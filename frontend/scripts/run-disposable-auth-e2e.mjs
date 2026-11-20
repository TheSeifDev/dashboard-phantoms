#!/usr/bin/env node
/**
 * Disposable local Auth E2E.
 *
 * The service key is read from local `supabase status`, retained only in this
 * process, and never passed to a child, browser, fixture bridge, or log. The
 * bridge exposes only bounded fixture identity checks and local Auth action-link
 * redirects over loopback. Passwords and invitation tokens remain in process
 * or browser memory only; no storage state, screenshots, traces, videos,
 * tokens, passwords, or session data are persisted.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  closeHttpServer,
  finalizeAuthEvidence,
  isCompleteAuthEvidence,
  isExactLoopbackHttpOrigin,
  isExactLoopbackPostgresUrl,
  scopedMailpitDeleteOptions,
} from './auth-e2e-helpers.mjs';
import { runAuthFixtureLifecycle } from './auth-fixture-lifecycle.mjs';
import { localStatusArgs, localFunctionServeArgs, localRuntimeWorkdir } from './local-stack-runtime.mjs';
import { isExactNativeStackHost, isExactNativeStackWorkload, isExactOwnedNativeEdgeRuntime } from './native-supabase-process-ownership.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const BACKEND = path.join(ROOT, 'backend');

function localPort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error('Invalid disposable loopback port.');
  }
  return Number(value);
}

const API_PORT = localPort('PHANTOMS_LOCAL_API_PORT', 54321);
const DB_PORT = localPort('PHANTOMS_LOCAL_DB_PORT', 54322);
const PREVIEW_PORT = localPort('PHANTOMS_LOCAL_PREVIEW_PORT', 4173);
const MAILPIT_PORT = localPort('PHANTOMS_LOCAL_MAILPIT_PORT', 54324);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const MAILPIT_ORIGIN = `http://127.0.0.1:${MAILPIT_PORT}`;
const ENROLLMENT_FUNCTION_PATH = '/functions/v1/member-password-enrollment';
const AUTH_EVIDENCE_PATH = path.join(FRONTEND, 'test-results', 'auth-evidence.json');
const MAX_AUTH_USER_PAGES = 20;
const AUTH_USER_PAGE_SIZE = 100;
const CLEANUP_OPERATION_TIMEOUT_MS = 10_000;
const ENV_LOCAL = path.join(FRONTEND, '.env.local');
const PROJECT_REF_FILE = path.join(BACKEND, 'supabase', '.temp', 'project-ref');
const SAFE_DOMAIN = 'phantoms-test.example';
const PASSWORD = 'Disposable-Auth-Local-2026!';
const DISPOSABLE_INVITATION_NOTE = 'local disposable password migration fixture';
const ADMIN_PERMISSIONS = { dashboard: true, members: true, tasks: true, ranking: true, notes: true, announcements: true, whatsapp: true, ai_assistant: true, web_projects: false };
const FORBIDDEN_ENV_NAMES = [
  'SUPABASE_ACCESS_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY',
  'SERVICE_ROLE_KEY', 'JWT_SECRET', 'SUPABASE_JWT_SECRET', 'ANON_KEY', 'POSTGRES_URL',
  'DIRECT_URL', 'SB_SECRET_KEY', 'SB_ACCESS_TOKEN', 'PGHOST', 'PGPORT', 'PGUSER',
  'PGPASSWORD', 'PGDATABASE',
];
const PRIVATE_VALUES = new Set();
const activeChildren = new Set();
const activeServers = new Set();
const ownedRuntimeDirectories = new Set();
let abortRequested = false;

function readProcessRecord(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closingParen = stat.lastIndexOf(')');
    if (closingParen < 0) return null;
    const fields = stat.slice(closingParen + 2).split(' ');
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    const executable = readlinkSync(`/proc/${pid}/exe`);
    const parentPid = Number(fields[1]);
    const startTime = fields[19];
    if (!Number.isInteger(parentPid) || !startTime) return null;
    return { pid, parentPid, startTime, comm, command, executable };
  } catch {
    return null;
  }
}

function allProcessRecords() {
  let entries;
  try { entries = readdirSync('/proc'); } catch { return []; }
  return entries.filter((entry) => /^\d+$/.test(entry)).map((entry) => readProcessRecord(Number(entry)))
    .filter(Boolean);
}

function nativeEdgeProcesses() {
  return allProcessRecords().filter((record) => record.comm.startsWith('.edge-runtime'));
}

function nativeStackWorkloads(context) {
  return allProcessRecords().filter((record) => isExactNativeStackWorkload(record, {
    supabaseExecutable: context.supabaseExecutable,
    stackHostPids: context.stackHostPids,
  }));
}

function nativeStackOwnershipBefore() {
  if (process.env.SUPABASE_EXPERIMENTAL_STACK !== '1') return null;
  let version;
  let supabaseExecutable;
  try {
    version = execFileSync('supabase', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const located = execFileSync('which', ['supabase'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    supabaseExecutable = realpathSync(located);
  } catch {
    fail('could not establish the pinned local Supabase CLI identity.');
  }
  if (version !== '3.1.0') fail('native process ownership requires the pinned Supabase CLI version.');
  const supabaseHome = process.env.SUPABASE_HOME;
  if (!supabaseHome || !path.isAbsolute(supabaseHome)) fail('native process ownership requires the exact local Supabase home.');
  const expected = { supabaseExecutable, supabaseHome: path.resolve(supabaseHome) };
  const stackHostPids = new Set(allProcessRecords()
    .filter((record) => isExactNativeStackHost(record, expected))
    .map((record) => record.pid));
  if (stackHostPids.size !== 1) fail('could not establish exactly one selected disposable native stack host.');
  const context = { supabaseExecutable, stackHostPids };
  return {
    ...context,
    workloadPidsBefore: new Set(nativeStackWorkloads(context).map((record) => record.pid)),
    edgePidsBefore: new Set(nativeEdgeProcesses().map((record) => record.pid)),
  };
}

function processIdentityIsAlive(identity) {
  const current = identity ? readProcessRecord(identity.pid) : null;
  return Boolean(current && current.startTime === identity.startTime && current.comm === identity.comm
    && current.executable === identity.executable);
}

function enrollmentProcessOutcome(enrollmentFunction) {
  const state = enrollmentFunction?.nativeState;
  if (state?.spawnError) return 'spawn-error';
  if (state?.signalCode !== null && state?.signalCode !== undefined) return 'signal';
  if (state?.exitCode !== null && state?.exitCode !== undefined) return state.exitCode === 0 ? 'exit-zero' : 'exit-nonzero';
  return 'running';
}

function assertEnrollmentProcessOutcome(runtime) {
  const enrollmentFunction = runtime?.enrollmentFunction;
  const outcome = enrollmentProcessOutcome(enrollmentFunction);
  if (outcome === 'spawn-error' || outcome === 'signal' || outcome === 'exit-nonzero') {
    fail('local enrollment function failed before browser tests.');
  }
  return outcome;
}

function recordNativeEnrollmentDaemon(runtime) {
  const enrollmentFunction = runtime?.enrollmentFunction;
  if (process.env.SUPABASE_EXPERIMENTAL_STACK !== '1' || enrollmentProcessOutcome(enrollmentFunction) !== 'exit-zero') return;
  const context = enrollmentFunction.nativeEdgeOwnershipContext;
  if (!context) fail('native enrollment function ownership context was not established.');
  const candidates = nativeEdgeProcesses().filter((record) => !context.edgePidsBefore.has(record.pid));
  const workloads = nativeStackWorkloads(context).filter((record) => !context.workloadPidsBefore.has(record.pid));
  if (candidates.length !== 1 || workloads.length !== 1) fail('native enrollment function did not produce exactly one owned Edge workload.');
  const daemon = candidates[0];
  const wrapper = readProcessRecord(daemon.parentPid);
  if (workloads[0].pid !== wrapper?.pid || !isExactOwnedNativeEdgeRuntime({ daemon, wrapper, ...context })) {
    fail('native enrollment function Edge workload owner was not exact.');
  }
  enrollmentFunction.nativeEdgeDaemon = { daemon, wrapper };
}

function fail(message) {
  throw new Error(`[auth-e2e] ${message}`);
}

function redact(message) {
  let safe = String(message)
    .replaceAll(PASSWORD, '[redacted]')
    .replaceAll(/(?:service[_-]?role|access|secret)[_-]?key\s*[=:]\s*[^\s,;]+/gi, '[redacted-secret]')
    .replaceAll(/\b(?:eyJ[a-zA-Z0-9_-]{20,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]{12,}|sbp_[a-zA-Z0-9_-]{12,})\b/g, '[redacted-token]');
  for (const value of PRIVATE_VALUES) if (value) safe = safe.replaceAll(value, '[redacted-secret]');
  return safe;
}

function assertLoopbackOrigin(origin, label) {
  if (!isExactLoopbackHttpOrigin(origin)) fail(`${label} is not exact loopback HTTP.`);
}

function assertPreflightSafety() {
  if (process.env.CI !== 'true' && process.env.PHANTOMS_DISPOSABLE_E2E !== '1') {
    fail('refusing to run outside CI=true or PHANTOMS_DISPOSABLE_E2E=1.');
  }
  if (existsSync(ENV_LOCAL)) fail('refusing to run while frontend/.env.local exists.');
  if (existsSync(PROJECT_REF_FILE)) fail('refusing to run while backend/supabase/.temp/project-ref exists.');
  for (const name of FORBIDDEN_ENV_NAMES) if (process.env[name]) fail(`refusing forbidden credential variable ${name}.`);
  localRuntimeWorkdir(BACKEND);
  assertLoopbackOrigin(API_ORIGIN, 'Supabase API');
  assertLoopbackOrigin(PREVIEW_ORIGIN, 'preview');
  assertLoopbackOrigin(MAILPIT_ORIGIN, 'Mailpit');
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL !== API_ORIGIN) {
    fail('refusing a non-local VITE_SUPABASE_URL.');
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== API_ORIGIN) {
    fail('refusing a non-local SUPABASE_URL.');
  }
}

function parseEnvOutput(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
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
    raw = execFileSync('supabase', localStatusArgs(BACKEND), {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    fail('could not read local Supabase status; no database write was attempted.');
  }
  const values = parseEnvOutput(raw);
  const api = values.API_URL || values.SUPABASE_URL;
  const db = values.DB_URL || values.DATABASE_URL;
  const anonKey = values.ANON_KEY || values.SUPABASE_ANON_KEY;
  const serviceKey = values.SERVICE_ROLE_KEY || values.SUPABASE_SERVICE_ROLE_KEY;
  if (api !== API_ORIGIN) fail('Supabase status did not report the exact loopback API.');
  if (!db || !anonKey || !serviceKey) fail('local Supabase status omitted required credentials.');
  if (!isExactLoopbackPostgresUrl(db, DB_PORT)) fail('refusing a database target other than the selected loopback database.');
  PRIVATE_VALUES.add(anonKey);
  PRIVATE_VALUES.add(serviceKey);
  PRIVATE_VALUES.add(values.JWT_SECRET || '');
  return { api, db, anonKey, serviceKey };
}

function childEnvironment(status, extra = {}) {
  const env = { ...process.env };
  for (const name of FORBIDDEN_ENV_NAMES) delete env[name];
  delete env.SUPABASE_URL;
  delete env.DATABASE_URL;
  return {
    ...env,
    VITE_SUPABASE_URL: status?.api ?? API_ORIGIN,
    VITE_SUPABASE_ANON_KEY: status?.anonKey ?? 'local-build-only-placeholder',
    VITE_VAPID_PUBLIC_KEY: 'your-vapid-public-key',
    VITE_PUBLIC_WEB_URL: PREVIEW_ORIGIN,
    ...extra,
  };
}

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? FRONTEND,
      env: options.env ?? process.env,
      stdio: options.inheritOutput ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    activeChildren.add(child);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      activeChildren.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`));
    });
  });
}

async function waitForHttp(origin, pathName, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}${pathName}`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The local service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`${label} did not become ready on loopback.`);
}

async function waitForEnrollmentFunction(runtime) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertEnrollmentProcessOutcome(runtime);
    try {
      const response = await fetch(`${API_ORIGIN}${ENROLLMENT_FUNCTION_PATH}`, {
        method: 'GET', headers: { Origin: PREVIEW_ORIGIN }, signal: AbortSignal.timeout(2_000),
      });
      // Only our initialized handler's method rejection proves readiness.
      // Gateway errors and missing server credentials must not pass this gate.
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      if (response.status === 405 && body?.code === 'INVALID_INPUT') {
        assertEnrollmentProcessOutcome(runtime);
        recordNativeEnrollmentDaemon(runtime);
        return;
      }
    } catch {
      // The disposable edge runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('member-password-enrollment did not become available on the exact loopback function route.');
}

function spawnPreview(env) {
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: FRONTEND, env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  activeChildren.add(preview);
  preview.once('exit', () => activeChildren.delete(preview));
  return preview;
}

function spawnEnrollmentFunction(env) {
  // Supabase CLI owns disposable local bindings. Never pass service credentials
  // through this child process or retain its output.
  const nativeEdgeOwnershipContext = nativeStackOwnershipBefore();
  const directory = mkdtempSync(path.join(os.tmpdir(), 'phantoms-auth-runtime-'));
  ownedRuntimeDirectories.add(directory);
  const originFile = path.join(directory, 'origins.env');
  // CLI child environment variables are not an Edge secret-injection contract.
  // This disposable file contains only a public loopback origin, never keys.
  writeFileSync(originFile, `PHANTOMS_ALLOWED_ORIGINS=${PREVIEW_ORIGIN}\nPHANTOMS_DISPOSABLE_AUTH=1\n`, { mode: 0o600 });
  const functionProcess = spawn('supabase', localFunctionServeArgs(BACKEND, originFile), {
    cwd: ROOT,
    env: childEnvironment(null, { ...env, PHANTOMS_ALLOWED_ORIGINS: PREVIEW_ORIGIN, PHANTOMS_DISPOSABLE_AUTH: '1' }),
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  functionProcess.nativeEdgeOwnershipContext = nativeEdgeOwnershipContext;
  functionProcess.nativeState = { spawnError: false, exitCode: null, signalCode: null };
  functionProcess.on('error', () => { functionProcess.nativeState.spawnError = true; });
  activeChildren.add(functionProcess);
  functionProcess.once('exit', (code, signal) => {
    functionProcess.nativeState.exitCode = code;
    functionProcess.nativeState.signalCode = signal;
    activeChildren.delete(functionProcess);
  });
  return functionProcess;
}

async function stopProcess(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    const deadline = setTimeout(() => {
      clearTimeout(forceTimer);
      reject(new Error(`${label} did not exit within the bounded shutdown period.`));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(forceTimer);
      clearTimeout(deadline);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function stopNativeEnrollmentDaemon(runtime) {
  let owned = runtime?.enrollmentFunction?.nativeEdgeDaemon;
  const context = runtime?.enrollmentFunction?.nativeEdgeOwnershipContext;
  if (!owned && context) {
    const candidates = nativeEdgeProcesses().filter((record) => !context.edgePidsBefore.has(record.pid));
    const workloads = nativeStackWorkloads(context).filter((record) => !context.workloadPidsBefore.has(record.pid));
    if (candidates.length > 1 || workloads.length > 1) fail('native enrollment function workload ownership was ambiguous.');
    if (candidates.length === 1) {
      const daemon = candidates[0];
      const wrapper = readProcessRecord(daemon.parentPid);
      if (workloads.length !== 1 || workloads[0].pid !== wrapper?.pid
        || !isExactOwnedNativeEdgeRuntime({ daemon, wrapper, ...context })) {
        fail('native enrollment function Edge workload owner was not exact.');
      }
      owned = { daemon, wrapper };
    } else if (workloads.length === 1) {
      owned = { wrapper: workloads[0] };
    }
  }
  if (owned && context?.edgePidsBefore) {
    if (owned.daemon && !isExactOwnedNativeEdgeRuntime({ daemon: owned.daemon, wrapper: owned.wrapper, ...context })) {
      fail('native enrollment function Edge workload identity changed before cleanup.');
    }
  }
  if (!owned) return;
  const identities = [owned.daemon, owned.wrapper].filter(Boolean);
  for (const identity of identities) {
    if (!processIdentityIsAlive(identity)) continue;
    try { process.kill(identity.pid, 'SIGTERM'); } catch { fail('native enrollment function daemon cleanup failed.'); }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && identities.some(processIdentityIsAlive)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const identity of identities) {
    if (!processIdentityIsAlive(identity)) continue;
    try { process.kill(identity.pid, 'SIGKILL'); } catch { fail('native enrollment function daemon cleanup failed.'); }
  }
  if (identities.some(processIdentityIsAlive)) fail('native enrollment function daemon cleanup timed out.');
}

async function mailpitJson(pathName, options = {}) {
  const response = await fetch(`${MAILPIT_ORIGIN}${pathName}`, { ...options, signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error('local mail service request failed');
  return response.json();
}

function recipientMatches(message, email) {
  const recipients = [...(message.To ?? []), ...(message.Cc ?? []), ...(message.Bcc ?? [])];
  return recipients.some((recipient) => {
    const address = typeof recipient === 'string' ? recipient : recipient?.Address;
    return typeof address === 'string' && address.toLowerCase() === email.toLowerCase();
  });
}

async function waitForMailpit() {
  try {
    await waitForHttp(MAILPIT_ORIGIN, '/api/v1/messages?limit=1', 'Mailpit');
  } catch (error) {
    fail(`Mailpit is unavailable; no Auth fixture write was attempted (${redact(error instanceof Error ? error.message : error)}).`);
  }
}

async function trackFixtureMessages(fixture, messageIds) {
  const listing = await mailpitJson('/api/v1/messages?limit=100');
  // Member password enrollment never sends mail. Track only the unchanged admin
  // invite/recovery flows so cleanup remains exact-ID scoped.
  const fixtureEmails = new Set([fixture.inviteEmail, fixture.recoveryEmail]);
  for (const message of Array.isArray(listing.messages) ? listing.messages : []) {
    if (message.ID && [...fixtureEmails].some((email) => recipientMatches(message, email))) messageIds.add(message.ID);
  }
}

async function prepareOwnedInvitationCleanup(service, fixture) {
  const actorId = fixture.joinIssueActorId ?? fixture.adminUserIds[0];
  const notes = new Set([DISPOSABLE_INVITATION_NOTE, fixture.joinInvitationNote].filter((value) => typeof value === 'string' && value));
  if (!actorId || notes.size === 0) return;
  const result = await Promise.race([
    service.from('member_password_invitations')
      .select('id,created_by,member_id,purpose,note,normalized_email,expected_auth_user_id,auth_user_id,auth_write_user_id')
      .eq('created_by', actorId).in('note', [...notes]).limit(100),
    new Promise((_, reject) => setTimeout(() => reject(new Error('owned invitation lookup timed out')), CLEANUP_OPERATION_TIMEOUT_MS)),
  ]);
  if (result?.error || !Array.isArray(result?.data) || result.data.length >= 100) {
    throw new Error('exact owned invitation lookup failed');
  }
  for (const row of result.data) {
    if (typeof row.id !== 'string' || row.created_by !== actorId
        || !['join', 'enroll', 'reset'].includes(row.purpose) || !notes.has(row.note)) {
      throw new Error('owned invitation marker mismatch');
    }
    if (row.purpose === 'join' && row.note === fixture.joinInvitationNote && typeof row.normalized_email === 'string'
        && row.normalized_email.toLowerCase() !== fixture.joinMemberEmail.toLowerCase()) {
      throw new Error('owned join invitation email mismatch');
    }
    if (!fixture.invitationIds.includes(row.id)) fixture.invitationIds.push(row.id);
    if (Number.isSafeInteger(row.member_id) && row.member_id > 0 && !fixture.memberIds.includes(row.member_id)) {
      fixture.memberIds.push(row.member_id);
    }
    for (const userId of [row.expected_auth_user_id, row.auth_user_id, row.auth_write_user_id]) {
      if (typeof userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
          && !fixture.createdUserIds.includes(userId)) fixture.createdUserIds.push(userId);
    }
  }
}

function authUserNotFound(result) {
  return Boolean(result?.error && (result.error.status === 404 || /user not found/i.test(String(result.error.message ?? ''))));
}

async function assertExactAuthUserAbsent(admin, userId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('refusing non-UUID Auth fixture cleanup');
  }
  const result = await Promise.race([
    admin.getUserById(userId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('exact Auth lookup timed out')), CLEANUP_OPERATION_TIMEOUT_MS)),
  ]);
  if (authUserNotFound(result) || (!result?.error && !result?.data?.user)) return;
  if (result?.error) throw new Error('exact Auth fixture lookup failed');
  throw new Error('owned Auth fixture remains after cleanup');
}

async function deleteAndVerifyExactAuthUser(admin, userId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('refusing non-UUID Auth fixture cleanup');
  }
  const before = await Promise.race([
    admin.getUserById(userId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('exact Auth lookup timed out')), CLEANUP_OPERATION_TIMEOUT_MS)),
  ]);
  if (authUserNotFound(before) || (!before?.error && !before?.data?.user)) return;
  if (before?.error) throw new Error('exact Auth fixture lookup failed');
  const deleted = await Promise.race([
    admin.deleteUser(userId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('exact Auth deletion timed out')), CLEANUP_OPERATION_TIMEOUT_MS)),
  ]);
  if (deleted?.error && !authUserNotFound(deleted)) throw new Error('exact Auth fixture deletion failed');
  await assertExactAuthUserAbsent(admin, userId);
}

async function assertJoinFixtureEmailUnused(service, admin, email) {
  const normalized = email.toLowerCase();
  const [members, invitations] = await Promise.all([
    service.from('members').select('id').eq('email', normalized).limit(1),
    service.from('member_password_invitations').select('id').eq('normalized_email', normalized).limit(1),
  ]);
  if (members.error || invitations.error || members.data?.length || invitations.data?.length) {
    fail('random join fixture email was not unused.');
  }
  for (let page = 1; page <= MAX_AUTH_USER_PAGES; page += 1) {
    const listed = await admin.listUsers({ page, perPage: AUTH_USER_PAGE_SIZE });
    if (listed?.error) fail('could not preflight the random join fixture identity.');
    const users = Array.isArray(listed?.data?.users) ? listed.data.users : [];
    if (users.some((user) => user.email?.toLowerCase() === normalized)) fail('random join fixture identity already exists.');
    if (users.length < AUTH_USER_PAGE_SIZE) return;
  }
  fail('random join fixture email preflight exceeded its bounded limit.');
}

async function cleanupFixtures(service, admin, fixture, messageIds) {
  const failures = [];
  const attempt = async (operation) => {
    try {
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('bounded cleanup timeout')), CLEANUP_OPERATION_TIMEOUT_MS)),
      ]);
      if (result?.error) failures.push('local cleanup operation failed');
    } catch {
      failures.push('local cleanup operation failed');
    }
  };
  await attempt(() => trackFixtureMessages(fixture, messageIds));
  await attempt(() => prepareOwnedInvitationCleanup(service, fixture));
  const exactFixtureUserIds = new Set(fixture.createdUserIds);
  // Invitations restrict member deletion; audit rows must be removed first.
  // All selected member IDs were registered immediately by this invocation.
  if (fixture.invitationIds.length) {
    await attempt(() => service.from('member_password_audit').delete().in('invitation_id', fixture.invitationIds));
    await attempt(() => service.from('member_password_invitations').delete().in('id', fixture.invitationIds));
  }
  if (fixture.memberIds.length) {
    await attempt(() => service.from('member_password_audit').delete().in('member_id', fixture.memberIds));
    await attempt(() => service.from('member_password_invitations').delete().in('member_id', fixture.memberIds));
  }
  if (fixture.memberIds.length) await attempt(() => service.from('members').delete().in('id', fixture.memberIds));
  if (fixture.adminUserIds.length) await attempt(() => service.from('admin_accounts').delete().in('user_id', fixture.adminUserIds));
  for (const userId of exactFixtureUserIds) await attempt(() => deleteAndVerifyExactAuthUser(admin, userId));
  for (const messageId of messageIds) {
    try {
      const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
        ...scopedMailpitDeleteOptions([messageId]), signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) failures.push('local mail cleanup failed');
    } catch {
      failures.push('local mail cleanup failed');
    }
  }
  try {
    const remaining = await mailpitJson('/api/v1/messages?limit=100');
    if ((remaining.messages ?? []).some((message) => messageIds.has(message.ID))) failures.push('fixture messages remain after cleanup');
  } catch {
    failures.push('mail cleanup verification failed');
  }
  if (fixture.memberIds.length) {
    for (const [table, column] of [['members', 'id'], ['member_auth_bindings', 'member_id'], ['member_password_invitations', 'member_id'], ['member_password_audit', 'member_id']]) {
      const remaining = await service.from(table).select(column).in(column, fixture.memberIds).limit(fixture.memberIds.length);
      if (remaining.error || remaining.data?.length !== 0) failures.push('owned fixture cleanup verification failed');
    }
  }
  if (fixture.invitationIds.length) {
    const [remainingInvites, remainingAudit] = await Promise.all([
      service.from('member_password_invitations').select('id').in('id', fixture.invitationIds).limit(fixture.invitationIds.length),
      service.from('member_password_audit').select('id').in('invitation_id', fixture.invitationIds).limit(100),
    ]);
    if (remainingInvites.error || remainingInvites.data?.length !== 0 || remainingAudit.error || remainingAudit.data?.length !== 0) {
      failures.push('exact owned invitation cleanup verification failed');
    }
  }
  const actorId = fixture.joinIssueActorId ?? fixture.adminUserIds[0];
  if (actorId) {
    const notes = [DISPOSABLE_INVITATION_NOTE, fixture.joinInvitationNote].filter((value) => typeof value === 'string' && value);
    const remainingMarkers = await service.from('member_password_invitations').select('id')
      .eq('created_by', actorId).in('note', notes).limit(1);
    if (remainingMarkers.error || remainingMarkers.data?.length !== 0) failures.push('exact owned invitation markers remain after cleanup');
  }
  for (const userId of exactFixtureUserIds) await attempt(() => assertExactAuthUserAbsent(admin, userId));
  if (failures.length) fail(`fixture cleanup failed (${failures.length} bounded operations).`);
}

function extractDeliveredConfirmationURL(message, expectedRedirectTo) {
  const body = `${message.Text ?? ''}\n${message.HTML ?? ''}`
    .replaceAll('&amp;', '&')
    .replaceAll('&#x2F;', '/')
    .replaceAll('&#47;', '/');
  const candidates = body.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.origin !== API_ORIGIN || parsed.pathname !== '/auth/v1/verify') continue;
      if (parsed.searchParams.get('redirect_to') !== expectedRedirectTo) continue;
      return parsed.toString();
    } catch {
      // Ignore non-URL text in the local message body.
    }
  }
  return null;
}

async function waitForDeliveredConfirmationURL(email, expectedRedirectTo, messageIds) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const listing = await mailpitJson('/api/v1/messages?limit=100');
      const messages = Array.isArray(listing.messages) ? listing.messages : [];
      for (const message of [...messages].reverse()) {
        if (!message.ID || !recipientMatches(message, email)) continue;
        const detail = await mailpitJson(`/api/v1/message/${encodeURIComponent(message.ID)}`);
        const confirmationURL = extractDeliveredConfirmationURL(detail, expectedRedirectTo);
        if (confirmationURL) {
          messageIds.add(message.ID);
          return confirmationURL;
        }
      }
    } catch {
      // Mailpit may briefly abort a bounded request while the email is being delivered.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local Auth action email was not delivered');
}

async function seedFixtures(status) {
  const service = createClient(status.api, status.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = service.auth.admin;
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const email = (label) => `auth-${label}-${suffix}@${SAFE_DOMAIN}`;
  const fixture = {
    adminEmail: email('admin'),
    existingMemberEmail: email('existing-member'),
    firstTimeMemberEmail: email('new-member'),
    joinMemberEmail: email('join-member'),
    joinInvitationNote: `auth-e2e-join-${suffix}`,
    joinIssueActorId: null,
    invitationIds: [],
    outsiderEmail: email('outsider'),
    inviteEmail: email('invite'),
    recoveryEmail: email('recovery'),
    password: PASSWORD,
    existingMemberAuthUserId: null,
    existingMemberId: null,
    firstTimeMemberId: null,
    createdUserIds: [],
    adminUserIds: [],
    memberIds: [],
  };
  const createUser = async (userEmail, options = {}) => {
    const body = { email: userEmail, email_confirm: options.email_confirm ?? true };
    if (options.password !== undefined) body.password = options.password;
    const result = await admin.createUser(body);
    if (result.error || !result.data.user) fail('could not seed a disposable Auth user.');
    // Register immediately after creation so every later failure is cleanable.
    fixture.createdUserIds.push(result.data.user.id);
    return result.data.user;
  };
  const addAdmin = async (userId) => {
    // Register access before writing so a partial insert remains cleanup-safe.
    fixture.adminUserIds.push(userId);
    const result = await service.from('admin_accounts').insert({ user_id: userId, role: 'admin', permissions: ADMIN_PERMISSIONS });
    if (result.error) fail('could not seed disposable admin access.');
  };
  const createMember = async (body) => {
    const result = await service.from('members').insert(body).select('id,email').single();
    if (result.error || !result.data?.id) fail('could not seed a disposable member row.');
    // Register immediately after each row creation; no bulk unregistered window.
    fixture.memberIds.push(result.data.id);
    return result.data;
  };
  const makeOwnedLegacyFixturePasswordless = (user) => {
    // GoTrue 2.197 creates a random hash when Admin.createUser omits password.
    // This is explicit PG fixture construction, not a claim that the Auth API
    // created a passwordless account. The subsequent enrollment/password write
    // still uses the actual GoTrue service and the unmodified application guard.
    if (!fixture.createdUserIds.includes(user.id) || user.email !== fixture.existingMemberEmail
        || !/^[0-9a-f-]{36}$/i.test(user.id)
        || !/^auth-existing-member-[a-z0-9-]+@phantoms-test\.example$/.test(user.email)
        || !isExactLoopbackPostgresUrl(status.db, DB_PORT)) fail('invalid owned passwordless fixture target.');
    const db = new URL(status.db);
    const env = { ...process.env, PGHOST: db.hostname, PGPORT: db.port,
      PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
      PGDATABASE: db.pathname.slice(1) || 'postgres' };
    let changed;
    try {
      changed = execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-Atqc',
        `UPDATE auth.users AS u SET encrypted_password = NULL WHERE u.id = '${user.id}'::uuid
         AND u.email = '${user.email}'
         AND NOT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = u.id)
         RETURNING u.id`], { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8_000 }).trim();
    } catch { fail('owned passwordless fixture construction failed.'); }
    if (changed !== user.id) fail('owned passwordless fixture construction did not affect exactly one unbound identity.');
  };
  try {
    await assertJoinFixtureEmailUnused(service, admin, fixture.joinMemberEmail);
    const adminUser = await createUser(fixture.adminEmail, { password: PASSWORD });
    fixture.joinIssueActorId = adminUser.id;
    await addAdmin(adminUser.id);
    const existingJoinMarker = await service.from('member_password_invitations').select('id')
      .eq('created_by', fixture.joinIssueActorId).eq('purpose', 'join').eq('note', fixture.joinInvitationNote).limit(1);
    if (existingJoinMarker.error || existingJoinMarker.data?.length) fail('random join invitation ownership marker was not unused.');
    const existingUser = await createUser(fixture.existingMemberEmail);
    makeOwnedLegacyFixturePasswordless(existingUser);
    fixture.existingMemberAuthUserId = existingUser.id;
    await createUser(fixture.outsiderEmail, { password: PASSWORD });
    const recoveryUser = await createUser(fixture.recoveryEmail, { password: PASSWORD });
    await addAdmin(recoveryUser.id);

    const existingMember = await createMember({ email: fixture.existingMemberEmail, full_name: 'Disposable existing password member', completion_rank: 88, team_notes: 'Auth E2E', residence: 'Alexandria', work_conditions: 'remote', bio: 'Auth E2E existing member', phone: '+201000000101', device: 'لابتوب', gender: 'female', meeting_attendance: 'present', work_status: 'active', can_go_alexandria: true, custom_fields: {} });
    const firstTimeMember = await createMember({ email: fixture.firstTimeMemberEmail, full_name: 'Disposable first-time password member', completion_rank: 47, team_notes: 'Auth E2E', residence: 'Cairo', work_conditions: 'onsite', bio: 'Auth E2E first-time member', phone: '+201000000102', device: 'كمبيوتر', gender: 'male', meeting_attendance: 'regular', work_status: 'active', can_go_alexandria: false, custom_fields: {} });
    const identityBinding = await service.from('member_auth_bindings').insert({
      member_id: existingMember.id,
      auth_user_id: existingUser.id,
      normalized_email: fixture.existingMemberEmail.toLowerCase(),
      password_ready: false,
    });
    if (identityBinding.error) fail('could not seed the exact disposable existing-member identity binding.');
    fixture.existingMemberId = existingMember.id;
    fixture.firstTimeMemberId = firstTimeMember.id;

    return { service, admin, fixture };
  } catch (error) {
    let cleanupFailed = false;
    try {
      await cleanupFixtures(service, admin, fixture, new Set());
    } catch { cleanupFailed = true; }
    if (cleanupFailed) fail('fixture setup failed and exact-owned cleanup FAILED; disposable fixtures require review.');
    fail(`fixture setup failed; exact-owned cleanup completed (${redact(error instanceof Error ? error.message : error)}).`);
  }
}

function startFixtureBridge(fixture, messageIds, service, admin) {
  const allowedEmails = new Set([
    fixture.adminEmail, fixture.existingMemberEmail, fixture.firstTimeMemberEmail, fixture.joinMemberEmail,
    fixture.outsiderEmail, fixture.inviteEmail, fixture.recoveryEmail,
  ].map((email) => email.toLowerCase()));
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/identity-check') {
        const requestedEmail = requestUrl.searchParams.get('email')?.toLowerCase() ?? '';
        const expectedAuthUserId = requestUrl.searchParams.get('expectedAuthUserId') ?? '';
        if (!allowedEmails.has(requestedEmail)) { response.writeHead(404).end(); return; }
        const listed = await admin.listUsers({ page: 1, perPage: AUTH_USER_PAGE_SIZE });
        if (listed.error) { response.writeHead(503).end(); return; }
        const users = (listed.data?.users ?? []).filter((user) => user.email?.toLowerCase() === requestedEmail);
        const idMatches = expectedAuthUserId ? users.length === 1 && users[0].id === expectedAuthUserId : false;
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ count: users.length, idMatches }));
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/admin/invite') {
        const redirectTo = `${PREVIEW_ORIGIN}/admin/set-password`;
        const invite = await admin.inviteUserByEmail(fixture.inviteEmail, { redirectTo });
        if (invite.error || !invite.data.user?.id) { response.writeHead(503).end(); return; }
        fixture.createdUserIds.push(invite.data.user.id);
        if (!fixture.adminUserIds.includes(invite.data.user.id)) {
          const access = await service.from('admin_accounts').insert({ user_id: invite.data.user.id, role: 'admin', permissions: ADMIN_PERMISSIONS });
          if (access.error) { response.writeHead(503).end(); return; }
          fixture.adminUserIds.push(invite.data.user.id);
        }
        const confirmationURL = await waitForDeliveredConfirmationURL(fixture.inviteEmail, redirectTo, messageIds);
        response.writeHead(302, { location: confirmationURL, 'cache-control': 'no-store' }).end();
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/admin/recovery') {
        const redirectTo = `${PREVIEW_ORIGIN}/admin/recovery/callback`;
        const recovery = await service.auth.resetPasswordForEmail(fixture.recoveryEmail, { redirectTo });
        if (recovery.error) { response.writeHead(503).end(); return; }
        const confirmationURL = await waitForDeliveredConfirmationURL(fixture.recoveryEmail, redirectTo, messageIds);
        response.writeHead(302, { location: confirmationURL, 'cache-control': 'no-store' }).end();
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(503).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('fixture bridge did not bind to loopback')); return; }
      activeServers.add(server);
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const abortHandler = () => {
    abortRequested = true;
    for (const child of activeChildren) {
      try { child.kill('SIGTERM'); } catch { /* child may already be gone */ }
    }
    for (const server of activeServers) server.closeAllConnections?.();
  };
  process.on('SIGINT', abortHandler);
  process.on('SIGTERM', abortHandler);
  assertPreflightSafety();
  if (args.has('--list')) {
    await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.auth.config.ts', '--list', '--reporter=list'], { env: childEnvironment(null), inheritOutput: true });
    return;
  }
  if (args.has('--compile-only')) {
    await runChild('npm', ['run', 'build'], { env: childEnvironment(null), inheritOutput: true });
    return;
  }

  const status = readLocalStatus();
  await waitForMailpit();
  const buildEnv = childEnvironment(status);
  await runChild('npm', ['run', 'build'], { env: buildEnv });
  const messageIds = new Set();
  const seeded = await seedFixtures(status);
  const lifecycle = await runAuthFixtureLifecycle({
    seeded,
    messageIds,
    trackFixtureMessages: (fixture, ids) => trackFixtureMessages(fixture, ids),
    startFixtureBridge: (currentSeeded, ids) => startFixtureBridge(currentSeeded.fixture, ids, currentSeeded.service, currentSeeded.admin),
    spawnPreview: () => ({ preview: spawnPreview(buildEnv), enrollmentFunction: spawnEnrollmentFunction(buildEnv) }),
    waitForPreview: async (_currentSeeded, _currentBridge, runtime) => {
      await waitForHttp(PREVIEW_ORIGIN, '/login', 'Vite preview');
      if (!runtime?.enrollmentFunction) fail('local enrollment function was not started.');
      await waitForEnrollmentFunction(runtime);
    },
    runTests: async (currentSeeded, currentBridge) => {
      const testEnv = childEnvironment(status, {
        PHANTOMS_AUTH_ADMIN_EMAIL: currentSeeded.fixture.adminEmail,
        PHANTOMS_AUTH_ADMIN_PASSWORD: currentSeeded.fixture.password,
        PHANTOMS_AUTH_EXISTING_MEMBER_EMAIL: currentSeeded.fixture.existingMemberEmail,
        PHANTOMS_AUTH_EXISTING_MEMBER_ID: String(currentSeeded.fixture.existingMemberId),
        PHANTOMS_AUTH_EXISTING_MEMBER_AUTH_USER_ID: currentSeeded.fixture.existingMemberAuthUserId,
        PHANTOMS_AUTH_FIRST_TIME_MEMBER_EMAIL: currentSeeded.fixture.firstTimeMemberEmail,
        PHANTOMS_AUTH_FIRST_TIME_MEMBER_ID: String(currentSeeded.fixture.firstTimeMemberId),
        PHANTOMS_AUTH_JOIN_MEMBER_EMAIL: currentSeeded.fixture.joinMemberEmail,
        PHANTOMS_AUTH_JOIN_INVITE_NOTE: currentSeeded.fixture.joinInvitationNote,
        PHANTOMS_AUTH_OUTSIDER_EMAIL: currentSeeded.fixture.outsiderEmail,
        PHANTOMS_LOCAL_FIXTURE_BRIDGE_URL: currentBridge.origin,
        PHANTOMS_LOCAL_MAILPIT_PORT: String(MAILPIT_PORT),
      });
      await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.auth.config.ts'], { env: testEnv, inheritOutput: true });
    },
    stopPreview: async (runtime) => {
      const shutdownErrors = [];
      try { await stopProcess(runtime?.enrollmentFunction, 'disposable enrollment function'); } catch (error) { shutdownErrors.push(error); }
      try { await stopNativeEnrollmentDaemon(runtime); } catch (error) { shutdownErrors.push(error); }
      try { await stopProcess(runtime?.preview, 'disposable preview'); } catch (error) { shutdownErrors.push(error); }
      for (const directory of ownedRuntimeDirectories) {
        try { rmSync(directory, { recursive: true, force: true }); } catch (error) { shutdownErrors.push(error); }
      }
      ownedRuntimeDirectories.clear();
      if (shutdownErrors.length) throw shutdownErrors[0];
    },
    closeBridge: async (currentBridge) => {
      if (currentBridge) {
        await closeHttpServer(currentBridge.server, 'fixture bridge');
        activeServers.delete(currentBridge.server);
      }
    },
    cleanupFixtures,
    finalizeEvidence: (cleanupStatus) => {
      const finalized = finalizeAuthEvidence(AUTH_EVIDENCE_PATH, cleanupStatus);
      if (!isCompleteAuthEvidence(finalized)) fail('Auth browser evidence is incomplete or fixture cleanup did not pass.');
    },
  });
  if (lifecycle.cleanupError) console.error('[auth-e2e] fixture cleanup failed; details withheld.');
  if (lifecycle.finalizationError) console.error('[auth-e2e] evidence finalization failed; details withheld.');
  if (lifecycle.primaryError) throw lifecycle.primaryError;
  if (lifecycle.shutdownError) throw lifecycle.shutdownError;
  if (lifecycle.cleanupError) throw lifecycle.cleanupError;
  if (lifecycle.finalizationError) throw lifecycle.finalizationError;
  process.off('SIGINT', abortHandler);
  process.off('SIGTERM', abortHandler);
  console.log(`[auth-e2e] completed; sanitized evidence written (cleanup=${lifecycle.cleanupStatus}, aborted=${abortRequested}).`);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
