import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberPasswordEnrollmentController, type ControllerRuntime, type RpcClient } from './controller.ts';

type State = {
  rate: boolean;
  health: boolean;
  reserve: { invitation_id: string; claim_id: string; member_id: number; email: string; purpose: 'enroll' | 'reset'; expected_auth_user_id: string | null } | null;
  reserveError: string | null;
  identity: { exists: boolean; auth_user_id?: string; has_password?: boolean; is_admin?: boolean };
  identityState: { exists: boolean; auth_user_id?: string; email_matches?: boolean; has_password?: boolean; is_admin?: boolean; usable?: boolean };
  complete: boolean;
  authCreate: { id: string } | null;
  authCreateError: string | null;
  authUpdate: { id: string } | null;
  authUpdateError: string | null;
  calls: Array<{ client: string; name: string; args?: Record<string, unknown> }>;
  reviews: Array<{ invitation_id: string; claim_id: string }>;
};

const baseState = (): State => ({
  rate: false,
  health: true,
  reserve: { invitation_id: '11111111-1111-4111-8111-111111111111', claim_id: '22222222-2222-4222-8222-222222222222', member_id: 9, email: 'member@phantoms-test.example', purpose: 'enroll', expected_auth_user_id: null },
  reserveError: null,
  identity: { exists: false },
  identityState: { exists: true, email_matches: true, has_password: false, is_admin: false, usable: true },
  complete: true,
  authCreate: { id: '33333333-3333-4333-8333-333333333333' },
  authCreateError: null,
  authUpdate: null,
  authUpdateError: null,
  calls: [],
  reviews: [],
});

function fakeRuntime(state: State, authorizedAdmin = true): ControllerRuntime {
  const client = (name: string): RpcClient => ({
    async rpc<T = unknown>(rpcName: string, args?: Record<string, unknown>) {
      state.calls.push({ client: name, name: rpcName, args });
      if (rpcName === 'member_password_check_rate_limit') return { data: state.rate as T, error: null };
      if (rpcName === 'member_password_service_health') return state.health
        ? { data: true as T, error: null } : { data: null, error: { message: 'health unavailable' } };
      if (rpcName === 'member_password_reserve') return state.reserveError
        ? { data: null, error: { message: state.reserveError } } : { data: state.reserve as T, error: null };
      if (rpcName === 'member_password_identity_by_email') return { data: state.identity as T, error: null };
      if (rpcName === 'member_password_identity_state') return { data: {
        auth_user_id: state.reserve?.expected_auth_user_id,
        ...state.identityState,
      } as T, error: null };
      if (rpcName === 'member_password_complete') return state.complete
        ? { data: { ok: true } as T, error: null } : { data: null, error: { message: 'completion unavailable' } };
      if (rpcName === 'member_password_mark_review_required') {
        state.reviews.push({ invitation_id: String(args?.p_invitation_id), claim_id: String(args?.p_claim_id) });
        return { data: true as T, error: null };
      }
      if (rpcName === 'member_password_issue_invitation') return { data: {
        id: '55555555-5555-4555-8555-555555555555', member_id: 9, email: 'member@phantoms-test.example', purpose: 'enroll', note: '', expires_at: '2030-01-01T00:00:00.000Z',
      } as T, error: null };
      if (rpcName === 'member_password_revoke_invitation') return { data: true as T, error: null };
      if (rpcName === 'member_password_list_invitations') return { data: [] as T, error: null };
      return { data: null, error: { message: 'unexpected rpc' } };
    },
  });
  return {
    configReady: true,
    serviceDb: client('service'),
    adminDb: client('admin'),
    authAdmin: {
      auth: {
        admin: {
          async createUser(attributes) {
            state.calls.push({ client: 'auth', name: 'createUser', args: attributes });
            return state.authCreateError ? { data: null, error: { message: state.authCreateError } } : { data: { user: state.authCreate ?? undefined }, error: null };
          },
          async updateUserById(userId, attributes) {
            state.calls.push({ client: 'auth', name: 'updateUserById', args: { userId, ...attributes } });
            return state.authUpdateError ? { data: null, error: { message: state.authUpdateError } } : { data: { user: state.authUpdate ?? { id: userId } }, error: null };
          },
        },
      },
    },
    async authorizeAdmin(authorization) {
      return authorizedAdmin && authorization === 'Bearer admin' ? { userId: '66666666-6666-4666-8666-666666666666' } : null;
    },
  };
}

const token = 'phpw_' + 'a'.repeat(64);
const enrollBody = (overrides: Record<string, unknown> = {}) => ({
  action: 'enroll', email: 'member@phantoms-test.example', token,
  password: 'StrongMemberPassword1', confirmPassword: 'StrongMemberPassword1', ...overrides,
});
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://local.test/member-password-enrollment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dashboard-phantoms.vercel.app', ...headers }, body: JSON.stringify(body),
});
const json = async (res: Response) => await res.json() as Record<string, unknown>;

// These tests exercise the actual request controller with fake service/Auth
// boundaries. They do not validate GoTrue, PostgREST, RLS, or SQL behavior.
test('valid new-member enrollment provisions confirmed Auth user then completes DB claim', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const result = await json(await controller(request(enrollBody())));
  assert.deepEqual(result, { ok: true });
  const create = state.calls.find((call) => call.name === 'createUser');
  assert.equal(create?.args?.email, 'member@phantoms-test.example');
  assert.equal(create?.args?.email_confirm, true);
  assert.equal(state.calls.some((call) => call.name === 'member_password_complete'), true);
  assert.equal(state.calls.filter((call) => call.name === 'member_password_check_rate_limit').length, 2);
  assert.equal(state.reviews.length, 0);
});

test('password mismatch, weak password, extra key, and malformed token stop before reservation', async () => {
  for (const [body, expected] of [
    [enrollBody({ confirmPassword: 'DifferentPassword1' }), 'PASSWORD_MISMATCH'],
    [enrollBody({ password: 'short1', confirmPassword: 'short1' }), 'WEAK_PASSWORD'],
    [enrollBody({ extra: 'reject' }), 'INVALID_INPUT'],
    [enrollBody({ token: 'legacy-token' }), 'INVALID_INPUT'],
  ] as const) {
    const state = baseState();
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(body)));
    assert.equal(result.code, expected);
    assert.equal(state.calls.some((call) => call.name === 'member_password_reserve'), false);
    assert.equal(state.calls.some((call) => call.name === 'createUser' || call.name === 'updateUserById'), false);
  }
});

test('password validation follows the real GoTrue UTF-8 byte boundary without trimming', async () => {
  for (const [password, expected] of [
    [`A1${'a'.repeat(70)}`, true],
    [`A1${'a'.repeat(71)}`, false],
    [`A1${'a'.repeat(126)}`, false],
    [`A1${'Ж'.repeat(35)}`, true],
    [`A1${'Ж'.repeat(35)}a`, false],
    [`A1${'Ж'.repeat(70)}`, false],
  ] as const) {
    const state = baseState();
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody({ password, confirmPassword: password }))));
    assert.equal(result.code === undefined, expected, `unexpected validation result for ${password.length} code units`);
    if (expected) assert.equal(state.calls.some((call) => call.name === 'createUser'), true);
    else assert.equal(state.calls.some((call) => call.name === 'member_password_reserve'), false);
  }

  const significantWhitespace = 'A1abcdefghi ';
  const state = baseState();
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request(enrollBody({ password: significantWhitespace, confirmPassword: significantWhitespace })),
  ));
  assert.deepEqual(result, { ok: true });
  assert.equal(state.calls.find((call) => call.name === 'createUser')?.args?.password, significantWhitespace);
  assert.notEqual(state.calls.find((call) => call.name === 'createUser')?.args?.password, significantWhitespace.trim());
});

test('safe public errors map invalid, expired, revoked, reused, and wrong-email reservations', async () => {
  for (const [error, expected] of [
    ['INVALID_TOKEN', 'INVALID_TOKEN'], ['EXPIRED', 'EXPIRED'], ['REVOKED', 'REVOKED'],
    ['ALREADY_USED', 'ALREADY_USED'], ['WRONG_EMAIL', 'WRONG_EMAIL'],
  ] as const) {
    const state = baseState(); state.reserveError = error;
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
    assert.equal(result.code, expected);
    assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  }
});

test('existing OTP identity uses exact update path and never calls createUser', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, purpose: 'enroll', expected_auth_user_id: '77777777-7777-4777-8777-777777777777' };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
  assert.deepEqual(result, { ok: true });
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  const update = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(update?.args?.userId, state.reserve.expected_auth_user_id);
  assert.equal(update?.args?.email_confirm, true);
});

test('reset purpose updates the exact existing Auth ID without enrollment fallback', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, purpose: 'reset', expected_auth_user_id: '88888888-8888-4888-8888-888888888888' };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
  assert.deepEqual(result, { ok: true });
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  const update = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(update?.args?.email_confirm, undefined);
});

test('existing password, admin collision, and Auth identity collision fail closed and quarantine reservation', async () => {
  const passworded = baseState(); passworded.reserve = { ...passworded.reserve!, expected_auth_user_id: '99999999-9999-4999-8999-999999999999' }; passworded.identityState.has_password = true;
  const passwordResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(passworded))(request(enrollBody())));
  assert.equal(passwordResult.code, 'PASSWORD_ALREADY_SET'); assert.equal(passworded.reviews.length, 1);

  const admin = baseState(); admin.reserve = { ...admin.reserve!, expected_auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }; admin.identityState.is_admin = true;
  const adminResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(admin))(request(enrollBody())));
  assert.equal(adminResult.code, 'IDENTITY_CONFLICT'); assert.equal(admin.reviews.length, 1);

  const collision = baseState(); collision.identity = { exists: true, auth_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const collisionResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(collision))(request(enrollBody())));
  assert.equal(collisionResult.code, 'IDENTITY_CONFLICT'); assert.equal(collision.reviews.length, 1);
});

test('uncertain Auth write and uncertain completion become review_required with no retry', async () => {
  const authFailure = baseState(); authFailure.authCreateError = 'remote timeout';
  const authResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(authFailure))(request(enrollBody())));
  assert.equal(authResult.code, 'REVIEW_REQUIRED'); assert.equal(authFailure.reviews.length, 1);

  const completionFailure = baseState(); completionFailure.complete = false;
  const completionResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(completionFailure))(request(enrollBody())));
  assert.equal(completionResult.code, 'REVIEW_REQUIRED'); assert.equal(completionFailure.reviews.length, 1);
});

test('missing server configuration, health failure, and limiter failure deny before provisioning', async () => {
  const noConfig = baseState(); const noConfigRuntime = fakeRuntime(noConfig); noConfigRuntime.configReady = false;
  const configResult = await json(await createMemberPasswordEnrollmentController(noConfigRuntime)(request(enrollBody())));
  assert.equal(configResult.code, 'SERVER_CONFIG'); assert.equal(noConfig.calls.length, 0);

  const unhealthy = baseState(); unhealthy.health = false;
  const healthResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(unhealthy))(request(enrollBody())));
  assert.equal(healthResult.code, 'SERVER_UNAVAILABLE'); assert.equal(unhealthy.calls.some((call) => call.name === 'member_password_reserve'), false);

  const limited = baseState(); limited.rate = true;
  const limitedResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(limited))(request(enrollBody())));
  assert.equal(limitedResult.code, 'RATE_LIMITED'); assert.equal(limited.calls.some((call) => call.name === 'member_password_reserve'), false);
});

test('admin issue is authenticated, strict, and returns a one-time server-generated token', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const body = { action: 'issue', memberId: 9, email: 'member@phantoms-test.example', purpose: 'enroll', expiresInHours: 24, note: 'reviewed' };
  const result = await json(await controller(request(body, { Authorization: 'Bearer admin' })));
  assert.equal(typeof (result.invite as Record<string, unknown>).token, 'string');
  assert.match(String((result.invite as Record<string, unknown>).token), /^phpw_[0-9a-f]{64}$/);
  assert.equal(state.calls.find((call) => call.name === 'member_password_issue_invitation')?.client, 'admin');

  const unauthorized = await json(await controller(request(body)));
  assert.equal(unauthorized.code, 'UNAUTHORIZED');
  const malformed = await json(await controller(request({ ...body, unexpected: true }, { Authorization: 'Bearer admin' })));
  assert.equal(malformed.code, 'INVALID_INPUT');
});

test('admin list and revoke require admin permission and expose no token material', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const list = await json(await controller(request({ action: 'list' }, { Authorization: 'Bearer admin' })));
  assert.deepEqual(list, { invites: [] });
  const revoke = await json(await controller(request({ action: 'revoke', inviteId: '11111111-1111-4111-8111-111111111111' }, { Authorization: 'Bearer admin' })));
  assert.deepEqual(revoke, { ok: true });
  const outsider = await json(await createMemberPasswordEnrollmentController(fakeRuntime(baseState(), false))(request({ action: 'list' }, { Authorization: 'Bearer admin' })));
  assert.equal(outsider.code, 'UNAUTHORIZED');
});

test('origin, method, max body, and CORS behavior are fail-closed', async () => {
  const state = baseState(); const controller = createMemberPasswordEnrollmentController(fakeRuntime(state), { maxBodyBytes: 100 });
  const forbidden = await controller(request(enrollBody(), { Origin: 'https://evil.example' }));
  assert.equal(forbidden.status, 403);
  const get = await controller(new Request('https://local.test/member-password-enrollment', { method: 'GET', headers: { Origin: 'https://dashboard-phantoms.vercel.app' } }));
  assert.equal((await json(get)).code, 'INVALID_INPUT');
  const oversized = await controller(new Request('https://local.test/member-password-enrollment', { method: 'POST', headers: { Origin: 'https://dashboard-phantoms.vercel.app', 'content-length': '1000' }, body: '{}' }));
  assert.equal((await json(oversized)).code, 'INVALID_INPUT');
});

test('limiting starts after bounded validation and uses independent credential/actor budgets', async () => {
  const malformedState = baseState();
  const malformed = await json(await createMemberPasswordEnrollmentController(fakeRuntime(malformedState))(
    request({ action: 'unknown', payload: 'x' }),
  ));
  assert.equal(malformed.code, 'INVALID_INPUT');
  assert.equal(malformedState.calls.filter((call) => call.name === 'member_password_check_rate_limit').length, 0);

  const enrollState = baseState();
  await createMemberPasswordEnrollmentController(fakeRuntime(enrollState))(request(enrollBody()));
  const enrollKeys = enrollState.calls.filter((call) => call.name === 'member_password_check_rate_limit');
  assert.equal(enrollKeys.length, 2);
  assert.notEqual(enrollKeys[0]?.args?.p_key_hash, enrollKeys[1]?.args?.p_key_hash);

  const adminState = baseState();
  await createMemberPasswordEnrollmentController(fakeRuntime(adminState))(request({ action: 'list' }, { Authorization: 'Bearer admin' }));
  assert.equal(adminState.calls.filter((call) => call.name === 'member_password_check_rate_limit').length, 1);
});

test('a mismatched Auth update response is quarantined rather than accepted', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, expected_auth_user_id: '77777777-7777-4777-8777-777777777777' };
  state.authUpdate = { id: '88888888-8888-4888-8888-888888888888' };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
  assert.equal(result.code, 'REVIEW_REQUIRED');
  assert.equal(state.reviews.length, 1);
});

test('asynchronous RPC failures are sanitized before provisioning or quarantined after reservation', async () => {
  for (const target of ['member_password_check_rate_limit', 'member_password_service_health', 'member_password_reserve', 'member_password_identity_by_email', 'member_password_complete']) {
    const state = baseState();
    const runtime = fakeRuntime(state);
    const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
    runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
      if (name === target) {
        state.calls.push({ client: 'service', name, args });
        throw new Error('private database exception');
      }
      return original<T>(name, args);
    };
    const result = await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody())));
    assert.equal(result.code, ['member_password_check_rate_limit', 'member_password_service_health'].includes(target) ? 'SERVER_UNAVAILABLE' : 'REVIEW_REQUIRED');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(state.calls.filter((call) => call.name === target).length, 1, 'no automatic RPC retry');
    assert.equal(state.calls.filter((call) => call.name === 'createUser').length, target === 'member_password_complete' ? 1 : 0);
    assert.equal(state.reviews.length, ['member_password_identity_by_email', 'member_password_complete'].includes(target) ? 1 : 0);
  }
});

test('thrown Auth mutation and quarantine failures never retry or escape the handler', async () => {
  const state = baseState(); const runtime = fakeRuntime(state);
  runtime.authAdmin.auth.admin.createUser = async (attributes) => {
    state.calls.push({ client: 'auth', name: 'createUser', args: attributes });
    throw new Error('private Auth timeout');
  };
  const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
  runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
    if (name === 'member_password_mark_review_required') {
      state.calls.push({ client: 'service', name, args });
      throw new Error('private quarantine unavailable');
    }
    return original<T>(name, args);
  };
  const result = await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody())));
  assert.deepEqual(result, { code: 'REVIEW_REQUIRED' });
  assert.equal(state.calls.filter((call) => call.name === 'createUser').length, 1);
  assert.equal(state.calls.filter((call) => call.name === 'member_password_mark_review_required').length, 1);
  assert.equal(state.calls.some((call) => /release|delete|retry/.test(call.name)), false);
});

test('admin authorization or service-action exceptions become safe unavailable responses', async () => {
  for (const target of ['authorize', 'member_password_list_invitations']) {
    const state = baseState(); const runtime = fakeRuntime(state);
    if (target === 'authorize') runtime.authorizeAdmin = async () => { throw new Error('private actor exception'); };
    else {
      const original = runtime.adminDb.rpc.bind(runtime.adminDb);
      runtime.adminDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
        if (name === target) throw new Error('private service exception');
        return original<T>(name, args);
      };
    }
    const result = await json(await createMemberPasswordEnrollmentController(runtime)(request({ action: 'list' }, { Authorization: 'Bearer admin' })));
    assert.deepEqual(result, { code: 'SERVER_UNAVAILABLE' });
  }
});

test('initial enrollment rejects unknown password/usable state and mismatched service identity', async () => {
  for (const change of [{ has_password: undefined }, { usable: undefined }, { auth_user_id: 'different-uid' }]) {
    const state = baseState();
    state.reserve = { ...state.reserve!, expected_auth_user_id: '77777777-7777-4777-8777-777777777777' };
    state.identityState = { ...state.identityState, ...change };
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
    assert.equal(['REVIEW_REQUIRED', 'IDENTITY_CONFLICT'].includes(String(result.code)), true);
    assert.equal(state.calls.some((call) => call.client === 'auth'), false);
    assert.equal(state.reviews.length, 1);
  }
});

test('the last create preflight requires an explicit no-identity result', async () => {
  const state = baseState(); const runtime = fakeRuntime(state);
  const original = runtime.serviceDb.rpc.bind(runtime.serviceDb); let lookups = 0;
  runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
    if (name === 'member_password_identity_by_email' && ++lookups === 2) return { data: null, error: null };
    return original<T>(name, args);
  };
  const result = await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody())));
  assert.deepEqual(result, { code: 'REVIEW_REQUIRED' });
  assert.equal(state.calls.some((call) => call.client === 'auth'), false);
  assert.equal(state.reviews.length, 1);
});

test('committed expiry response never provisions or quarantines a nonexistent claim', async () => {
  const state = baseState(); const runtime = fakeRuntime(state);
  const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
  runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
    if (name === 'member_password_reserve') return { data: { status: 'expired' } as T, error: null };
    return original<T>(name, args);
  };
  const result = await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody())));
  assert.deepEqual(result, { code: 'EXPIRED' });
  assert.equal(state.calls.some((call) => call.client === 'auth'), false);
  assert.equal(state.reviews.length, 0);
});

test('OPTIONS and enrollment responses are non-cacheable with a valid empty preflight body', async () => {
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(baseState()));
  const preflight = await controller(new Request('https://local.test/member-password-enrollment', { method: 'OPTIONS', headers: { Origin: 'https://dashboard-phantoms.vercel.app' } }));
  assert.equal(preflight.status, 204); assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('cache-control'), 'no-store');
  const success = await controller(request(enrollBody()));
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(success.headers.get('vary'), 'Origin');
  assert.equal(success.headers.get('referrer-policy'), 'no-referrer');
});

test('bounded streaming rejects oversized bodies even without a content-length header', async () => {
  const state = baseState(); let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(60)); controller.enqueue(new Uint8Array(60)); },
    cancel() { canceled = true; },
  });
  const req = new Request('https://local.test/member-password-enrollment', {
    method: 'POST', body: stream, duplex: 'half', headers: { Origin: 'https://dashboard-phantoms.vercel.app' },
  } as RequestInit);
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state), { maxBodyBytes: 100 })(req));
  assert.deepEqual(result, { code: 'INVALID_INPUT' });
  assert.equal(canceled, true); assert.equal(state.calls.length, 0);
});

test('malformed trusted claims cannot select a create or update branch', async () => {
  for (const change of [{ invitation_id: 'bad-id' }, { claim_id: 'bad-id' }, { member_id: 0 }, { email: 'other@phantoms-test.example' }, { purpose: 'unknown' }, { purpose: 'reset', expected_auth_user_id: null }, { expected_auth_user_id: 'bad-id' }]) {
    const state = baseState(); state.reserve = { ...state.reserve!, ...change } as State['reserve'];
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(enrollBody())));
    assert.deepEqual(result, { code: 'REVIEW_REQUIRED' });
    assert.equal(state.calls.some((call) => call.client === 'auth'), false);
    assert.equal(state.reviews.length, 'invitation_id' in change || 'claim_id' in change ? 0 : 1);
  }
});

test('completion success must be exactly true, never an empty or truthy response', async () => {
  for (const data of [null, {}, { ok: false }, { ok: 'true' }]) {
    const state = baseState(); const runtime = fakeRuntime(state);
    const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
    runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
      if (name === 'member_password_complete') return { data: data as T, error: null };
      return original<T>(name, args);
    };
    assert.deepEqual(await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody()))), { code: 'REVIEW_REQUIRED' });
    assert.equal(state.reviews.length, 1);
  }
});

// Fault injection only: these do not substitute for real GoTrue acceptance.
for (const operation of ['create', 'update'] as const) {
  test(`mocked ${operation} succeeds remotely but response times out: one write, quarantine, no retry`, async () => {
    const state = baseState();
    if (operation === 'update') state.reserve = { ...state.reserve!, purpose: 'reset', expected_auth_user_id: '88888888-8888-4888-8888-888888888888' };
    const runtime = fakeRuntime(state);
    let committedWrites = 0;
    const timeout = async () => { committedWrites += 1; throw new Error('withheld remote result'); };
    if (operation === 'create') runtime.authAdmin.auth.admin.createUser = timeout;
    else runtime.authAdmin.auth.admin.updateUserById = timeout;
    assert.deepEqual(await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody()))), { code: 'REVIEW_REQUIRED' });
    assert.equal(committedWrites, 1);
    assert.equal(state.reviews.length, 1);
    assert.equal(state.calls.some((call) => call.name === 'member_password_complete'), false);
    assert.equal(state.calls.some((call) => /release|delete|retry/.test(call.name)), false);
  });
}

for (const failure of ['missing marker', 'wrong UUID marker', 'final consumption failure', 'audit failure'] as const) {
  test(`mocked ${failure} at completion remains quarantined after one Auth operation`, async () => {
    const state = baseState(); const runtime = fakeRuntime(state);
    const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
    runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
      if (name === 'member_password_complete') {
        state.calls.push({ client: 'service', name, args });
        return { data: null, error: { message: failure === 'wrong UUID marker' ? 'IDENTITY_CONFLICT' : 'REVIEW_REQUIRED' } };
      }
      return original<T>(name, args);
    };
    assert.deepEqual(await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody()))), { code: 'REVIEW_REQUIRED' });
    assert.equal(state.calls.filter((call) => call.client === 'auth').length, 1);
    assert.equal(state.calls.filter((call) => call.name === 'member_password_complete').length, 1);
    assert.equal(state.reviews.length, 1);
    assert.equal(state.calls.some((call) => /release|delete|retry/.test(call.name)), false);
  });
}

for (const boundary of ['before request', 'after reserve', 'after Auth write', 'after complete'] as const) {
  test(`observed disconnect ${boundary} fails closed with no second password operation`, async () => {
    const abort = new AbortController(); const state = baseState(); const runtime = fakeRuntime(state);
    const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
    if (boundary === 'before request') abort.abort();
    runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
      const result = await original<T>(name, args);
      if ((boundary === 'after reserve' && name === 'member_password_reserve') || (boundary === 'after complete' && name === 'member_password_complete')) abort.abort();
      return result;
    };
    const originalCreate = runtime.authAdmin.auth.admin.createUser.bind(runtime.authAdmin.auth.admin);
    runtime.authAdmin.auth.admin.createUser = async (attributes) => {
      const result = await originalCreate(attributes);
      if (boundary === 'after Auth write') abort.abort();
      return result;
    };
    const req = new Request('https://local.test/member-password-enrollment', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dashboard-phantoms.vercel.app' },
      body: JSON.stringify(enrollBody()), signal: abort.signal,
    });
    const result = await json(await createMemberPasswordEnrollmentController(runtime)(req));
    assert.deepEqual(result, { code: boundary === 'before request' ? 'SERVER_UNAVAILABLE' : 'REVIEW_REQUIRED' });
    assert.equal(state.calls.filter((call) => call.client === 'auth').length, ['after Auth write', 'after complete'].includes(boundary) ? 1 : 0);
    assert.equal(state.reviews.length, boundary === 'before request' ? 0 : 1);
    assert.equal(state.calls.some((call) => /release|delete|retry/.test(call.name)), false);
  });
}

test('default origins exclude unapproved hosts and loopback is accepted only by explicit configuration', async () => {
  for (const origin of ['https://admin-phantoms.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:5173']) {
    const state = baseState();
    const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
    assert.equal((await controller(request(enrollBody(), { Origin: origin }))).status, 403);
    assert.equal(state.calls.length, 0);
  }
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state), { allowedOrigins: ['http://127.0.0.1:4173'] });
  assert.equal((await controller(request(enrollBody(), { Origin: 'http://127.0.0.1:4173' }))).status, 200);
});
