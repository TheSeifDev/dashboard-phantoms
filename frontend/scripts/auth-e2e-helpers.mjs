import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SAFE_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const SAFE_CLEANUP_STATUSES = new Set(['passed', 'failed', 'not-started']);
const AUTH_EVIDENCE_SCHEMA = 'phantoms-auth-disposable-evidence/v2';

export const AUTH_TEST_TITLE = 'real member password migration, isolated sessions, invitations, and recovery';
export const AUTH_STAGE_TITLES = Object.freeze([
  'admin login',
  'existing member password enrollment and scoped member logout',
  'wrong password retry',
  'existing passwordless identity preserves UID without duplicate',
  'new member enrollment and no auto-login',
  'new self-service join waits for Admin review and never opens the portal',
  'non-member password rejection and local cleanup',
  'public signup disabled',
  'reset invitation exact ID and one-use',
  'invalid invitation email and token states',
  'delivered invite action link and local admin session',
  'delivered recovery action link and local admin session',
]);
export const AUTH_REQUIRED_METADATA = Object.freeze([
  'noMemberOtpCalls',
  'noBrowserSignup',
  'memberLogoutScoped',
  'nonmemberLogoutScoped',
]);
export const AUTH_EVIDENCE_CONTRACT = Object.freeze({
  schema: AUTH_EVIDENCE_SCHEMA,
  overallTest: AUTH_TEST_TITLE,
  stages: AUTH_STAGE_TITLES,
  requiredMetadata: AUTH_REQUIRED_METADATA,
  cleanupStatus: 'passed',
});
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

/** Historical OTP-only utility retained for old unit/security coverage; no active password E2E path calls it. */
export function differentOtp(code) {
  if (!/^\d{8}$/.test(code)) throw new Error('OTP must be an eight-digit string.');
  const next = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
  return next === code ? '00000000' : next;
}

function safeStatus(value) {
  return SAFE_STATUSES.has(value) ? value : 'interrupted';
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function safeStep(step) {
  return { name: sanitizeAuthLabel(step?.name), status: safeStatus(step?.status), passed: step?.status === 'passed' };
}

export function isCompleteAuthEvidence(evidence) {
  if (!exactKeys(evidence, ['schema', 'passed', 'tests', 'steps', 'statusCounts', 'metadata', 'cleanupStatus'])
    || evidence.schema !== AUTH_EVIDENCE_SCHEMA || evidence.passed !== true
    || evidence.cleanupStatus !== AUTH_EVIDENCE_CONTRACT.cleanupStatus) return false;
  if (!Array.isArray(evidence.tests) || evidence.tests.length === 0) return false;
  if (evidence.tests.some((test) => !exactKeys(test, ['name', 'status', 'passed']) || !AUTH_ALLOWED_LABELS.includes(test.name)
    || test.status !== 'passed' || test.passed !== true)) return false;
  if (!evidence.tests.some((test) => test.name === AUTH_TEST_TITLE)) return false;

  if (!Array.isArray(evidence.steps) || evidence.steps.length !== AUTH_STAGE_TITLES.length) return false;
  const stages = new Set();
  for (const step of evidence.steps) {
    if (!exactKeys(step, ['name', 'status', 'passed']) || !AUTH_STAGE_TITLES.includes(step.name) || stages.has(step.name)
      || step.status !== 'passed' || step.passed !== true) return false;
    stages.add(step.name);
  }
  if (stages.size !== AUTH_STAGE_TITLES.length) return false;

  if (!Array.isArray(evidence.metadata) || evidence.metadata.length !== AUTH_REQUIRED_METADATA.length) return false;
  const metadata = new Set();
  for (const item of evidence.metadata) {
    if (!exactKeys(item, ['name', 'passed']) || !AUTH_REQUIRED_METADATA.includes(item.name) || metadata.has(item.name)
      || item.passed !== true) return false;
    metadata.add(item.name);
  }
  if (!exactKeys(evidence.statusCounts, ['passed'])) return false;
  const counts = Object.entries(evidence.statusCounts);
  return metadata.size === AUTH_REQUIRED_METADATA.length && counts.length === 1
    && counts[0][0] === 'passed' && counts[0][1] === evidence.tests.length;
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
      if (!AUTH_REQUIRED_METADATA.includes(name)) return [];
      return [{ name, passed: item?.passed === true }];
    })
    : [];
  const evidence = {
    schema: AUTH_EVIDENCE_SCHEMA,
    passed: true,
    tests,
    steps,
    statusCounts,
    metadata,
    cleanupStatus: SAFE_CLEANUP_STATUSES.has(cleanupStatus) ? cleanupStatus : 'failed',
  };
  return { ...evidence, passed: isCompleteAuthEvidence(evidence) };
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
