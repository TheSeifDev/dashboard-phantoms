import test from 'node:test';
import assert from 'node:assert/strict';
import { runAuthFixtureLifecycle } from './auth-fixture-lifecycle.mjs';

// Prerequisite: Node.js with built-in node:test; run from frontend with:
// node --test scripts/auth-fixture-lifecycle.test.mjs

function fakeSeeded() {
  return {
    service: { name: 'owned-service' },
    admin: { name: 'owned-admin' },
    fixture: {
      adminEmail: 'owned-admin@phantoms-test.example',
      existingMemberEmail: 'owned-member@phantoms-test.example',
      firstTimeMemberEmail: 'owned-first-time@phantoms-test.example',
      outsiderEmail: 'owned-outsider@phantoms-test.example',
      inviteEmail: 'owned-invite@phantoms-test.example',
      recoveryEmail: 'owned-recovery@phantoms-test.example',
      memberIds: ['owned-member-row'],
      adminUserIds: ['owned-admin-user'],
      createdUserIds: ['owned-admin-user'],
    },
  };
}

test('first post-seed listing failure still finalizes and preserves the original error', async () => {
  const seeded = fakeSeeded();
  const messageIds = new Set(['owned-before-failure']);
  const unrelatedMessageId = 'unrelated-message';
  const originalError = new Error('injected first Mailpit listing failure');
  const events = [];
  let listingCalls = 0;
  let cleanupIds;
  let finalizedWith;
  const trackFixtureMessages = async (_fixture, ids) => {
    listingCalls += 1;
    events.push(`track:${listingCalls}`);
    if (listingCalls === 1) throw originalError;
    ids.add('owned-found-during-cleanup');
    assert.equal(ids.has(unrelatedMessageId), false);
  };

  const result = await runAuthFixtureLifecycle({
    seeded,
    messageIds,
    trackFixtureMessages,
    startFixtureBridge: async () => {
      throw new Error('browser setup must not start after listing failure');
    },
    spawnPreview: async () => {
      throw new Error('preview must not start after listing failure');
    },
    waitForPreview: async () => {
      throw new Error('preview wait must not start after listing failure');
    },
    runTests: async () => {
      throw new Error('browser tests must not start after listing failure');
    },
    stopPreview: async (preview) => {
      events.push(`stop:${preview ?? 'none'}`);
    },
    closeBridge: async (bridge) => {
      events.push(`close:${bridge ?? 'none'}`);
    },
    cleanupFixtures: async (_service, _admin, fixture, ids) => {
      events.push(`cleanup:${fixture.adminEmail}`);
      assert.equal(fixture, seeded.fixture);
      await trackFixtureMessages(fixture, ids);
      cleanupIds = [...ids];
      ids.delete(unrelatedMessageId);
    },
    finalizeEvidence: (cleanupStatus) => {
      events.push(`finalize:${cleanupStatus}`);
      finalizedWith = cleanupStatus;
    },
  });

  assert.equal(result.primaryError, originalError);
  assert.equal(result.shutdownError, null);
  assert.equal(result.cleanupError, null);
  assert.equal(result.finalizationError, null);
  assert.equal(result.cleanupStatus, 'passed');
  assert.deepEqual(events, [
    'track:1',
    'stop:none',
    'close:none',
    'cleanup:owned-admin@phantoms-test.example',
    'track:2',
    'finalize:passed',
  ]);
  assert.deepEqual(cleanupIds, ['owned-before-failure', 'owned-found-during-cleanup']);
  assert.equal(cleanupIds.includes(unrelatedMessageId), false);
  assert.equal(finalizedWith, 'passed');
});

test('normal lifecycle runs in order and cleans only exact tracked message IDs', async () => {
  const seeded = fakeSeeded();
  const messageIds = new Set();
  const events = [];
  let cleanupIds;
  let finalizedWith;
  const trackFixtureMessages = async (_fixture, ids) => {
    events.push('track');
    ids.add('owned-listed-message');
    // This message belongs to another disposable fixture and must never be tracked.
    assert.equal(ids.has('unrelated-message'), false);
  };

  const result = await runAuthFixtureLifecycle({
    seeded,
    messageIds,
    trackFixtureMessages,
    startFixtureBridge: async (_currentSeeded, ids) => {
      events.push('bridge');
      ids.add('owned-bridge-message');
      return { origin: 'http://127.0.0.1:41001', server: { name: 'owned-bridge' } };
    },
    spawnPreview: async () => {
      events.push('preview');
      return { name: 'owned-preview' };
    },
    waitForPreview: async (currentSeeded, bridge, preview) => {
      assert.equal(currentSeeded, seeded);
      assert.equal(bridge.server.name, 'owned-bridge');
      assert.equal(preview.name, 'owned-preview');
      events.push('wait');
    },
    runTests: async (_currentSeeded, _bridge, _preview, ids) => {
      events.push('tests');
      ids.add('owned-consumed-message');
    },
    stopPreview: async (preview) => {
      events.push(`stop:${preview.name}`);
    },
    closeBridge: async (bridge) => {
      events.push(`close:${bridge.server.name}`);
    },
    cleanupFixtures: async (_service, _admin, fixture, ids) => {
      events.push(`cleanup:${fixture.adminEmail}`);
      cleanupIds = [...ids];
    },
    finalizeEvidence: (cleanupStatus) => {
      events.push(`finalize:${cleanupStatus}`);
      finalizedWith = cleanupStatus;
    },
  });

  assert.equal(result.primaryError, null);
  assert.equal(result.shutdownError, null);
  assert.equal(result.cleanupError, null);
  assert.equal(result.finalizationError, null);
  assert.equal(result.cleanupStatus, 'passed');
  assert.deepEqual(events, [
    'track',
    'bridge',
    'preview',
    'wait',
    'tests',
    'stop:owned-preview',
    'close:owned-bridge',
    'cleanup:owned-admin@phantoms-test.example',
    'finalize:passed',
  ]);
  assert.deepEqual(cleanupIds, [
    'owned-listed-message',
    'owned-bridge-message',
    'owned-consumed-message',
  ]);
  assert.equal(cleanupIds.includes('unrelated-message'), false);
  assert.equal(finalizedWith, 'passed');
});

test('cleanup failure is reported separately while preserving an earlier setup error', async () => {
  const seeded = fakeSeeded();
  const messageIds = new Set();
  const setupError = new Error('injected browser setup failure');
  const cleanupError = new Error('injected cleanup failure');
  let finalizedWith;

  const result = await runAuthFixtureLifecycle({
    seeded,
    messageIds,
    trackFixtureMessages: async () => {},
    startFixtureBridge: async () => {
      throw setupError;
    },
    spawnPreview: async () => null,
    waitForPreview: async () => {},
    runTests: async () => {},
    stopPreview: async () => {},
    closeBridge: async () => {},
    cleanupFixtures: async () => {
      throw cleanupError;
    },
    finalizeEvidence: (cleanupStatus) => {
      finalizedWith = cleanupStatus;
    },
  });

  assert.equal(result.primaryError, setupError);
  assert.equal(result.cleanupError, cleanupError);
  assert.equal(result.cleanupStatus, 'failed');
  assert.equal(result.finalizationError, null);
  assert.equal(finalizedWith, 'failed');
});
