const TOP_LEVEL_KEYS = ['schema', 'runtime', 'fixtureRowsPerResult', 'operations', 'safety', 'cleanupStatus', 'passed'];
const OPERATION_KEYS = ['limit', 'offsets', 'pageCounts', 'ownedRowsObserved', 'pagesDisjoint', 'overflowSafe'];
const SAFETY_KEYS = ['readOnlyTransactions', 'boundedLimits', 'offsetsApplied', 'noDmlOrDdl', 'secretBearingOutputExcluded', 'ownedFixtureOnly', 'cleanupExact'];
const OPERATIONS = ['member', 'auth', 'invitation'];
const OFFSETS = [0, 500, 1000];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected) {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function exactArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

export function isCompleteInventoryPaginationEvidence(evidence) {
  if (!exactKeys(evidence, TOP_LEVEL_KEYS)
    || evidence.schema !== 'phantoms-member-password-inventory-pagination/v1'
    || !['native-disposable-postgresql-17', 'docker-disposable-postgresql-17'].includes(evidence.runtime)
    || evidence.fixtureRowsPerResult !== 1002
    || evidence.cleanupStatus !== 'completed-exact-fixtures'
    || evidence.passed !== true
    || !exactKeys(evidence.operations, OPERATIONS)
    || !exactKeys(evidence.safety, SAFETY_KEYS)
    || Object.values(evidence.safety).some((value) => value !== true)) return false;

  for (const operation of OPERATIONS) {
    const result = evidence.operations[operation];
    const expectedPageCounts = operation === 'auth' ? [500, 500, 3] : [500, 500, 2];
    if (!exactKeys(result, OPERATION_KEYS)
      || result.limit !== 500
      || !exactArray(result.offsets, OFFSETS)
      || !exactArray(result.pageCounts, expectedPageCounts)
      || result.ownedRowsObserved !== 1002
      || result.pagesDisjoint !== true
      || result.overflowSafe !== true) return false;
  }
  return true;
}
