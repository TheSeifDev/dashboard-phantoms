import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/db';
import { memberSupabase } from '../../lib/supabase/member-client';
import { normalizeAuthEmail, validateMemberPassword } from './member-password';
import { isValidEmail } from '../../lib/validators';
import type { MemberRecoveryCallback } from './member-recovery';

export class MemberRecoveryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const codes = new Set(['INVALID_INPUT', 'INVALID_TOKEN', 'UNAUTHORIZED', 'WEAK_PASSWORD', 'PASSWORD_MISMATCH', 'RATE_LIMITED', 'REVIEW_REQUIRED', 'SERVER_UNAVAILABLE', 'SERVER_CONFIG', 'IDENTITY_CONFLICT', 'MEMBER_SESSION_REQUIRED']);
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';
const VERIFIER_KEY = 'phantoms-member-recovery-pkce-v1';
const VERIFIER_TTL = 30 * 60 * 1000;
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
export function createMemberRecoveryClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'phantoms-member-recovery-ephemeral', flowType: 'pkce' },
    global: { fetch: boundedFetch },
  });
}
async function invokeRecovery(client: SupabaseClient<Database>, body: Record<string, string>, requireActive = false): Promise<void> {
  const { data, error } = await client.functions.invoke('member-password-enrollment', { body });
  let code: unknown = data?.code;
  if (error && error.context instanceof Response) {
    try { code = (await error.context.json() as { code?: unknown }).code; } catch { /* Never expose raw provider errors. */ }
  }
  if (error || data?.ok !== true || (requireActive && data?.membership !== 'active')) throw new MemberRecoveryError(typeof code === 'string' && codes.has(code) ? code : requireActive ? 'REVIEW_REQUIRED' : 'SERVER_UNAVAILABLE');
}
function consumeVerifier(): string {
  try {
    const raw = localStorage.getItem(VERIFIER_KEY);
    localStorage.removeItem(VERIFIER_KEY);
    if (!raw) throw new Error();
    const record = JSON.parse(raw) as { verifier?: unknown; createdAt?: unknown };
    if (typeof record.verifier !== 'string' || !/^[0-9a-f]{64}$/.test(record.verifier)
        || typeof record.createdAt !== 'number' || record.createdAt > Date.now()
        || Date.now() - record.createdAt > VERIFIER_TTL) throw new Error();
    return record.verifier;
  } catch { throw new MemberRecoveryError('INVALID_TOKEN'); }
}
export async function requestMemberRecovery(email: string): Promise<void> {
  const normalized = normalizeAuthEmail(email);
  if (!isValidEmail(normalized) || normalized.length > 254) throw new MemberRecoveryError('INVALID_INPUT');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const codeChallenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, createdAt: Date.now() })); }
  catch { throw new MemberRecoveryError('SERVER_UNAVAILABLE'); }
  try { await invokeRecovery(memberSupabase, { action: 'request_recovery', email: normalized, codeChallenge }); }
  catch (error) {
    try { if (JSON.parse(localStorage.getItem(VERIFIER_KEY) ?? '{}').verifier === verifier) localStorage.removeItem(VERIFIER_KEY); } catch { /* storage may be unavailable */ }
    throw error;
  }
}
export async function verifyMemberRecovery(client: SupabaseClient<Database>, callback: MemberRecoveryCallback): Promise<string> {
  if (callback.kind !== 'code') throw new MemberRecoveryError('INVALID_TOKEN');
  const verifier = consumeVerifier();
  // Only a native PKCE code exchange produces signed + durable recovery AMR.
  // No verifier, access token, refresh token or password enters ordinary stores.
  const exchanged = await boundedFetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: callback.code, code_verifier: verifier }),
  });
  if (!exchanged.ok) throw new MemberRecoveryError('INVALID_TOKEN');
  const session = await exchanged.json() as { access_token?: unknown; refresh_token?: unknown };
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') throw new MemberRecoveryError('INVALID_TOKEN');
  const result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (result.error || !result.data.session?.user.id) throw new MemberRecoveryError('INVALID_TOKEN');
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.id || data.user.id !== result.data.session.user.id || !data.user.email) throw new MemberRecoveryError('INVALID_TOKEN');
  const access = await client.rpc('member_password_self_recovery_access');
  if (access.error || access.data !== true) throw new MemberRecoveryError('UNAUTHORIZED');
  return normalizeAuthEmail(data.user.email);
}
export async function completeMemberRecovery(client: SupabaseClient<Database>, password: string, confirmPassword: string): Promise<void> {
  const valid = validateMemberPassword(password, confirmPassword);
  if (!valid.ok) throw new MemberRecoveryError(password !== confirmPassword ? 'PASSWORD_MISMATCH' : 'WEAK_PASSWORD');
  await invokeRecovery(client, { action: 'complete_recovery', password, confirmPassword }, true);
}
