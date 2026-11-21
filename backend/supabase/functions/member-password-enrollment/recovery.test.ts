import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMemberRecoveryAction, type RecoveryRuntime } from './recovery.ts';
import type { RpcClient } from './controller.ts';

type State = {
  limited: boolean;
  eligible: boolean;
  prepare: boolean;
  prepareError: string | null;
  rpcFault: string | null;
  sendError: unknown;
  actor: { userId: string; email: string } | null;
  calls: Array<{ client: string; name: string; args?: Record<string, unknown> }>;
  sent: Array<{ email: string; redirectTo: string; codeChallenge?: string }>;
  redeemed: Array<Record<string, unknown>>;
};

const baseState = (): State => ({
  limited: false,
  eligible: true,
  prepare: true,
  prepareError: null,
  rpcFault: null,
  sendError: null,
  actor: { userId: '11111111-1111-4111-8111-111111111111', email: 'member@real.example' },
  calls: [],
  sent: [],
  redeemed: [],
});

function fakeRuntime(state: State): RecoveryRuntime {
  const serviceDb: RpcClient = {
    async rpc<T = unknown>(name: string, args?: Record<string, unknown>) {
      state.calls.push({ client: 'service', name, args });
      if (state.rpcFault === name) throw new Error('private provider/database fault');
      if (name === 'member_password_check_rate_limit') return { data: state.limited as T, error: null };
      if (name === 'member_password_recovery_eligible') return { data: state.eligible as T, error: null };
      return { data: null, error: { message: 'unexpected service RPC' } };
    },
  };
  const actorDb: RpcClient = {
    async rpc<T = unknown>(name: string, args?: Record<string, unknown>) {
      state.calls.push({ client: 'authenticated', name, args });
      if (state.rpcFault === name) throw new Error('private prepare fault');
      if (name !== 'member_password_prepare_self_recovery') {
        return { data: null, error: { message: 'unexpected authenticated RPC' } };
      }
      if (state.prepareError) return { data: null, error: { message: state.prepareError } };
      return { data: state.prepare as T, error: null };
    },
  };
  return {
    serviceDb,
    sendRecoveryEmail: async (email, redirectTo, codeChallenge) => {
      state.sent.push({ email, redirectTo, codeChallenge });
      return { error: state.sendError };
    },
    authorizeRecovery: async (authorization) => {
      if (authorization !== 'Bearer recovery' || !state.actor) return null;
      return { ...state.actor, db: actorDb };
    },
  };
}

const request = (body: unknown, options: { authorization?: string; signal?: AbortSignal } = {}) => new Request(
  'https://local.test/member-password-enrollment',
  {
    method: 'POST',
    headers: {
      Origin: 'https://dashboard-phantoms.vercel.app',
      'Content-Type': 'application/json',
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  },
);

const json = async (result: Response) => await result.json() as Record<string, unknown>;
const redirectTo = 'https://dashboard-phantoms.vercel.app/recovery/callback';
const codeChallenge = 'Abcdefghijklmnopqrstuvwxyz0123456789-_ABC12';
const requestRecoveryBody = (email = 'member@real.example') => ({ action: 'request_recovery', email, codeChallenge });
const completeBody = (password = 'StrongRecoveryPassword1') => ({
  action: 'complete_recovery', password, confirmPassword: password,
});

test('unknown and ineligible request addresses are indistinguishable and never send email', async () => {
  for (const eligible of [false, true] as const) {
    const state = baseState();
    state.eligible = eligible;
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state),
      requestRecoveryBody(eligible ? 'member@real.example' : 'unknown@real.example'),
      request(requestRecoveryBody()),
      'https://dashboard-phantoms.vercel.app',
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      redirectTo,
    ));
    assert.deepEqual(result, { ok: true });
    assert.equal(state.sent.length, eligible ? 1 : 0);
  }
});

test('request recovery uses only the fixed redirect and does not trust a client callback', async () => {
  const state = baseState();
  const result = await json(await handleMemberRecoveryAction(
    fakeRuntime(state),
    { ...requestRecoveryBody(' MEMBER@REAL.EXAMPLE '), redirectTo: 'https://evil.example' },
    request({ ...requestRecoveryBody(), redirectTo: 'https://evil.example' }),
    'https://dashboard-phantoms.vercel.app',
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    redirectTo,
  ));
  assert.deepEqual(result, { code: 'INVALID_INPUT' });
  assert.equal(state.sent.length, 0);

  const validState = baseState();
  const valid = await json(await handleMemberRecoveryAction(
    fakeRuntime(validState),
    requestRecoveryBody(' MEMBER@REAL.EXAMPLE '),
    request(requestRecoveryBody()),
    'https://dashboard-phantoms.vercel.app',
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    redirectTo,
  ));
  assert.deepEqual(valid, { ok: true });
  assert.deepEqual(validState.sent, [{ email: 'member@real.example', redirectTo, codeChallenge }]);
});

test('request recovery requires exactly action/email/codeChallenge and never sends malformed challenges', async () => {
  assert.equal(codeChallenge.length, 43);
  const invalidBodies: unknown[] = [
    { action: 'request_recovery', email: 'member@real.example' },
    { ...requestRecoveryBody(), codeChallenge: 'A'.repeat(42) },
    { ...requestRecoveryBody(), codeChallenge: 'A'.repeat(44) },
    { ...requestRecoveryBody(), codeChallenge: '!'.repeat(43) },
    { ...requestRecoveryBody(), codeChallenge: 123 },
    { ...requestRecoveryBody(), verifier: '0123456789abcdef'.repeat(4) },
  ];
  for (const body of invalidBodies) {
    const state = baseState();
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), body as Record<string, unknown>, request(body),
      'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
    ));
    assert.deepEqual(result, { code: 'INVALID_INPUT' });
    assert.equal(state.sent.length, 0);
    assert.equal(state.calls.length, 0);
  }
});

test('request recovery accepts no verifier and forwards the exact challenge unchanged', async () => {
  const state = baseState();
  const result = await json(await handleMemberRecoveryAction(
    fakeRuntime(state), requestRecoveryBody(), request(requestRecoveryBody()),
    'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
  ));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(state.sent, [{ email: 'member@real.example', redirectTo, codeChallenge }]);
  assert.equal(Object.hasOwn(state.sent[0], 'verifier'), false);
});

test('admin or password-only sessions cannot complete recovery before prepare', async () => {
  for (const prepareError of [null, 'UNAUTHORIZED'] as const) {
    const state = baseState();
    state.actor = null;
    state.prepareError = prepareError;
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
      'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
    ));
    assert.deepEqual(result, { code: 'UNAUTHORIZED' });
    assert.equal(state.calls.some((call) => call.name === 'member_password_prepare_self_recovery'), false);
  }
});

test('native recovery proof/session failures are safe and do not redeem an invitation', async () => {
  for (const proofError of ['RECOVERY_PROOF_REQUIRED', 'RECOVERY_SESSION_REQUIRED', 'IDENTITY_CONFLICT']) {
    const state = baseState();
    state.prepareError = proofError;
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
      'https://dashboard-phantoms.vercel.app', async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), redirectTo,
    ));
    assert.deepEqual(result, { code: 'REVIEW_REQUIRED' });
    assert.equal(state.redeemed.length, 0);
  }
});

test('complete recovery derives email from the authenticated identity and delegates exactly once', async () => {
  const state = baseState();
  state.actor = { userId: '22222222-2222-4222-8222-222222222222', email: '  Member@Real.Example ' };
  const result = await json(await handleMemberRecoveryAction(
    fakeRuntime(state), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
    'https://dashboard-phantoms.vercel.app', async (body) => {
      state.redeemed.push(body);
      return new Response(JSON.stringify({ ok: true, membership: 'active' }), { status: 200 });
    }, redirectTo,
  ));
  assert.deepEqual(result, { ok: true, membership: 'active' });
  assert.equal(state.redeemed.length, 1);
  assert.deepEqual(state.redeemed[0], {
    action: 'enroll', email: 'member@real.example', token: state.redeemed[0]?.token,
    password: 'StrongRecoveryPassword1', confirmPassword: 'StrongRecoveryPassword1',
  });
  assert.match(String(state.redeemed[0]?.token), /^phpw_[0-9a-f]{64}$/);
  assert.equal(state.calls.filter((call) => call.name === 'member_password_prepare_self_recovery').length, 1);
  assert.equal(String(result).includes('phpw_'), false);
});

test('already-used or duplicate recovery claims never retry or release the invitation', async () => {
  for (const prepareError of ['ALREADY_USED', 'REVIEW_REQUIRED'] as const) {
    const state = baseState();
    state.prepareError = prepareError;
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
      'https://dashboard-phantoms.vercel.app', async (body) => {
        state.redeemed.push(body);
        return new Response('{}', { status: 200 });
      }, redirectTo,
    ));
    assert.deepEqual(result, { code: 'REVIEW_REQUIRED' });
    assert.equal(state.redeemed.length, 0);
    assert.equal(state.calls.filter((call) => call.name === 'member_password_prepare_self_recovery').length, 1);
  }
});

test('rate limits fail closed before eligibility or prepare', async () => {
  const requestState = baseState();
  requestState.limited = true;
  const requestResult = await json(await handleMemberRecoveryAction(
    fakeRuntime(requestState), requestRecoveryBody(),
    request(requestRecoveryBody()),
    'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
  ));
  assert.deepEqual(requestResult, { code: 'RATE_LIMITED' });
  assert.equal(requestState.calls.some((call) => call.name === 'member_password_recovery_eligible'), false);

  const completeState = baseState();
  completeState.limited = true;
  const completeResult = await json(await handleMemberRecoveryAction(
    fakeRuntime(completeState), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
    'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
  ));
  assert.deepEqual(completeResult, { code: 'RATE_LIMITED' });
  assert.equal(completeState.calls.some((call) => call.name === 'member_password_prepare_self_recovery'), false);
});

test('provider faults are sanitized and never expose account or token material', async () => {
  const state = baseState();
  state.sendError = { message: 'UPPERCASE_PRIVATE_TOKEN account=real@example secret=phpw_' + 'a'.repeat(64) };
  const logged: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => logged.push(args);
  try {
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), requestRecoveryBody(),
      request(requestRecoveryBody()),
      'https://dashboard-phantoms.vercel.app', async () => new Response('{}', { status: 200 }), redirectTo,
    ));
    assert.deepEqual(result, { ok: true });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(JSON.stringify(logged).includes('real@example'), false);
  assert.equal(JSON.stringify(logged).includes('phpw_'), false);
  assert.equal(JSON.stringify(logged).includes('UPPERCASE_PRIVATE_TOKEN'), false);
  assert.deepEqual(logged[0], ['member recovery delivery failure', 'DELIVERY_FAILED']);
});

test('post-prepare downstream failures require administrator review, never a retryable consumed session', async () => {
  for (const code of ['RATE_LIMITED', 'SERVER_UNAVAILABLE', 'INVALID_TOKEN']) {
    const state = baseState();
    const result = await handleMemberRecoveryAction(
      fakeRuntime(state), completeBody(), request(completeBody(), { authorization: 'Bearer recovery' }),
      'https://dashboard-phantoms.vercel.app', async (body) => {
        state.redeemed.push(body);
        return new Response(JSON.stringify({ code }), { status: 429 });
      }, redirectTo,
    );
    assert.equal(result.status, 409);
    assert.deepEqual(await json(result), { code: 'REVIEW_REQUIRED' });
    assert.equal(state.redeemed.length, 1);
    assert.equal(state.calls.filter((call) => call.name === 'member_password_prepare_self_recovery').length, 1);
  }
});

test('aborted request stops before prepare, while a post-prepare disconnect still delegates once', async () => {
  const before = baseState();
  const beforeAbort = new AbortController();
  beforeAbort.abort();
  const beforeResult = await json(await handleMemberRecoveryAction(
    fakeRuntime(before), completeBody(), request(completeBody(), { authorization: 'Bearer recovery', signal: beforeAbort.signal }),
    'https://dashboard-phantoms.vercel.app', async (body) => {
      before.redeemed.push(body);
      return new Response('{}', { status: 200 });
    }, redirectTo,
  ));
  assert.deepEqual(beforeResult, { code: 'SERVER_UNAVAILABLE' });
  assert.equal(before.calls.some((call) => call.name === 'member_password_prepare_self_recovery'), false);

  const after = baseState();
  const afterAbort = new AbortController();
  const result = await handleMemberRecoveryAction(
    fakeRuntime(after), completeBody(), request(completeBody(), { authorization: 'Bearer recovery', signal: afterAbort.signal }),
    'https://dashboard-phantoms.vercel.app', async (body) => {
      after.redeemed.push(body);
      afterAbort.abort();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, redirectTo,
  );
  assert.equal(result.status, 200);
  assert.equal(after.redeemed.length, 1);
});

test('password validation happens before authentication and prepare', async () => {
  for (const body of [
    { action: 'complete_recovery', password: 'short1', confirmPassword: 'short1' },
    { action: 'complete_recovery', password: 'NoDigitsHere', confirmPassword: 'NoDigitsHere' },
    { action: 'complete_recovery', password: 'StrongRecoveryPassword1', confirmPassword: 'DifferentPassword1' },
    { action: 'complete_recovery', password: 'StrongRecoveryPassword1', confirmPassword: 'StrongRecoveryPassword1', extra: true },
  ]) {
    const state = baseState();
    const result = await json(await handleMemberRecoveryAction(
      fakeRuntime(state), body, request(body), 'https://dashboard-phantoms.vercel.app',
      async () => new Response('{}', { status: 200 }), redirectTo,
    ));
    assert.equal(['WEAK_PASSWORD', 'PASSWORD_MISMATCH', 'INVALID_INPUT'].includes(String(result.code)), true);
    assert.equal(state.calls.length, 0);
  }
});
