import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AuthSafeReporter from './auth-safe-reporter.mjs';
import {
  AUTH_ALLOWED_LABELS,
  AUTH_EVIDENCE_CONTRACT,
  AUTH_REQUIRED_METADATA,
  AUTH_STAGE_TITLES,
  AUTH_TEST_TITLE,
  closeHttpServer,
  differentOtp,
  finalizeAuthEvidence,
  isCompleteAuthEvidence,
  isExactLoopbackHttpOrigin,
  isExactLoopbackPostgresUrl,
  sanitizeAuthEvidence,
  sanitizeAuthLabel,
  scopedMailpitDeleteOptions,
  writeSanitizedAuthEvidence,
} from './auth-e2e-helpers.mjs';

function completeEvidenceInput(overrides = {}) {
  return {
    tests: [{ name: AUTH_TEST_TITLE, status: 'passed' }],
    steps: AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed' })),
    metadata: AUTH_REQUIRED_METADATA.map((name) => ({ name, passed: true })),
    ...overrides,
  };
}

function authSafetyAnnotation() {
  return {
    type: 'auth-safety',
    description: JSON.stringify(Object.fromEntries(AUTH_REQUIRED_METADATA.map((name) => [name, true]))),
  };
}

test('loopback guard accepts only exact local HTTP origins', () => {
  assert.equal(isExactLoopbackHttpOrigin('http://127.0.0.1:54321'), true);
  assert.equal(isExactLoopbackHttpOrigin('https://127.0.0.1:54321'), false);
  assert.equal(isExactLoopbackHttpOrigin('http://localhost:54321'), false);
  assert.equal(isExactLoopbackHttpOrigin('http://127.0.0.1:54321/?token=secret'), true);
  assert.equal(isExactLoopbackHttpOrigin('http://127.0.0.1.evil.example:54321'), false);
});

test('database preflight accepts both CLI Postgres schemes without weakening loopback or port checks', () => {
  assert.equal(isExactLoopbackPostgresUrl('postgres://127.0.0.1:54322/postgres', 54322), true);
  assert.equal(isExactLoopbackPostgresUrl('postgresql://127.0.0.1:54322/postgres', 54322), true);
  assert.equal(isExactLoopbackPostgresUrl('postgresql://127.0.0.1:54323/postgres', 54322), false);
  assert.equal(isExactLoopbackPostgresUrl('postgresql://db.example:54322/postgres', 54322), false);
  assert.equal(isExactLoopbackPostgresUrl('https://127.0.0.1:54322/postgres', 54322), false);
});

test('Mailpit deletion always supplies nonempty exact IDs and rejects mailbox-wide requests', () => {
  const request = scopedMailpitDeleteOptions(['local-message-1', 'local-message-1']);
  assert.equal(request.method, 'DELETE');
  assert.deepEqual(JSON.parse(request.body), { IDs: ['local-message-1'] });
  assert.throws(() => scopedMailpitDeleteOptions([]));
  assert.throws(() => scopedMailpitDeleteOptions(['']));
  assert.throws(() => scopedMailpitDeleteOptions([null]));
});

test('historical OTP utility remains safe but is not an active password migration stage', () => {
  for (const code of ['00000000', '12345678', '99999999']) {
    const next = differentOtp(code);
    assert.match(next, /^\d{8}$/);
    assert.notEqual(next, code);
  }
  assert.throws(() => differentOtp('000000'));
  assert.equal(AUTH_STAGE_TITLES.some((stage) => /OTP|resend|numeric/i.test(stage)), false);
});

test('auth labels use the exact v2 whitelist and redact arbitrary secrets', () => {
  assert.deepEqual(AUTH_ALLOWED_LABELS, [AUTH_TEST_TITLE, ...AUTH_STAGE_TITLES]);
  for (const stageTitle of AUTH_STAGE_TITLES) assert.equal(sanitizeAuthLabel(stageTitle), stageTitle);
  for (const arbitraryLabel of ['12345678', 'not-a-real-password', 'phpw_' + 'a'.repeat(64), 'https://example.invalid/form', 'session-marker']) {
    assert.equal(sanitizeAuthLabel(arbitraryLabel), '[redacted]');
  }
});

test('auth evidence sanitizer retains only whitelisted labels, booleans, statuses, and cleanup state', () => {
  const evidence = sanitizeAuthEvidence(completeEvidenceInput(), 'passed');
  assert.deepEqual(evidence, {
    schema: 'phantoms-auth-disposable-evidence/v2',
    passed: true,
    tests: [{ name: AUTH_TEST_TITLE, status: 'passed', passed: true }],
    steps: AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed', passed: true })),
    statusCounts: { passed: 1 },
    metadata: AUTH_REQUIRED_METADATA.map((name) => ({ name, passed: true })),
    cleanupStatus: 'passed',
  });

  const redacted = sanitizeAuthEvidence({
    tests: [{ name: AUTH_TEST_TITLE, status: 'passed', error: 'not-a-real-password' }],
    steps: [
      { name: '12345678', status: 'passed', stack: 'session-marker' },
      { name: 'not-a-real-password', status: 'passed' },
      { name: 'https://example.invalid/form', status: 'passed' },
      { name: 'phpw_' + 'a'.repeat(64), status: 'passed' },
    ],
    metadata: [{ name: 'unexpected', passed: true }],
  }, 'passed');
  assert.deepEqual(redacted.steps, [
    { name: '[redacted]', status: 'passed', passed: true },
    { name: '[redacted]', status: 'passed', passed: true },
    { name: '[redacted]', status: 'passed', passed: true },
    { name: '[redacted]', status: 'passed', passed: true },
  ]);
  assert.equal(redacted.passed, false);
  for (const secret of ['not-a-real-password', 'example.invalid', 'session-marker', 'phpw_']) {
    assert.equal(JSON.stringify(redacted).includes(secret), false);
  }
});

test('complete evidence contract is explicit and accepts only the full passing artifact', () => {
  assert.equal(AUTH_EVIDENCE_CONTRACT.schema, 'phantoms-auth-disposable-evidence/v2');
  assert.equal(AUTH_EVIDENCE_CONTRACT.overallTest, AUTH_TEST_TITLE);
  assert.deepEqual(AUTH_EVIDENCE_CONTRACT.stages, AUTH_STAGE_TITLES);
  assert.deepEqual(AUTH_EVIDENCE_CONTRACT.requiredMetadata, AUTH_REQUIRED_METADATA);
  const evidence = sanitizeAuthEvidence(completeEvidenceInput(), 'passed');
  assert.equal(isCompleteAuthEvidence(evidence), true);
  assert.equal(evidence.passed, true);
});

test('complete evidence contract rejects failed cleanup', () => {
  const evidence = sanitizeAuthEvidence(completeEvidenceInput(), 'failed');
  assert.equal(evidence.cleanupStatus, 'failed');
  assert.equal(evidence.passed, false);
  assert.equal(isCompleteAuthEvidence(evidence), false);
});

test('complete evidence contract rejects incomplete or duplicate stages', () => {
  const incomplete = sanitizeAuthEvidence(completeEvidenceInput({ steps: AUTH_STAGE_TITLES.slice(0, -1).map((name) => ({ name, status: 'passed' })) }), 'passed');
  assert.equal(incomplete.passed, false);
  const duplicate = sanitizeAuthEvidence(completeEvidenceInput({
    steps: [...AUTH_STAGE_TITLES.slice(0, -1), { name: AUTH_STAGE_TITLES[0], status: 'passed' }],
  }), 'passed');
  assert.equal(duplicate.passed, false);
});

test('complete evidence contract rejects missing, unknown, or false safety metadata', () => {
  const missing = sanitizeAuthEvidence(completeEvidenceInput({ metadata: AUTH_REQUIRED_METADATA.slice(0, -1).map((name) => ({ name, passed: true })) }), 'passed');
  assert.equal(missing.metadata.length, AUTH_REQUIRED_METADATA.length - 1);
  assert.equal(missing.passed, false);
  const unknown = sanitizeAuthEvidence(completeEvidenceInput({ metadata: [{ name: 'unknown', passed: true }] }), 'passed');
  assert.equal(unknown.metadata.length, 0);
  assert.equal(unknown.passed, false);
  const falseMetadata = AUTH_REQUIRED_METADATA.map((name) => ({ name, passed: true }));
  falseMetadata[0].passed = false;
  const failed = sanitizeAuthEvidence(completeEvidenceInput({ metadata: falseMetadata }), 'passed');
  assert.equal(failed.passed, false);
});

test('complete evidence contract rejects failed tests, invalid schema, and contradictory counts', () => {
  const failedTest = sanitizeAuthEvidence(completeEvidenceInput({ tests: [{ name: AUTH_TEST_TITLE, status: 'failed' }] }), 'passed');
  assert.equal(failedTest.passed, false);
  const valid = sanitizeAuthEvidence(completeEvidenceInput(), 'passed');
  assert.equal(isCompleteAuthEvidence({ ...valid, schema: 'unexpected-schema' }), false);
  assert.equal(isCompleteAuthEvidence({ ...valid, screenshotPath: '/tmp/private.png' }), false);
  assert.equal(isCompleteAuthEvidence({ ...valid, tests: [{ ...valid.tests[0], email: 'private@example.invalid' }, ...valid.tests.slice(1)] }), false);
  assert.equal(isCompleteAuthEvidence({ ...valid, steps: [{ ...valid.steps[0], title: 'raw step detail' }, ...valid.steps.slice(1)] }), false);
  assert.equal(isCompleteAuthEvidence({ ...valid, metadata: [{ ...valid.metadata[0], secret: true }, ...valid.metadata.slice(1)] }), false);
  for (const statusCounts of [{}, [], { passed: 2 }, { passed: 1, failed: 1 }]) {
    assert.equal(isCompleteAuthEvidence({ ...valid, statusCounts }), false);
  }
});

test('reporter stores all password stages and ignores retried API/assertion children', () => {
  const reporter = new AuthSafeReporter({ outputFile: '/tmp/auth-safe-reporter-unused.json' });
  reporter.onTestEnd(
    { title: AUTH_TEST_TITLE, annotations: [authSafetyAnnotation()] },
    {
      status: 'passed',
      steps: [
        ...AUTH_STAGE_TITLES.map((title) => ({
          category: 'test.step',
          title,
          steps: [
            { category: 'expect', title: 'not-a-real-password', error: {} },
            { category: 'pw:api', title: 'phpw_' + 'b'.repeat(64), error: {} },
          ],
        })),
        { category: 'pw:api', title: 'https://example.invalid/form', error: {} },
      ],
    },
  );
  const evidence = sanitizeAuthEvidence({ tests: reporter.tests, steps: reporter.steps, metadata: reporter.metadata }, 'passed');
  assert.equal(evidence.passed, true);
  assert.deepEqual(reporter.steps, AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed' })));
  assert.equal(JSON.stringify(reporter.steps).includes('not-a-real-password'), false);
});

test('reporter marks a failed top-level stage and preserves failed test status', () => {
  const reporter = new AuthSafeReporter({ outputFile: '/tmp/auth-safe-reporter-unused.json' });
  reporter.onTestEnd(
    { title: AUTH_TEST_TITLE, annotations: [] },
    { status: 'failed', steps: [{ category: 'test.step', title: AUTH_STAGE_TITLES[2], error: {} }] },
  );
  const evidence = sanitizeAuthEvidence({ tests: reporter.tests, steps: reporter.steps });
  assert.equal(evidence.passed, false);
  assert.deepEqual(evidence.tests, [{ name: AUTH_TEST_TITLE, status: 'failed', passed: false }]);
  assert.deepEqual(evidence.steps, [{ name: AUTH_STAGE_TITLES[2], status: 'failed', passed: false }]);
});

test('direct reporter serialization preserves intermediate state and redacts stage details', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-reporter-serialization-'));
  const filePath = path.join(directory, 'evidence.json');
  try {
    const reporter = new AuthSafeReporter({ outputFile: filePath });
    reporter.onTestEnd(
      { title: AUTH_TEST_TITLE, annotations: [authSafetyAnnotation()] },
      {
        status: 'passed',
        steps: AUTH_STAGE_TITLES.map((title) => ({
          category: 'test.step', title, error: undefined,
          steps: [{ category: 'expect', title: 'not-a-real-password', error: 'secret trace' }],
        })),
      },
    );
    reporter.onEnd();
    const serialized = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(serialized.cleanupStatus, 'not-started');
    assert.equal(serialized.passed, false);
    assert.equal(isCompleteAuthEvidence(serialized), false);
    assert.deepEqual(serialized.steps, AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed', passed: true })));
    assert.deepEqual(serialized.metadata, AUTH_REQUIRED_METADATA.map((name) => ({ name, passed: true })));
    assert.equal(JSON.stringify(serialized).includes('secret trace'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('finalizeAuthEvidence preserves final passed results after re-sanitizing', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-evidence-safety-'));
  const filePath = path.join(directory, 'evidence.json');
  try {
    writeSanitizedAuthEvidence(filePath, completeEvidenceInput(), 'passed');
    const finalized = finalizeAuthEvidence(filePath, 'passed');
    assert.equal(finalized.passed, true);
    assert.equal(finalized.cleanupStatus, 'passed');
    assert.deepEqual(finalized.steps, AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed', passed: true })));
    assert.deepEqual(finalized.metadata, AUTH_REQUIRED_METADATA.map((name) => ({ name, passed: true })));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Auth runner lists the discovered suite and rejects incomplete final evidence', () => {
  const runner = readFileSync(new URL('./run-disposable-auth-e2e.mjs', import.meta.url), 'utf8');
  assert.match(runner, /'--list', '--reporter=list'/);
  assert.match(runner, /if \(!isCompleteAuthEvidence\(finalized\)\)/);
  assert.match(runner, /prepareJoinFixtureCleanup\(service, fixture\)/);
});

test('HTTP bridge shutdown closes real connections within the bounded path', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  assert.equal(server.listening, true);
  await closeHttpServer(server, 'test bridge', 1_000);
  assert.equal(server.listening, false);
});
