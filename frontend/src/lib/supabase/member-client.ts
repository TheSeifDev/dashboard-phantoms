import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/db';
import { MEMBER_AUTH_STORAGE_KEY, memberAuthStorage } from './member-auth-storage';
import { supabaseBaseUrl, supabaseDirectUrl } from './endpoints';
import { createSupabaseFetch } from './transport';

export { MEMBER_AUTH_STORAGE_KEY } from './member-auth-storage';

const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  ?? 'placeholder-anon-key';

// نفس طبقة النقل المرنة: بروكسي نفس الدومين أولاً، ورجوع تلقائي لـ Supabase
// مباشرة لو الشبكة قطعت الطلب — ومهلة أول بايت واضحة بدل تعليق المتصفح.
const resilientSupabaseFetch = createSupabaseFetch({
  primaryBase: supabaseBaseUrl,
  fallbackBase: supabaseDirectUrl,
});

export const memberSupabase = createClient<Database>(supabaseBaseUrl, supabaseAnonKey, {
  global: { fetch: resilientSupabaseFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: MEMBER_AUTH_STORAGE_KEY,
    storage: memberAuthStorage,
  },
});
