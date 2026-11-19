#!/usr/bin/env node
/**
 * Disposable local dashboard E2E.
 *
 * The service key is read only from `supabase status --workdir backend -o env`,
 * held in memory for fixture setup/cleanup, and is never placed in a file,
 * browser context, child-process environment, or log. This runner refuses all
 * linked/remote targets before doing any write.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { localStatusArgs, localRuntimeWorkdir } from './local-stack-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const BACKEND = path.join(ROOT, 'backend');
function localPort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('Invalid disposable loopback port.');
  return Number(value);
}
const API_ORIGIN = `http://127.0.0.1:${localPort('PHANTOMS_LOCAL_API_PORT', 54321)}`;
const DB_PORT = localPort('PHANTOMS_LOCAL_DB_PORT', 54322);
const PREVIEW_PORT = localPort('PHANTOMS_LOCAL_PREVIEW_PORT', 4173);
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const ENV_LOCAL = path.join(FRONTEND, '.env.local');
const PROJECT_REF_FILE = path.join(BACKEND, 'supabase', '.temp', 'project-ref');
const SAFE_DOMAIN = 'phantoms-test.example';
const PASSWORD = 'Disposable-Local-E2E-2026!';
const MEMBER_ONE_EMAIL = `dashboard-member-one@${SAFE_DOMAIN}`;
const MEMBER_TWO_EMAIL = `dashboard-member-two@${SAFE_DOMAIN}`;
const OWNER_EMAIL = `dashboard-owner@${SAFE_DOMAIN}`;
const OUTSIDER_EMAIL = `dashboard-outsider@${SAFE_DOMAIN}`;
const CUSTOM_FIELD_LABEL = 'Disposable dashboard custom field';
const INVITE_NOTE = 'Disposable dashboard invite';
const TASK_TITLE = 'Disposable local dashboard task';
const UI_SPECIFIC_TASK_TITLE = 'Disposable UI selected member task';
const UI_ALL_TASK_TITLE = 'Disposable UI all members task';
const UI_RESTORED_TASK_TITLE = 'Disposable UI restored task';
const NOTE_TEXT = 'Disposable local dashboard note [B:+12]';
const FORBIDDEN_ENV_NAMES = [
  'SUPABASE_ACCESS_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'SUPABASE_JWT_SECRET', 'ANON_KEY', 'POSTGRES_URL', 'DIRECT_URL',
  'SB_SECRET_KEY', 'SB_ACCESS_TOKEN',
  'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
];
const PRIVATE_VALUES = new Set();

function fail(message) {
  throw new Error(`[dashboard-e2e] ${message}`);
}

function redact(message) {
  let safe = String(message)
    .replaceAll(PASSWORD, '[redacted]')
    .replaceAll(/(?:service[_-]?role|access|secret)[_-]?key\s*[=:]\s*[^\s,;]+/gi, '[redacted-secret]')
    .replaceAll(/\b(?:eyJ[a-zA-Z0-9_-]{20,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]{12,}|sbp_[a-zA-Z0-9_-]{12,})\b/g, '[redacted-token]');
  for (const value of PRIVATE_VALUES) {
    if (value) safe = safe.replaceAll(value, '[redacted-secret]');
  }
  return safe;
}

function assertPreflightSafety() {
  if (process.env.CI !== 'true' && process.env.PHANTOMS_DISPOSABLE_E2E !== '1') {
    fail('refusing to run outside CI=true or PHANTOMS_DISPOSABLE_E2E=1.');
  }
  if (existsSync(ENV_LOCAL)) fail('refusing to run while frontend/.env.local exists; use CI checkout env only.');
  if (existsSync(PROJECT_REF_FILE)) fail('refusing to run while backend/supabase/.temp/project-ref exists.');
  localRuntimeWorkdir(BACKEND);
  for (const name of FORBIDDEN_ENV_NAMES) {
    if (process.env[name]) fail(`refusing to run with forbidden production credential variable ${name}.`);
  }
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL !== API_ORIGIN) {
    fail('refusing to run with a non-local VITE_SUPABASE_URL.');
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== API_ORIGIN) {
    fail('refusing to run with a non-local SUPABASE_URL.');
  }
}

function parseEnvOutput(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replaceAll('\\"', '"');
  }
  return values;
}

function readLocalStatus() {
  let raw;
  try {
    raw = execFileSync('supabase', localStatusArgs(BACKEND), {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    fail('could not read local Supabase status; no database write was attempted.');
  }
  const values = parseEnvOutput(raw);
  const api = values.API_URL || values.SUPABASE_URL;
  const db = values.DB_URL || values.DATABASE_URL;
  const anonKey = values.ANON_KEY || values.SUPABASE_ANON_KEY;
  const serviceKey = values.SERVICE_ROLE_KEY || values.SUPABASE_SERVICE_ROLE_KEY;
  if (api !== API_ORIGIN) fail('Supabase status did not report the selected exact loopback API.');
  if (!db || !anonKey || !serviceKey) fail('local Supabase status omitted required local API credentials.');
  let dbUrl;
  try { dbUrl = new URL(db); } catch { fail('local Supabase status returned an invalid DB_URL.'); }
  if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== String(DB_PORT)) {
    fail('refusing a database target other than the selected exact loopback database port.');
  }
  PRIVATE_VALUES.add(anonKey);
  PRIVATE_VALUES.add(serviceKey);
  PRIVATE_VALUES.add(values.JWT_SECRET || '');
  return { api, db, anonKey, serviceKey };
}

function childEnvironment(status, extra = {}) {
  const env = { ...process.env };
  for (const name of FORBIDDEN_ENV_NAMES) delete env[name];
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.SUPABASE_SERVICE_KEY;
  delete env.SUPABASE_SECRET_KEY;
  delete env.SERVICE_ROLE_KEY;
  delete env.JWT_SECRET;
  delete env.SUPABASE_JWT_SECRET;
  delete env.ANON_KEY;
  delete env.SB_SECRET_KEY;
  delete env.SB_ACCESS_TOKEN;
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
      stdio: options.inheritOutput === false ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`));
    });
  });
}

async function waitForPreview(preview) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${PREVIEW_ORIGIN}/admin/login`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  preview.kill('SIGTERM');
  fail('Vite preview did not become ready on loopback.');
}

function spawnPreview(env) {
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  return preview;
}

async function stopPreview(preview) {
  if (!preview || preview.exitCode !== null || preview.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const forceTimer = setTimeout(() => preview.kill('SIGKILL'), 5_000);
    const deadline = setTimeout(() => {
      clearTimeout(forceTimer);
      reject(new Error('Disposable preview did not exit within the bounded shutdown period.'));
    }, 10_000);
    preview.once('exit', () => {
      clearTimeout(forceTimer);
      clearTimeout(deadline);
      resolve();
    });
    preview.kill('SIGTERM');
  });
}

function cleanupContributionFixtures(status, taskIds, memberIds) {
  if (!status?.db) fail('local DB status is required for exact ledger fixture cleanup.');
  const target = new URL(status.db);
  if (target.hostname !== '127.0.0.1' || target.port !== String(DB_PORT)) fail('ledger cleanup refuses a non-owned loopback database.');
  if (![...taskIds, ...memberIds].every((id) => Number.isSafeInteger(id) && id > 0)) fail('ledger cleanup requires exact positive numeric fixture IDs.');
  const scope = taskIds.length && memberIds.length
    ? `task_id IN (${taskIds.join(',')}) AND member_id IN (${memberIds.join(',')})`
    : 'FALSE';
  const sql = `BEGIN;
    ALTER TABLE public.task_contribution_events DISABLE TRIGGER task_contribution_events_append_only;
    DELETE FROM public.task_contribution_events WHERE ${scope};
    ALTER TABLE public.task_contribution_events ENABLE TRIGGER task_contribution_events_append_only;
    SELECT (SELECT count(*) FROM public.task_contribution_events WHERE ${scope})::text || '|' ||
      (SELECT (tgenabled = 'O')::text FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.task_contribution_events'::regclass AND tgname = 'task_contribution_events_append_only' LIMIT 1);
    COMMIT;`;
  let output;
  try {
    output = execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT,
      env: childEnvironment(null, { PGHOST: target.hostname, PGPORT: target.port, PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: target.pathname.slice(1), PGCONNECT_TIMEOUT: '8' }),
    }).trim();
  } catch { fail('exact-owned ledger fixture cleanup failed; details withheld.'); }
  if (output !== '0|true') fail('ledger cleanup could not prove zero residue and append-only trigger restoration.');
  return 0;
}

async function cleanupFixtures(service, admin, createdUserIds = [], evidenceMode = null, status = null, knownFixtures = { memberIds: [], taskIds: [] }) {
  const failures = [];
  const memberEmails = [MEMBER_ONE_EMAIL, MEMBER_TWO_EMAIL];
  const taskTitles = [TASK_TITLE, UI_SPECIFIC_TASK_TITLE, UI_ALL_TASK_TITLE, UI_RESTORED_TASK_TITLE];
  const authIds = new Set(createdUserIds);
  const safeErrorCode = (error) => typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'operation-failed';
  const attempt = async (label, operation) => {
    try {
      const result = await operation();
      if (result?.error) failures.push(`${label}:${safeErrorCode(result.error)}`);
      return result;
    } catch (error) {
      failures.push(`${label}:${safeErrorCode(error)}`);
      return null;
    }
  };
  const rows = async (label, query) => {
    const result = await attempt(label, query);
    return result && !result.error && Array.isArray(result.data) ? result.data : null;
  };
  const memberRows = await rows('member inventory', () => service.from('members').select('id').in('email', memberEmails).limit(10));
  const memberIds = [...new Set([...(memberRows ?? []).map((row) => row.id), ...knownFixtures.memberIds])];
  const taskRows = await rows('task inventory', () => service.from('tasks').select('id').in('title', taskTitles).limit(10));
  const taskIds = [...new Set([...(taskRows ?? []).map((row) => row.id), ...knownFixtures.taskIds])];
  const ledgerResult = await attempt('contribution ledger cleanup', async () => ({ data: cleanupContributionFixtures(status, taskIds, memberIds), error: null }));
  const contributionEvents = ledgerResult?.data === 0 ? 0 : null;
  const listOwnedUsers = async (label) => {
    const matching = new Map();
    let complete = false;
    for (let page = 1; page <= 20; page += 1) {
      const result = await attempt(`${label} page`, () => admin.listUsers({ page, perPage: 100 }));
      if (!result || result.error || !Array.isArray(result.data?.users)) return null;
      for (const user of result.data.users) {
        if (createdUserIds.includes(user.id) || [OWNER_EMAIL, OUTSIDER_EMAIL].includes(user.email ?? '')) matching.set(user.id, user);
      }
      if (result.data.users.length < 100) { complete = true; break; }
    }
    if (!complete) {
      failures.push(`${label}:pagination-guard`);
      return null;
    }
    return [...matching.values()];
  };
  const initialUsers = await listOwnedUsers('auth user inventory');
  for (const user of initialUsers ?? []) authIds.add(user.id);
  await attempt('invite cleanup', () => service.from('member_registration_invites').delete().eq('note', INVITE_NOTE));
  await attempt('custom field cleanup', () => service.from('member_custom_fields').delete().eq('label', CUSTOM_FIELD_LABEL));
  await attempt('target note cleanup', () => service.from('notes').delete().eq('text', NOTE_TEXT));
  await attempt('general note cleanup', () => service.from('notes').delete().eq('text', 'Disposable local dashboard general note'));
  await attempt('approval source note cleanup', async () => {
    return taskIds.length ? service.from('notes').delete().in('source_task_id', taskIds) : { error: null };
  });
  await attempt('task cleanup', () => service.from('tasks').delete().in('title', taskTitles));
  if (authIds.size) await attempt('admin account cleanup', () => service.from('admin_accounts').delete().in('user_id', [...authIds]));
  if (memberIds.length) await attempt('member binding cleanup', () => service.from('member_auth_bindings').delete().in('member_id', memberIds));
  await attempt('member cleanup', () => service.from('members').delete().in('email', memberEmails));
  for (const id of authIds) await attempt('auth user cleanup', () => admin.deleteUser(id));

  const countRows = async (label, query) => {
    const result = await rows(label, query);
    return result === null ? null : result.length;
  };
  const remainingAuthUsers = await listOwnedUsers('auth cleanup verification');
  const [adminAccounts, members, bindings, tasks, notesByText, notesByTask, customFields, invites] = await Promise.all([
    countRows('admin account verification', () => authIds.size ? service.from('admin_accounts').select('user_id').in('user_id', [...authIds]).limit(100) : { data: [], error: null }),
    countRows('member verification', () => service.from('members').select('id').in('email', memberEmails).limit(10)),
    countRows('binding verification', () => memberIds.length ? service.from('member_auth_bindings').select('member_id').in('member_id', memberIds).limit(20) : { data: [], error: null }),
    countRows('task verification', () => service.from('tasks').select('id').in('title', taskTitles).limit(20)),
    rows('note text verification', () => service.from('notes').select('id').in('text', [NOTE_TEXT, 'Disposable local dashboard general note']).limit(20)),
    rows('note source verification', () => taskIds.length ? service.from('notes').select('id').in('source_task_id', taskIds).limit(20) : { data: [], error: null }),
    countRows('custom field verification', () => service.from('member_custom_fields').select('id').eq('label', CUSTOM_FIELD_LABEL).limit(10)),
    countRows('invite verification', () => service.from('member_registration_invites').select('id').eq('note', INVITE_NOTE).limit(10)),
  ]);
  const noteIds = new Set([...(notesByText ?? []), ...(notesByTask ?? [])].map((row) => row.id));
  const remaining = {
    authUsers: remainingAuthUsers === null ? null : remainingAuthUsers.length,
    adminAccounts,
    members,
    memberBindings: bindings,
    tasks,
    notes: notesByText === null || notesByTask === null ? null : noteIds.size,
    customFields,
    legacyInvites: invites,
    contributionEvents,
  };
  const passed = failures.length === 0 && Object.values(remaining).every((count) => count === 0);
  const cleanupEvidence = { schema: 'phantoms-dashboard-fixture-cleanup/v2', vapidMode: evidenceMode, passed, remaining };
  if (evidenceMode === 'missing' || evidenceMode === 'invalid') {
    const evidenceDir = path.join(FRONTEND, 'test-results');
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(evidenceDir, `dashboard-fixture-cleanup-${evidenceMode}.json`), `${JSON.stringify(cleanupEvidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  if (!passed) fail('fixture cleanup could not verify that all exact-owned dashboard records were removed');
  return cleanupEvidence;
}

async function seedFixtures(status, evidenceMode) {
  const service = createClient(status.api, status.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = service.auth.admin;
  const createdUserIds = [];
  const knownFixtures = { memberIds: [], taskIds: [] };
  try {
    await cleanupFixtures(service, admin, [], null, status);
  const inviteToken = `disposable-dashboard-${randomBytes(24).toString('hex')}`;
  const inviteHash = createHash('sha256').update(inviteToken).digest('hex');

  const ownerResult = await admin.createUser({ email: OWNER_EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: 'Disposable Dashboard Owner' } });
  if (ownerResult.error || !ownerResult.data.user) fail('could not create the reserved-domain local owner.');
  createdUserIds.push(ownerResult.data.user.id);
  const outsiderResult = await admin.createUser({ email: OUTSIDER_EMAIL, password: PASSWORD, email_confirm: true });
  if (outsiderResult.error || !outsiderResult.data.user) fail('could not create the reserved-domain local outsider.');
  createdUserIds.push(outsiderResult.data.user.id);
  const ownerId = ownerResult.data.user.id;

  const permissions = { dashboard: true, members: true, tasks: true, ranking: true, notes: true, announcements: true, whatsapp: true, ai_assistant: true };
  const adminInsert = await service.from('admin_accounts').upsert({ user_id: ownerId, role: 'owner', permissions }, { onConflict: 'user_id' });
  if (adminInsert.error) fail('could not provision the disposable owner access row.');

  const memberInsert = await service.from('members').insert([
    { email: MEMBER_ONE_EMAIL, full_name: 'Disposable member one', completion_rank: 88, team_notes: 'Projection verification', residence: 'Alexandria', work_conditions: 'remote', bio: 'Projection verification', phone: '+201000000001', device: 'لابتوب', gender: 'female', meeting_attendance: 'present', work_status: 'active', can_go_alexandria: true, custom_fields: {} },
    { email: MEMBER_TWO_EMAIL, full_name: 'Disposable member two', completion_rank: 47, team_notes: 'Second reserved fixture', residence: 'Cairo', work_conditions: 'onsite', bio: 'Second reserved fixture', phone: '+201000000002', device: 'كمبيوتر', gender: 'male', meeting_attendance: 'regular', work_status: 'active', can_go_alexandria: false, custom_fields: {} },
  ]).select('id,email,full_name');
  if (memberInsert.error || !memberInsert.data || memberInsert.data.length !== 2) fail('could not seed the two disposable members.');
  knownFixtures.memberIds.push(...memberInsert.data.map((member) => member.id));
  const first = memberInsert.data.find((member) => member.email === MEMBER_ONE_EMAIL);
  const second = memberInsert.data.find((member) => member.email === MEMBER_TWO_EMAIL);
  if (!first || !second) fail('disposable member ids were not returned.');

  const taskInsert = await service.from('tasks').insert({
    title: TASK_TITLE,
    description: 'Projection verification task for local dashboard.',
    has_deadline: true,
    deadline_date: '2026-01-01',
    assigned_to: [String(first.id), String(second.id)],
    tracking: {
      [first.id]: { status: 'under_review', note: 'Disposable review', submission_url: 'https://example.test/disposable', updated_at: new Date().toISOString() },
      [second.id]: { status: 'in_progress', note: 'Disposable progress', submission_url: '', updated_at: new Date().toISOString() },
    },
    bonus_points: 4,
  }).select('id,title').single();
  if (taskInsert.error) fail('could not seed the disposable task.');
  knownFixtures.taskIds.push(taskInsert.data.id);

  const noteInsert = await service.from('notes').insert([
    { text: NOTE_TEXT, author: 'Disposable owner', author_role: 'Admin', date: '2026-01-01', target_member_id: first.id, target_name: 'Disposable member one', source_task_id: taskInsert.data?.id ?? null, source_member_id: first.id },
    { text: 'Disposable local dashboard general note', author: 'Disposable owner', author_role: 'Admin', date: '2026-01-01', target_member_id: null, target_name: null },
  ]).select('id');
  if (noteInsert.error || !noteInsert.data || noteInsert.data.length !== 2) fail('could not seed the disposable notes.');

  const fieldInsert = await service.from('member_custom_fields').insert({ label: CUSTOM_FIELD_LABEL, field_type: 'short_text', options: [], placeholder: 'fixture', show_in_card: true, is_required: false, is_active: true, sort_order: 999, created_by: ownerId }).select('id').single();
  if (fieldInsert.error) fail('could not seed the disposable custom field.');
  const inviteInsert = await service.from('member_registration_invites').insert({ token_hash: inviteHash, note: INVITE_NOTE, expires_at: '2099-12-31T00:00:00Z', created_by: ownerId }).select('id').single();
  if (inviteInsert.error) fail('could not seed the disposable invite row.');

    return { cleanup: () => cleanupFixtures(service, admin, createdUserIds, evidenceMode, status, knownFixtures) };
  } catch (error) {
    try {
      await cleanupFixtures(service, admin, createdUserIds, null, status, knownFixtures);
    } catch (cleanupError) {
      fail(`fixture setup and cleanup failed: ${redact(cleanupError instanceof Error ? cleanupError.message : cleanupError)}`);
    }
    fail(`fixture setup failed; scoped cleanup completed: ${redact(error instanceof Error ? error.message : error)}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  assertPreflightSafety();
  if (args.has('--list')) {
    await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.dashboard.config.ts', '--list'], { env: childEnvironment(null) });
    return;
  }
  if (args.has('--compile-only')) {
    await runChild('npm', ['run', 'build'], { env: childEnvironment(null) });
    return;
  }
  const status = readLocalStatus();
  const vapidVariants = [
    { name: 'missing', key: '' },
    { name: 'invalid', key: 'invalid-vapid-public-key' },
  ];
  for (const variant of vapidVariants) {
    const buildEnv = childEnvironment(status, { VITE_VAPID_PUBLIC_KEY: variant.key });
    console.log(`[dashboard-e2e] building frontend with ${variant.name} VAPID readiness…`);
    await runChild('npm', ['run', 'build'], { env: buildEnv });
    const fixtures = await seedFixtures(status, variant.name);
    let preview;
    try {
      preview = spawnPreview(buildEnv);
      await waitForPreview(preview);
      const testEnv = childEnvironment(status, {
        PHANTOMS_VAPID_MODE: variant.name,
        PHANTOMS_DASHBOARD_OWNER_EMAIL: OWNER_EMAIL,
        PHANTOMS_DASHBOARD_OWNER_PASSWORD: PASSWORD,
        PHANTOMS_DASHBOARD_OUTSIDER_EMAIL: OUTSIDER_EMAIL,
        PHANTOMS_DASHBOARD_OUTSIDER_PASSWORD: PASSWORD,
        PHANTOMS_DASHBOARD_MEMBER_ONE_EMAIL: MEMBER_ONE_EMAIL,
        PHANTOMS_DASHBOARD_MEMBER_TWO_EMAIL: MEMBER_TWO_EMAIL,
      });
      console.log(`[dashboard-e2e] running local Chromium dashboard checks (${variant.name} VAPID)…`);
      await runChild(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.dashboard.config.ts', `--output=test-results/dashboard-${variant.name}-artifacts`], { env: testEnv });
    } finally {
      try {
        await stopPreview(preview);
      } finally {
        await fixtures.cleanup();
      }
    }
  }
  console.log('[dashboard-e2e] completed; only sanitized dashboard PNG/JSON evidence remains.');
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
