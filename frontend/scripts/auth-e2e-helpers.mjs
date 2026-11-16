import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SAFE_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const SAFE_CLEANUP_STATUSES = new Set(['passed', 'failed', 'not-started']);

export const AUTH_TEST_TITLE = 'real numeric OTP, isolated member/admin sessions, rejection, retry, invite, and recovery';
export const AUTH_STAGE_TITLES = Object.freeze([
  'admin login',
  'same-account member OTP and scoped member logout',
  'real invalid eight-digit OTP and retry',
  'expired OTP and resend retry',
  'first-time member OTP',
  'non-member rejection and local cleanup',
  'delivered invite action link and local admin session',
  'delivered recovery action link and local admin session',
]);
export const AUTH_ALLOWED_LABELS = Object.freeze([AUTH_TEST_TITLE, ...AUTH_STAGE_TITLES]);

export function sanitizeAuthLabel(value) {
  return typeof value === 'string' && AUTH_ALLOWED_LABELS.includes(value) ? value : '[redacted]';
}

export function isExactLoopbackHttpOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isExactLoopbackPostgresUrl(value, selectedPort) {
  try {
    const parsed = new URL(value);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && parsed.hostname === '127.0.0.1'
      && parsed.port === String(selectedPort);
  } catch {
    return false;
  }
}

export function scopedMailpitDeleteOptions(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0
    || messageIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new Error('Mail cleanup requires nonempty exact message IDs.');
  }
  return {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IDs: [...new Set(messageIds)] }),
  };
}

export function differentOtp(code) {
  if (!/^\d{8}$/.test(code)) throw new Error('OTP must be an eight-digit string.');
  const next = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
  return next === code ? '00000000' : next;
}

function safeStatus(value) {
  return SAFE_STATUSES.has(value) ? value : 'interrupted';
}

function safeStep(step) {
  return { name: sanitizeAuthLabel(step?.name), status: safeStatus(step?.status), passed: step?.status === 'passed' };
}

export function sanitizeAuthEvidence(raw, cleanupStatus = 'not-started') {
  const tests = Array.isArray(raw?.tests)
    ? raw.tests.map((test) => ({ name: sanitizeAuthLabel(test?.name), status: safeStatus(test?.status), passed: test?.status === 'passed' }))
    : [];
  const steps = Array.isArray(raw?.steps) ? raw.steps.map(safeStep) : [];
  const statusCounts = {};
  for (const test of tests) statusCounts[test.status] = (statusCounts[test.status] ?? 0) + 1;
  const metadata = Array.isArray(raw?.metadata)
    ? raw.metadata.flatMap((item) => {
      const name = item?.name;
      if (!['noVerifyBeforeCode', 'noEmailRedirectTo', 'memberLogoutScoped', 'nonmemberLogoutScoped'].includes(name)) return [];
      return [{ name, passed: item?.passed === true }];
    })
    : [];
  const passed = tests.length > 0 && tests.every((test) => test.passed) && steps.every((step) => step.passed);
  return {
    schema: 'phantoms-auth-disposable-evidence/v1',
    passed,
    tests,
    steps,
    statusCounts,
    metadata,
    cleanupStatus: SAFE_CLEANUP_STATUSES.has(cleanupStatus) ? cleanupStatus : 'failed',
  };
}

export function writeSanitizedAuthEvidence(filePath, raw, cleanupStatus = 'not-started') {
  const evidence = sanitizeAuthEvidence(raw, cleanupStatus);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return evidence;
}

export function finalizeAuthEvidence(filePath, cleanupStatus = 'not-started') {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    // Produce a safe empty record if Playwright did not reach its reporter finalizer.
  }
  return writeSanitizedAuthEvidence(filePath, raw, cleanupStatus);
}

export async function closeHttpServer(server, label, timeoutMs = 5_000) {
  if (!server || !server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish(new Error(`${label} did not close within the bounded shutdown period.`));
    }, timeoutMs);
    try {
      server.close(finish);
    } catch (error) {
      finish(error);
    }
  });
}
