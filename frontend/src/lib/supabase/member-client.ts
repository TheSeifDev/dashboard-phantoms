import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/db';
import { MEMBER_AUTH_STORAGE_KEY, memberAuthStorage } from './member-auth-storage';

export { MEMBER_AUTH_STORAGE_KEY } from './member-auth-storage';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  ?? 'placeholder-anon-key';
const memberAuthTimeoutMs = 12_000;
const nativeFetch = globalThis.fetch.bind(globalThis);

const fetchWithMemberAuthTimeout: typeof fetch = async (input, init) => {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return nativeFetch(input, init);
  }
  const isPasswordSignIn = url.pathname.endsWith('/auth/v1/token')
    && url.searchParams.get('grant_type') === 'password';
  if (!isPasswordSignIn) return nativeFetch(input, init);

  const controller = new AbortController();
  const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abortWithUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortWithUpstream();
  else upstreamSignal?.addEventListener('abort', abortWithUpstream, { once: true });
  const timeoutId = globalThis.setTimeout(() => controller.abort(), memberAuthTimeoutMs);
  try {
    return await nativeFetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', abortWithUpstream);
  }
};

export const memberSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithMemberAuthTimeout },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: MEMBER_AUTH_STORAGE_KEY,
    storage: memberAuthStorage,
  },
});
