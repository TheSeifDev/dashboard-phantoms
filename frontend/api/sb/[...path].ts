// =====================================================
// Same-origin Supabase proxy (Vercel Edge Function)
// =====================================================
// بعض شبكات المشغلين (وعدد من مزودي الإنترنت في مصر) بتحجب أو بتقطع
// الاتصال بـ *.supabase.co، فالطلب بيفشل من المتصفح قبل ما يوصل للخادم
// ("Failed to fetch") — وده اللي كان بيظهر كـ "معرفناش نتصل بالخادم"
// أو كـ "البريد أو كلمة المرور غير صحيحة".
//
// الدالة دي بتخلي التطبيق يتكلم مع نفس الدومين بتاعه (/api/sb/...) وهي
// بتوصّل الطلب لـ Supabase من عند الحافة (Edge) بدل متصفح المستخدم.
// =====================================================

const UPSTREAM_ORIGIN = 'https://wxwoaputugxwysuhcebv.supabase.co';
const PATH_PREFIX = '/api/sb';

const REQUEST_HEADER_BLOCKLIST = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

const RESPONSE_HEADER_BLOCKLIST = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'proxy-authenticate',
  'trailer',
  'upgrade',
]);

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// نفس سياسة CORS اللي Supabase بيبعتها، عشان التطبيق الأصلي (Capacitor)
// اللي أصله https://localhost يقدر يستخدم البروكسي برضه.
const ALLOWED_METHOD_LIST = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS';

function corsHeaders(request?: Request): Headers {
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': ALLOWED_METHOD_LIST,
    'access-control-max-age': '86400',
  });
  const requested = request?.headers.get('access-control-request-headers');
  headers.set('access-control-allow-headers', requested && requested.trim() ? requested : 'authorization,apikey,content-type,x-client-info,prefer,accept,accept-profile,content-profile,x-supabase-api-version,range');
  headers.set('access-control-expose-headers', 'content-range,content-location,x-supabase-api-version');
  return headers;
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function forwardRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    const name = key.toLowerCase();
    if (REQUEST_HEADER_BLOCKLIST.has(name) || name.startsWith('x-vercel-')) return;
    headers.set(name, value);
  });
  return headers;
}

function forwardResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    const name = key.toLowerCase();
    if (RESPONSE_HEADER_BLOCKLIST.has(name) || name.startsWith('x-vercel-')) return;
    headers.set(name, value);
  });
  // ممنوع كاش للطلبات المصادَق عليها (الجلسة بتتغير كل لحظة).
  headers.set('cache-control', 'no-store');
  return headers;
}

export function upstreamUrlFor(requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith(PATH_PREFIX)) return null;
  const rest = parsed.pathname.slice(PATH_PREFIX.length);
  if (!rest.startsWith('/') || rest.includes('..') || rest.startsWith('//')) return null;
  return `${UPSTREAM_ORIGIN}${rest}${parsed.search}`;
}

export default async function handler(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return new Response(JSON.stringify({ message: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const target = upstreamUrlFor(request.url);
  if (!target) {
    return new Response(JSON.stringify({ message: 'INVALID_PROXY_PATH' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // preflight: بنرد إحنا بدل ما نروح لـ Supabase
  if (method === 'OPTIONS') {
    const headers = corsHeaders(request);
    headers.set('cache-control', 'no-store');
    return new Response(null, { status: 204, headers });
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  try {
    const upstream = await fetch(target, {
      method,
      headers: forwardRequestHeaders(request.headers),
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      // Edge runtime يقبل البث الثنائي للجسم.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit & { duplex?: 'half' });

    return withCors(new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: forwardResponseHeaders(upstream.headers),
    }), request);
  } catch (error) {
    return withCors(new Response(JSON.stringify({
      message: 'UPSTREAM_UNREACHABLE',
      detail: error instanceof Error ? error.message : String(error),
    }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }), request);
  }
}

export const config = { runtime: 'edge' };
