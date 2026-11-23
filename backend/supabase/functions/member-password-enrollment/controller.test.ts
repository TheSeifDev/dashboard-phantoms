import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemberPasswordEnrollmentController, type ControllerRuntime, type RpcClient } from './controller.ts';

type State = {
  rate: boolean;
  health: boolean;
  reserve: { invitation_id: string; claim_id: string; member_id: number | null; email: string; purpose: 'enroll' | 'reset' | 'join'; expected_auth_user_id: string | null; adopt_auth_user_id?: string | null } | null;
  reserveError: string | null;
  identity: { exists: boolean; auth_user_id?: string; has_password?: boolean; is_admin?: boolean };
  stranded: { exists: boolean; adoptable?: boolean; auth_user_id?: string };
  identityState: { exists: boolean; auth_user_id?: string; email_matches?: boolean; has_password?: boolean; is_admin?: boolean; usable?: boolean };
  complete: boolean;
  authCreate: { id: string } | null;
  authCreateError: string | null;
  authUpdate: { id: string } | null;
  authUpdateError: string | null;
  calls: Array<{ client: string; name: string; args?: Record<string, unknown> }>;
  reviews: Array<{ invitation_id: string; claim_id: string }>;
  joinReviews: unknown[];
  approvalResult: 'approved' | 'already_approved' | 'rejected';
  directReset: { invitation_id: string; claim_id: string; member_id: number; email: string; auth_user_id: string } | null;
  directResetError: string | null;
  verifyPassword: boolean;
  directComplete: boolean;
  clearedMustChange: boolean;
  abandoned: string[];
};

const baseState = (): State => ({
  rate: false,
  health: true,
  reserve: { invitation_id: '11111111-1111-4111-8111-111111111111', claim_id: '22222222-2222-4222-8222-222222222222', member_id: 9, email: 'member@phantoms-test.example', purpose: 'enroll', expected_auth_user_id: null },
  reserveError: null,
  identity: { exists: false },
  stranded: { exists: false, adoptable: false },
  identityState: { exists: true, email_matches: true, has_password: false, is_admin: false, usable: true },
  complete: true,
  authCreate: { id: '33333333-3333-4333-8333-333333333333' },
  authCreateError: null,
  authUpdate: null,
  authUpdateError: null,
  calls: [],
  reviews: [],
  joinReviews: [],
  approvalResult: 'approved',
  directReset: {
    invitation_id: '88888888-8888-4888-8888-888888888888',
    claim_id: '99999999-9999-4999-8999-999999999999',
    member_id: 9,
    email: 'member@phantoms-test.example',
    auth_user_id: '77777777-7777-4777-8777-777777777777',
  },
  directResetError: null,
  verifyPassword: true,
  directComplete: true,
  clearedMustChange: true,
  abandoned: [],
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
      if (rpcName === 'member_password_stranded_identity') return { data: state.stranded as T, error: null };
      if (rpcName === 'member_password_identity_state') return { data: {
        auth_user_id: state.reserve?.expected_auth_user_id,
        ...state.identityState,
      } as T, error: null };
      if (rpcName === 'member_password_complete_profile') return state.complete
        ? { data: { ok: true, membership: state.reserve?.purpose === 'join' ? 'pending_review' : 'active' } as T, error: null }
        : { data: null, error: { message: 'completion unavailable' } };
      if (rpcName === 'member_password_mark_review_required') {
        state.reviews.push({ invitation_id: String(args?.p_invitation_id), claim_id: String(args?.p_claim_id) });
        return { data: true as T, error: null };
      }
      if (rpcName === 'member_password_issue_invitation') return { data: {
        id: '55555555-5555-4555-8555-555555555555', member_id: args?.p_member_id as number | null,
        email: args?.p_email as string | null, purpose: args?.p_purpose as 'join' | 'enroll' | 'reset', note: '', expires_at: '2030-01-01T00:00:00.000Z',
      } as T, error: null };
      if (rpcName === 'member_password_revoke_invitation') return { data: true as T, error: null };
      if (rpcName === 'member_password_list_invitations') return { data: [] as T, error: null };
      if (rpcName === 'member_password_list_join_reviews') return { data: state.joinReviews as T, error: null };
      if (rpcName === 'member_password_approve_join') return state.approvalResult === 'rejected'
        ? { data: null, error: { message: 'REVIEW_REQUIRED' } }
        : { data: (state.approvalResult === 'already_approved'
          ? { approved: false, status: 'already_approved' }
          : { approved: true, member_id: args?.p_member_id }) as T, error: null };
      if (rpcName === 'member_password_begin_direct_reset' || rpcName === 'member_password_begin_self_change') {
        return state.directResetError
          ? { data: null, error: { message: state.directResetError } }
          : { data: state.directReset as T, error: null };
      }
      if (rpcName === 'member_password_complete') {
        return state.directComplete
          ? { data: { ok: true } as T, error: null }
          : { data: null, error: { message: 'completion unavailable' } };
      }
      if (rpcName === 'member_password_abandon_direct_reset') {
        state.abandoned.push(String(args?.p_invitation_id));
        return { data: { ok: true, status: 'revoked' } as T, error: null };
      }
      if (rpcName === 'member_password_clear_must_change') {
        state.clearedMustChange = true;
        return { data: true as T, error: null };
      }
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
    async authorizeRecovery(authorization) {
      if (!authorizedAdmin || authorization !== 'Bearer member') return null;
      return { userId: '77777777-7777-4777-8777-777777777777', email: 'member@phantoms-test.example', db: client('member') };
    },
    async verifyMemberPassword(email, password) {
      state.calls.push({ client: 'auth', name: 'verifyMemberPassword', args: { email, password } });
      return state.verifyPassword;
    },
  };
}

const token = 'phpw_' + 'a'.repeat(64);
const profile = {
  fullName: 'Member Test', phone: '+201112223333', residence: 'Alexandria', workConditions: 'Remote', bio: 'Controller fixture', device: 'لابتوب', gender: 'ذكر',
  academicNumber: '001234', academicGroup: 'CSE-1', specialization: 'software',
  linkedinUrl: 'https://www.linkedin.com/in/controller-fixture', portfolioUrl: 'https://github.com/controller-fixture',
};
const enrollBody = (overrides: Record<string, unknown> = {}) => ({
  action: 'enroll', email: 'member@phantoms-test.example', token,
  password: 'StrongMemberPassword1', confirmPassword: 'StrongMemberPassword1', profile, ...overrides,
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
  assert.deepEqual(result, { ok: true, membership: 'active' });
  const create = state.calls.find((call) => call.name === 'createUser');
  assert.equal(create?.args?.email, 'member@phantoms-test.example');
  assert.equal(create?.args?.email_confirm, true);
  assert.equal(state.calls.some((call) => call.name === 'member_password_complete_profile'), true);
  assert.equal(state.calls.filter((call) => call.name === 'member_password_check_rate_limit').length, 2);
  assert.equal(state.reviews.length, 0);
});

test('new join invitation creates only the recipient Auth identity and returns pending_review', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, member_id: null, email: 'new@phantoms-test.example', purpose: 'join', expected_auth_user_id: null };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request(enrollBody({ email: 'new@phantoms-test.example' })),
  ));
  assert.deepEqual(result, { ok: true, membership: 'pending_review' });
  assert.equal(state.calls.filter((call) => call.name === 'createUser').length, 1);
  assert.equal(state.calls.some((call) => call.name === 'updateUserById'), false);
  const completion = state.calls.find((call) => call.name === 'member_password_complete_profile');
  assert.deepEqual(completion?.args?.p_profile, {
    fullName: 'Member Test', phone: '+201112223333', residence: 'Alexandria', workConditions: 'Remote', bio: 'Controller fixture', device: 'لابتوب', gender: 'ذكر',
    academicNumber: '001234', academicGroup: 'CSE-1', specialization: 'software',
    linkedinUrl: 'https://www.linkedin.com/in/controller-fixture', portfolioUrl: 'https://github.com/controller-fixture',
  });
  assert.equal(state.reviews.length, 0);
});

test('password reset accepts no profile and never creates a new Auth identity', async () => {
  const state = baseState();
  const authId = '33333333-3333-4333-8333-333333333333';
  state.reserve = { ...state.reserve!, expected_auth_user_id: authId, purpose: 'reset' };
  state.identityState = { ...state.identityState, has_password: true };
  const body = { action: 'enroll', email: 'member@phantoms-test.example', token,
    password: 'StrongMemberPassword1', confirmPassword: 'StrongMemberPassword1' };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(body)));
  assert.deepEqual(result, { ok: true, membership: 'active' });
  const completion = state.calls.find((call) => call.name === 'member_password_complete_profile');
  assert.equal(completion?.args?.p_profile, null);
  assert.equal(state.calls.filter((call) => call.name === 'updateUserById').length, 1);
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  assert.equal(state.reviews.length, 0);
});

test('self-service join adopts a stranded Auth identity instead of blocking the email', async () => {
  const state = baseState();
  const strandedId = '77777777-7777-4777-8777-777777777777';
  state.reserve = {
    ...state.reserve!, member_id: null, email: 'stranded@phantoms-test.example',
    purpose: 'join', expected_auth_user_id: null, adopt_auth_user_id: strandedId,
  };
  state.stranded = { exists: true, adoptable: true, auth_user_id: strandedId };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request(enrollBody({ email: 'stranded@phantoms-test.example' })),
  ));
  assert.deepEqual(result, { ok: true, membership: 'pending_review' });
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  const adoption = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(adoption?.args?.userId, strandedId);
  assert.equal(adoption?.args?.password, 'StrongMemberPassword1');
  assert.equal(adoption?.args?.email_confirm, true);
  const completion = state.calls.find((call) => call.name === 'member_password_complete_profile');
  assert.equal(completion?.args?.p_auth_user_id, strandedId);
  assert.equal(state.reviews.length, 0);
});

test('join adoption is refused when the identity is no longer stranded', async () => {
  const state = baseState();
  const strandedId = '77777777-7777-4777-8777-777777777777';
  state.reserve = {
    ...state.reserve!, member_id: null, email: 'stranded@phantoms-test.example',
    purpose: 'join', expected_auth_user_id: null, adopt_auth_user_id: strandedId,
  };
  state.stranded = { exists: true, adoptable: false, auth_user_id: strandedId };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request(enrollBody({ email: 'stranded@phantoms-test.example' })),
  ));
  assert.equal(result.code, 'IDENTITY_CONFLICT');
  assert.equal(state.calls.some((call) => call.name === 'updateUserById'), false);
  assert.equal(state.calls.some((call) => call.name === 'member_password_complete_profile'), false);
  assert.equal(state.reviews.length, 1);
});

test('an adopted identity id that belongs to another email is quarantined', async () => {
  const state = baseState();
  const strandedId = '77777777-7777-4777-8777-777777777777';
  state.reserve = {
    ...state.reserve!, member_id: null, email: 'stranded@phantoms-test.example',
    purpose: 'join', expected_auth_user_id: null, adopt_auth_user_id: strandedId,
  };
  state.stranded = { exists: true, adoptable: true, auth_user_id: '88888888-8888-4888-8888-888888888888' };
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request(enrollBody({ email: 'stranded@phantoms-test.example' })),
  ));
  assert.equal(result.code, 'REVIEW_REQUIRED');
  assert.equal(state.calls.some((call) => call.name === 'updateUserById'), false);
  assert.equal(state.reviews.length, 1);
});

test('purpose/profile mismatch is quarantined before any Auth write', async () => {
  const resetState = baseState();
  resetState.reserve = { ...resetState.reserve!, expected_auth_user_id: '33333333-3333-4333-8333-333333333333', purpose: 'reset' };
  resetState.identityState = { ...resetState.identityState, has_password: true };
  const resetResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(resetState))(request(enrollBody())));
  assert.equal(resetResult.code, 'INVALID_INPUT');
  assert.equal(resetState.reviews.length, 1);
  assert.equal(resetState.calls.some((call) => call.name === 'createUser' || call.name === 'updateUserById'), false);

  const joinState = baseState();
  joinState.reserve = { ...joinState.reserve!, member_id: null, email: 'new@phantoms-test.example', purpose: 'join', expected_auth_user_id: null };
  const { profile: _ignored, ...bodyWithoutProfile } = enrollBody({ email: 'new@phantoms-test.example' });
  const joinResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(joinState))(request(bodyWithoutProfile)));
  assert.equal(joinResult.code, 'INVALID_INPUT');
  assert.equal(joinState.reviews.length, 1);
  assert.equal(joinState.calls.some((call) => call.name === 'createUser' || call.name === 'updateUserById'), false);
});

test('password mismatch, weak password, extra key, and malformed token stop before reservation', async () => {
  for (const [body, expected] of [
    [enrollBody({ confirmPassword: 'DifferentPassword1' }), 'PASSWORD_MISMATCH'],
    [enrollBody({ password: 'short1', confirmPassword: 'short1' }), 'WEAK_PASSWORD'],
    [enrollBody({ extra: 'reject' }), 'INVALID_INPUT'],
    [enrollBody({ token: 'legacy-token' }), 'INVALID_INPUT'],
    [enrollBody({ profile: { ...profile, role: 'admin' } }), 'INVALID_INPUT'],
    [enrollBody({ profile: { ...profile, fullName: '' } }), 'INVALID_INPUT'],
  ] as const) {
    const state = baseState();
    const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(body)));
    assert.equal(result.code, expected);
    assert.equal(state.calls.some((call) => call.name === 'member_password_reserve'), false);
    assert.equal(state.calls.some((call) => call.name === 'createUser' || call.name === 'updateUserById'), false);
  }
});

test('profile validation canonicalizes Arabic/Persian academic digits and rejects invalid required fields and URLs', async () => {
  const canonical = baseState();
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(canonical))(
    request(enrollBody({ profile: { ...profile, academicNumber: '٠٠۱۲۳۴', linkedinUrl: 'https://www.linkedin.com/in/member' } })),
  ));
  assert.deepEqual(result, { ok: true, membership: 'active' });
  const completion = canonical.calls.find((call) => call.name === 'member_password_complete_profile');
  assert.equal((completion?.args?.p_profile as Record<string, unknown>)?.academicNumber, '001234');

  for (const invalidProfile of [
    { ...profile, phone: '' },
    { ...profile, phone: '+20123' },
    { ...profile, phone: '+20(111)223-333-444-55' },
    { ...profile, academicNumber: '12-34' },
    { ...profile, academicGroup: '   ' },
    { ...profile, specialization: 'design' },
    { ...profile, linkedinUrl: 'http://linkedin.com/in/member' },
    { ...profile, linkedinUrl: 'https://evil.example/member' },
    { ...profile, portfolioUrl: 'https://localhost/me' },
    { ...profile, portfolioUrl: 'https://127.0.0.1/me' },
    { ...profile, portfolioUrl: 'https://example' },
    { ...profile, portfolioUrl: 'https://user:pass@example.com/me' },
    { ...profile, portfolioUrl: 'https://example.com/me#fragment' },
    { ...profile, unexpected: true },
  ]) {
    const state = baseState();
    const response = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
      request(enrollBody({ profile: invalidProfile })),
    ));
    assert.equal(response.code, 'INVALID_INPUT');
    assert.equal(state.calls.some((call) => call.name === 'member_password_reserve'), false);
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
  assert.deepEqual(result, { ok: true, membership: 'active' });
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
  assert.deepEqual(result, { ok: true, membership: 'active' });
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  const update = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(update?.args?.userId, state.reserve.expected_auth_user_id);
  assert.equal(update?.args?.email_confirm, true);
});

test('reset purpose updates the exact existing Auth ID without enrollment fallback', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, purpose: 'reset', expected_auth_user_id: '88888888-8888-4888-8888-888888888888' };
  const { profile: _ignored, ...body } = enrollBody();
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(request(body)));
  assert.deepEqual(result, { ok: true, membership: 'active' });
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

test('admin issue rejects manual Auth UUID and association-evidence fields at the HTTP boundary', async () => {
  const base = { action: 'issue', memberId: 9, email: 'member@phantoms-test.example', purpose: 'enroll', expiresInHours: 24, note: 'reviewed' };
  for (const extra of [
    { expectedAuthUserId: '77777777-7777-4777-8777-777777777777' },
    { associationEvidence: 'reviewed legacy identity' },
    { expectedAuthUserId: '77777777-7777-4777-8777-777777777777', associationEvidence: 'reviewed legacy identity' },
  ]) {
    const state = baseState();
    const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
    const result = await json(await controller(request({ ...base, ...extra }, { Authorization: 'Bearer admin' })));
    assert.equal(result.code, 'INVALID_INPUT');
    assert.equal(state.calls.some((call) => call.name === 'member_password_issue_invitation'), false);
  }
});

test('Admin can issue an unbound join link without supplying a member or Auth ID', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const body = { action: 'issue', memberId: null, email: 'new@phantoms-test.example', purpose: 'join', expiresInHours: 24, note: '' };
  const result = await json(await controller(request(body, { Authorization: 'Bearer admin' })));
  const invite = result.invite as Record<string, unknown>;
  assert.equal(invite.purpose, 'join');
  assert.equal(invite.member_id, null);
  assert.match(String(invite.token), /^phpw_[0-9a-f]{64}$/);
  const args = state.calls.find((call) => call.name === 'member_password_issue_invitation')?.args;
  assert.equal(args?.p_member_id, null);
  assert.equal(args?.p_expected_auth_user_id, null);
  assert.equal(args?.p_association_evidence, null);
});

test('Admin may leave join email unset, but enrollment and reset emails remain mandatory', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const join = await json(await controller(request({
    action: 'issue', memberId: null, email: null, purpose: 'join', expiresInHours: 72, note: '',
  }, { Authorization: 'Bearer admin' })));
  const invite = join.invite as Record<string, unknown>;
  assert.equal(invite.email, null);
  assert.equal(invite.purpose, 'join');
  assert.match(String(invite.token), /^phpw_[0-9a-f]{64}$/);
  assert.equal(state.calls.find((call) => call.name === 'member_password_issue_invitation')?.args?.p_email, null);

  for (const purpose of ['enroll', 'reset'] as const) {
    const invalidState = baseState();
    const invalid = await json(await createMemberPasswordEnrollmentController(fakeRuntime(invalidState))(request({
      action: 'issue', memberId: 9, email: null, purpose, expiresInHours: 24, note: '',
    }, { Authorization: 'Bearer admin' })));
    assert.equal(invalid.code, 'INVALID_INPUT');
    assert.equal(invalidState.calls.some((call) => call.name === 'member_password_issue_invitation'), false);
  }
});

test('unbound join email conflict is returned without reserving or quarantining the token', async () => {
  const state = baseState();
  state.reserve = { ...state.reserve!, member_id: null, purpose: 'join', expected_auth_user_id: null };
  state.reserve = null;
  state.reserveError = null;
  const runtime = fakeRuntime(state);
  const originalRpc = runtime.serviceDb.rpc.bind(runtime.serviceDb);
  runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
    if (name === 'member_password_reserve') {
      state.calls.push({ client: 'service', name, args });
      return { data: { status: 'identity_conflict' } as T, error: null };
    }
    return originalRpc<T>(name, args);
  };
  const result = await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody())));
  assert.equal(result.code, 'IDENTITY_CONFLICT');
  assert.equal(state.calls.some((call) => call.name === 'createUser'), false);
  assert.equal(state.reviews.length, 0);
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

test('authorized Admin can list completed join reviews without exposing invitation secrets', async () => {
  const state = baseState();
  state.joinReviews = [{ member_id: 41, full_name: 'Pending Member', email: 'pending@phantoms-test.example' }];
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const list = await json(await controller(request({ action: 'list_join_reviews' }, { Authorization: 'Bearer admin' })));
  assert.deepEqual(list, { reviews: state.joinReviews });
  const firstPageArgs = state.calls.find((call) => call.name === 'member_password_list_join_reviews')?.args;
  assert.equal(firstPageArgs?.p_actor_user_id, '66666666-6666-4666-8666-666666666666');
  assert.equal(firstPageArgs?.p_before_submitted_at, null);
  assert.equal(firstPageArgs?.p_before_member_id, null);
  assert.equal(firstPageArgs?.p_before_invitation_id, null);
  assert.equal(JSON.stringify(list).includes('token'), false);

  const cursor = {
    submittedAt: '2026-11-19T00:00:00.000Z',
    memberId: 41,
    invitationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  };
  const nextPage = await json(await controller(request({ action: 'list_join_reviews', cursor }, { Authorization: 'Bearer admin' })));
  assert.deepEqual(nextPage, { reviews: state.joinReviews });
  const nextPageArgs = state.calls.filter((call) => call.name === 'member_password_list_join_reviews')[1]?.args;
  assert.equal(nextPageArgs?.p_before_submitted_at, cursor.submittedAt);
  assert.equal(nextPageArgs?.p_before_member_id, cursor.memberId);
  assert.equal(nextPageArgs?.p_before_invitation_id, cursor.invitationId);

  const invalid = await json(await controller(request({ action: 'list_join_reviews', memberId: 41 }, { Authorization: 'Bearer admin' })));
  assert.equal(invalid.code, 'INVALID_INPUT');
  for (const malformedCursor of [
    null,
    {},
    { submittedAt: 'not-a-date', memberId: 41, invitationId: cursor.invitationId },
    { submittedAt: cursor.submittedAt, memberId: 0, invitationId: cursor.invitationId },
    { submittedAt: cursor.submittedAt, memberId: 41, invitationId: 'not-a-uuid' },
    { ...cursor, unexpected: true },
  ]) {
    const response = await json(await controller(request(
      { action: 'list_join_reviews', cursor: malformedCursor }, { Authorization: 'Bearer admin' },
    )));
    assert.equal(response.code, 'INVALID_INPUT');
  }
  assert.equal(state.calls.filter((call) => call.name === 'member_password_list_join_reviews').length, 2);
  const outsider = await json(await createMemberPasswordEnrollmentController(fakeRuntime(baseState(), false))(
    request({ action: 'list_join_reviews' }, { Authorization: 'Bearer admin' }),
  ));
  assert.equal(outsider.code, 'UNAUTHORIZED');
});

test('join approval validates member ID, uses the authenticated Admin actor, and handles repeat approval safely', async () => {
  const state = baseState();
  const controller = createMemberPasswordEnrollmentController(fakeRuntime(state));
  const body = { action: 'approve_join', memberId: 41 };
  const approved = await json(await controller(request(body, { Authorization: 'Bearer admin' })));
  assert.deepEqual(approved, { ok: true, approved: true });
  const call = state.calls.find((entry) => entry.name === 'member_password_approve_join');
  assert.equal(call?.args?.p_member_id, 41);
  assert.equal(call?.args?.p_actor_user_id, '66666666-6666-4666-8666-666666666666');

  state.approvalResult = 'already_approved';
  const repeated = await json(await controller(request(body, { Authorization: 'Bearer admin' })));
  assert.deepEqual(repeated, { ok: true, approved: false, alreadyApproved: true });

  for (const memberId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '41', null]) {
    const invalid = await json(await controller(request({ ...body, memberId }, { Authorization: 'Bearer admin' })));
    assert.equal(invalid.code, 'INVALID_INPUT');
  }
  const extra = await json(await controller(request({ ...body, approved: true }, { Authorization: 'Bearer admin' })));
  assert.equal(extra.code, 'INVALID_INPUT');
  const unauthorized = await json(await controller(request(body)));
  assert.equal(unauthorized.code, 'UNAUTHORIZED');
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
  for (const target of ['member_password_check_rate_limit', 'member_password_service_health', 'member_password_reserve', 'member_password_identity_by_email', 'member_password_complete_profile']) {
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
    assert.equal(state.calls.filter((call) => call.name === 'createUser').length, target === 'member_password_complete_profile' ? 1 : 0);
    assert.equal(state.reviews.length, ['member_password_identity_by_email', 'member_password_complete_profile'].includes(target) ? 1 : 0);
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
      if (name === 'member_password_complete_profile') return { data: data as T, error: null };
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
    const body = operation === 'update' ? (({ profile: _ignored, ...rest }) => rest)(enrollBody()) : enrollBody();
    assert.deepEqual(await json(await createMemberPasswordEnrollmentController(runtime)(request(body))), { code: 'REVIEW_REQUIRED' });
    assert.equal(committedWrites, 1);
    assert.equal(state.reviews.length, 1);
    assert.equal(state.calls.some((call) => call.name === 'member_password_complete_profile'), false);
    assert.equal(state.calls.some((call) => /release|delete|retry/.test(call.name)), false);
  });
}

for (const failure of ['missing marker', 'wrong UUID marker', 'final consumption failure', 'audit failure'] as const) {
  test(`mocked ${failure} at completion remains quarantined after one Auth operation`, async () => {
    const state = baseState(); const runtime = fakeRuntime(state);
    const original = runtime.serviceDb.rpc.bind(runtime.serviceDb);
    runtime.serviceDb.rpc = async <T = unknown>(name: string, args?: Record<string, unknown>) => {
      if (name === 'member_password_complete_profile') {
        state.calls.push({ client: 'service', name, args });
        return { data: null, error: { message: failure === 'wrong UUID marker' ? 'IDENTITY_CONFLICT' : 'REVIEW_REQUIRED' } };
      }
      return original<T>(name, args);
    };
    assert.deepEqual(await json(await createMemberPasswordEnrollmentController(runtime)(request(enrollBody()))), { code: 'REVIEW_REQUIRED' });
    assert.equal(state.calls.filter((call) => call.client === 'auth').length, 1);
    assert.equal(state.calls.filter((call) => call.name === 'member_password_complete_profile').length, 1);
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
      if ((boundary === 'after reserve' && name === 'member_password_reserve') || (boundary === 'after complete' && name === 'member_password_complete_profile')) abort.abort();
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

test('production CORS preflight reaches the handler before configuration checks and gateway JWT is disabled', async () => {
  const state = baseState();
  const runtime = fakeRuntime(state);
  runtime.configReady = false;
  const response = await createMemberPasswordEnrollmentController(runtime)(new Request(
    'https://local.test/member-password-enrollment',
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard-phantoms.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
      },
    },
  ));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://dashboard-phantoms.vercel.app');
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(state.calls.length, 0);

  const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.member-password-enrollment\]\s*verify_jwt\s*=\s*false/);
});

test('an administrator sets the default temporary password without issuing a link', async () => {
  const state = baseState();
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request({ action: 'set_password', memberId: 9 }, { Authorization: 'Bearer admin' }),
  ));
  assert.deepEqual(result, {
    ok: true,
    memberId: 9,
    email: 'member@phantoms-test.example',
    temporaryPassword: '123456789',
    mustChangePassword: true,
  });
  const begin = state.calls.find((call) => call.name === 'member_password_begin_direct_reset');
  assert.equal(begin?.args?.p_reason, 'admin_reset');
  assert.equal(begin?.args?.p_member_id, 9);
  assert.equal(begin?.args?.p_actor_user_id, '66666666-6666-4666-8666-666666666666');
  const update = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(update?.args?.userId, '77777777-7777-4777-8777-777777777777');
  assert.equal(update?.args?.password, '123456789');
  const complete = state.calls.find((call) => call.name === 'member_password_complete');
  assert.equal(complete?.args?.p_claim_id, '99999999-9999-4999-8999-999999999999');
  assert.equal(state.calls.some((call) => call.name === 'member_password_issue_invitation'), false);
  assert.equal(state.abandoned.length, 0);
});

test('the administrator may choose the temporary password but never a weak one', async () => {
  const state = baseState();
  const okResult = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request({ action: 'set_password', memberId: 9, password: 'Phantoms-Temp-2026' }, { Authorization: 'Bearer admin' }),
  ));
  assert.equal(okResult.temporaryPassword, 'Phantoms-Temp-2026');

  const weakState = baseState();
  const weak = await createMemberPasswordEnrollmentController(fakeRuntime(weakState))(
    request({ action: 'set_password', memberId: 9, password: 'short' }, { Authorization: 'Bearer admin' }),
  );
  assert.equal(weak.status, 400);
  assert.deepEqual(await json(weak), { code: 'WEAK_PASSWORD' });
  assert.equal(weakState.calls.some((call) => call.name === 'member_password_begin_direct_reset'), false);
  assert.equal(weakState.calls.some((call) => call.name === 'updateUserById'), false);
});

test('setting a password requires an authorised administrator and an eligible member', async () => {
  const anonymous = baseState();
  const unauthorized = await createMemberPasswordEnrollmentController(fakeRuntime(anonymous))(
    request({ action: 'set_password', memberId: 9 }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(anonymous.calls.length, 0);

  const disabledState = baseState();
  disabledState.directResetError = 'MEMBER_DISABLED';
  const disabled = await createMemberPasswordEnrollmentController(fakeRuntime(disabledState))(
    request({ action: 'set_password', memberId: 9 }, { Authorization: 'Bearer admin' }),
  );
  assert.equal(disabled.status, 400);
  assert.deepEqual(await json(disabled), { code: 'MEMBER_DISABLED' });
  assert.equal(disabledState.calls.some((call) => call.name === 'updateUserById'), false);
});

test('an explicit Auth rejection releases the claim so the member is never locked out', async () => {
  const state = baseState();
  state.authUpdateError = 'auth rejected the write';
  const response = await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request({ action: 'set_password', memberId: 9 }, { Authorization: 'Bearer admin' }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), { code: 'SERVER_UNAVAILABLE' });
  assert.deepEqual(state.abandoned, ['88888888-8888-4888-8888-888888888888']);
  assert.equal(state.calls.some((call) => call.name === 'member_password_complete'), false);
});

test('a member replaces their own password after proving the current one', async () => {
  const state = baseState();
  const result = await json(await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request({
      action: 'change_password',
      currentPassword: '123456789',
      newPassword: 'PersonalPassword2026',
      confirmPassword: 'PersonalPassword2026',
    }, { Authorization: 'Bearer member' }),
  ));
  assert.deepEqual(result, { ok: true, mustChangePassword: false });
  assert.equal(state.calls.some((call) => call.name === 'verifyMemberPassword'), true);
  const begin = state.calls.find((call) => call.name === 'member_password_begin_self_change');
  assert.equal(begin?.args?.p_auth_user_id, '77777777-7777-4777-8777-777777777777');
  const update = state.calls.find((call) => call.name === 'updateUserById');
  assert.equal(update?.args?.password, 'PersonalPassword2026');
  assert.equal(state.clearedMustChange, true);
});

test('a wrong current password or a weak replacement never reaches Auth', async () => {
  const wrongState = baseState();
  wrongState.verifyPassword = false;
  const wrong = await createMemberPasswordEnrollmentController(fakeRuntime(wrongState))(
    request({
      action: 'change_password',
      currentPassword: 'not-my-password',
      newPassword: 'PersonalPassword2026',
      confirmPassword: 'PersonalPassword2026',
    }, { Authorization: 'Bearer member' }),
  );
  assert.equal(wrong.status, 400);
  assert.deepEqual(await json(wrong), { code: 'INVALID_CREDENTIALS' });
  assert.equal(wrongState.calls.some((call) => call.name === 'member_password_begin_self_change'), false);

  const weakState = baseState();
  const weak = await createMemberPasswordEnrollmentController(fakeRuntime(weakState))(
    request({
      action: 'change_password',
      currentPassword: '123456789',
      newPassword: 'weakpass1',
      confirmPassword: 'weakpass1',
    }, { Authorization: 'Bearer member' }),
  );
  assert.equal(weak.status, 400);
  assert.deepEqual(await json(weak), { code: 'WEAK_PASSWORD' });
  assert.equal(weakState.calls.length, 0);

  const mismatchState = baseState();
  const mismatch = await createMemberPasswordEnrollmentController(fakeRuntime(mismatchState))(
    request({
      action: 'change_password',
      currentPassword: '123456789',
      newPassword: 'PersonalPassword2026',
      confirmPassword: 'PersonalPassword2027',
    }, { Authorization: 'Bearer member' }),
  );
  assert.equal(mismatch.status, 400);
  assert.deepEqual(await json(mismatch), { code: 'PASSWORD_MISMATCH' });
});

test('changing a password needs a member session', async () => {
  const state = baseState();
  const response = await createMemberPasswordEnrollmentController(fakeRuntime(state))(
    request({
      action: 'change_password',
      currentPassword: '123456789',
      newPassword: 'PersonalPassword2026',
      confirmPassword: 'PersonalPassword2026',
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(state.calls.length, 0);
});
