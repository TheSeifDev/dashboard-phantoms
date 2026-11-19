const SCREENSHOT_KEYS = ['theme', 'viewport'];
const SCREENSHOT_EXPECTED = ['dark:desktop', 'dark:mobile', 'light:desktop', 'light:mobile'];
const MOBILE_CASE_KEYS = ['width', 'theme', 'drawerFullScreen', 'nameFromDatabase', 'nameWrapped', 'closeButton', 'escapeClose'];
const CLEANUP_KEYS = ['authUsers', 'adminAccounts', 'members', 'memberBindings', 'tasks', 'notes', 'customFields', 'legacyInvites', 'contributionEvents'];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected) {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function validScreenshots(screenshots) {
  if (!Array.isArray(screenshots) || screenshots.length !== SCREENSHOT_EXPECTED.length) return false;
  const labels = [];
  for (const item of screenshots) {
    if (!exactKeys(item, SCREENSHOT_KEYS) || !['light', 'dark'].includes(item.theme)
      || !['desktop', 'mobile'].includes(item.viewport)) return false;
    labels.push(`${item.theme}:${item.viewport}`);
  }
  return new Set(labels).size === SCREENSHOT_EXPECTED.length
    && SCREENSHOT_EXPECTED.every((label) => labels.includes(label));
}

function validMobileCases(mobileUI) {
  if (!exactKeys(mobileUI, ['cases', 'longArabicNamePersistedFromDatabase', 'longArabicNameWrapped', 'noHorizontalOverflow'])
    || mobileUI.longArabicNamePersistedFromDatabase !== true
    || mobileUI.longArabicNameWrapped !== true
    || mobileUI.noHorizontalOverflow !== true
    || !Array.isArray(mobileUI.cases) || mobileUI.cases.length !== 4) return false;
  const cases = new Set();
  for (const item of mobileUI.cases) {
    if (!exactKeys(item, MOBILE_CASE_KEYS)
      || ![360, 390].includes(item.width)
      || !['light', 'dark'].includes(item.theme)
      || item.drawerFullScreen !== true
      || item.nameFromDatabase !== true
      || item.nameWrapped !== true
      || item.closeButton !== true
      || item.escapeClose !== true) return false;
    cases.add(`${item.width}:${item.theme}`);
  }
  return cases.size === 4
    && [360, 390].every((width) => ['light', 'dark'].every((theme) => cases.has(`${width}:${theme}`)));
}

export function isCompleteDashboardEvidence(evidence, expectedMode) {
  const topKeys = ['schema', 'runtime', 'vapidMode', 'fixtures', 'workflows', 'assignments', 'screenshots', 'security', 'recovery', 'genuineEmptyStateVerified', 'pageErrorCount', 'requests', 'mobileUI'];
  if (!exactKeys(evidence, topKeys)
    || evidence.schema !== 'phantoms-dashboard-disposable-evidence/v3'
    || !['missing', 'invalid'].includes(evidence.vapidMode)
    || (expectedMode && evidence.vapidMode !== expectedMode)
    || !exactKeys(evidence.runtime, ['apiHost', 'apiPort'])
    || evidence.runtime.apiHost !== '127.0.0.1'
    || !integer(evidence.runtime.apiPort, 1024)
    || evidence.runtime.apiPort > 65535
    || !exactKeys(evidence.fixtures, ['members', 'tasks', 'notes', 'customFields', 'pendingInvites'])
    || evidence.fixtures.members !== 2 || evidence.fixtures.tasks !== 4 || evidence.fixtures.notes !== 2
    || evidence.fixtures.customFields !== 1 || evidence.fixtures.pendingInvites !== 1
    || !exactKeys(evidence.workflows, ['seededApprovalPersisted', 'failedTaskInsertVisibleAndNotPersisted', 'restoredUiCreationPersisted'])
    || Object.values(evidence.workflows).some((value) => value !== true)
    || !exactKeys(evidence.assignments, ['specificPersisted', 'specificAssignedMembers', 'specificTrackingMembers', 'allPersisted', 'allAssignedMembers', 'allTrackingMembers', 'visibleAfterReload', 'exactTestTasksRemainingAfterCleanup'])
    || evidence.assignments.specificPersisted !== true
    || evidence.assignments.specificAssignedMembers !== 1 || evidence.assignments.specificTrackingMembers !== 1
    || evidence.assignments.allPersisted !== true
    || evidence.assignments.allAssignedMembers !== 2 || evidence.assignments.allTrackingMembers !== 2
    || evidence.assignments.visibleAfterReload !== true
    || evidence.assignments.exactTestTasksRemainingAfterCleanup !== 0
    || !validScreenshots(evidence.screenshots)
    || !exactKeys(evidence.security, ['protectedColumnsDenied', 'anonDenied', 'outsiderRows', 'blockedRemoteRequests', 'pushRequestsWhileVapidDeferred'])
    || evidence.security.protectedColumnsDenied !== true || evidence.security.anonDenied !== true
    || evidence.security.outsiderRows !== 0 || evidence.security.blockedRemoteRequests !== 0
    || evidence.security.pushRequestsWhileVapidDeferred !== 0
    || !exactKeys(evidence.recovery, ['controlled403Observed', 'recoveredWithLiveData'])
    || evidence.recovery.controlled403Observed !== true || evidence.recovery.recoveredWithLiveData !== true
    || evidence.genuineEmptyStateVerified !== true || evidence.pageErrorCount !== 0
    || !exactKeys(evidence.requests, ['total', 'successfulMemberSelects', 'injectedTaskInsertFailures', 'unexpectedErrorResponses'])
    || !integer(evidence.requests.total, 1) || !integer(evidence.requests.successfulMemberSelects, 1)
    || evidence.requests.injectedTaskInsertFailures !== 1 || evidence.requests.unexpectedErrorResponses !== 0
    || !validMobileCases(evidence.mobileUI)) return false;
  return true;
}

export function isCompleteDashboardCleanupEvidence(evidence, expectedMode) {
  if (!exactKeys(evidence, ['schema', 'vapidMode', 'passed', 'remaining'])
    || evidence.schema !== 'phantoms-dashboard-fixture-cleanup/v2'
    || !['missing', 'invalid'].includes(evidence.vapidMode)
    || (expectedMode && evidence.vapidMode !== expectedMode)
    || evidence.passed !== true
    || !exactKeys(evidence.remaining, CLEANUP_KEYS)) return false;
  return Object.values(evidence.remaining).every((count) => count === 0);
}
