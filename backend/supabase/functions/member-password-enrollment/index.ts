import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {
  createMemberPasswordEnrollmentController,
  type ControllerRuntime,
} from './controller.ts';
import type { RecoveryRuntime } from './recovery.ts';
import { validateOriginConfiguration } from './pureorigins.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const originConfiguration = validateOriginConfiguration({
  allowedOrigins: Deno.env.get('PHANTOMS_ALLOWED_ORIGINS'),
  appUrl: Deno.env.get('PHANTOMS_APP_URL'),
  disposableAuth: Deno.env.get('PHANTOMS_DISPOSABLE_AUTH'),
});
const configReady = Boolean(url && anonKey && serviceKey && originConfiguration.valid);
const safeUrl = url || 'https://invalid.local';
const safeAnonKey = anonKey || 'missing-anon-key';
const safeServiceKey = serviceKey || 'missing-service-key';
const configuredOrigins = originConfiguration.origins;

// A timeout is an ambiguous outcome, not permission to repeat a mutation.
// The controller quarantines that claim. No raw network/Auth error is logged.
const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000),
});

const serviceClient = createClient(safeUrl, safeServiceKey, {
  global: { fetch: boundedFetch },
  auth: { persistSession: false, autoRefreshToken: false },
});

const runtime = {
  configReady,
  serviceDb: serviceClient,
  adminDb: serviceClient,
  authAdmin: serviceClient,
  authorizeAdmin: async (authorization: string) => {
    if (!configReady || !authorization) return null;
    const adminClient = createClient(safeUrl, safeAnonKey, {
      global: { headers: { Authorization: authorization }, fetch: boundedFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await adminClient.auth.getUser();
    if (userError || !userData.user) return null;
    const { data: allowed, error: permissionError } = await adminClient.rpc('has_admin_permission', {
      p_permission: 'members',
    });
    if (permissionError || allowed !== true) return null;
    return { userId: userData.user.id };
  },
  sendRecoveryEmail: async (email: string, redirectTo: string, codeChallenge: string) => {
    // PKCE preserves the native recovery authentication method. Implicit recovery
    // emits OTP on pinned GoTrue and intentionally cannot satisfy our SQL proof.
    // The browser owns the verifier; neither this Edge nor Auth receives it here.
    const delivery = await boundedFetch(`${safeUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { apikey: safeAnonKey, Authorization: `Bearer ${safeAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code_challenge: codeChallenge, code_challenge_method: 's256' }),
    });
    return { error: delivery.ok ? null : { message: 'EMAIL_SEND_FAILED' } };
  },
  authorizeRecovery: async (authorization: string) => {
    if (!configReady || !authorization) return null;
    const recoveryClient = createClient(safeUrl, safeAnonKey, {
      global: { headers: { Authorization: authorization }, fetch: boundedFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await recoveryClient.auth.getUser();
    const email = userData.user?.email?.trim().toLowerCase() ?? '';
    if (userError || !userData.user?.id || !email) return null;
    return { userId: userData.user.id, email, db: recoveryClient };
  },
  // A member changing their password must still know the current one. GoTrue is
  // the only component that can check a bcrypt hash, so the Edge proves the
  // password with a password grant and discards the issued session.
  verifyMemberPassword: async (email: string, password: string) => {
    if (!configReady || !email || !password) return false;
    try {
      const verification = await boundedFetch(`${safeUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: safeAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const verified = verification.ok;
      await verification.body?.cancel().catch(() => undefined);
      return verified;
    } catch {
      return false;
    }
  },
} as ControllerRuntime & RecoveryRuntime;

serve(createMemberPasswordEnrollmentController(runtime, {
  allowedOrigins: configuredOrigins,
  recoveryRedirectTo: `${configuredOrigins[0]}/member/recovery`,
}));
