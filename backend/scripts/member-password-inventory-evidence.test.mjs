import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteInventoryPaginationEvidence } from './member-password-inventory-evidence.mjs';

function validEvidence() {
  return {
    schema: 'phantoms-member-password-inventory-pagination/v1',
    runtime: 'native-disposable-postgresql-17',
    fixtureRowsPerResult: 1002,
    operations: Object.fromEntries([
      ['member', [500, 500, 2]],
      ['auth', [500, 500, 3]],
      ['invitation', [500, 500, 2]],
    ].map(([name, pageCounts]) => [name, {
      limit: 500,
      offsets: [0, 500, 1000],
      pageCounts,
      ownedRowsObserved: 1002,
      pagesDisjoint: true,
      overflowSafe: true,
    }])),
    safety: {
      readOnlyTransactions: true,
      boundedLimits: true,
      offsetsApplied: true,
      noDmlOrDdl: true,
      secretBearingOutputExcluded: true,
      ownedFixtureOnly: true,
      cleanupExact: true,
    },
    cleanupStatus: 'completed-exact-fixtures',
    passed: true,
  };
}

test('accepts only complete exact-schema inventory pagination evidence', () => {
  assert.equal(isCompleteInventoryPaginationEvidence(validEvidence()), true);
});

test('rejects unknown top-level, operation, and safety keys', () => {
  const extraTop = { ...validEvidence(), rawRows: [] };
  const extraOperation = validEvidence();
  extraOperation.operations.member.sampleEmail = 'fixture@example.invalid';
  const extraSafety = validEvidence();
  extraSafety.safety.connectedToHosted = false;
  assert.equal(isCompleteInventoryPaginationEvidence(extraTop), false);
  assert.equal(isCompleteInventoryPaginationEvidence(extraOperation), false);
  assert.equal(isCompleteInventoryPaginationEvidence(extraSafety), false);
});

test('rejects incomplete pages, incorrect offsets, and unverifiable cleanup', () => {
  const wrongPage = validEvidence();
  wrongPage.operations.invitation.pageCounts = [500, 500, 3];
  const wrongOffsets = validEvidence();
  wrongOffsets.operations.auth.offsets = [0, 500, 999];
  const failedCleanup = validEvidence();
  failedCleanup.safety.cleanupExact = false;
  failedCleanup.cleanupStatus = 'failed';
  assert.equal(isCompleteInventoryPaginationEvidence(wrongPage), false);
  assert.equal(isCompleteInventoryPaginationEvidence(wrongOffsets), false);
  assert.equal(isCompleteInventoryPaginationEvidence(failedCleanup), false);
  assert.equal(isCompleteInventoryPaginationEvidence(null), false);
});
