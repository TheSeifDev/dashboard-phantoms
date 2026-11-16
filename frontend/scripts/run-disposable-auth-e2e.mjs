#!/usr/bin/env node
/**
 * Disposable local Auth E2E.
 *
 * The service key is read from local `supabase status`, retained only in this
 * process, and never passed to a child, browser, file, fixture bridge, or log.
 * The bridge exposes only reserved fixture OTPs and one-use-in-practice local
 * Auth action-link redirects over loopback. No storage state, screenshots,
 * traces, videos, OTPs, passwords, tokens, or session data are persisted.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  closeHttpServer,
  finalizeAuthEvidence,
  isExactLoopbackHttpOrigin,
  isExactLoopbackPostgresUrl,
} from './auth-e2e-helpers.mjs';

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
const AUTH_EVIDENCE_PATH = path.join(FRONTEND, 'test-results', 'auth-evidence.json');
const MAX_AUTH_USER_PAGES = 20;
const AUTH_USER_PAGE_SIZE = 100;
const CLEANUP_OPERATION_TIMEOUT_MS = 10_000;
const ENV_LOCAL = path.join(FRONTEND, '.env.local');
const PROJECT_REF_FILE = path.join(BACKEND, 'supabase', '.temp', 'project-ref');
const SAFE_DOMAIN = 'phantoms-test.example';
const PASSWORD = 'Disposable-Auth-Local-2026!';
const ADMIN_PERMISSIONS = { dashboard: true, members: true, tasks: true, ranking: true, notes: true, announcements: true, whatsapp: true, ai_assistant: true };
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
let abortRequested = false;

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
    raw = execFileSync('supabase', ['status', '--workdir', BACKEND, '-o', 'env'], {
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
  if (!isExactLoopbackPostgresUrl(db, DB_PORT)) {
    fail('refusing a database target other than the selected loopback database.');
  }
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
      stdio: options.inheritOutput ? ['ignore', 'inherit', 'ignore'] : ['ignore', 'ignore', 'ignore'],
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

function spawnPreview(env) {
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: FRONTEND, env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  activeChildren.add(preview);
  preview.once('exit', () => activeChildren.delete(preview));
  return preview;
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

function extractOtp(message) {
  const body = `${message.Text ?? ''}\n${message.HTML ?? ''}`.replaceAll('&nbsp;', ' ');
  const labelled = body.match(/(?:code|رمز)[^\d]{0,80}(\d{8})/i)?.[1];
  if (labelled) return labelled;
  return body.match(/(?<!\d)\d{8}(?!\d)/)?.[0] ?? null;
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
  const fixtureEmails = new Set([
    fixture.adminEmail,
    fixture.existingMemberEmail,
    fixture.firstTimeMemberEmail,
    fixture.outsiderEmail,
    fixture.inviteEmail,
    fixture.recoveryEmail,
  ]);
  for (const message of Array.isArray(listing.messages) ? listing.messages : []) {
    if (message.ID && [...fixtureEmails].some((email) => recipientMatches(message, email))) messageIds.add(message.ID);
  }
}

async function discoverFixtureUserIds(admin, fixture) {
  const fixtureEmails = new Set([
    fixture.adminEmail,
    fixture.existingMemberEmail,
    fixture.firstTimeMemberEmail,
    fixture.outsiderEmail,
    fixture.inviteEmail,
    fixture.recoveryEmail,
  ].map((email) => email.toLowerCase()));
  const ids = new Set();
  for (let page = 1; page <= MAX_AUTH_USER_PAGES; page += 1) {
    const listed = await Promise.race([
      admin.listUsers({ page, perPage: AUTH_USER_PAGE_SIZE }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('fixture Auth listing timed out')), CLEANUP_OPERATION_TIMEOUT_MS)),
    ]);
    if (listed?.error) throw new Error('fixture Auth listing failed');
    const users = Array.isArray(listed?.data?.users) ? listed.data.users : [];
    for (const user of users) {
      if (user.id && typeof user.email === 'string' && fixtureEmails.has(user.email.toLowerCase())) ids.add(user.id);
    }
    if (users.length < AUTH_USER_PAGE_SIZE) return ids;
  }
  throw new Error('fixture Auth listing exceeded its bounded pagination limit');
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
  if (fixture.memberIds.length) await attempt(() => service.from('members').delete().in('id', fixture.memberIds));
  if (fixture.adminUserIds.length) await attempt(() => service.from('admin_accounts').delete().in('user_id', fixture.adminUserIds));
  let discoveredUserIds = new Set();
  try {
    discoveredUserIds = await discoverFixtureUserIds(admin, fixture);
  } catch {
    failures.push('fixture Auth listing failed');
  }
  const exactFixtureUserIds = new Set([...fixture.createdUserIds, ...discoveredUserIds]);
  for (const userId of exactFixtureUserIds) await attempt(() => admin.deleteUser(userId));
  for (const messageId of messageIds) {
    try {
      const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok && response.status !== 404) failures.push('local mail cleanup failed');
    } catch {
      failures.push('local mail cleanup failed');
    }
  }
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
    existingMemberEmail: null,
    firstTimeMemberEmail: email('first-time-member'),
    outsiderEmail: email('outsider'),
    inviteEmail: email('invite'),
    recoveryEmail: email('recovery'),
    password: PASSWORD,
    createdUserIds: [],
    adminUserIds: [],
    memberIds: [],
  };
  fixture.existingMemberEmail = fixture.adminEmail;
  const createUser = async (userEmail, options = {}) => {
    const result = await admin.createUser({ email: userEmail, password: PASSWORD, email_confirm: options.email_confirm ?? true });
    if (result.error || !result.data.user) fail('could not seed a disposable Auth user.');
    fixture.createdUserIds.push(result.data.user.id);
    return result.data.user;
  };
  const addAdmin = async (userId) => {
    fixture.adminUserIds.push(userId);
    const result = await service.from('admin_accounts').insert({ user_id: userId, role: 'admin', permissions: ADMIN_PERMISSIONS });
    if (result.error) fail('could not seed disposable admin access.');
  };
  try {
    const adminUser = await createUser(fixture.adminEmail);
    await addAdmin(adminUser.id);
    await createUser(fixture.outsiderEmail);
    const recoveryUser = await createUser(fixture.recoveryEmail);
    await addAdmin(recoveryUser.id);

    const members = await service.from('members').insert([
      { email: fixture.existingMemberEmail, full_name: 'Disposable existing OTP member', completion_rank: 88, team_notes: 'Auth E2E', residence: 'Alexandria', work_conditions: 'remote', bio: 'Auth E2E existing member', phone: '+201000000101', device: 'لابتوب', gender: 'female', meeting_attendance: 'present', work_status: 'active', can_go_alexandria: true, custom_fields: {} },
      { email: fixture.firstTimeMemberEmail, full_name: 'Disposable first-time OTP member', completion_rank: 47, team_notes: 'Auth E2E', residence: 'Cairo', work_conditions: 'onsite', bio: 'Auth E2E first-time member', phone: '+201000000102', device: 'كمبيوتر', gender: 'male', meeting_attendance: 'regular', work_status: 'active', can_go_alexandria: false, custom_fields: {} },
    ]).select('id,email');
    if (members.error || !members.data || members.data.length !== 2) fail('could not seed disposable member rows.');
    fixture.memberIds.push(...members.data.map((row) => row.id));

    return { service, admin, fixture };
  } catch (error) {
    try {
      const listed = await admin.listUsers({ page: 1, perPage: 100 });
      const reserved = new Set([
        fixture.adminEmail,
        fixture.existingMemberEmail,
        fixture.firstTimeMemberEmail,
        fixture.outsiderEmail,
        fixture.recoveryEmail,
        fixture.inviteEmail,
      ]);
      for (const user of listed.data?.users ?? []) {
        if (user.email && reserved.has(user.email)) fixture.createdUserIds.push(user.id);
      }
      await cleanupFixtures(service, admin, fixture, new Set());
    } catch { /* preserve the original bounded failure */ }
    fail(`fixture setup failed; scoped cleanup was attempted (${redact(error instanceof Error ? error.message : error)}).`);
  }
}

function startFixtureBridge(fixture, messageIds, service, admin) {
  const consumedMessages = new Set();
  const allowedEmails = new Set([fixture.existingMemberEmail, fixture.firstTimeMemberEmail, fixture.outsiderEmail]);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/otp') {
        const requestedEmail = requestUrl.searchParams.get('email')?.toLowerCase() ?? '';
        if (!allowedEmails.has(requestedEmail)) { response.writeHead(404).end(); return; }
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const listing = await mailpitJson('/api/v1/messages?limit=100');
          const messages = Array.isArray(listing.messages) ? listing.messages : [];
          for (const message of [...messages].reverse()) {
            if (!message.ID || consumedMessages.has(message.ID) || !recipientMatches(message, requestedEmail)) continue;
            const detail = await mailpitJson(`/api/v1/message/${encodeURIComponent(message.ID)}`);
            const code = extractOtp(detail);
            if (!code) continue;
            consumedMessages.add(message.ID);
            messageIds.add(message.ID);
            response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ code }));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        response.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ready":false}');
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
      resolve({ server, origin: `http://127.0.0.1:${address.port}`, consumedMessages });
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
    await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.auth.config.ts', '--list'], { env: childEnvironment(null), inheritOutput: true });
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
  await trackFixtureMessages(seeded.fixture, messageIds);
  let bridge;
  let preview;
  let cleanupStatus = 'not-started';
  let shutdownFailure = null;
  try {
    bridge = await startFixtureBridge(seeded.fixture, messageIds, seeded.service, seeded.admin);
    preview = spawnPreview(buildEnv);
    await waitForHttp(PREVIEW_ORIGIN, '/login', 'Vite preview');
    const testEnv = childEnvironment(status, {
      PHANTOMS_AUTH_ADMIN_EMAIL: seeded.fixture.adminEmail,
      PHANTOMS_AUTH_ADMIN_PASSWORD: seeded.fixture.password,
      PHANTOMS_AUTH_EXISTING_MEMBER_EMAIL: seeded.fixture.existingMemberEmail,
      PHANTOMS_AUTH_FIRST_TIME_MEMBER_EMAIL: seeded.fixture.firstTimeMemberEmail,
      PHANTOMS_AUTH_OUTSIDER_EMAIL: seeded.fixture.outsiderEmail,
      PHANTOMS_LOCAL_FIXTURE_BRIDGE_URL: bridge.origin,
      PHANTOMS_LOCAL_MAILPIT_PORT: String(MAILPIT_PORT),
    });
    await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.auth.config.ts'], { env: testEnv, inheritOutput: true });
  } finally {
    try {
      await stopProcess(preview, 'disposable preview');
    } catch (error) {
      shutdownFailure = error;
    }
    try {
      if (bridge) {
        await closeHttpServer(bridge.server, 'fixture bridge');
        activeServers.delete(bridge.server);
      }
    } catch (error) {
      shutdownFailure ??= error;
    }
    try {
      await cleanupFixtures(seeded.service, seeded.admin, seeded.fixture, messageIds);
      cleanupStatus = 'passed';
    } catch (error) {
      cleanupStatus = 'failed';
      shutdownFailure ??= error;
    }
    finalizeAuthEvidence(AUTH_EVIDENCE_PATH, cleanupStatus);
  }
  if (shutdownFailure) throw shutdownFailure;
  process.off('SIGINT', abortHandler);
  process.off('SIGTERM', abortHandler);
  console.log(`[auth-e2e] completed; sanitized evidence written (cleanup=${cleanupStatus}, aborted=${abortRequested}).`);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
