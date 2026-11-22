import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SupabaseTransportError,
  buildCandidateUrls,
  createSupabaseFetch,
  isSupabaseTransportError,
  isTransportFailure,
  transportFailureReason,
} from '../src/lib/supabase/transport';

const PROXY = 'https://dashboard-phantoms.vercel.app/api/sb';
const DIRECT = 'https://wxwoaputugxwysuhcebv.supabase.co';
const TOKEN_PATH = '/auth/v1/token?grant_type=password';

test('buildCandidateUrls: يرجع البروكسي الأول وبعده العنوان المباشر', () => {
  assert.deepEqual(
    buildCandidateUrls(`${PROXY}${TOKEN_PATH}`, PROXY, DIRECT),
    [`${PROXY}${TOKEN_PATH}`, `${DIRECT}${TOKEN_PATH}`],
  );
  assert.deepEqual(
    buildCandidateUrls(`${DIRECT}${TOKEN_PATH}`, PROXY, DIRECT),
    [`${DIRECT}${TOKEN_PATH}`, `${PROXY}${TOKEN_PATH}`],
  );
});

test('buildCandidateUrls: عنوان خارج الاتنين يفضل زي ما هو', () => {
  const external = 'https://api.github.com/user';
  assert.deepEqual(buildCandidateUrls(external, PROXY, DIRECT), [external]);
  assert.deepEqual(buildCandidateUrls(external, null, DIRECT), [external]);
});

test('createSupabaseFetch: يفشل على البروكسي فيكمّل على Supabase مباشرة', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(PROXY)) throw new TypeError('Failed to fetch');
    return new Response('{"access_token":"ok"}', { status: 200 });
  }) as typeof fetch;

  const resilientFetch = createSupabaseFetch({ primaryBase: PROXY, fallbackBase: DIRECT, fetchImpl: fakeFetch });
  const response = await resilientFetch(`${PROXY}${TOKEN_PATH}`, { method: 'POST', body: '{}' });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [`${PROXY}${TOKEN_PATH}`, `${DIRECT}${TOKEN_PATH}`]);
});

test('createSupabaseFetch: أول محاولة ناجحة مبتبعتش طلب تاني', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const resilientFetch = createSupabaseFetch({ primaryBase: PROXY, fallbackBase: DIRECT, fetchImpl: fakeFetch });
  await resilientFetch(`${PROXY}/rest/v1/members`, { method: 'GET' });

  assert.deepEqual(calls, [`${PROXY}/rest/v1/members`]);
});

test('createSupabaseFetch: فشل الاتنين بيرمي خطأ نقل واضح', async () => {
  const fakeFetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  const resilientFetch = createSupabaseFetch({ primaryBase: PROXY, fallbackBase: DIRECT, fetchImpl: fakeFetch });

  await assert.rejects(
    () => resilientFetch(`${PROXY}${TOKEN_PATH}`, { method: 'POST', body: '{}' }),
    (error: unknown) => {
      assert.ok(isSupabaseTransportError(error));
      assert.equal((error as SupabaseTransportError).reason, 'unreachable');
      return true;
    },
  );
});

test('createSupabaseFetch: المهلة الزمنية بتتحول لسبب timeout', async () => {
  const fakeFetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    });
  })) as typeof fetch;

  const resilientFetch = createSupabaseFetch({
    primaryBase: null,
    fallbackBase: DIRECT,
    fetchImpl: fakeFetch,
    timeToFirstByteMs: 10,
  });

  await assert.rejects(
    () => resilientFetch(`${DIRECT}${TOKEN_PATH}`, { method: 'POST', body: '{}' }),
    (error: unknown) => {
      assert.ok(isSupabaseTransportError(error));
      assert.equal((error as SupabaseTransportError).reason, 'timeout');
      assert.equal(transportFailureReason(error), 'timeout');
      return true;
    },
  );
});

test('createSupabaseFetch: إلغاء المتصل مش بيتم إعادة المحاولة عليه', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted by caller');
        error.name = 'AbortError';
        reject(error);
      });
    });
  }) as typeof fetch;

  const controller = new AbortController();
  const resilientFetch = createSupabaseFetch({ primaryBase: PROXY, fallbackBase: DIRECT, fetchImpl: fakeFetch });
  const pending = resilientFetch(`${PROXY}${TOKEN_PATH}`, { method: 'POST', body: '{}', signal: controller.signal });
  controller.abort();

  await assert.rejects(() => pending);
  assert.equal(calls.length, 1);
});

test('isTransportFailure: بيعرف أخطاء الشبكة والـ transport بس', () => {
  assert.equal(isTransportFailure(new TypeError('Failed to fetch')), true);
  assert.equal(isTransportFailure(new SupabaseTransportError('timeout', DIRECT)), true);
  assert.equal(isTransportFailure(new Error('Invalid login credentials')), false);
  assert.equal(isTransportFailure({ status: 400, code: 'invalid_credentials' }), false);
});
