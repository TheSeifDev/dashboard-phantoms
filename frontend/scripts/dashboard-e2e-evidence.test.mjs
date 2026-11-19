import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteDashboardEvidence, isCompleteDashboardCleanupEvidence } from './dashboard-e2e-evidence.mjs';

function evidence(mode = 'missing') {
  return {
    schema: 'phantoms-dashboard-disposable-evidence/v3',
    runtime: { apiHost: '127.0.0.1', apiPort: 54321 },
    vapidMode: mode,
    fixtures: { members: 2, tasks: 4, notes: 2, customFields: 1, pendingInvites: 1 },
    workflows: { seededApprovalPersisted: true, failedTaskInsertVisibleAndNotPersisted: true, restoredUiCreationPersisted: true },
    assignments: { specificPersisted: true, specificAssignedMembers: 1, specificTrackingMembers: 1, allPersisted: true, allAssignedMembers: 2, allTrackingMembers: 2, visibleAfterReload: true, exactTestTasksRemainingAfterCleanup: 0 },
    screenshots: [
      { theme: 'dark', viewport: 'desktop' }, { theme: 'dark', viewport: 'mobile' },
      { theme: 'light', viewport: 'desktop' }, { theme: 'light', viewport: 'mobile' },
    ],
    security: { protectedColumnsDenied: true, anonDenied: true, outsiderRows: 0, blockedRemoteRequests: 0, pushRequestsWhileVapidDeferred: 0 },
    recovery: { controlled403Observed: true, recoveredWithLiveData: true },
    genuineEmptyStateVerified: true,
    pageErrorCount: 0,
    requests: { total: 18, successfulMemberSelects: 2, injectedTaskInsertFailures: 1, unexpectedErrorResponses: 0 },
    mobileUI: {
      cases: [360, 390].flatMap((width) => ['light', 'dark'].map((theme) => ({ width, theme, drawerFullScreen: true, nameFromDatabase: true, nameWrapped: true, closeButton: true, escapeClose: true }))),
      longArabicNamePersistedFromDatabase: true,
      longArabicNameWrapped: true,
      noHorizontalOverflow: true,
    },
  };
}

function cleanupEvidence(mode = 'missing') {
  return {
    schema: 'phantoms-dashboard-fixture-cleanup/v2',
    vapidMode: mode,
    passed: true,
    remaining: { authUsers: 0, adminAccounts: 0, members: 0, memberBindings: 0, tasks: 0, notes: 0, customFields: 0, legacyInvites: 0, contributionEvents: 0 },
  };
}

test('accepts exact minimized dashboard evidence and verified per-mode fixture cleanup', () => {
  assert.equal(isCompleteDashboardEvidence(evidence(), 'missing'), true);
  assert.equal(isCompleteDashboardEvidence(evidence('invalid'), 'invalid'), true);
  assert.equal(isCompleteDashboardCleanupEvidence(cleanupEvidence(), 'missing'), true);
  assert.equal(isCompleteDashboardCleanupEvidence(cleanupEvidence('invalid'), 'invalid'), true);
});

test('rejects paths, task payloads, raw requests, and unknown nested evidence fields', () => {
  const withPath = evidence();
  withPath.screenshots[0].path = '/tmp/private.png';
  const withTask = evidence();
  withTask.assignments.task = { id: 'fixture-id', title: 'private title' };
  const withRequests = evidence();
  withRequests.requests.items = [{ endpoint: '/rest/v1/private', method: 'GET' }];
  const withMobileName = evidence();
  withMobileName.mobileUI.cases[0].memberName = 'raw name';
  assert.equal(isCompleteDashboardEvidence(withPath), false);
  assert.equal(isCompleteDashboardEvidence(withTask), false);
  assert.equal(isCompleteDashboardEvidence(withRequests), false);
  assert.equal(isCompleteDashboardEvidence(withMobileName), false);
});

test('requires all 360/390 light/dark real mobile cases and visible cleanup proof', () => {
  const missingCase = evidence();
  missingCase.mobileUI.cases.pop();
  const noDatabaseName = evidence();
  noDatabaseName.mobileUI.cases[0].nameFromDatabase = false;
  const residue = cleanupEvidence();
  residue.remaining.members = 1;
  assert.equal(isCompleteDashboardEvidence(missingCase), false);
  assert.equal(isCompleteDashboardEvidence(noDatabaseName), false);
  assert.equal(isCompleteDashboardCleanupEvidence(residue), false);
  assert.equal(isCompleteDashboardCleanupEvidence({ ...cleanupEvidence(), unknown: true }), false);
});

test('cleanup v2 refuses old schemas, omitted ledger inventory and residual contribution events', () => {
  const residue = cleanupEvidence();
  residue.remaining.contributionEvents = 1;
  assert.equal(isCompleteDashboardCleanupEvidence(residue), false);
  assert.equal(isCompleteDashboardCleanupEvidence({ ...cleanupEvidence(), schema: 'phantoms-dashboard-fixture-cleanup/v1' }), false);
  const omitted = cleanupEvidence();
  delete omitted.remaining.contributionEvents;
  assert.equal(isCompleteDashboardCleanupEvidence(omitted), false);
});
