import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REAL_EVIDENCE_CONTRACT,
  REAL_BOUNDARY_EXPECTATIONS,
  REAL_BOUNDARY_OBSERVATION_LABELS,
  REAL_STAGE_LABELS,
  REAL_TEST_TITLE,
  countUsersByEmail,
  isCompleteRealEvidence,
  isExactLoopbackDb,
  isExactLoopbackOrigin,
  sanitizeRealEvidence,
  validatePreflightConfig,
} from './member-password-real.test.mjs';

const REAL_RUNNER_SOURCE = readFileSync(new URL('./member-password-real.test.mjs', import.meta.url), 'utf8');

function passingInput(overrides = {}) {
  return {
    schema: REAL_EVIDENCE_CONTRACT.schema,
    mode: 'real-http',
    test: REAL_TEST_TITLE,
    realServices: true,
    passed: true,
    pg17: true,
    stages: REAL_STAGE_LABELS.map((label) => ({ label, status: 'passed', passed: true })),
    counts: { stages: REAL_STAGE_LABELS.length, passed: REAL_STAGE_LABELS.length, failed: 0, notStarted: 0 },
    cleanupStatus: 'passed',
    aborted: false,
    observations: {
      oldPasswordRejected: true,
      newPasswordAccepted: true,
      oldAccessJwtAccepted: false,
      oldRefreshAccepted: false,
      unrelatedAdminSessionPreserved: true,
    },
    boundaryObservations: REAL_BOUNDARY_EXPECTATIONS.map((expected) => ({
      ...expected, exactLogin: expected.accepted, trimmedRejected: expected.label === 'ascii72', changedSuffixRejected: expected.accepted,
    })),
    ...overrides,
  };
}

test('real evidence contract is explicitly real-http and has every required stage', () => {
  const evidence = sanitizeRealEvidence(passingInput());
  assert.equal(evidence.mode, 'real-http');
  assert.equal(evidence.realServices, true);
  assert.equal(evidence.passed, true);
  assert.equal(evidence.cleanupStatus, 'passed');
  assert.deepEqual(evidence.stages.map((stage) => stage.label), REAL_STAGE_LABELS);
  assert.equal(evidence.counts.passed, REAL_STAGE_LABELS.length);
  assert.equal(isCompleteRealEvidence(evidence), true);
});

test('evidence rejects missing required stages and never converts them to a pass', () => {
  const missing = sanitizeRealEvidence(passingInput({ stages: REAL_STAGE_LABELS.slice(0, -1).map((label) => ({ label, status: 'passed', passed: true })) }));
  assert.equal(missing.passed, false);
  assert.equal(missing.counts.passed, REAL_STAGE_LABELS.length - 1);
  assert.equal(isCompleteRealEvidence(missing), false);
});

test('evidence rejects duplicate stage labels', () => {
  const duplicate = sanitizeRealEvidence(passingInput({
    stages: [...REAL_STAGE_LABELS.slice(0, -1), REAL_STAGE_LABELS[0]].map((label) => ({ label, status: 'passed', passed: true })),
  }));
  assert.equal(duplicate.passed, false);
  assert.equal(isCompleteRealEvidence(duplicate), false);
});

test('evidence rejects failed cleanup even if every stage claims passed', () => {
  const failedCleanup = sanitizeRealEvidence(passingInput({ cleanupStatus: 'failed' }));
  assert.equal(failedCleanup.cleanupStatus, 'failed');
  assert.equal(failedCleanup.passed, false);
  assert.equal(isCompleteRealEvidence(failedCleanup), false);
});

test('evidence requires PG17 and a non-aborted run', () => {
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(passingInput({ pg17: false }))), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(passingInput({ aborted: true }))), false);
});

test('evidence rejects raw pass-bit and contradictory count tampering', () => {
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(passingInput({ passed: false }))), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(passingInput({ counts: { stages: REAL_STAGE_LABELS.length, passed: REAL_STAGE_LABELS.length - 1, failed: 0, notStarted: 0 } }))), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(passingInput({ counts: { stages: REAL_STAGE_LABELS.length, passed: REAL_STAGE_LABELS.length, failed: 0, notStarted: 1 } }))), false);
});

test('evidence requires the allowlisted reset observations and rejects unknown fields', () => {
  const missingObservation = passingInput({ observations: { oldPasswordRejected: true, newPasswordAccepted: true, oldAccessJwtAccepted: false, oldRefreshAccepted: false } });
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(missingObservation)), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence({ ...passingInput(), unexpected: true })), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence({ ...passingInput(), observations: { ...passingInput().observations, secret: true } })), false);
  const extraStage = passingInput(); extraStage.stages[0].rawTitle = 'private stage detail';
  const extraBoundary = passingInput(); extraBoundary.boundaryObservations[0].password = 'private value';
  assert.equal(isCompleteRealEvidence(extraStage), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(extraStage)), false);
  assert.equal(isCompleteRealEvidence(extraBoundary), false);
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(extraBoundary)), false);
});

test('reset acceptance requires old Member JWT and refresh denial', () => {
  for (const name of ['oldAccessJwtAccepted', 'oldRefreshAccepted']) {
    const input = passingInput(); input.observations[name] = true;
    assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(input)), false);
  }
});

test('evidence requires every fixed password-boundary observation', () => {
  const missingBoundary = passingInput({ boundaryObservations: REAL_BOUNDARY_OBSERVATION_LABELS.slice(0, -1).map((label) => ({ label, characters: 0, utf8Bytes: 0, accepted: false, exactLogin: false, trimmedRejected: false, changedSuffixRejected: false })) });
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(missingBoundary)), false);
  const baseline = passingInput().boundaryObservations;
  const duplicateBoundary = passingInput({ boundaryObservations: [...baseline.slice(0, -1), baseline[0]] });
  assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(duplicateBoundary)), false);
});

test('boundary acceptance cannot be forged with placeholder lengths or wrong compatibility outcomes', () => {
  for (const field of ['characters', 'utf8Bytes', 'accepted']) {
    const input = passingInput();
    input.boundaryObservations[0][field] = field === 'accepted' ? false : 0;
    assert.equal(isCompleteRealEvidence(sanitizeRealEvidence(input)), false);
  }
});

test('mock mode, omitted real-service proof, and fake mode cannot mark real acceptance passed', () => {
  const mockMode = sanitizeRealEvidence(passingInput({ mode: 'mock' }));
  const omittedProof = sanitizeRealEvidence(passingInput({ realServices: false }));
  const omittedMode = sanitizeRealEvidence({ ...passingInput(), mode: undefined });
  assert.equal(mockMode.passed, false);
  assert.equal(omittedProof.passed, false);
  assert.equal(omittedMode.passed, false);
});

test('unknown labels and private detail fields are discarded from evidence', () => {
  const unsafe = sanitizeRealEvidence({
    ...passingInput(),
    stages: [
      ...REAL_STAGE_LABELS.slice(0, -1).map((label) => ({ label, status: 'passed', passed: true })),
      { label: 'access-token-secret-and-password', status: 'passed', passed: true, error: 'private response body' },
    ],
  });
  assert.equal(unsafe.passed, false);
  assert.equal(unsafe.stages.at(-1).label, '[redacted]');
  assert.equal(JSON.stringify(unsafe).includes('access-token-secret-and-password'), false);
  assert.equal(JSON.stringify(unsafe).includes('private response body'), false);
});

test('loopback guards reject hosted URLs, localhost aliases, and wrong database ports', () => {
  assert.equal(isExactLoopbackOrigin('http://127.0.0.1:54321'), true);
  assert.equal(isExactLoopbackOrigin('http://127.0.0.1:4173', 4173), true);
  assert.equal(isExactLoopbackOrigin('http://localhost:54321'), false);
  assert.equal(isExactLoopbackOrigin('https://127.0.0.1:54321'), false);
  assert.equal(isExactLoopbackOrigin('http://127.0.0.1:54320'), false);
  assert.equal(isExactLoopbackOrigin('http://127.0.0.1:54321/health'), false);
  assert.equal(isExactLoopbackOrigin('http://127.0.0.1:54321/?token=secret'), false);
  assert.equal(isExactLoopbackOrigin('http://user:pass@127.0.0.1:54321'), false);
  assert.equal(isExactLoopbackOrigin('https://dashboard-phantoms.vercel.app'), false);
  assert.equal(isExactLoopbackDb('postgresql://127.0.0.1:54322/postgres', 54322), true);
  assert.equal(isExactLoopbackDb('postgresql://127.0.0.1:54323/postgres', 54322), false);
  assert.equal(isExactLoopbackDb('postgresql://db.example:54322/postgres', 54322), false);
});

test('preflight rejects env-local, linked project refs, forbidden credentials, and hosted URLs', () => {
  assert.match(String(validatePreflightConfig({ envLocalExists: true })), /env/);
  assert.match(String(validatePreflightConfig({ projectRefExists: true })), /linked/);
  assert.match(String(validatePreflightConfig({ runtimeSourceMatches: false })), /source/);
  assert.match(String(validatePreflightConfig({ env: { SUPABASE_ACCESS_TOKEN: 'present' } })), /credential/);
  assert.match(String(validatePreflightConfig({ env: { SUPABASE_DB_PASSWORD: 'present' } })), /credential/);
  assert.match(String(validatePreflightConfig({ env: { SUPABASE_URL: 'https://hosted.example' } })), /nonlocal/);
  assert.match(String(validatePreflightConfig({ apiOrigin: 'https://hosted.example' })), /loopback/);
  assert.match(String(validatePreflightConfig({ previewOrigin: 'http://127.0.0.1:4173/path' })), /loopback/);
  assert.equal(validatePreflightConfig({ env: {}, apiOrigin: 'http://127.0.0.1:54321', previewOrigin: 'http://127.0.0.1:4173' }), null);
});

test('incomplete evidence starts false and never silently skips the required suite', () => {
  const initial = sanitizeRealEvidence({
    schema: REAL_EVIDENCE_CONTRACT.schema,
    mode: 'real-http',
    test: REAL_TEST_TITLE,
    realServices: true,
    stages: REAL_STAGE_LABELS.map((label) => ({ label, status: 'not-started', passed: false })),
    cleanupStatus: 'not-started',
  });
  assert.equal(initial.passed, false);
  assert.equal(initial.counts.notStarted, REAL_STAGE_LABELS.length);
  assert.equal(isCompleteRealEvidence(initial), false);
});

test('unbound join invitations are cleanup-owned before issue and orphan rows are discovered by exact actor/note', () => {
  const issueStart = REAL_RUNNER_SOURCE.indexOf('async function issue(');
  const lifecycleStart = REAL_RUNNER_SOURCE.indexOf('async function selfServiceJoinLifecycle(');
  const cleanupStart = REAL_RUNNER_SOURCE.indexOf('async function cleanup()');
  assert.ok(issueStart >= 0 && lifecycleStart > issueStart && cleanupStart > lifecycleStart);
  const issueSource = REAL_RUNNER_SOURCE.slice(issueStart, REAL_RUNNER_SOURCE.indexOf('\nasync function signIn(', issueStart));
  const joinOwnership = issueSource.indexOf('fixture.joinIssueNotes.add(note)');
  const requestWrite = issueSource.indexOf('await adminAction(body, accessToken)');
  assert.ok(joinOwnership >= 0 && requestWrite > joinOwnership, 'register the exact join marker before the write can commit');
  const lifecycleSource = REAL_RUNNER_SOURCE.slice(lifecycleStart, REAL_RUNNER_SOURCE.indexOf('\nasync function existingPasswordless(', lifecycleStart));
  const emailPreflight = lifecycleSource.indexOf('const existingAuth = await countUsersByEmail(ctx.admin, email)');
  const issueWrite = lifecycleSource.indexOf("issue(adminSession.data.session.access_token, null, null, 'join'");
  assert.ok(emailPreflight >= 0 && issueWrite > emailPreflight, 'preflight member-submitted email before issuing the unbound link');
  const cleanupSource = REAL_RUNNER_SOURCE.slice(cleanupStart, REAL_RUNNER_SOURCE.indexOf('\nasync function run()', cleanupStart));
  assert.match(issueSource, /fixture\.invitationNotes\.add\(note\)/);
  assert.match(cleanupSource, /select\('id,created_by,member_id,purpose,note,expected_auth_user_id,auth_user_id,auth_write_user_id'\)/);
  assert.match(cleanupSource, /eq\('created_by', actorId\)\.in\('note', notes\)/);
  assert.doesNotMatch(cleanupSource, /listUsers|listOwnedAuthUsers|\.in\('email',|\.eq\('email',/);
  assert.match(cleanupSource, /deleteAndVerifyExactAuthUser\(service\.auth\.admin, id\)/);
  assert.match(cleanupSource, /assertExactAuthUserAbsent\(service\.auth\.admin, id\)/);
  assert.match(cleanupSource, /\.in\('id', \[\.\.\.new Set\(fixture\.invitationIds\)\]\)/);
  const auditDelete = cleanupSource.indexOf("member_password_audit').delete().in('invitation_id'");
  const invitationDelete = cleanupSource.indexOf("member_password_invitations').delete().in('id'");
  assert.ok(auditDelete >= 0 && invitationDelete > auditDelete, 'delete exact-owned audit rows before invitations');
  assert.match(cleanupSource, /exact owned invitation markers remain/);
  assert.match(cleanupSource, /exact owned invitations remain/);
  assert.match(cleanupSource, /owned invitation audit rows remain/);
});

test('mocked bounded Auth listing counts matching identities across pages', async () => {
  const calls = [];
  const admin = { listUsers: async ({ page, perPage }) => {
    calls.push({ page, perPage });
    return { error: null, data: { users: page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: `page1-${index}`, email: index === 0 ? 'same@example.invalid' : `other-${index}@example.invalid` }))
      : [{ id: 'page2-match', email: 'SAME@example.invalid' }] } };
  } };
  assert.equal((await countUsersByEmail(admin, 'same@example.invalid')).length, 2);
  assert.deepEqual(calls, [{ page: 1, perPage: 100 }, { page: 2, perPage: 100 }]);
});

test('mocked Auth listing refuses a partial count after the strict page ceiling', async () => {
  let calls = 0;
  const admin = { listUsers: async () => {
    calls += 1;
    return { error: null, data: { users: Array.from({ length: 100 }, () => ({ email: 'other@example.invalid' })) } };
  } };
  await assert.rejects(countUsersByEmail(admin, 'same@example.invalid'), /bounded Auth listing exceeded/);
  assert.equal(calls, 20);
});
