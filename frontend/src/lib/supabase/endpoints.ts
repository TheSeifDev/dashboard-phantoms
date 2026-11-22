// =====================================================
// تحديد عنوان Supabase اللي التطبيق بيتكلم معاه
// =====================================================
// الافتراضي: نفس دومين التطبيق + /api/sb (بروكسي على Vercel Edge) عشان
// يشتغل حتى لو الشبكة بتحجب *.supabase.co.
// في التطوير المحلي (http) بنروح على Supabase مباشرة.
// =====================================================

/** العنوان الرسمي لمشروع Supabase — بنستخدمه كخطة بديلة (failover). */
export const SUPABASE_DIRECT_URL_FALLBACK = 'https://wxwoaputugxwysuhcebv.supabase.co';

/** مسار البروكسي على نفس الدومين (Vercel Edge Function). */
export const SUPABASE_PROXY_PATH = '/api/sb';

/** أصل النشر الرسمي — بيستخدم كمرجع للتطبيق الأصلي (Capacitor) اللي أصله localhost. */
export const SUPABASE_PUBLIC_ORIGIN = 'https://dashboard-phantoms.vercel.app';

export interface ProxyBaseParams {
  origin?: string;
  protocol?: string;
  native?: boolean;
  disabled?: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(origin);
}

/** عنوان Supabase المباشر (من env أو الافتراضي). */
export function readDirectSupabaseUrl(rawValue?: string | null): string {
  const value = (rawValue ?? '').trim();
  if (!value) return SUPABASE_DIRECT_URL_FALLBACK;
  return trimTrailingSlash(value);
}

/**
 * عنوان البروكسي اللي المفروض التطبيق يستخدمه، أو null لو مش متاح
 * (تطوير محلي، أو env عطّله، أو أصل غير https).
 */
export function resolveSupabaseProxyBase(params: ProxyBaseParams = {}): string | null {
  if (params.disabled) return null;
  if (params.native) return `${SUPABASE_PUBLIC_ORIGIN}${SUPABASE_PROXY_PATH}`;
  const origin = trimTrailingSlash((params.origin ?? '').trim());
  const protocol = (params.protocol ?? '').trim();
  if (!origin || protocol !== 'https:') return null;
  if (isLoopbackOrigin(origin)) return null;
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return null;
  return `${origin}${SUPABASE_PROXY_PATH}`;
}

interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PROXY?: string;
}

function readEnv(): SupabaseEnv {
  try {
    const meta = import.meta as ImportMeta & { env?: SupabaseEnv };
    return meta.env ?? {};
  } catch {
    return {};
  }
}

function detectNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const capacitor = (window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }).Capacitor;
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform();
    if (typeof capacitor.getPlatform === 'function') return capacitor.getPlatform() !== 'web';
  } catch {
    return false;
  }
  return false;
}

const env = readEnv();

/** العنوان المباشر لمشروع Supabase. */
export const supabaseDirectUrl = readDirectSupabaseUrl(env.VITE_SUPABASE_URL);

/** البروكسي المتاح حالياً (أو null). */
export const supabaseProxyBase = resolveSupabaseProxyBase({
  origin: typeof window === 'undefined' ? '' : window.location.origin,
  protocol: typeof window === 'undefined' ? '' : window.location.protocol,
  native: detectNativeShell(),
  disabled: env.VITE_SUPABASE_PROXY === '0' || env.VITE_SUPABASE_PROXY === 'false',
});

/** العنوان الأساسي اللي supabase-js هيبني عليه كل الطلبات. */
export const supabaseBaseUrl = supabaseProxyBase ?? supabaseDirectUrl;
