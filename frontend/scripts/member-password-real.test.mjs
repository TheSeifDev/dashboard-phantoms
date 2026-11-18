#!/usr/bin/env node
/**
 * Real local Supabase/GoTrue acceptance suite for member-password-enrollment.
 *
 * This file deliberately does not start or reset Supabase. The parent runtime
 * owns the disposable stack; this runner only reads `supabase status`, serves
 * the owned Edge Function, and talks to the local HTTP services.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { localFunctionServeArgs, localRuntimeWorkdir, localStatusArgs, nativeRuntimeEnabled, synchronizeNativeTestSource } from './local-stack-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const BACKEND = path.join(ROOT, 'backend');
const API_PORT = localPort('PHANTOMS_LOCAL_API_PORT', 54321);
const DB_PORT = localPort('PHANTOMS_LOCAL_DB_PORT', 54322);
const PREVIEW_PORT = localPort('PHANTOMS_LOCAL_PREVIEW_PORT', 4173);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const FUNCTION_PATH = '/functions/v1/member-password-enrollment';
const EVIDENCE_PATH = path.join(FRONTEND, 'test-results', 'member-password-real-evidence.json');
const PROJECT_REF_FILE = path.join(BACKEND, 'supabase', '.temp', 'project-ref');
const NATIVE_WORKDIR = nativeRuntimeEnabled() ? localRuntimeWorkdir(BACKEND) : null;
const ADMIN_PERMISSION_KEYS = Object.freeze(['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant']);
const BOUNDARY_LABELS = Object.freeze(['ascii12', 'ascii72', 'ascii73', 'ascii128', 'utf8chars12', 'utf8chars72', 'utf8chars73', 'utf8chars128', 'utf8bytes72', 'utf8bytes73']);
export const REAL_BOUNDARY_OBSERVATION_LABELS = BOUNDARY_LABELS;
export const REAL_BOUNDARY_EXPECTATIONS = Object.freeze([
  ['ascii12', 12, 12, true], ['ascii72', 72, 72, true], ['ascii73', 73, 73, false], ['ascii128', 128, 128, false],
  ['utf8chars12', 12, 23, true], ['utf8chars72', 72, 143, false], ['utf8chars73', 73, 145, false], ['utf8chars128', 128, 255, false],
  ['utf8bytes72', 37, 72, true], ['utf8bytes73', 38, 73, false],
].map(([label, characters, utf8Bytes, accepted]) => Object.freeze({ label, characters, utf8Bytes, accepted })));
const ENV_LOCAL = path.join(FRONTEND, '.env.local');
const SAFE_DOMAIN = 'phantoms-real-http.example';
const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const CLEANUP_TIMEOUT_MS = 10_000;
const SAFE_STATUSES = new Set(['passed', 'failed', 'timedOut', 'interrupted', 'not-started']);
const FORBIDDEN_ENV_NAMES = [
  'SUPABASE_ACCESS_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET',
  'SUPABASE_JWT_SECRET', 'ANON_KEY', 'POSTGRES_URL', 'DIRECT_URL', 'SB_SECRET_KEY',
  'SB_ACCESS_TOKEN', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'SUPABASE_DB_PASSWORD',
];
const REQUIRED_OBSERVATIONS = Object.freeze(['oldPasswordRejected', 'newPasswordAccepted', 'unrelatedAdminSessionPreserved']);
const EVIDENCE_FIELDS = new Set(['schema', 'mode', 'test', 'realServices', 'passed', 'pg17', 'stages', 'counts', 'cleanupStatus', 'aborted', 'observations', 'boundaryObservations']);
const COUNT_FIELDS = new Set(['stages', 'passed', 'failed', 'notStarted']);
const OBSERVATION_FIELDS = new Set(['oldPasswordRejected', 'newPasswordAccepted', 'oldAccessJwtAccepted', 'oldRefreshAccepted', 'unrelatedAdminSessionPreserved']);
export const REAL_TEST_TITLE = 'real local HTTP Supabase member password acceptance';
export const REAL_STAGE_LABELS = Object.freeze([
  'local preflight and service readiness',
  'new member invitation lifecycle and portal access',
  'existing unconfirmed identity preserves UUID',
  'existing confirmed passwordless identity preserves UUID',
  'admin and unrelated Auth operations remain allowed',
  'existing password enrollment rejects and reset succeeds',
  'password boundary observations',
  'HTTP authorization and malformed-input negatives',
  'real concurrent enrollment and reset single-writer checks',
  'SQL-owned fault quarantine boundary',
]);
export const REAL_EVIDENCE_CONTRACT = Object.freeze({
  schema: 'phantoms-member-password-real-http-evidence/v1',
  test: REAL_TEST_TITLE,
  stages: REAL_STAGE_LABELS,
  mode: 'real-http',
  cleanupRequired: true,
});
const PRIVATE_VALUES = new Set();
const activeChildren = new Set();
const ownedTempDirectories = new Set();
const ownedSqlFaults = new Map();
function nativeRuntimeSelected() { return nativeRuntimeEnabled(); }
function completeAdminPermissions(overrides = {}) {
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, overrides?.[key] === true]));
}
function rememberRateKey(prefix, value) {
  if (typeof value === 'string') fixture.rateKeyHashes.add(sha256(`${prefix}${value}`));
}
function emptyBoundaryObservations() {
  return BOUNDARY_LABELS.map((label) => ({ label, characters: 0, utf8Bytes: 0, accepted: false, exactLogin: false, trimmedRejected: false, changedSuffixRejected: false }));
}
const fixture = {
  emails: new Set(),
  memberIds: [],
  joinEmails: new Set(),
  resetTokens: new Set(),
  authUserIds: [],
  adminUserIds: [],
  invitationIds: [],
  rateKeyHashes: new Set(),
  passwords: new Set(),
};
let status;
let abortRequested = false;
let edgeProcess;
let evidence;

function localPort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error('invalid local port');
  }
  return Number(value);
}

function fail(message) { throw new Error(message); }
function safeFailureLine(error) {
  const match = String(error?.stack ?? '').match(/member-password-real\.test\.mjs:(\d+):\d+/);
  return match ? Number(match[1]) : 0;
}
function safePublicCode(value) {
  return new Set(['INVALID_INPUT', 'PASSWORD_MISMATCH', 'WEAK_PASSWORD', 'INVALID_TOKEN', 'ALREADY_USED', 'WRONG_EMAIL', 'EXPIRED', 'REVOKED', 'MEMBER_DISABLED', 'IDENTITY_CONFLICT', 'REVIEW_REQUIRED', 'PASSWORD_ALREADY_SET', 'RATE_LIMITED', 'UNAUTHORIZED', 'FORBIDDEN', 'SERVER_UNAVAILABLE']).has(value) ? value : '[redacted]';
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function bounded(operation, timeout = REQUEST_TIMEOUT_MS) {
  return Promise.race([operation, new Promise((_, reject) => setTimeout(() => reject(new Error('bounded timeout')), timeout))]);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function emailFor(label, suffix) { return `real-${label}-${suffix}@${SAFE_DOMAIN}`; }
function validPassword(label = 'Member') { return `${label}LocalPassword1`; }
function sessionClient(session) {
  return createClient(status.api, status.anonKey, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function sqlIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail('invalid owned SQL identifier');
  return value;
}
function dbEnv() {
  if (!status?.db) fail('local database status unavailable');
  const parsed = new URL(status.db);
  return { ...childEnv(), PGHOST: parsed.hostname, PGPORT: parsed.port, PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres' };
}
function localSql(sql, _capture = false) {
  if (!status?.db) fail('local database status unavailable');
  try {
    return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-Atqc', sql], {
      cwd: ROOT, env: dbEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8_000,
    }).trim();
  } catch { fail('owned SQL fault operation failed'); }
}
function installOwnedTrigger({ key, trigger, functionName, table, body, timing = 'BEFORE', events = 'INSERT OR UPDATE' }) {
  sqlIdentifier(trigger); sqlIdentifier(functionName);
  ownedSqlFaults.set(key, { trigger, functionName, table });
  localSql(`CREATE OR REPLACE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fault$
BEGIN
${body}
END;
$fault$;
CREATE TRIGGER ${trigger} ${timing} ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION public.${functionName}();`);
}
function dropOwnedTrigger(key) {
  const fault = ownedSqlFaults.get(key);
  if (!fault) return;
  localSql(`DROP TRIGGER IF EXISTS ${fault.trigger} ON ${fault.table}; DROP FUNCTION IF EXISTS public.${fault.functionName}();`);
  ownedSqlFaults.delete(key);
}

export function isExactLoopbackOrigin(value, selectedPort = API_PORT) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(selectedPort)
      && !parsed.username && !parsed.password && parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  } catch { return false; }
}
export function isExactLoopbackDb(value, selectedPort = DB_PORT) {
  try {
    const parsed = new URL(value);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && parsed.hostname === '127.0.0.1' && parsed.port === String(selectedPort);
  } catch { return false; }
}
export function validatePreflightConfig(config = {}) {
  if (config.envLocalExists) return 'frontend/.env.local is forbidden';
  if (config.projectRefExists) return 'linked hosted project is forbidden';
  if (config.runtimeSourceMatches === false) return 'disposable runtime source mismatch';
  for (const name of FORBIDDEN_ENV_NAMES) if (config.env?.[name]) return 'forbidden credential environment';
  if (!isExactLoopbackOrigin(config.apiOrigin ?? API_ORIGIN, API_PORT)) return 'API must be exact loopback';
  if (!isExactLoopbackOrigin(config.previewOrigin ?? PREVIEW_ORIGIN, PREVIEW_PORT)) return 'preview must be exact loopback';
  if (config.env?.VITE_SUPABASE_URL && config.env.VITE_SUPABASE_URL !== (config.apiOrigin ?? API_ORIGIN)) return 'nonlocal VITE URL';
  if (config.env?.SUPABASE_URL && config.env.SUPABASE_URL !== (config.apiOrigin ?? API_ORIGIN)) return 'nonlocal Supabase URL';
  return null;
}

function exactEvidenceKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function evidenceSkeleton() {
  return {
    schema: REAL_EVIDENCE_CONTRACT.schema,
    mode: REAL_EVIDENCE_CONTRACT.mode,
    test: REAL_TEST_TITLE,
    realServices: true,
    passed: false,
    pg17: false,
    stages: REAL_STAGE_LABELS.map((label) => ({ label, status: 'not-started', passed: false })),
    counts: { stages: REAL_STAGE_LABELS.length, passed: 0, failed: 0, notStarted: REAL_STAGE_LABELS.length },
    cleanupStatus: 'not-started',
    aborted: false,
    observations: {
      oldPasswordRejected: false,
      newPasswordAccepted: false,
      oldAccessJwtAccepted: false,
      oldRefreshAccepted: false,
      unrelatedAdminSessionPreserved: false,
    },
    boundaryObservations: emptyBoundaryObservations(),
  };
}
export function sanitizeRealEvidence(raw = {}) {
  const allowedStages = new Map(REAL_STAGE_LABELS.map((label) => [label, true]));
  const source = Array.isArray(raw.stages) ? raw.stages : [];
  const stages = source.map((item) => {
    const label = allowedStages.has(item?.label) ? item.label : '[redacted]';
    const statusValue = SAFE_STATUSES.has(item?.status) ? item.status : 'interrupted';
    return { label, status: statusValue, passed: item?.passed === true && statusValue === 'passed' };
  });
  const counts = { stages: REAL_STAGE_LABELS.length, passed: 0, failed: 0, notStarted: 0 };
  for (const stage of stages) {
    if (stage.status === 'passed') counts.passed += 1;
    else if (stage.status === 'not-started') counts.notStarted += 1;
    else counts.failed += 1;
  }
  const cleanupStatus = ['passed', 'failed', 'not-started'].includes(raw.cleanupStatus) ? raw.cleanupStatus : 'failed';
  const observationNames = [...OBSERVATION_FIELDS];
  const observations = Object.fromEntries(observationNames.map((name) => [name, raw.observations?.[name] === true]));
  const rawCountKeys = raw.counts && typeof raw.counts === 'object' && !Array.isArray(raw.counts) ? Object.keys(raw.counts) : [];
  const countsValid = rawCountKeys.length === COUNT_FIELDS.size
    && rawCountKeys.every((key) => COUNT_FIELDS.has(key))
    && [...COUNT_FIELDS].every((key) => Number.isInteger(raw.counts[key]) && raw.counts[key] === counts[key]);
  const observationKeys = raw.observations && typeof raw.observations === 'object' && !Array.isArray(raw.observations)
    ? Object.keys(raw.observations) : [];
  const observationsValid = observationKeys.length === OBSERVATION_FIELDS.size
    && observationKeys.every((key) => OBSERVATION_FIELDS.has(key))
    && [...OBSERVATION_FIELDS].every((key) => typeof raw.observations[key] === 'boolean');
  const rawBoundaries = Array.isArray(raw.boundaryObservations) ? raw.boundaryObservations : [];
  const boundaryByLabel = new Map(rawBoundaries.map((item) => [item?.label, item]));
  const boundaryObservations = BOUNDARY_LABELS.map((label) => {
    const item = boundaryByLabel.get(label) ?? {};
    return {
      label,
      characters: Number.isInteger(item.characters) && item.characters >= 0 ? item.characters : 0,
      utf8Bytes: Number.isInteger(item.utf8Bytes) && item.utf8Bytes >= 0 ? item.utf8Bytes : 0,
      accepted: item.accepted === true,
      exactLogin: item.exactLogin === true,
      trimmedRejected: item.trimmedRejected === true,
      changedSuffixRejected: item.changedSuffixRejected === true,
    };
  });
  const boundaryKeys = rawBoundaries.map((item) => item?.label);
  const boundaryObservationsValid = rawBoundaries.length === BOUNDARY_LABELS.length
    && new Set(boundaryKeys).size === BOUNDARY_LABELS.length
    && boundaryKeys.every((label) => BOUNDARY_LABELS.includes(label))
    && boundaryObservations.every((item) => Number.isInteger(item.characters) && Number.isInteger(item.utf8Bytes)
      && typeof item.accepted === 'boolean' && typeof item.exactLogin === 'boolean'
      && typeof item.trimmedRejected === 'boolean' && typeof item.changedSuffixRejected === 'boolean'
      && (!item.accepted || (item.exactLogin && item.changedSuffixRejected)))
    && REAL_BOUNDARY_EXPECTATIONS.every((expected) => {
      const item = boundaryByLabel.get(expected.label);
      return item?.characters === expected.characters && item?.utf8Bytes === expected.utf8Bytes
        && item?.accepted === expected.accepted && (expected.label !== 'ascii72' || item.trimmedRejected === true);
    });
  const unknownFields = !exactEvidenceKeys(raw, [...EVIDENCE_FIELDS]);
  const stageShapesValid = Array.isArray(raw.stages) && raw.stages.every((item) => exactEvidenceKeys(item, ['label', 'status', 'passed']));
  const boundaryShapesValid = rawBoundaries.every((item) => exactEvidenceKeys(item, ['label', 'characters', 'utf8Bytes', 'accepted', 'exactLogin', 'trimmedRejected', 'changedSuffixRejected']));
  const complete = raw.schema === REAL_EVIDENCE_CONTRACT.schema && raw.mode === 'real-http'
    && raw.realServices === true && raw.test === REAL_TEST_TITLE && raw.passed === true
    && raw.pg17 === true && raw.aborted === false && !unknownFields && countsValid && observationsValid && boundaryObservationsValid
    && stageShapesValid && boundaryShapesValid
    && stages.length === REAL_STAGE_LABELS.length
    && new Set(stages.map((item) => item.label)).size === REAL_STAGE_LABELS.length
    && stages.every((item) => REAL_STAGE_LABELS.includes(item.label) && item.status === 'passed' && item.passed === true)
    && cleanupStatus === 'passed' && REQUIRED_OBSERVATIONS.every((name) => observations[name] === true)
    && observations.oldAccessJwtAccepted === false && observations.oldRefreshAccepted === false;
  return {
    schema: REAL_EVIDENCE_CONTRACT.schema,
    mode: REAL_EVIDENCE_CONTRACT.mode,
    test: REAL_TEST_TITLE,
    realServices: raw.realServices === true,
    passed: complete,
    pg17: raw.pg17 === true,
    stages,
    counts,
    cleanupStatus,
    aborted: raw.aborted === true,
    observations,
    boundaryObservations,
  };
}
export function isCompleteRealEvidence(value) { return sanitizeRealEvidence(value).passed === true; }
function writeEvidence() {
  // The runner never trusts its previous `passed` bit. Recompute it from the
  // complete in-memory run, while sanitizeRealEvidence still rejects a
  // tampered external artifact whose bit claims success.
  const safe = sanitizeRealEvidence({ ...evidence, passed: true });
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  // Preserve object identity: a running stage may write observations mid-step.
  // Counts/pass are derived for serialization and final validation only.
  evidence.counts = safe.counts;
  evidence.passed = safe.passed;
}

function parseStatusEnv(raw) {
  const values = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value.replaceAll('\\"', '"');
  }
  return values;
}
function readLocalStatus() {
  let raw;
  try {
    const args = localStatusArgs(BACKEND);
    raw = execFileSync('supabase', args, { cwd: ROOT, env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { fail('local Supabase status unavailable'); }
  const values = parseStatusEnv(raw);
  const api = values.API_URL || values.SUPABASE_URL || values.KONG_URL;
  const db = values.DB_URL || values.DATABASE_URL || values.POSTGRES_URL;
  const anonKey = values.ANON_KEY || values.SUPABASE_ANON_KEY || values.PUBLISHABLE_KEY || values.SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = values.SERVICE_ROLE_KEY || values.SERVICE_KEY || values.SECRET_KEY || values.SUPABASE_SERVICE_ROLE_KEY || values.SUPABASE_SECRET_KEY;
  if (api !== API_ORIGIN || !isExactLoopbackDb(db)) fail('Supabase status is not exact selected loopback');
  if (!anonKey || !serviceKey) fail('local status omitted generated keys');
  PRIVATE_VALUES.add(anonKey); PRIVATE_VALUES.add(serviceKey);
  return { api, db, anonKey, serviceKey, pg17: false, native: nativeRuntimeSelected() };
}
function childEnv() {
  const env = { ...process.env };
  for (const name of FORBIDDEN_ENV_NAMES) delete env[name];
  delete env.SUPABASE_URL; delete env.DATABASE_URL;
  return env;
}
function nativeSourceMatchesProduct() {
  if (!nativeRuntimeSelected()) return true;
  try { synchronizeNativeTestSource(BACKEND); return true; } catch { return false; }
}
async function waitForFunction() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_ORIGIN}${FUNCTION_PATH}`, { headers: { Origin: PREVIEW_ORIGIN }, signal: AbortSignal.timeout(2_000) });
      if (response.status === 405) {
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (body?.code === 'INVALID_INPUT') return;
      }
    } catch { /* bounded readiness poll */ }
    await sleep(300);
  }
  fail('member-password-enrollment readiness did not return exact 405 INVALID_INPUT');
}
function spawnEdge() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'phantoms-real-http-'));
  ownedTempDirectories.add(directory);
  const envFile = path.join(directory, 'public-origin.env');
  writeFileSync(envFile, `PHANTOMS_ALLOWED_ORIGINS=${PREVIEW_ORIGIN}\nPHANTOMS_DISPOSABLE_AUTH=1\n`, { mode: 0o600 });
  const args = localFunctionServeArgs(BACKEND, envFile);
  edgeProcess = spawn('supabase', args, { cwd: ROOT, env: { ...childEnv(), PHANTOMS_ALLOWED_ORIGINS: PREVIEW_ORIGIN, PHANTOMS_DISPOSABLE_AUTH: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
  activeChildren.add(edgeProcess);
  edgeProcess.once('exit', () => activeChildren.delete(edgeProcess));
  return edgeProcess;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 4_000);
    const timer = setTimeout(() => reject(new Error('edge shutdown timeout')), 8_000);
    child.once('exit', () => { clearTimeout(force); clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
function assertRpc(result, label) {
  if (!result || result.error) fail(`${label} failed`);
  return result.data;
}
function serviceClient() {
  return createClient(status.api, status.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
function anonClient() {
  return createClient(status.api, status.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function adminAction(body, accessToken) {
  if (body?.action === 'enroll') {
    if (typeof body.email === 'string') rememberRateKey('member-password:email:', body.email.trim().toLowerCase());
    if (typeof body.token === 'string') rememberRateKey('member-password:token:', body.token);
  }
  const headers = { 'content-type': 'application/json', Origin: PREVIEW_ORIGIN };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await bounded(fetch(`${API_ORIGIN}${FUNCTION_PATH}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (response.status !== 200) console.log(`admin action status ${response.status} code ${safePublicCode(payload.code)}`);
  return { status: response.status, payload };
}
async function enrollRequest(email, token, password, confirmPassword = password, extra = undefined, signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)) {
  if (typeof email === 'string') rememberRateKey('member-password:email:', email.trim().toLowerCase());
  if (typeof token === 'string') rememberRateKey('member-password:token:', token);
  const body = { action: 'enroll', email, token, password, confirmPassword };
  if (!fixture.resetTokens.has(token)) body.profile = {
    fullName: 'Self Service HTTP Member', phone: '+201100000001', residence: 'Alexandria',
    workConditions: 'Remote', bio: 'Owned disposable fixture', device: 'لابتوب', gender: 'ذكر',
  };
  if (extra) Object.assign(body, extra);
  const response = await bounded(fetch(`${API_ORIGIN}${FUNCTION_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', Origin: PREVIEW_ORIGIN }, body: JSON.stringify(body), signal,
  }));
  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (response.status !== 200) console.log(`enrollment status ${response.status} code ${safePublicCode(payload.code)}`);
  return { status: response.status, payload };
}
async function createUser(admin, email, password, confirmed = true) {
  const result = await bounded(admin.createUser({ email, ...(password === undefined ? {} : { password }), email_confirm: confirmed }));
  assertRpc(result, 'Auth fixture creation');
  const user = result.data.user;
  if (!user?.id) fail('Auth fixture did not return an id');
  fixture.authUserIds.push(user.id); fixture.emails.add(email); fixture.passwords.add(password ?? '');
  return user;
}

async function clearOwnedFixturePassword(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId))) fail('invalid owned passwordless fixture id');
  // GoTrue 2.197 generates a hash when Admin.createUser omits password. This
  // exact owned-fixture setup clears that fabricated hash; the subsequent
  // password write remains an actual GoTrue Admin API operation under test.
  localSql(`UPDATE auth.users SET encrypted_password = NULL WHERE id = '${userId}'::uuid`);
}
async function addAdmin(service, userId, permissions = { members: true }) {
  fixture.adminUserIds.push(userId);
  rememberRateKey('member-password:admin:', userId);
  const result = await service.from('admin_accounts').insert({ user_id: userId, role: 'admin', permissions: completeAdminPermissions(permissions) });
  assertRpc(result, 'admin fixture row');
}
async function createMember(service, email, label) {
  const result = await service.from('members').insert({
    email, full_name: `Real HTTP ${label}`, completion_rank: 1, team_notes: 'owned real HTTP fixture', residence: 'Cairo',
    work_conditions: 'remote', bio: 'owned fixture', phone: '+201000000001', device: 'fixture', gender: 'female',
    meeting_attendance: 'regular', work_status: 'active', can_go_alexandria: false, custom_fields: {},
  }).select('id,email').limit(1).single();
  assertRpc(result, 'member fixture row');
  fixture.memberIds.push(result.data.id); fixture.emails.add(email);
  return result.data;
}
async function issue(accessToken, memberId, email, purpose = 'enroll') {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (purpose === 'join') { fixture.joinEmails.add(normalizedEmail); fixture.emails.add(normalizedEmail); }
  rememberRateKey('member-password:email:', normalizedEmail);
  const body = { action: 'issue', memberId, email, purpose, expiresInHours: 24, note: 'owned real HTTP fixture' };
  const result = await adminAction(body, accessToken);
  if (result.status !== 200 || !result.payload.invite?.id || !result.payload.invite?.token) fail('invitation issue failed');
  fixture.invitationIds.push(result.payload.invite.id);
  if (purpose === 'reset') fixture.resetTokens.add(result.payload.invite.token);
  rememberRateKey('member-password:token:', result.payload.invite.token);
  return result.payload.invite;
}
async function signIn(email, password) {
  const client = anonClient();
  const result = await bounded(client.auth.signInWithPassword({ email, password }));
  return result;
}
async function selectOwned(service, table, columns, column, values) {
  let query = service.from(table).select(columns).in(column, values);
  // Completion proof must not accidentally inspect only the earlier issued row.
  // Two exact-scope completion rows are enough to detect a duplicate completion.
  if (table === 'member_password_audit') query = query.eq('action', 'completed');
  const result = await bounded(query.limit(table === 'member_password_audit' ? 2 : Math.max(values.length, 1)));
  return assertRpc(result, `owned ${table} inspection`);
}
export async function countUsersByEmail(admin, email) {
  const matches = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await bounded(admin.listUsers({ page, perPage: 100 }));
    assertRpc(result, 'Auth fixture listing');
    const users = result.data?.users ?? [];
    matches.push(...users.filter((user) => typeof user.email === 'string' && user.email.toLowerCase() === email.toLowerCase()));
    if (users.length < 100) return matches;
  }
  fail('bounded Auth listing exceeded');
}
async function seedFixtures() {
  const service = serviceClient();
  const admin = service.auth.admin;
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const names = ['admin', 'unrelated-admin', 'outsider', 'new', 'unconfirmed', 'passwordless', 'passworded', 'reset2', 'fault'];
  const email = (name) => emailFor(name, suffix);
  const passwords = Object.fromEntries(names.map((name) => [name, validPassword(name)]));
  const users = {};
  users.admin = await createUser(admin, email('admin'), passwords.admin, true);
  await addAdmin(service, users.admin.id, { members: true, dashboard: true, tasks: true });
  users.unrelatedAdmin = await createUser(admin, email('unrelated-admin'), passwords['unrelated-admin'], true);
  await addAdmin(service, users.unrelatedAdmin.id, { members: true, dashboard: true });
  users.outsider = await createUser(admin, email('outsider'), passwords.outsider, true);
  users.unconfirmed = await createUser(admin, email('unconfirmed'), undefined, false);
  await clearOwnedFixturePassword(users.unconfirmed.id);
  users.passwordless = await createUser(admin, email('passwordless'), undefined, true);
  await clearOwnedFixturePassword(users.passwordless.id);
  users.passworded = await createUser(admin, email('passworded'), passwords.passworded, true);
  users.reset2 = await createUser(admin, email('reset2'), passwords.reset2, true);
  users.fault = await createUser(admin, email('fault'), passwords.fault, true);
  const members = {};
  members.new = await createMember(service, email('new'), 'new');
  members.unconfirmed = await createMember(service, email('unconfirmed'), 'unconfirmed');
  members.passwordless = await createMember(service, email('passwordless'), 'passwordless');
  members.passworded = await createMember(service, email('passworded'), 'passworded');
  members.reset2 = await createMember(service, email('reset2'), 'reset2');
  members.fault = await createMember(service, email('fault'), 'fault');
  const bind = async (member, user, passwordReady = true) => {
    const result = await service.from('member_auth_bindings').insert({ member_id: member.id, auth_user_id: user.id, normalized_email: member.email, password_ready: passwordReady });
    assertRpc(result, 'existing binding fixture');
  };
  await bind(members.unconfirmed, users.unconfirmed, false);
  await bind(members.passwordless, users.passwordless, false);
  await bind(members.passworded, users.passworded);
  await bind(members.reset2, users.reset2);
  await bind(members.fault, users.fault);
  return { service, admin, users, members, passwords, suffix };
}

async function newMemberLifecycle(ctx) {
  const { service, members, passwords } = ctx;
  const session = await signIn(ctx.fixtureEmail, passwords.admin);
  assert.equal(session.error, null);
  const invite = await issue(session.data.session.access_token, members.new.id, members.new.email);
  const enrollment = await enrollRequest(members.new.email, invite.token, validPassword('new-member'));
  assert.equal(enrollment.status, 200);
  const created = await countUsersByEmail(ctx.admin, members.new.email);
  assert.equal(created.length, 1);
  const authUser = created[0];
  const rows = await selectOwned(service, 'member_password_invitations', 'id,status,auth_user_id,auth_write_user_id,auth_write_completed_at,completed_at', 'id', [invite.id]);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'complete'); assert.equal(rows[0].auth_user_id, authUser.id); assert.equal(rows[0].auth_write_user_id, authUser.id);
  const binding = await selectOwned(service, 'member_auth_bindings', 'member_id,auth_user_id,password_ready,normalized_email', 'member_id', [members.new.id]);
  assert.equal(binding.length, 1); assert.equal(binding[0].auth_user_id, authUser.id); assert.equal(binding[0].password_ready, true);
  const memberSession = await signIn(members.new.email, validPassword('new-member'));
  assert.equal(memberSession.error, null); assert.ok(memberSession.data.session?.access_token);
  const memberClient = createClient(status.api, status.anonKey, { global: { headers: { Authorization: `Bearer ${memberSession.data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const access = await memberClient.rpc('get_member_password_access');
  assert.equal(access.error, null); assert.equal(access.data?.member_id, members.new.id); assert.equal(access.data?.auth_user_id, authUser.id);
  const device = `real-device-${ctx.suffix}-new`;
  const bound = await memberClient.rpc('bind_member_device_session', { p_email: members.new.email, p_device_token: device });
  assert.equal(bound.error, null); assert.equal(bound.data, true);
  const profile = await memberClient.rpc('lookup_member_by_email', { p_email: members.new.email, p_device_token: device });
  assert.equal(profile.error, null); assert.equal(profile.data?.[0]?.id, members.new.id);
  const publicSignupEmail = emailFor('public-signup', ctx.suffix);
  fixture.emails.add(publicSignupEmail);
  const signup = await anonClient().auth.signUp({ email: publicSignupEmail, password: validPassword('public-signup') });
  assert.ok(signup.error, 'public signup must be rejected');
  if (signup.data?.user?.id) fixture.authUserIds.push(signup.data.user.id);
  return { authUserId: authUser.id, adminSession: session.data.session, memberSession: memberSession.data.session };
}
async function selfServiceJoinLifecycle(ctx) {
  const email = emailFor('self-join', ctx.suffix);
  const password = validPassword('self-service-join');
  const adminSession = await signIn(ctx.fixtureEmail, ctx.passwords.admin);
  assert.equal(adminSession.error, null);
  const existingAuth = await countUsersByEmail(ctx.admin, email);
  assert.equal(existingAuth.length, 0, 'self-service join email is collision-checked before invitation');
  const existingMember = await ctx.service.from('members').select('id').eq('email', email).limit(1);
  assertRpc(existingMember, 'self-service join collision check');
  assert.equal(existingMember.data?.length, 0);
  const existingJoinInvite = await ctx.service.from('member_password_invitations').select('id').eq('normalized_email', email).eq('purpose', 'join').limit(1);
  assertRpc(existingJoinInvite, 'self-service join invitation collision check');
  assert.equal(existingJoinInvite.data?.length, 0, 'self-service join email must not already have an invitation');
  const invite = await issue(adminSession.data.session.access_token, null, email, 'join');
  const completion = await enrollRequest(email, invite.token, password);
  assert.equal(completion.status, 200);
  assert.deepEqual(completion.payload, { ok: true, membership: 'pending_review' });
  const authUsers = await countUsersByEmail(ctx.admin, email);
  assert.equal(authUsers.length, 1, 'join provisions exactly one confirmed Auth identity');
  fixture.authUserIds.push(authUsers[0].id);
  const memberResult = await ctx.service.from('members').select('id,email,full_name,work_status').eq('email', email).limit(2);
  assertRpc(memberResult, 'self-service member row');
  assert.equal(memberResult.data?.length, 1);
  const member = memberResult.data[0];
  fixture.memberIds.push(member.id);
  assert.equal(member.full_name, 'Self Service HTTP Member');
  assert.equal(member.work_status, 'inactive');
  const binding = await selectOwned(ctx.service, 'member_auth_bindings', 'member_id,auth_user_id,password_ready', 'member_id', [member.id]);
  assert.equal(binding.length, 1);
  assert.equal(binding[0].auth_user_id, authUsers[0].id);
  assert.equal(binding[0].password_ready, true);
  const session = await signIn(email, password);
  assert.equal(session.error, null, 'the newly provisioned identity can authenticate without opening member portal access');
  const memberClient = createClient(status.api, status.anonKey, {
    global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pending = await memberClient.rpc('get_member_pending_review');
  assert.equal(pending.error, null);
  assert.deepEqual(pending.data, { status: 'pending_review' });
  const access = await memberClient.rpc('get_member_password_access');
  assert.equal(access.error, null);
  assert.equal(access.data, null, 'pending member receives no active portal access');
  const directProfile = await memberClient.from('members').select('id').eq('id', member.id).limit(1);
  assert.equal(directProfile.error, null);
  assert.equal(directProfile.data?.length, 0, 'RLS hides the pending profile from its own session');
}
async function existingPasswordless(ctx, kind, confirmed) {
  const { service, users, members, passwords } = ctx;
  assert.equal(Boolean(users[kind].email_confirmed_at), confirmed);
  const user = users[kind]; const member = members[kind];
  const adminSession = await signIn(ctx.fixtureEmail, passwords.admin);
  assert.equal(adminSession.error, null);
  const invite = await issue(adminSession.data.session.access_token, member.id, member.email, 'enroll');
  const result = await enrollRequest(member.email.toUpperCase(), invite.token, validPassword(kind));
  assert.equal(result.status, 200);
  const listed = await countUsersByEmail(ctx.admin, member.email);
  assert.equal(listed.length, 1); assert.equal(listed[0].id, user.id);
  const authState = await service.rpc('member_password_identity_state', { p_auth_user_id: user.id, p_email: member.email });
  assert.equal(authState.error, null); assert.equal(authState.data?.has_password, true); assert.equal(authState.data?.email_confirmed, true);
  const binding = await selectOwned(service, 'member_auth_bindings', 'member_id,auth_user_id,password_ready', 'member_id', [member.id]);
  assert.equal(binding.length, 1); assert.equal(binding[0].auth_user_id, user.id); assert.equal(binding[0].password_ready, true);
  const logged = await signIn(member.email, validPassword(kind));
  assert.equal(logged.error, null);
  assert.equal(authState.data?.email_confirmed, true);
}
async function adminAndUnrelated(ctx) {
  const { admin, users, members, passwords } = ctx;
  const independentAdminLogin = await signIn(ctx.fixtureEmail, passwords.admin);
  const sameAdminLogin = await signIn(ctx.fixtureEmail, passwords.admin);
  const independentMemberLogin = await signIn(members.new.email, validPassword('new-member'));
  assert.equal(independentAdminLogin.error, null); assert.equal(sameAdminLogin.error, null); assert.equal(independentMemberLogin.error, null);
  const adminSession = independentAdminLogin.data.session;
  const sameAdminSession = sameAdminLogin.data.session;
  const memberSession = independentMemberLogin.data.session;
  assert.equal(adminSession.user.id, sameAdminSession.user.id);
  assert.notEqual(adminSession.access_token, sameAdminSession.access_token);
  assert.notEqual(adminSession.refresh_token, sameAdminSession.refresh_token);
  assert.notEqual(adminSession.user.id, memberSession.user.id);
  const adminPortal = await sessionClient(adminSession).rpc('get_member_password_access');
  const memberPortal = await sessionClient(memberSession).rpc('get_member_password_access');
  assert.equal(adminPortal.error, null); assert.equal(adminPortal.data, null);
  assert.equal(memberPortal.error, null); assert.equal(memberPortal.data?.member_id, members.new.id);
  const memberLogoutClient = anonClient();
  assert.equal((await memberLogoutClient.auth.setSession(memberSession)).error, null);
  const memberLogout = await memberLogoutClient.auth.signOut({ scope: 'local' });
  assert.equal(memberLogout.error, null);
  assert.ok((await anonClient().auth.refreshSession({ refresh_token: memberSession.refresh_token })).error,
    'local logout actually revokes the member refresh session');
  const sameAdminAfterMemberLogout = sessionClient(sameAdminSession);
  const sameAdminUserAfterMemberLogout = await sameAdminAfterMemberLogout.auth.getUser();
  const sameAdminRefreshAfterMemberLogout = await sameAdminAfterMemberLogout.auth.refreshSession({ refresh_token: sameAdminSession.refresh_token });
  assert.equal(sameAdminUserAfterMemberLogout.error, null); assert.equal(sameAdminUserAfterMemberLogout.data.user?.id, users.admin.id);
  assert.equal(sameAdminRefreshAfterMemberLogout.error, null); assert.equal(sameAdminRefreshAfterMemberLogout.data.session?.user.id, users.admin.id);
  const adminAfterMemberLogout = sessionClient(adminSession);
  const adminUserAfterMemberLogout = await adminAfterMemberLogout.auth.getUser();
  const adminPermissionAfterMemberLogout = await adminAfterMemberLogout.rpc('has_admin_permission', { p_permission: 'members' });
  const adminRefreshAfterMemberLogout = await adminAfterMemberLogout.auth.refreshSession({ refresh_token: adminSession.refresh_token });
  assert.equal(adminUserAfterMemberLogout.error, null); assert.equal(adminUserAfterMemberLogout.data.user?.id, users.admin.id);
  assert.equal(adminPermissionAfterMemberLogout.error, null); assert.equal(adminPermissionAfterMemberLogout.data, true);
  assert.equal(adminRefreshAfterMemberLogout.error, null); assert.equal(adminRefreshAfterMemberLogout.data.session?.user.id, users.admin.id);
  const adminUpdate = validPassword('admin-updated');
  const update = await admin.updateUserById(users.admin.id, { password: adminUpdate });
  assert.equal(update.error, null); fixture.passwords.add(adminUpdate); passwords.admin = adminUpdate;
  const adminLogin = await signIn(ctx.fixtureEmail, adminUpdate); assert.equal(adminLogin.error, null);
  const unrelatedUpdate = validPassword('unrelated-updated');
  const unrelated = await admin.updateUserById(users.outsider.id, { password: unrelatedUpdate });
  assert.equal(unrelated.error, null); fixture.passwords.add(unrelatedUpdate);
  passwords.outsider = unrelatedUpdate;
  const unrelatedLogin = await signIn(ctx.outsiderEmail, unrelatedUpdate); assert.equal(unrelatedLogin.error, null);
  const extra = await createUser(admin, ctx.extraEmail, validPassword('extra'), true);
  assert.ok(extra.id);
}
async function resetAndSessions(ctx) {
  const { service, admin, users, members, passwords } = ctx;
  const adminSession = await signIn(ctx.fixtureEmail, passwords.admin);
  assert.equal(adminSession.error, null);
  const originalAdminSession = {
    access_token: adminSession.data.session.access_token,
    refresh_token: adminSession.data.session.refresh_token,
  };
  const originalAdminJwtClient = sessionClient(originalAdminSession);
  const originalAdminUser = await originalAdminJwtClient.auth.getUser();
  assert.equal(originalAdminUser.error, null); assert.equal(originalAdminUser.data.user?.id, users.admin.id);
  const originalAdminPermission = await originalAdminJwtClient.rpc('has_admin_permission', { p_permission: 'members' });
  assert.equal(originalAdminPermission.error, null); assert.equal(originalAdminPermission.data, true);
  const oldPassword = passwords.passworded;
  const oldSession = await signIn(members.passworded.email, oldPassword);
  assert.equal(oldSession.error, null); assert.ok(oldSession.data.session?.access_token); const oldAccess = oldSession.data.session.access_token;
  const invite = await issue(adminSession.data.session.access_token, members.passworded.id, members.passworded.email, 'reset');
  const nextPassword = validPassword('passworded-reset');
  const changed = await enrollRequest(members.passworded.email, invite.token, nextPassword);
  assert.equal(changed.status, 200);
  const oldLogin = await signIn(members.passworded.email, oldPassword);
  const newLogin = await signIn(members.passworded.email, nextPassword);
  assert.ok(oldLogin.error); assert.equal(newLogin.error, null);
  const oldAccessClient = createClient(status.api, status.anonKey, { global: { headers: { Authorization: `Bearer ${oldAccess}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const oldAccessResult = await oldAccessClient.rpc('get_member_password_access');
  assert.equal(oldAccessResult.data, null, 'old Member JWT cannot regain portal access after reset');
  const oldDevice = await oldAccessClient.rpc('bind_member_device_session', { p_email: members.passworded.email, p_device_token: `old-reset-device-${ctx.suffix}` });
  assert.ok(oldDevice.error, 'old Member JWT cannot bind a new device after reset');
  const oldProfile = await oldAccessClient.rpc('lookup_member_by_email', { p_email: members.passworded.email, p_device_token: `old-reset-device-${ctx.suffix}` });
  assert.ok(oldProfile.error || !oldProfile.data?.length, 'old Member JWT cannot read the member profile after reset');
  const freshAccess = await sessionClient(newLogin.data.session).rpc('get_member_password_access');
  assert.equal(freshAccess.error, null); assert.equal(freshAccess.data?.member_id, members.passworded.id);
  const unreservedWrite = await admin.updateUserById(users.passworded.id, { password: validPassword('unreserved-must-fail') });
  assert.ok(unreservedWrite.error, 'bound Member password mutation requires a fresh reset reservation');
  const adminAfterReset = sessionClient(originalAdminSession);
  const adminUserAfterReset = await adminAfterReset.auth.getUser();
  const adminPermissionAfterReset = await adminAfterReset.rpc('has_admin_permission', { p_permission: 'members' });
  const adminRefreshAfterReset = await adminAfterReset.auth.refreshSession({ refresh_token: originalAdminSession.refresh_token });
  assert.equal(adminUserAfterReset.error, null); assert.equal(adminUserAfterReset.data.user?.id, users.admin.id);
  assert.equal(adminPermissionAfterReset.error, null); assert.equal(adminPermissionAfterReset.data, true);
  assert.equal(adminRefreshAfterReset.error, null); assert.equal(adminRefreshAfterReset.data.session?.user.id, users.admin.id);
  const rows = await selectOwned(service, 'member_password_audit', 'id,action', 'member_id', [members.passworded.id]);
  assert.equal(rows.filter((row) => row.action === 'completed').length, 1);
  const refresh = await anonClient().auth.refreshSession({ refresh_token: oldSession.data.session.refresh_token });
  assert.ok(refresh.error);
  assert.equal(refresh.data?.session ?? null, null);
  evidence.observations.oldPasswordRejected = Boolean(oldLogin.error);
  evidence.observations.newPasswordAccepted = newLogin.error === null;
  evidence.observations.oldAccessJwtAccepted = oldAccessResult.error === null && oldAccessResult.data !== null;
  evidence.observations.oldRefreshAccepted = refresh.error === null && Boolean(refresh.data?.session);
  evidence.observations.unrelatedAdminSessionPreserved = adminUserAfterReset.error === null
    && adminUserAfterReset.data.user?.id === users.admin.id
    && adminPermissionAfterReset.error === null && adminPermissionAfterReset.data === true
    && adminRefreshAfterReset.error === null && adminRefreshAfterReset.data.session?.user.id === users.admin.id;
  writeEvidence();
}
async function passwordBoundaries(ctx) {
  const { admin } = ctx;
  const cases = [
    ['ascii12', `${'A'.repeat(11)}1`], ['ascii72', `${'A'.repeat(70)}1 `], ['ascii73', `${'A'.repeat(72)}1`], ['ascii128', `${'A'.repeat(127)}1`],
    ['utf8chars12', `${'Ж'.repeat(11)}1`], ['utf8chars72', `${'Ж'.repeat(71)}1`], ['utf8chars73', `${'Ж'.repeat(72)}1`], ['utf8chars128', `${'Ж'.repeat(127)}1`],
  ];
  const observations = [];
  for (const [label, password] of cases) {
    const email = emailFor(`boundary-${label}`, ctx.suffix); fixture.emails.add(email); fixture.passwords.add(password);
    const result = await bounded(admin.createUser({ email, password, email_confirm: true }));
    const accepted = !result.error && Boolean(result.data?.user?.id);
    if (accepted) fixture.authUserIds.push(result.data.user.id);
    const observation = { label, characters: password.length, utf8Bytes: Buffer.byteLength(password, 'utf8'), accepted, exactLogin: false, trimmedRejected: false, changedSuffixRejected: false };
    if (accepted) {
      const exact = await signIn(email, password);
      const changedSuffix = await signIn(email, `${password.slice(0, -1)}X`);
      assert.equal(exact.error, null);
      assert.ok(changedSuffix.error);
      observation.exactLogin = true; observation.changedSuffixRejected = true;
      if (label.startsWith('ascii') && password.length >= 72) {
        const trimmed = await signIn(email, password.trim());
        assert.ok(trimmed.error); observation.trimmedRejected = true;
      }
    }
    observations.push(observation);
  }
  const byteCases = [['utf8bytes72', `A1${'Ж'.repeat(35)}`], ['utf8bytes73', `A1${'Ж'.repeat(35)}Z`]];
  for (const [label, password] of byteCases) {
    const email = emailFor(`boundary-${label}`, ctx.suffix); fixture.emails.add(email); fixture.passwords.add(password);
    const result = await bounded(admin.createUser({ email, password, email_confirm: true }));
    const accepted = !result.error && Boolean(result.data?.user?.id);
    if (accepted) fixture.authUserIds.push(result.data.user.id);
    const observation = { label, characters: password.length, utf8Bytes: Buffer.byteLength(password, 'utf8'), accepted, exactLogin: false, trimmedRejected: false, changedSuffixRejected: false };
    if (accepted) {
      const exact = await signIn(email, password);
      const changedSuffix = await signIn(email, `${password.slice(0, -1)}X`);
      assert.equal(exact.error, null); assert.ok(changedSuffix.error);
      observation.exactLogin = true; observation.changedSuffixRejected = true;
    }
    observations.push(observation);
  }
  assert.equal(observations.length, BOUNDARY_LABELS.length);
  assert.equal(observations.find((item) => item.label === 'ascii12').accepted, true);
  evidence.boundaryObservations = observations;
  assert.equal(observations.find((item) => item.label === 'ascii72').accepted, true);
  const expectedAccepted = new Map([
    ['ascii12', true], ['ascii72', true], ['ascii73', false], ['ascii128', false],
    ['utf8chars12', true], ['utf8chars72', false], ['utf8chars73', false], ['utf8chars128', false],
    ['utf8bytes72', true], ['utf8bytes73', false],
  ]);
  for (const observation of observations) assert.equal(observation.accepted, expectedAccepted.get(observation.label));
  const edge72Password = `A1${'Ж'.repeat(35)}`;
  const edge72Member = await createMember(ctx.service, emailFor('boundary-edge-72', ctx.suffix), 'boundary-edge-72');
  const edge72Invite = await issue((await signIn(ctx.fixtureEmail, ctx.passwords.admin)).data.session.access_token, edge72Member.id, edge72Member.email);
  fixture.passwords.add(edge72Password);
  const edge72 = await enrollRequest(edge72Member.email, edge72Invite.token, edge72Password);
  assert.equal(edge72.status, 200);
  const edge72Users = await countUsersByEmail(ctx.admin, edge72Member.email);
  assert.equal(edge72Users.length, 1); fixture.authUserIds.push(edge72Users[0].id);
  const edge73Password = `${edge72Password}Z`;
  const edge73Member = await createMember(ctx.service, emailFor('boundary-edge-73', ctx.suffix), 'boundary-edge-73');
  const edge73Invite = await issue((await signIn(ctx.fixtureEmail, ctx.passwords.admin)).data.session.access_token, edge73Member.id, edge73Member.email);
  fixture.passwords.add(edge73Password);
  const edge73 = await enrollRequest(edge73Member.email, edge73Invite.token, edge73Password);
  assert.equal(edge73.payload.code, 'WEAK_PASSWORD');
  const edge73State = await selectOwned(ctx.service, 'member_password_invitations', 'id,status,auth_write_user_id,auth_write_completed_at', 'id', [edge73Invite.id]);
  assert.equal(edge73State[0].status, 'pending'); assert.equal(edge73State[0].auth_write_user_id, null); assert.equal(edge73State[0].auth_write_completed_at, null);
  for (const observation of observations) {
    assert.equal(typeof observation.accepted, 'boolean');
    assert.equal(Number.isInteger(observation.characters), true);
    assert.equal(Number.isInteger(observation.utf8Bytes), true);
  }
  const whitespaceEmail = emailFor('boundary-whitespace', ctx.suffix);
  const whitespacePassword = `${'A'.repeat(10)}1 `;
  fixture.emails.add(whitespaceEmail); fixture.passwords.add(whitespacePassword);
  const whitespaceUser = await bounded(admin.createUser({ email: whitespaceEmail, password: whitespacePassword, email_confirm: true }));
  assert.equal(whitespaceUser.error, null); assert.ok(whitespaceUser.data?.user?.id); fixture.authUserIds.push(whitespaceUser.data.user.id);
  const exact = await signIn(whitespaceEmail, whitespacePassword);
  const trimmed = await signIn(whitespaceEmail, whitespacePassword.trim());
  const changedSuffix = await signIn(whitespaceEmail, `${whitespacePassword.slice(0, -1)}X`);
  assert.equal(exact.error, null); assert.ok(trimmed.error); assert.ok(changedSuffix.error);
}
async function negatives(ctx) {
  const { service, admin, users, members, passwords } = ctx;
  const adminSession = await signIn(ctx.fixtureEmail, passwords.admin); assert.equal(adminSession.error, null);
  const token = 'phpw_' + '0'.repeat(64);
  const missingPassword = await enrollRequest(members.new.email, token, undefined, undefined); assert.notEqual(missingPassword.status, 200); assert.ok(missingPassword.payload.code);
  const weakPassword = await enrollRequest(members.new.email, token, 'a', 'a'); assert.notEqual(weakPassword.status, 200); assert.ok(weakPassword.payload.code);
  const malformedJsonResponse = await bounded(fetch(`${API_ORIGIN}${FUNCTION_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: PREVIEW_ORIGIN }, body: '{', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  const malformedJson = await malformedJsonResponse.json(); assert.notEqual(malformedJsonResponse.status, 200); assert.ok(malformedJson.code);
  const arrayResponse = await bounded(fetch(`${API_ORIGIN}${FUNCTION_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: PREVIEW_ORIGIN }, body: JSON.stringify([]), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  const arrayPayload = await arrayResponse.json(); assert.notEqual(arrayResponse.status, 200); assert.ok(arrayPayload.code);
  const missingInviteToken = await adminAction({ action: 'enroll', email: members.new.email, password: validPassword('bad'), confirmPassword: validPassword('bad') }); assert.notEqual(missingInviteToken.status, 200); assert.ok(missingInviteToken.payload.code);
  const malformed = await enrollRequest(members.new.email, 'hashalone', validPassword('bad')); assert.equal(malformed.payload.code, 'INVALID_INPUT');
  const missing = await enrollRequest(members.new.email, token, validPassword('bad')); assert.ok(['INVALID_TOKEN', 'ALREADY_USED'].includes(missing.payload.code));
  const mismatch = await enrollRequest(members.new.email, token, validPassword('bad'), validPassword('other')); assert.equal(mismatch.payload.code, 'PASSWORD_MISMATCH');
  const oversize = await adminAction({ action: 'enroll', email: members.new.email, token, password: 'A1'.repeat(MAX_BODY_BYTES), confirmPassword: 'A1'.repeat(MAX_BODY_BYTES) }); assert.equal(oversize.payload.code, 'INVALID_INPUT');
  const noAuth = await adminAction({ action: 'list' }); assert.equal(noAuth.payload.code, 'UNAUTHORIZED');
  const nonMemberPermission = await sessionClient((await signIn(ctx.outsiderEmail, passwords.outsider)).data.session).rpc('has_admin_permission', { p_permission: 'members' }); assert.equal(nonMemberPermission.error, null); assert.equal(nonMemberPermission.data, false);
  const badAuth = await adminAction({ action: 'list' }, 'not-a-jwt'); assert.equal(badAuth.payload.code, 'UNAUTHORIZED');
  const apikeyBearer = await adminAction({ action: 'list' }, status.anonKey); assert.equal(apikeyBearer.payload.code, 'UNAUTHORIZED');
  const freshNormalized = await createMember(service, emailFor('fresh-normalized', ctx.suffix), 'fresh-normalized');
  const wrongEmailInvite = await issue(adminSession.data.session.access_token, freshNormalized.id, freshNormalized.email, 'enroll');
  const wrongEmail = await enrollRequest(` ${freshNormalized.email.toUpperCase()}-wrong`, wrongEmailInvite.token, validPassword('bad')); assert.equal(wrongEmail.payload.code, 'WRONG_EMAIL');
  const normalized = await enrollRequest(` ${freshNormalized.email.toUpperCase()} `, wrongEmailInvite.token, validPassword('fresh-normalized')); assert.equal(normalized.status, 200);
  const revokedMember = await createMember(service, emailFor('revoked', ctx.suffix), 'revoked');
  const revokedInvite = await issue(adminSession.data.session.access_token, revokedMember.id, revokedMember.email);
  const revoked = await adminAction({ action: 'revoke', inviteId: revokedInvite.id }, adminSession.data.session.access_token); assert.equal(revoked.status, 200);
  const revokedUse = await enrollRequest(revokedMember.email, revokedInvite.token, validPassword('revoked')); assert.equal(revokedUse.payload.code, 'REVOKED');
  const expiredMember = await createMember(service, emailFor('expired', ctx.suffix), 'expired');
  const expiredInvite = await issue(adminSession.data.session.access_token, expiredMember.id, expiredMember.email);
  const changed = await service.from('member_password_invitations').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', expiredInvite.id).select('id').limit(1);
  assertRpc(changed, 'owned expiry fixture');
  const expiredUse = await enrollRequest(expiredMember.email, expiredInvite.token, validPassword('expired')); assert.equal(expiredUse.payload.code, 'EXPIRED');
  const passwordedEnroll = await adminAction({ action: 'issue', memberId: members.unconfirmed.id, email: members.unconfirmed.email, purpose: 'enroll', expiresInHours: 24, note: 'reject already enrolled unconfirmed identity' }, adminSession.data.session.access_token);
  assert.equal(passwordedEnroll.payload.code, 'PASSWORD_ALREADY_SET');
  const badUuid = await adminAction({ action: 'issue', memberId: members.passworded.id, email: members.passworded.email, purpose: 'reset', expectedAuthUserId: users.outsider.id, associationEvidence: 'reviewed', expiresInHours: 24, note: 'manual identity metadata is unsupported' }, adminSession.data.session.access_token); assert.equal(badUuid.payload.code, 'INVALID_INPUT');
  const badBinding = await adminAction({ action: 'issue', memberId: members.passworded.id, email: members.new.email, purpose: 'reset', expiresInHours: 24, note: 'wrong member binding' }, adminSession.data.session.access_token); assert.equal(badBinding.payload.code, 'WRONG_EMAIL');
  const unboundEmail = emailFor('unbound-legacy', ctx.suffix);
  rememberRateKey('member-password:email:', unboundEmail);
  const unboundUser = await createUser(admin, unboundEmail, validPassword('unbound-legacy'), true);
  const unboundMember = await createMember(service, unboundEmail, 'unbound legacy identity');
  assert.equal((await selectOwned(service, 'member_auth_bindings', 'member_id', 'member_id', [unboundMember.id])).length, 0);
  const unboundLegacy = await adminAction({ action: 'issue', memberId: unboundMember.id, email: unboundEmail, purpose: 'enroll', expiresInHours: 24, note: 'unbound legacy identity must not be auto-adopted' }, adminSession.data.session.access_token);
  assert.equal(unboundLegacy.payload.code, 'IDENTITY_CONFLICT');
  assert.ok(unboundUser.id);
  const disabled = await createMember(service, emailFor('disabled', ctx.suffix), 'disabled');
  const disabledInvite = await issue(adminSession.data.session.access_token, disabled.id, disabled.email);
  const disableRow = await service.from('members').update({ work_status: 'disabled' }).eq('id', disabled.id).select('id').limit(1); assertRpc(disableRow, 'owned disabled fixture');
  const disabledUse = await enrollRequest(disabled.email, disabledInvite.token, validPassword('disabled')); assert.equal(disabledUse.payload.code, 'MEMBER_DISABLED');
  const duplicateAuth = await bounded(admin.createUser({ email: members.passworded.email, password: validPassword('duplicate-auth'), email_confirm: true }));
  const duplicateUsers = await countUsersByEmail(ctx.admin, members.passworded.email);
  console.log(`owned duplicate Auth call rejected ${Boolean(duplicateAuth.error)} exact identity count ${duplicateUsers.length}`);
  assert.ok(duplicateAuth.error);
  assert.equal(duplicateUsers.length, 1);
  const adminIdentity = await adminAction({ action: 'issue', memberId: members.new.id, email: members.new.email, purpose: 'enroll', expectedAuthUserId: users.admin.id, associationEvidence: 'reviewed', expiresInHours: 24, note: 'admin identity metadata is unsupported' }, adminSession.data.session.access_token); assert.equal(adminIdentity.payload.code, 'INVALID_INPUT');
  const stale = await service.from('admin_accounts').update({ permissions: completeAdminPermissions({ dashboard: true }) }).eq('user_id', users.admin.id).select('user_id,permissions').limit(1); assertRpc(stale, 'owned permission fixture');
  assert.deepEqual(stale.data?.[0]?.permissions, completeAdminPermissions({ dashboard: true }));
  const staleDenied = await adminAction({ action: 'list' }, adminSession.data.session.access_token); assert.equal(staleDenied.payload.code, 'UNAUTHORIZED');
  const restore = await service.from('admin_accounts').update({ permissions: completeAdminPermissions({ members: true, dashboard: true, tasks: true }) }).eq('user_id', users.admin.id).select('user_id,permissions').limit(1); assertRpc(restore, 'owned permission restoration');
  assert.deepEqual(restore.data?.[0]?.permissions, completeAdminPermissions({ members: true, dashboard: true, tasks: true }));
  for (let i = 0; i < 9; i += 1) { const limited = await enrollRequest(emailFor('rate', ctx.suffix), `phpw_${'f'.repeat(64)}`, validPassword('rate')); if (i === 8) assert.equal(limited.payload.code, 'RATE_LIMITED'); }
  assert.ok(fixture.rateKeyHashes.size > 0);
  assert.equal(validatePreflightConfig({ env: { SUPABASE_URL: 'https://hosted.invalid' } })?.includes('nonlocal'), true);
}
async function concurrent(ctx) {
  const { service, passwords } = ctx;
  const assertContentionDenial = (result) => {
    const expectedStatus = { ALREADY_USED: 400, REVIEW_REQUIRED: 409, RATE_LIMITED: 429 }[result?.payload?.code];
    assert.ok(expectedStatus !== undefined, 'non-winning request must receive an expected one-use or safe contention denial');
    assert.equal(result.status, expectedStatus, 'contention response status must match its allowlisted code');
    assert.deepEqual(Object.keys(result.payload ?? {}).sort(), ['code'], 'contention response must expose only the safe error code');
  };
  const adminSession = await signIn(ctx.fixtureEmail, passwords.admin); assert.equal(adminSession.error, null);
  const member = await createMember(service, emailFor('concurrent', ctx.suffix), 'concurrent');
  const invite = await issue(adminSession.data.session.access_token, member.id, member.email);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => enrollRequest(member.email, invite.token, validPassword('concurrent'))));
  assert.equal(attempts.filter((result) => result.status === 200).length, 1);
  const losingAttempts = attempts.filter((result) => result.status !== 200);
  assert.equal(losingAttempts.length, 7);
  for (const result of losingAttempts) assertContentionDenial(result);
  const users = await countUsersByEmail(ctx.admin, member.email); assert.equal(users.length, 1);
  const audit = await selectOwned(service, 'member_password_audit', 'id,action', 'invitation_id', [invite.id]);
  assert.equal(audit.filter((row) => row.action === 'completed').length, 1);
  const resetMember = await createMember(service, emailFor('concurrent-reset', ctx.suffix), 'concurrent-reset');
  const resetUser = await createUser(ctx.admin, resetMember.email, validPassword('concurrent-reset-old'), true);
  const bind = await service.from('member_auth_bindings').insert({ member_id: resetMember.id, auth_user_id: resetUser.id, normalized_email: resetMember.email, password_ready: true }); assertRpc(bind, 'concurrent reset binding');
  const resetInvite = await issue(adminSession.data.session.access_token, resetMember.id, resetMember.email, 'reset');
  const resetAttempts = await Promise.all(Array.from({ length: 8 }, (_, i) => enrollRequest(resetMember.email, resetInvite.token, validPassword(`concurrent-reset-${i}`))));
  assert.equal(resetAttempts.filter((result) => result.status === 200).length, 1);
  const losingResetAttempts = resetAttempts.filter((result) => result.status !== 200);
  assert.equal(losingResetAttempts.length, 7);
  for (const result of losingResetAttempts) assertContentionDenial(result);
  const resetAudit = await selectOwned(service, 'member_password_audit', 'id,action', 'invitation_id', [resetInvite.id]);
  assert.equal(resetAudit.filter((row) => row.action === 'completed').length, 1);
}

async function createResetClaim(ctx, label, oldPassword = validPassword(`${label}-old`), reserve = true) {
  const member = await createMember(ctx.service, emailFor(`fault-${label}`, ctx.suffix), `fault-${label}`);
  const user = await createUser(ctx.admin, member.email, oldPassword, true);
  const binding = await ctx.service.from('member_auth_bindings').insert({ member_id: member.id, auth_user_id: user.id, normalized_email: member.email, password_ready: true });
  assertRpc(binding, `owned ${label} binding`);
  const adminSession = await signIn(ctx.fixtureEmail, ctx.passwords.admin); assert.equal(adminSession.error, null);
  const invite = await issue(adminSession.data.session.access_token, member.id, member.email, 'reset');
  let reservation = null;
  if (reserve) {
    reservation = await ctx.service.rpc('member_password_reserve', { p_token_hash: sha256(invite.token), p_email: member.email });
    assertRpc(reservation, `owned ${label} reservation`);
    assert.match(reservation.data.claim_id, /^[0-9a-f-]{36}$/i);
    reservation = reservation.data;
  }
  return { member, user, invite, reservation, oldPassword };
}

async function assertReviewDenied(ctx, claim, label) {
  const review = await ctx.service.rpc('member_password_mark_review_required', { p_invitation_id: claim.invite.id, p_claim_id: claim.reservation.claim_id });
  assert.equal(review.error, null); assert.equal(review.data, true);
  const state = await selectOwned(ctx.service, 'member_password_invitations', 'id,status,claim_id,auth_write_completed_at,auth_write_user_id', 'id', [claim.invite.id]);
  assert.equal(state.length, 1); assert.equal(state[0].status, 'review_required'); assert.equal(state[0].claim_id, claim.reservation.claim_id);
  const retry = await enrollRequest(claim.member.email, claim.invite.token, validPassword(`${label}-retry`));
  assert.equal(retry.payload.code, 'REVIEW_REQUIRED');
  return state[0];
}

async function markerAndWriteFaults(ctx) {
  const missing = await createResetClaim(ctx, 'marker-missing');
  const missingPassword = validPassword('marker-missing-written'); fixture.passwords.add(missingPassword);
  const missingWrite = await ctx.admin.updateUserById(missing.user.id, { password: missingPassword });
  assert.equal(missingWrite.error, null);
  const removed = await ctx.service.from('member_password_invitations').update({ auth_write_completed_at: null, auth_write_user_id: null }).eq('id', missing.invite.id).select('id').limit(1);
  assertRpc(removed, 'owned missing-marker fault');
  const missingCompletion = await ctx.service.rpc('member_password_complete', { p_invitation_id: missing.invite.id, p_claim_id: missing.reservation.claim_id, p_auth_user_id: missing.user.id });
  assert.ok(missingCompletion.error);
  const missingState = await assertReviewDenied(ctx, missing, 'marker-missing');
  assert.equal(missingState.auth_write_completed_at, null); assert.equal(missingState.auth_write_user_id, null);
  assert.equal((await signIn(missing.member.email, missingPassword)).error, null);

  const wrong = await createResetClaim(ctx, 'marker-wrong');
  const wrongPassword = validPassword('marker-wrong-written'); fixture.passwords.add(wrongPassword);
  const wrongWrite = await ctx.admin.updateUserById(wrong.user.id, { password: wrongPassword });
  assert.equal(wrongWrite.error, null);
  const wrongMarker = randomUUID();
  const changedMarker = await ctx.service.from('member_password_invitations').update({ auth_write_user_id: wrongMarker }).eq('id', wrong.invite.id).select('id').limit(1);
  assertRpc(changedMarker, 'owned wrong-marker fault');
  const wrongCompletion = await ctx.service.rpc('member_password_complete', { p_invitation_id: wrong.invite.id, p_claim_id: wrong.reservation.claim_id, p_auth_user_id: wrong.user.id });
  assert.ok(wrongCompletion.error);
  const wrongState = await assertReviewDenied(ctx, wrong, 'marker-wrong');
  assert.equal(wrongState.auth_write_user_id, wrongMarker); assert.ok(wrongState.auth_write_completed_at);
  assert.equal((await signIn(wrong.member.email, wrongPassword)).error, null);

  const duplicate = await createResetClaim(ctx, 'duplicate-write');
  const firstPassword = validPassword('duplicate-first'); const secondPassword = validPassword('duplicate-second');
  fixture.passwords.add(firstPassword); fixture.passwords.add(secondPassword);
  const firstWrite = await ctx.admin.updateUserById(duplicate.user.id, { password: firstPassword });
  assert.equal(firstWrite.error, null);
  const duplicateWrite = await ctx.admin.updateUserById(duplicate.user.id, { password: secondPassword });
  assert.ok(duplicateWrite.error);
  const duplicateState = await assertReviewDenied(ctx, duplicate, 'duplicate-write');
  assert.equal(duplicateState.auth_write_user_id, duplicate.user.id); assert.ok(duplicateState.auth_write_completed_at);
  assert.equal((await signIn(duplicate.member.email, firstPassword)).error, null);
  assert.ok((await signIn(duplicate.member.email, secondPassword)).error);

  const expired = await createResetClaim(ctx, 'expired-reservation');
  const expiryUpdate = await ctx.service.from('member_password_invitations').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', expired.invite.id).select('id').limit(1);
  assertRpc(expiryUpdate, 'owned reserved expiry fault');
  const expiredPassword = validPassword('expired-reservation-write'); fixture.passwords.add(expiredPassword);
  const expiredWrite = await ctx.admin.updateUserById(expired.user.id, { password: expiredPassword });
  assert.ok(expiredWrite.error);
  const expiredState = await assertReviewDenied(ctx, expired, 'expired-reservation');
  assert.equal(expiredState.auth_write_completed_at, null); assert.equal(expiredState.auth_write_user_id, null);
}

async function faultQuarantine(ctx) {
  await markerAndWriteFaults(ctx);
  const { service, users } = ctx;
  const adminSession = await signIn(ctx.fixtureEmail, ctx.passwords.admin); assert.equal(adminSession.error, null);
  const member = ctx.members.fault;
  const invite = await issue(adminSession.data.session.access_token, member.id, member.email, 'reset');
  const triggerKey = `audit-${ctx.suffix}`;
  const triggerName = sqlIdentifier(`real_fault_audit_${ctx.suffix.replaceAll('-', '_')}`);
  const functionName = sqlIdentifier(`real_fault_audit_fn_${ctx.suffix.replaceAll('-', '_')}`);
  try {
    installOwnedTrigger({
      key: triggerKey, trigger: triggerName, functionName, table: 'public.member_password_audit',
      body: `  IF NEW.action = 'completed' AND NEW.invitation_id = '${invite.id}'::uuid THEN RAISE EXCEPTION 'OWNED_COMPLETED_AUDIT_FAULT'; END IF;\n  RETURN NEW;`,
    });
    const nextPassword = validPassword('audit-fault-written'); fixture.passwords.add(nextPassword);
    const completion = await enrollRequest(member.email, invite.token, nextPassword);
    assert.equal(completion.payload.code, 'REVIEW_REQUIRED');
    const state = await selectOwned(service, 'member_password_invitations', 'id,status,claim_id,auth_write_completed_at,auth_write_user_id', 'id', [invite.id]);
    assert.equal(state[0].status, 'review_required'); assert.equal(state[0].auth_write_user_id, users.fault.id); assert.ok(state[0].auth_write_completed_at);
    assert.equal((await signIn(member.email, nextPassword)).error, null);
    const access = await sessionClient((await signIn(member.email, nextPassword)).data.session).rpc('get_member_password_access');
    assert.equal(access.error, null); assert.equal(access.data, null);
    const completedAudit = await selectOwned(service, 'member_password_audit', 'id,action', 'invitation_id', [invite.id]);
    assert.equal(completedAudit.some((row) => row.action === 'completed'), false);
    assert.equal((await service.from('member_auth_bindings').select('member_id,password_ready').eq('member_id', member.id).limit(1).single()).data?.password_ready, true);
  } finally {
    try { dropOwnedTrigger(triggerKey); } catch { /* cleanup retains the owned map for retry */ }
  }
  await controlledChildTermination(ctx);
}

async function waitForInvitationStatus(service, invitationId, expectedStatus, timeout = 8_000, requireMarker = false) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await service.from('member_password_invitations').select('id,status,claim_id,auth_write_completed_at,auth_write_user_id').eq('id', invitationId).limit(1);
    if (!result.error && result.data?.[0]?.status === expectedStatus && (!requireMarker || result.data[0].auth_write_completed_at)) return result.data[0];
    await sleep(100);
  }
  fail('owned invitation status did not reach expected pause point');
}

async function findNativeEdgePid() {
  if (!nativeRuntimeSelected()) return null;
  // CLI 3.1 native status does not expose service PIDs. Only select the exact
  // executable under this test's private native home, same UID and worktree.
  const home = process.env.SUPABASE_HOME;
  if (!home || !path.isAbsolute(home)) fail('explicit owned native home is required');
  const candidates = [];
  for (const name of readdirSync('/proc')) {
    if (!/^[0-9]+$/.test(name) || Number(name) <= 1) continue;
    try {
      const proc = `/proc/${name}`;
      const executable = readlinkSync(`${proc}/exe`);
      const cwd = readlinkSync(`${proc}/cwd`);
      const relative = path.relative(home, executable);
      if (statSync(proc).uid === process.getuid()
        && relative.startsWith('cache/stack/slim-services/edge-runtime/')
        && /\/bin\/(?:\.edge-runtime-wrapped|edge-runtime)$/.test(relative)
        && [ROOT, NATIVE_WORKDIR].includes(cwd)) candidates.push(Number(name));
    } catch { /* processes can exit during exact ownership inspection */ }
  }
  if (candidates.length !== 1) fail('exact single owned native Edge runtime PID was not identified');
  return candidates[0];
}
async function findOwnedDockerEdgeId() {
  const config = readFileSync(path.join(BACKEND, 'supabase', 'config.toml'), 'utf8');
  const project = config.match(/^project_id\s*=\s*"(phantoms-password-local|phantoms-disposable-[0-9]+)"\s*$/m)?.[1];
  if (!project) fail('exact disposable project namespace is required');
  const expectedName = `supabase_edge_runtime_${project}`;
  let raw;
  try { raw = execFileSync('docker', ['ps', '--filter', `name=^/${expectedName}$`, '--format', '{{.ID}}\t{{.Names}}'], { cwd: ROOT, env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8_000 }); } catch { fail('owned Docker Edge inspection failed'); }
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('exact single owned Docker Edge container was not identified');
  const [id, name] = lines[0].split('\t');
  if (name !== expectedName || !/^[0-9a-f]+$/.test(id)) fail('owned Docker Edge identity mismatch');
  let inspect;
  try { inspect = JSON.parse(execFileSync('docker', ['inspect', id], { cwd: ROOT, env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8_000 }))[0]; } catch { fail('owned Docker Edge metadata unavailable'); }
  const labels = inspect?.Config?.Labels ?? {};
  if (labels['com.supabase.cli.project'] !== project) fail('owned Docker Edge project label mismatch');
  return id;
}
async function killOwnedEdgeRuntime() {
  if (nativeRuntimeSelected()) {
    const pid = await findNativeEdgePid();
    try { process.kill(pid, 'SIGKILL'); } catch { fail('owned native Edge termination failed'); }
    return;
  }
  const id = await findOwnedDockerEdgeId();
  try { execFileSync('docker', ['kill', id], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 8_000 }); } catch { fail('owned Docker Edge termination failed'); }
}
async function waitForOwnedAuthPause(nonce, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = Number(localSql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${nonce}'`, true));
    if (Number.isInteger(count) && count > 0) return count;
    await sleep(100);
  }
  fail('owned Auth pause was not observed');
}

async function controlledChildTermination(ctx) {
  const claim = await createResetClaim(ctx, 'child-termination', validPassword('child-termination-old'), false);
  const triggerKey = `pause-${ctx.suffix}`;
  const triggerName = sqlIdentifier(`real_fault_pause_${ctx.suffix.replaceAll('-', '_')}`);
  const functionName = sqlIdentifier(`real_fault_pause_fn_${ctx.suffix.replaceAll('-', '_')}`);
  const pauseNonce = `phantoms-owned-fault-${ctx.suffix.replaceAll('-', '_')}`;
  try {
    installOwnedTrigger({
      key: triggerKey, trigger: triggerName, functionName, table: 'auth.users', timing: 'AFTER', events: 'UPDATE',
      body: `  IF NEW.id = '${claim.user.id}'::uuid THEN PERFORM set_config('application_name', '${pauseNonce}', true); PERFORM pg_sleep(12); END IF;\n  RETURN NEW;`,
    });
    const controller = new AbortController();
    const nextPassword = validPassword('child-termination-written'); fixture.passwords.add(nextPassword);
    const pending = enrollRequest(claim.member.email, claim.invite.token, nextPassword, nextPassword, undefined, controller.signal).catch(() => null);
    const reserved = await waitForInvitationStatus(ctx.service, claim.invite.id, 'reserved');
    assert.match(reserved.claim_id, /^[0-9a-f-]{36}$/i);
    claim.reservation = { claim_id: reserved.claim_id };
    // The Auth transaction's marker is not visible until the paused write
    // commits. Observe the exact owned backend pause before killing Edge.
    await waitForOwnedAuthPause(pauseNonce);
    controller.abort();
    await killOwnedEdgeRuntime();
    await pending;
    await stopChild(edgeProcess);
    await sleep(13_000);
    edgeProcess = undefined;
    dropOwnedTrigger(triggerKey);
    edgeProcess = spawnEdge();
    await waitForFunction();
    const afterKill = await selectOwned(ctx.service, 'member_password_invitations', 'id,status,claim_id,auth_write_completed_at,auth_write_user_id', 'id', [claim.invite.id]);
    assert.equal(afterKill[0].status, 'reserved');
    assert.equal(afterKill[0].claim_id, claim.reservation.claim_id);
    const committed = afterKill[0].auth_write_completed_at !== null;
    assert.equal(afterKill[0].auth_write_user_id, committed ? claim.user.id : null);
    const denied = await assertReviewDenied(ctx, claim, 'child-termination');
    assert.equal(denied.status, 'review_required');
    // GoTrue may cancel and roll back when the killed Edge closes its socket.
    // Prove the marker/password outcome exactly; neither outcome may regain
    // Member access, and neither permits a retry/release/force-completion.
    const memberSession = await signIn(claim.member.email, committed ? nextPassword : claim.oldPassword);
    assert.equal(memberSession.error, null);
    assert.ok((await signIn(claim.member.email, committed ? claim.oldPassword : nextPassword)).error);
    console.log(`owned Edge termination Auth transaction ${committed ? 'committed' : 'rolled back'}`);
    const access = await sessionClient(memberSession.data.session).rpc('get_member_password_access');
    assert.equal(access.error, null); assert.equal(access.data, null);
  } finally {
    if (ownedSqlFaults.has(triggerKey)) { try { dropOwnedTrigger(triggerKey); } catch { /* cleanup retries owned trigger removal */ } }
  }
}


async function listOwnedAuthUsers(admin) {
  const matches = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await bounded(admin.listUsers({ page, perPage: 100 }), CLEANUP_TIMEOUT_MS);
    if (result.error) fail('Auth cleanup listing failed');
    const users = result.data?.users ?? [];
    for (const user of users) if (typeof user.email === 'string' && fixture.emails.has(user.email.trim().toLowerCase())) matches.push(user);
    if (users.length < 100) return matches;
  }
  fail('bounded Auth cleanup listing exceeded');
}
async function cleanup() {
  const failures = [];
  for (const key of ownedSqlFaults.keys()) {
    try { dropOwnedTrigger(key); } catch { failures.push(true); }
  }
  const service = status ? serviceClient() : null;
  const attempt = async (operation) => {
    try {
      const result = await bounded(operation(), CLEANUP_TIMEOUT_MS);
      if (result?.error) failures.push(true);
      return result;
    } catch { failures.push(true); return null; }
  };
  if (service && fixture.joinEmails.size) {
    const emails = [...fixture.joinEmails];
    const discoveredInvites = await attempt(() => service.from('member_password_invitations').select('id,normalized_email,purpose').in('normalized_email', emails).eq('purpose', 'join').limit(1000));
    if (!discoveredInvites || discoveredInvites.error || !Array.isArray(discoveredInvites.data)) failures.push(true);
    else {
      if (discoveredInvites.data.length >= 1000) failures.push(true);
      for (const row of discoveredInvites.data) {
        const normalizedEmail = typeof row.normalized_email === 'string' ? row.normalized_email.trim().toLowerCase() : '';
        if (row.purpose !== 'join' || !fixture.joinEmails.has(normalizedEmail) || typeof row.id !== 'string') { failures.push(true); continue; }
        if (!fixture.invitationIds.includes(row.id)) fixture.invitationIds.push(row.id);
      }
    }
    const discoveredMembers = await attempt(() => service.from('members').select('id,email').in('email', emails).limit(1000));
    if (!discoveredMembers || discoveredMembers.error || !Array.isArray(discoveredMembers.data)) failures.push(true);
    else {
      if (discoveredMembers.data.length >= 1000) failures.push(true);
      for (const row of discoveredMembers.data) {
        if (fixture.joinEmails.has(String(row.email).trim().toLowerCase()) && !fixture.memberIds.includes(row.id)) fixture.memberIds.push(row.id);
      }
    }
  }
  if (service && fixture.invitationIds.length) await attempt(() => service.from('member_password_audit').delete().in('invitation_id', [...new Set(fixture.invitationIds)]));
  if (service && fixture.memberIds.length) await attempt(() => service.from('member_password_audit').delete().in('member_id', fixture.memberIds));
  if (service && fixture.invitationIds.length) await attempt(() => service.from('member_password_invitations').delete().in('id', [...new Set(fixture.invitationIds)]));
  if (service && fixture.memberIds.length) await attempt(() => service.from('member_auth_bindings').delete().in('member_id', fixture.memberIds));
  if (service && fixture.memberIds.length) await attempt(() => service.from('members').delete().in('id', fixture.memberIds));
  if (service && fixture.adminUserIds.length) await attempt(() => service.from('admin_accounts').delete().in('user_id', [...new Set(fixture.adminUserIds)]));
  if (service && fixture.rateKeyHashes.size) await attempt(() => service.from('member_password_rate_limits').delete().in('key_hash', [...fixture.rateKeyHashes]));
  if (service) {
    let users = [];
    try { users = await listOwnedAuthUsers(service.auth.admin); } catch { failures.push(true); }
    const listedIds = new Set(users.map((user) => user.id));
    for (const user of users) await attempt(() => service.auth.admin.deleteUser(user.id));
    for (const id of new Set(fixture.authUserIds)) if (!listedIds.has(id)) await attempt(() => service.auth.admin.deleteUser(id));
  }
  if (service) {
    const checks = [
      ['members', 'id', fixture.memberIds], ['member_auth_bindings', 'member_id', fixture.memberIds],
      ['member_password_invitations', 'id', fixture.invitationIds], ['member_password_audit', 'member_id', fixture.memberIds],
    ];
    for (const [table, column, values] of checks) if (values.length) await attempt(async () => { const rows = await selectOwned(service, table, column, column, values); if (rows.length) return { error: new Error('owned rows remain') }; return { data: rows }; });
    if (fixture.invitationIds.length) await attempt(async () => { const rows = await service.from('member_password_audit').select('id').in('invitation_id', [...new Set(fixture.invitationIds)]).limit(1000); return rows.error || rows.data?.length ? { error: rows.error ?? new Error('owned invitation audit rows remain') } : rows; });
    if (fixture.memberIds.length) await attempt(async () => { const rows = await service.from('member_password_audit').select('id').in('member_id', fixture.memberIds).limit(1000); return rows.error || rows.data?.length ? { error: rows.error ?? new Error('owned member audit rows remain') } : rows; });
    if (fixture.joinEmails.size) {
      const emails = [...fixture.joinEmails];
      await attempt(async () => { const rows = await service.from('member_password_invitations').select('id').in('normalized_email', emails).eq('purpose', 'join').limit(1000); return rows.error || rows.data?.length ? { error: rows.error ?? new Error('owned join invitations remain') } : rows; });
      await attempt(async () => { const rows = await service.from('members').select('id').in('email', emails).limit(1000); return rows.error || rows.data?.length ? { error: rows.error ?? new Error('owned join members remain') } : rows; });
    }
    await attempt(async () => { const rows = await service.from('admin_accounts').select('user_id').in('user_id', [...new Set(fixture.adminUserIds)]).limit(Math.max(fixture.adminUserIds.length, 1)); return rows.data?.length ? { error: new Error('owned admin rows remain') } : rows; });
    await attempt(async () => { const rows = await service.from('member_password_rate_limits').select('key_hash').in('key_hash', [...fixture.rateKeyHashes]).limit(Math.max(fixture.rateKeyHashes.size, 1)); return rows.data?.length ? { error: new Error('owned rate rows remain') } : rows; });
    try { if ((await listOwnedAuthUsers(service.auth.admin)).length) failures.push(true); } catch { failures.push(true); }
  }
  if (ownedSqlFaults.size) failures.push(true);
  return failures.length ? 'failed' : 'passed';
}

async function run() {
  evidence = evidenceSkeleton(); writeEvidence();
  const primaryErrors = [];
  const mark = async (label, operation) => {
    const stage = evidence.stages.find((item) => item.label === label);
    try { await operation(); stage.status = 'passed'; stage.passed = true; console.log(`stage ${REAL_STAGE_LABELS.indexOf(label) + 1}: passed`); }
    catch (error) { stage.status = 'failed'; stage.passed = false; primaryErrors.push(error); console.log(`stage ${REAL_STAGE_LABELS.indexOf(label) + 1}: failed at source line ${safeFailureLine(error)}`); }
    writeEvidence();
  };
  try {
    await mark(REAL_STAGE_LABELS[0], async () => {
      const preflightConfig = { envLocalExists: existsSync(ENV_LOCAL), projectRefExists: existsSync(PROJECT_REF_FILE), env: process.env, apiOrigin: API_ORIGIN, previewOrigin: PREVIEW_ORIGIN };
      const preflightError = validatePreflightConfig(preflightConfig);
      if (preflightError) fail(preflightError);
      if (!nativeSourceMatchesProduct()) fail('disposable runtime source mismatch');
      status = readLocalStatus(); evidence.pg17 = await detectPg17(status.db);
      spawnEdge(); await waitForFunction();
    });
    if (status && evidence.pg17 && evidence.stages[0].passed) {
      const ctx = await seedFixtures();
      ctx.fixtureEmail = ctx.users.admin.email; ctx.outsiderEmail = ctx.users.outsider.email; ctx.extraEmail = emailFor('extra', ctx.suffix); fixture.emails.add(ctx.extraEmail);
      await mark(REAL_STAGE_LABELS[1], async () => {
        await newMemberLifecycle(ctx);
        await selfServiceJoinLifecycle(ctx);
      });
      await mark(REAL_STAGE_LABELS[2], () => existingPasswordless(ctx, 'unconfirmed', false));
      await mark(REAL_STAGE_LABELS[3], () => existingPasswordless(ctx, 'passwordless', true));
      await mark(REAL_STAGE_LABELS[4], () => adminAndUnrelated(ctx));
      await mark(REAL_STAGE_LABELS[5], () => resetAndSessions(ctx));
      await mark(REAL_STAGE_LABELS[6], () => passwordBoundaries(ctx));
      await mark(REAL_STAGE_LABELS[7], () => negatives(ctx));
      await mark(REAL_STAGE_LABELS[8], () => concurrent(ctx));
      await mark(REAL_STAGE_LABELS[9], () => faultQuarantine(ctx));
    }
  } catch (error) { primaryErrors.push(error); console.log(`run failed at source line ${safeFailureLine(error)}`); }
  finally {
    evidence.aborted = abortRequested;
    for (const child of activeChildren) {
      try { await stopChild(child); } catch (error) { primaryErrors.push(error); }
    }
    for (const directory of ownedTempDirectories) rmSync(directory, { recursive: true, force: true });
    evidence.cleanupStatus = await cleanup();
    writeEvidence();
  }
  if (primaryErrors.length || evidence.cleanupStatus !== 'passed' || !isCompleteRealEvidence(evidence)) {
    throw new Error('real local HTTP acceptance incomplete; sanitized evidence is not passing');
  }
}
async function detectPg17(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const output = execFileSync('psql', ['-Atqc', 'SHOW server_version'], { cwd: ROOT, env: { ...childEnv(), PGHOST: parsed.hostname, PGPORT: parsed.port, PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 });
    return /^17(?:\.|$)/.test(output.trim());
  } catch { return false; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', () => { abortRequested = true; for (const child of activeChildren) child.kill('SIGTERM'); });
  process.on('SIGTERM', () => { abortRequested = true; for (const child of activeChildren) child.kill('SIGTERM'); });
  run().catch(() => { process.exitCode = 1; });
}
