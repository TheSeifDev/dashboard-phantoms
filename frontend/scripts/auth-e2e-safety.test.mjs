import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { isExactLoopbackHttpOrigin, isExactLoopbackPostgresUrl, differentOtp, sanitizeAuthEvidence, closeHttpServer } from './auth-e2e-helpers.mjs';

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

test('differentOtp always returns a different valid eight-digit value without exposing input', () => {
  for (const code of ['00000000', '12345678', '99999999']) {
    const next = differentOtp(code);
    assert.match(next, /^\d{8}$/);
    assert.notEqual(next, code);
  }
  assert.throws(() => differentOtp('000000'));
});

test('auth evidence sanitizer retains only booleans, names, statuses, and cleanup state', () => {
  const evidence = sanitizeAuthEvidence({
    tests: [{ name: 'safe test', status: 'passed', error: 'password=do-not-retain' }],
    steps: [{ name: 'safe step?token=do-not-retain', status: 'passed', stack: 'secret' }],
    metadata: [
      { name: 'noVerifyBeforeCode', passed: true },
      { name: 'unexpected', passed: true },
    ],
  }, 'passed');
  assert.deepEqual(evidence, {
    schema: 'phantoms-auth-disposable-evidence/v1',
    passed: true,
    tests: [{ name: 'safe test', status: 'passed', passed: true }],
    steps: [{ name: '[redacted]', status: 'passed', passed: true }],
    statusCounts: { passed: 1 },
    metadata: [{ name: 'noVerifyBeforeCode', passed: true }],
    cleanupStatus: 'passed',
  });
  assert.equal(JSON.stringify(evidence).includes('password'), false);
  assert.equal(JSON.stringify(evidence).includes('secret'), false);
});

test('HTTP bridge shutdown closes real connections within the bounded path', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  assert.equal(server.listening, true);
  await closeHttpServer(server, 'test bridge', 1_000);
  assert.equal(server.listening, false);
});
