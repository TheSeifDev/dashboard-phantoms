import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../api/sb/[...path].ts', import.meta.url).href;
const { default: handler, upstreamUrlFor, config } = await import(moduleUrl);

const UPSTREAM = 'https://wxwoaputugxwysuhcebv.supabase.co';

test('upstreamUrlFor: بيحوّل مسار البروكسي لعنوان Supabase', () => {
  assert.equal(
    upstreamUrlFor('https://dashboard-phantoms.vercel.app/api/sb/auth/v1/token?grant_type=password'),
    `${UPSTREAM}/auth/v1/token?grant_type=password`,
  );
  assert.equal(
    upstreamUrlFor('https://dashboard-phantoms.vercel.app/api/sb/rest/v1/members?select=id'),
    `${UPSTREAM}/rest/v1/members?select=id`,
  );
});

test('upstreamUrlFor: بيرفض المسارات الغلط والتسلل', () => {
  assert.equal(upstreamUrlFor('https://dashboard-phantoms.vercel.app/api/sb'), null);
  assert.equal(upstreamUrlFor('https://dashboard-phantoms.vercel.app/api/sb/../secret'), null);
  assert.equal(upstreamUrlFor('https://dashboard-phantoms.vercel.app/api/sb//evil.example.com'), null);
  assert.equal(upstreamUrlFor('https://dashboard-phantoms.vercel.app/login'), null);
});

test('handler: بيمرّر الطلب لـ Supabase ويرجّع نفس الاستجابة', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method, apikey: new Headers(init?.headers).get('apikey') });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    });
  };

  try {
    const request = new Request('https://dashboard-phantoms.vercel.app/api/sb/auth/v1/health', {
      method: 'GET',
      headers: { apikey: 'sb_publishable_test', host: 'dashboard-phantoms.vercel.app' },
    });
    const response = await handler(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `${UPSTREAM}/auth/v1/health`);
    assert.equal(seen[0].apikey, 'sb_publishable_test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handler: بيرجّع 502 لو Supabase مش متاح', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  try {
    const response = await handler(new Request('https://dashboard-phantoms.vercel.app/api/sb/auth/v1/health'));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.message, 'UPSTREAM_UNREACHABLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handler: بيرفض المسار الغلط بـ400', async () => {
  const bad = await handler(new Request('https://dashboard-phantoms.vercel.app/api/sb'));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).message, 'INVALID_PROXY_PATH');
});

test('config: الدالة بتشتغل على Edge runtime', () => {
  assert.equal(config?.runtime, 'edge');
});

test('handler: بيرد على preflight بـ204 مع CORS للتطبيق الأصلي', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls += 1; return new Response('{}'); };
  try {
    const response = await handler(new Request('https://dashboard-phantoms.vercel.app/api/sb/auth/v1/token?grant_type=password', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'apikey,content-type',
      },
    }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-headers'), 'apikey,content-type');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handler: الاستجابة العادية بتحمل CORS', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await handler(new Request('https://dashboard-phantoms.vercel.app/api/sb/rest/v1/members'));
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
