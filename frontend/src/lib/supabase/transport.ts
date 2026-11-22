// =====================================================
// طبقة نقل (transport) مرنة لطلبات Supabase
// =====================================================
// 1) بتدي كل طلب مهلة زمنية واضحة لأول بايت (time to first byte) بدل
//    ما المتصفح يعلّق دقايق على شبكة ضعيفة.
// 2) لو الطلب فشل على البروكسي (نفس الدومين) بتعيده على Supabase مباشرة،
//    والعكس — عشان أي حجب أو انقطاع في أي اتجاه ما يمنعش تسجيل الدخول.
// 3) بترمي خطأ نقل واضح (SupabaseTransportError) عشان الواجهة تفرّق بين
//    "مشكلة شبكة" و"بيانات دخول غلط".
// =====================================================

export type SupabaseTransportReason = 'timeout' | 'network' | 'unreachable';

export class SupabaseTransportError extends Error {
  readonly reason: SupabaseTransportReason;
  readonly url: string;

  constructor(reason: SupabaseTransportReason, url: string, cause?: unknown) {
    super(`SUPABASE_TRANSPORT_${reason.toUpperCase()}:${url}`);
    this.name = 'SupabaseTransportError';
    this.reason = reason;
    this.url = url;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function isSupabaseTransportError(error: unknown): error is SupabaseTransportError {
  return error instanceof SupabaseTransportError;
}

/** هل الخطأ ده فشل اتصال (يستحق إعادة محاولة على مسار تاني)؟ */
export function isTransportFailure(error: unknown): boolean {
  if (error instanceof SupabaseTransportError) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('network error')
      || message.includes('load failed')
      || message.includes('fetch failed');
  }
  return false;
}

/** سبب فشل الاتصال بشكل مختصر للاستخدام في الرسائل. */
export function transportFailureReason(error: unknown): SupabaseTransportReason {
  if (error instanceof SupabaseTransportError) return error.reason;
  return 'network';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * يبني قائمة عناوين المحاولة: العنوان الأصلي الأول، وبعده المسار البديل
 * (بروكسي ↔ مباشر) لو الطلب كان على واحد منهم.
 */
export function buildCandidateUrls(url: string, primaryBase: string | null, fallbackBase: string | null): string[] {
  if (!isAbsoluteHttpUrl(url)) return [url];
  const bases = [primaryBase, fallbackBase].filter((base): base is string => Boolean(base));
  if (bases.length < 2 || primaryBase === fallbackBase) return [url];
  const primary = trimTrailingSlash(primaryBase as string);
  const fallback = trimTrailingSlash(fallbackBase as string);
  const candidates: string[] = [url];
  if (url.startsWith(`${primary}/`)) candidates.push(`${fallback}${url.slice(primary.length)}`);
  else if (url.startsWith(`${fallback}/`)) candidates.push(`${primary}${url.slice(fallback.length)}`);
  return candidates;
}

export interface SupabaseFetchOptions {
  primaryBase: string | null;
  fallbackBase: string | null;
  /** أقصى مدة لانتظار أول بايت من الخادم (مش مدة تحميل الرد كله). */
  timeToFirstByteMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TTFB_MS = 25_000;

export function createSupabaseFetch(options: SupabaseFetchOptions): typeof fetch {
  const {
    primaryBase,
    fallbackBase,
    timeToFirstByteMs = DEFAULT_TTFB_MS,
    fetchImpl = globalThis.fetch.bind(globalThis),
  } = options;

  const supabaseFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (upstreamSignal?.aborted) throw upstreamSignal.reason ?? new DOMException('Aborted', 'AbortError');

    let baseInit: RequestInit = init ?? {};
    if (input instanceof Request) {
      baseInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        integrity: input.integrity,
        keepalive: input.keepalive,
        ...baseInit,
        signal: upstreamSignal,
      };
    }

    const candidates = buildCandidateUrls(rawUrl, primaryBase, fallbackBase);
    // جسم الطلب في Request بيتقرأ مرة واحدة بس — مانعيدش المحاولة في الحالة دي.
    const retryable = !(input instanceof Request && input.body !== null);
    const attempts = retryable ? candidates : candidates.slice(0, 1);
    let lastError: unknown = null;

    for (let index = 0; index < attempts.length; index += 1) {
      const target = attempts[index];
      const controller = new AbortController();
      let timedOut = false;
      const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
      upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
      const timer = timeToFirstByteMs > 0
        ? globalThis.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeToFirstByteMs)
        : null;

      try {
        return await fetchImpl(target, { ...baseInit, signal: controller.signal });
      } catch (error) {
        if (upstreamSignal?.aborted) throw error;
        if (timedOut) lastError = new SupabaseTransportError('timeout', target, error);
        else if (isAbortError(error) || isTransportFailure(error)) lastError = new SupabaseTransportError('network', target, error);
        else throw error;
      } finally {
        if (timer !== null) globalThis.clearTimeout(timer);
        upstreamSignal?.removeEventListener('abort', abortFromUpstream);
      }
    }

    // مسار واحد بس: نرجّع السبب الحقيقي (مهلة/شبكة) بدل "غير معروف".
    if (attempts.length === 1 && lastError instanceof SupabaseTransportError) throw lastError;
    throw new SupabaseTransportError('unreachable', rawUrl, lastError);
  };

  return supabaseFetch as typeof fetch;
}
