import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AuthSafeReporter from './auth-safe-reporter.mjs';
import {
  AUTH_ALLOWED_LABELS,
  AUTH_STAGE_TITLES,
  AUTH_TEST_TITLE,
  closeHttpServer,
  differentOtp,
  finalizeAuthEvidence,
  isExactLoopbackHttpOrigin,
  isExactLoopbackPostgresUrl,
  sanitizeAuthEvidence,
  sanitizeAuthLabel,
  scopedMailpitDeleteOptions,
  writeSanitizedAuthEvidence,
} from './auth-e2e-helpers.mjs';

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

test('differentOtp always returns a different valid eight-digit value without exposing input', () => {
  for (const code of ['00000000', '12345678', '99999999']) {
    const next = differentOtp(code);
    assert.match(next, /^\d{8}$/);
    assert.notEqual(next, code);
  }
  assert.throws(() => differentOtp('000000'));
});

test('auth labels use the exact shared whitelist and redact arbitrary values', () => {
  assert.deepEqual(AUTH_ALLOWED_LABELS, [AUTH_TEST_TITLE, ...AUTH_STAGE_TITLES]);
  assert.equal(sanitizeAuthLabel(AUTH_TEST_TITLE), AUTH_TEST_TITLE);
  for (const stageTitle of AUTH_STAGE_TITLES) assert.equal(sanitizeAuthLabel(stageTitle), stageTitle);
  for (const arbitraryLabel of ['12345678', 'not-a-real-password', 'https://example.invalid/form', 'session-marker']) {
    assert.equal(sanitizeAuthLabel(arbitraryLabel), '[redacted]');
  }
});

test('auth evidence sanitizer retains only whitelisted labels, booleans, statuses, and cleanup state', () => {
  const evidence = sanitizeAuthEvidence({
    tests: [{ name: AUTH_TEST_TITLE, status: 'passed', error: 'ignored' }],
    steps: [
      { name: AUTH_STAGE_TITLES[0], status: 'passed', stack: 'ignored' },
      { name: '12345678', status: 'passed' },
      { name: 'not-a-real-password', status: 'passed' },
      { name: 'https://example.invalid/form', status: 'passed' },
      { name: 'session-marker', status: 'passed' },
    ],
    metadata: [
      { name: 'noVerifyBeforeCode', passed: true },
      { name: 'unexpected', passed: true },
    ],
  }, 'passed');
  assert.deepEqual(evidence, {
    schema: 'phantoms-auth-disposable-evidence/v1',
    passed: true,
    tests: [{ name: AUTH_TEST_TITLE, status: 'passed', passed: true }],
    steps: [
      { name: AUTH_STAGE_TITLES[0], status: 'passed', passed: true },
      { name: '[redacted]', status: 'passed', passed: true },
      { name: '[redacted]', status: 'passed', passed: true },
      { name: '[redacted]', status: 'passed', passed: true },
      { name: '[redacted]', status: 'passed', passed: true },
    ],
    statusCounts: { passed: 1 },
    metadata: [{ name: 'noVerifyBeforeCode', passed: true }],
    cleanupStatus: 'passed',
  });
  assert.equal(JSON.stringify(evidence).includes('not-a-real-password'), false);
  assert.equal(JSON.stringify(evidence).includes('example.invalid'), false);
  assert.equal(JSON.stringify(evidence).includes('session-marker'), false);
});

test('reporter stores all eight top-level custom stages and ignores retried API/assertion children', () => {
  const reporter = new AuthSafeReporter({ outputFile: '/tmp/auth-safe-reporter-unused.json' });
  reporter.onTestEnd(
    { title: AUTH_TEST_TITLE, annotations: [] },
    {
      status: 'passed',
      steps: [
        ...AUTH_STAGE_TITLES.map((title) => ({
          category: 'test.step',
          title,
          steps: [
            { category: 'expect', title: '12345678', error: {} },
            { category: 'pw:api', title: 'not-a-real-password', error: {} },
          ],
        })),
        { category: 'pw:api', title: 'https://example.invalid/form', error: {} },
        { category: 'expect', title: 'session-marker', error: {} },
      ],
    },
  );
  const evidence = sanitizeAuthEvidence({ tests: reporter.tests, steps: reporter.steps });
  assert.equal(evidence.passed, true);
  assert.deepEqual(reporter.steps, AUTH_STAGE_TITLES.map((name) => ({ name, status: 'passed' })));
  assert.equal(JSON.stringify(reporter.steps).includes('12345678'), false);
  assert.equal(JSON.stringify(reporter.steps).includes('not-a-real-password'), false);
});

test('reporter marks a failed top-level stage and preserves the overall failed test status', () => {
  const reporter = new AuthSafeReporter({ outputFile: '/tmp/auth-safe-reporter-unused.json' });
  reporter.onTestEnd(
    { title: AUTH_TEST_TITLE, annotations: [] },
    {
      status: 'failed',
      steps: [{ category: 'test.step', title: AUTH_STAGE_TITLES[2], error: {} }],
    },
  );
  const evidence = sanitizeAuthEvidence({ tests: reporter.tests, steps: reporter.steps });
  assert.equal(evidence.passed, false);
  assert.deepEqual(evidence.tests, [{ name: AUTH_TEST_TITLE, status: 'failed', passed: false }]);
  assert.deepEqual(evidence.steps, [{ name: AUTH_STAGE_TITLES[2], status: 'failed', passed: false }]);
});

test('finalizeAuthEvidence preserves final passed results after re-sanitizing', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-evidence-safety-'));
  const filePath = path.join(directory, 'evidence.json');
  try {
    writeSanitizedAuthEvidence(filePath, {
      tests: [{ name: AUTH_TEST_TITLE, status: 'passed' }],
      steps: [{ name: AUTH_STAGE_TITLES[7], status: 'passed' }],
    }, 'passed');
    const finalized = finalizeAuthEvidence(filePath, 'passed');
    assert.equal(finalized.passed, true);
    assert.equal(finalized.cleanupStatus, 'passed');
    assert.deepEqual(finalized.tests, [{ name: AUTH_TEST_TITLE, status: 'passed', passed: true }]);
    assert.deepEqual(finalized.steps, [{ name: AUTH_STAGE_TITLES[7], status: 'passed', passed: true }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP bridge shutdown closes real connections within the bounded path', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  assert.equal(server.listening, true);
  await closeHttpServer(server, 'test bridge', 1_000);
  assert.equal(server.listening, false);
});
