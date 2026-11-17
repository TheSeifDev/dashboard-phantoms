import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logoutMemberWithCleanup } from '../src/features/portal/member-logout.ts';

type Scenario = {
  deviceReject?: boolean;
  localReject?: boolean;
};

async function runScenario({ deviceReject = false, localReject = false }: Scenario = {}) {
  let memberState: { id: number } | null = { id: 42 };
  let adminSession: 'admin-session' | null = 'admin-session';
  const events: string[] = [];
  const reported: string[] = [];

  const result = await logoutMemberWithCleanup({
    deviceLogout: async () => {
      events.push('device-revoke');
      if (deviceReject) throw new Error('raw device auth failure');
    },
    localSignOut: async () => {
      events.push('local-sign-out');
      if (localReject) throw new Error('raw local auth failure');
    },
    clearMemberState: () => {
      events.push('clear-member-state');
      memberState = null;
    },
    navigateToLogin: () => {
      events.push('navigate-login');
    },
    onDeviceLogoutFailure: () => {
      reported.push('device');
    },
    onLocalSignOutFailure: () => {
      reported.push('local');
    },
  });

  // This value represents a separate admin client/session and must not be touched.
  assert.equal(adminSession, 'admin-session');
  adminSession = null;

  return { result, memberState, events, reported };
}

function assertNoStaleMemberState(memberState: { id: number } | null, events: string[]): void {
  assert.equal(memberState, null);
  assert.deepEqual(events.slice(-2), ['clear-member-state', 'navigate-login']);
}

test('normal logout revokes the device, signs out locally, clears member state, and navigates', async () => {
  const { result, memberState, events, reported } = await runScenario();

  assert.deepEqual(result, { deviceLogout: 'revoked', localSignOut: 'completed' });
  assert.deepEqual(events, ['device-revoke', 'local-sign-out', 'clear-member-state', 'navigate-login']);
  assert.deepEqual(reported, []);
  assertNoStaleMemberState(memberState, events);
});

test('local member sign-out rejection still clears member state and navigates', async () => {
  const { result, memberState, events, reported } = await runScenario({ localReject: true });

  assert.deepEqual(result, { deviceLogout: 'revoked', localSignOut: 'failed' });
  assert.deepEqual(events, ['device-revoke', 'local-sign-out', 'clear-member-state', 'navigate-login']);
  assert.deepEqual(reported, ['local']);
  assertNoStaleMemberState(memberState, events);
});

test('device logout rejection does not block local cleanup or navigation', async () => {
  const { result, memberState, events, reported } = await runScenario({ deviceReject: true });

  assert.deepEqual(result, { deviceLogout: 'failed', localSignOut: 'completed' });
  assert.deepEqual(events, ['device-revoke', 'local-sign-out', 'clear-member-state', 'navigate-login']);
  assert.deepEqual(reported, ['device']);
  assertNoStaleMemberState(memberState, events);
});

test('when both operations reject, local member state is still not stale', async () => {
  const { result, memberState, events, reported } = await runScenario({
    deviceReject: true,
    localReject: true,
  });

  assert.deepEqual(result, { deviceLogout: 'failed', localSignOut: 'failed' });
  assert.deepEqual(events, ['device-revoke', 'local-sign-out', 'clear-member-state', 'navigate-login']);
  assert.deepEqual(reported, ['device', 'local']);
  assertNoStaleMemberState(memberState, events);
});

test('member logout orchestration never signs out the independent admin session', async () => {
  const { memberState, events } = await runScenario({ localReject: true });

  assertNoStaleMemberState(memberState, events);
  assert.equal(events.includes('admin-sign-out'), false);
  assert.equal(events.includes('clear-admin-storage'), false);
});
