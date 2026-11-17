import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  localStatusArgs,
  localRuntimeWorkdir,
  nativeRuntimeEnabled as nativeRuntimeSelected,
} from '../../frontend/scripts/local-stack-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../..');
const backend = resolve(scriptDir, '..');
const frontend = join(root, 'frontend');
const inventoryPath = join(scriptDir, 'member-password-inventory.sql');
const configPath = join(backend, 'supabase', 'config.toml');
const evidencePath = join(frontend, 'test-results', 'member-password-inventory-pagination-evidence.json');
const reportPath = join(frontend, 'test-results', 'member-password-inventory-pagination-report.md');
const pageLimit = 500;
const fixtureCount = 1002;
const fixtureDomain = 'phantoms-inventory.example';
const forbiddenEnvironment = [
  'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'DATABASE_URL', 'SUPABASE_DB_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY',
  'SERVICE_ROLE_KEY', 'JWT_SECRET', 'SUPABASE_JWT_SECRET', 'ANON_KEY',
  'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'POSTGRES_URL', 'DIRECT_URL',
  'SB_SECRET_KEY', 'SB_ACCESS_TOKEN', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
  'PGDATABASE',
];
const allowedChildEnvironment = [
  'PATH', 'HOME', 'LANG', 'CI', 'SUPABASE_EXPERIMENTAL_STACK',
  'PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR', 'SUPABASE_HOME',
  'PHANTOMS_LOCAL_API_PORT', 'PHANTOMS_LOCAL_DB_PORT', 'PHANTOMS_LOCAL_PREVIEW_PORT',
];
const inventorySql = readFileSync(inventoryPath, 'utf8');

function fail(message) {
  throw new Error(`[member-password-inventory] ${message}`);
}

function portFromConfigOrEnvironment(name, configured) {
  const selected = process.env[name] ?? String(configured);
  if (!/^\d{4,5}$/u.test(selected) || Number(selected) < 1024 || Number(selected) > 65535) {
    fail(`invalid loopback port selector ${name}`);
  }
  if (Number(selected) !== configured) fail(`${name} does not match the active config port`);
  return Number(selected);
}

function parseActiveConfig(raw) {
  let section = '';
  const values = { projectId: null, apiPort: null, dbPort: null, majorVersion: null };
  const seen = new Set();
  for (const sourceLine of raw.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^\[\]]+)\]\s*(?:#.*)?$/u);
    if (header) {
      section = header[1];
      continue;
    }
    let match = line.match(/^project_id\s*=\s*"([^"]+)"\s*(?:#.*)?$/u);
    if (match && section === '') {
      if (seen.has('projectId')) fail('active config repeats project_id');
      values.projectId = match[1]; seen.add('projectId'); continue;
    }
    match = line.match(/^port\s*=\s*(\d+)\s*(?:#.*)?$/u);
    if (match && (section === 'api' || section === 'db')) {
      const key = section === 'api' ? 'apiPort' : 'dbPort';
      if (seen.has(key)) fail(`active config repeats ${key}`);
      values[key] = Number(match[1]); seen.add(key); continue;
    }
    match = line.match(/^major_version\s*=\s*(\d+)\s*(?:#.*)?$/u);
    if (match && section === 'db') {
      if (seen.has('majorVersion')) fail('active config repeats db.major_version');
      values.majorVersion = Number(match[1]); seen.add('majorVersion');
    }
  }
  if (!values.projectId || !values.apiPort || !values.dbPort || !values.majorVersion) {
    fail('active config omitted project namespace, API/DB ports, or PostgreSQL major version');
  }
  return values;
}

function assertOwnedConfig(config, runtimeConfig = config) {
  if (!/^phantoms-(?:password-local|disposable-\d+)$/u.test(config.projectId)) {
    fail('active config project namespace is not an owned disposable namespace');
  }
  if (runtimeConfig.projectId !== config.projectId || runtimeConfig.apiPort !== config.apiPort
      || runtimeConfig.dbPort !== config.dbPort || runtimeConfig.majorVersion !== config.majorVersion) {
    fail('native runtime config differs from the selected backend config');
  }
  if (config.majorVersion !== 17) fail('active database config is not PostgreSQL 17');
}

function assertPreflightSafety() {
  if (process.env.CI !== 'true' && process.env.PHANTOMS_DISPOSABLE_E2E !== '1') {
    fail('refusing to run outside CI=true or PHANTOMS_DISPOSABLE_E2E=1');
  }
  if (existsSync(join(frontend, '.env.local'))) fail('frontend/.env.local is forbidden');
  for (const name of forbiddenEnvironment) {
    if (process.env[name]) fail(`forbidden credential or connection environment ${name}`);
  }
  const native = nativeRuntimeSelected();
  if (!native && process.env.DOCKER_HOST) fail('DOCKER_HOST is only allowed for explicit owned native mode');
  if (native) {
    if (!process.env.SUPABASE_HOME || !/^(?:\/|[A-Za-z]:[\\/])/u.test(process.env.SUPABASE_HOME)) {
      fail('native mode requires a provided absolute SUPABASE_HOME');
    }
    if (!existsSync(process.env.SUPABASE_HOME)) fail('native SUPABASE_HOME is not available');
    if (!process.env.DOCKER_HOST || !/^unix:\/\//u.test(process.env.DOCKER_HOST)) {
      fail('native mode requires an explicitly provided owned Docker host');
    }
  }
  let runtime;
  try {
    runtime = localRuntimeWorkdir(backend, process.env);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'owned runtime selection failed');
  }
  const projectRefPaths = [join(backend, 'supabase', '.temp', 'project-ref'), join(runtime, 'supabase', '.temp', 'project-ref')];
  if (projectRefPaths.some((path) => existsSync(path))) fail('linked project-ref is forbidden');
  const config = parseActiveConfig(readFileSync(configPath, 'utf8'));
  const runtimeConfigPath = join(runtime, 'supabase', 'config.toml');
  const runtimeConfig = runtime === backend ? config : parseActiveConfig(readFileSync(runtimeConfigPath, 'utf8'));
  assertOwnedConfig(config, runtimeConfig);
  const apiPort = portFromConfigOrEnvironment('PHANTOMS_LOCAL_API_PORT', config.apiPort);
  const dbPort = portFromConfigOrEnvironment('PHANTOMS_LOCAL_DB_PORT', config.dbPort);
  return { native, runtime, config, apiPort, dbPort };
}

function childEnvironment(extra = {}) {
  const env = {};
  for (const name of allowedChildEnvironment) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  if (nativeRuntimeSelected()) env.DOCKER_HOST = process.env.DOCKER_HOST;
  for (const [name, value] of Object.entries(extra)) env[name] = value;
  return env;
}

function parseStatusEnv(raw) {
  const values = {};
  for (const line of String(raw).split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replaceAll("'\\''", "'");
    }
    values[match[1]] = value;
  }
  return values;
}

function isExactApi(value, selectedPort) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
      && parsed.port === String(selectedPort) && !parsed.username && !parsed.password
      && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch { return false; }
}

function readLocalStatus(selection) {
  let raw;
  try {
    raw = spawnSync('supabase', localStatusArgs(backend, process.env), {
      cwd: root,
      env: childEnvironment(),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    fail('Supabase status could not be started');
  }
  if (raw.error || raw.status !== 0) fail('Supabase status failed for the selected owned local stack');
  const values = parseStatusEnv(raw.stdout);
  const api = values.API_URL || values.SUPABASE_URL || values.KONG_URL;
  const db = values.DB_URL || values.DATABASE_URL || values.POSTGRES_URL;
  if (!isExactApi(api, selection.apiPort)) fail('status API_URL is not the exact selected loopback endpoint');
  let dbUrl;
  try { dbUrl = new URL(db); } catch { fail('status DB_URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) || dbUrl.hostname !== '127.0.0.1'
      || dbUrl.port !== String(selection.dbPort) || !dbUrl.pathname || dbUrl.pathname === '/') {
    fail('status DB_URL is not the exact selected loopback database endpoint');
  }
  if (/supabase\.co|vercel\.app/iu.test(`${api ?? ''}${db ?? ''}`)) fail('hosted endpoint found in local status');
  const password = decodeURIComponent(dbUrl.password);
  return { api, db, dbUrl, password, projectId: selection.config.projectId };
}

function assertPsqlAvailable() {
  const result = spawnSync('psql', ['--version'], {
    env: childEnvironment(), stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000,
  });
  if (result.error || result.status !== 0) fail('Ubuntu psql client is required; no CLI installation is attempted');
}

function psql(status, args, sql = null) {
  const dbEnv = childEnvironment({
    PGHOST: status.dbUrl.hostname,
    PGPORT: status.dbUrl.port,
    PGUSER: decodeURIComponent(status.dbUrl.username),
    PGPASSWORD: status.password,
    PGDATABASE: status.dbUrl.pathname.slice(1),
  });
  const command = ['-X', '-qAt', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...args];
  let temporarySqlDirectory = null;
  let result;
  try {
    if (sql !== null && Buffer.byteLength(sql, 'utf8') <= 64 * 1024) {
      command.push('-c', sql);
    } else if (sql !== null) {
      temporarySqlDirectory = mkdtempSync(join(tmpdir(), 'phantoms-inventory-sql-'));
      chmodSync(temporarySqlDirectory, 0o700);
      const temporarySqlPath = join(temporarySqlDirectory, 'statement.sql');
      writeFileSync(temporarySqlPath, sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      command.push('-f', temporarySqlPath);
    }
    result = spawnSync('psql', command, {
      env: dbEnv,
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    if (temporarySqlDirectory) rmSync(temporarySqlDirectory, { recursive: true, force: true });
  }
  if (result.error || result.status !== 0) {
    const stderr = String(result.stderr ?? '').toLowerCase();
    const sqlState = stderr.match(/\berror:\s*([0-9a-z]{5})\b/u)?.[1]?.toUpperCase();
    const sqlStateClasses = {
      '08006': 'connection-failure', '22P02': 'invalid-input', '23502': 'not-null-violation',
      '23503': 'foreign-key-violation', '23505': 'unique-violation', '23514': 'check-violation',
      '25006': 'read-only-transaction', '42501': 'permission-denied', '42601': 'sql-syntax',
      '42703': 'undefined-column', '42P01': 'undefined-table', '42804': 'datatype-mismatch',
      'P0001': 'user-defined-database-error',
    };
    const failureClass = result.error?.code === 'ETIMEDOUT' ? 'timeout'
      : stderr.includes('connection refused') ? 'connection-refused'
        : stderr.includes('password authentication failed') ? 'authentication'
          : stderr.includes('does not exist') ? 'missing-schema-object'
              : stderr.includes('permission denied') ? 'permission-denied'
                : stderr.includes('syntax error') ? 'sql-syntax'
                  : stderr.includes('duplicate key') ? 'unique-violation'
                    : stderr.includes('foreign key') ? 'foreign-key-violation'
                      : stderr.includes('null value') ? 'not-null-violation'
                        : stderr.includes('check constraint') ? 'check-violation'
                          : stderr.includes('read-only transaction') ? 'read-only-transaction'
                              : stderr.includes('invalid input syntax') ? 'invalid-input'
                                : sqlStateClasses[sqlState] ?? (sqlState ? `postgres-${sqlState}`
                                  : result.error?.code ? `spawn-${result.error.code}`
                                    : result.signal ? `signal-${result.signal}`
                                      : stderr.length === 0 ? `exit-${result.status}-no-diagnostic` : `exit-${result.status}-sql-error`);
    fail(`owned local database operation failed: ${failureClass}`);
  }
  return result.stdout;
}

function scalar(status, sql) {
  const value = psql(status, [], sql).trim();
  if (!/^\d+$/u.test(value)) fail('database count query returned an unexpected shape');
  return Number(value);
}

function counts(status) {
  return {
    member: scalar(status, 'SELECT count(*) FROM public.members;'),
    auth: scalar(status, 'SELECT count(*) FROM auth.users;'),
    invitation: scalar(status, 'SELECT count(*) FROM public.member_password_invitations;'),
  };
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlQuote).join(', ')}]`;
}

function sqlUuidArray(values) {
  return `${sqlTextArray(values)}::uuid[]`;
}

function sqlBigintArray(values) {
  return values.length ? `ARRAY[${values.join(', ')}]::bigint[]` : 'ARRAY[]::bigint[]';
}

function deriveUuid(suffix, index) {
  const digest = createHash('sha256').update(`phantoms-member-inventory:${suffix}:${index}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function makeFixture(suffix) {
  const actorId = deriveUuid(suffix, 0);
  const authIds = Array.from({ length: fixtureCount }, (_, index) => deriveUuid(suffix, index + 1));
  const invitationIds = Array.from({ length: fixtureCount }, (_, index) => deriveUuid(suffix, index + 10_001));
  const authEmails = authIds.map((_, index) => `inventory-${suffix}-auth-${String(index + 1).padStart(4, '0')}@${fixtureDomain}`);
  const memberEmails = authEmails.map((email) => email.replace('-auth-', '-member-'));
  const actorEmail = `inventory-${suffix}-actor@${fixtureDomain}`;
  const allAuthIds = [actorId, ...authIds];
  const allAuthEmails = [actorEmail, ...authEmails];
  const tokenHashes = invitationIds.map((id) => createHash('sha256').update(`${suffix}:${id}:token`).digest('hex'));
  return {
    suffix, actorId, actorEmail, authIds, authEmails, allAuthIds, allAuthEmails,
    invitationIds, memberEmails, tokenHashes, memberIds: [],
  };
}

function fixtureSql(fixture) {
  const authValues = [
    `(${sqlQuote(fixture.actorId)}, ${sqlQuote(fixture.actorEmail)})`,
    ...fixture.authIds.map((id, index) => `(${sqlQuote(id)}, ${sqlQuote(fixture.authEmails[index])})`),
  ].join(',\n');
  const invitationValues = fixture.invitationIds.map((id, index) => (
    `(${sqlQuote(id)}, ${sqlQuote(fixture.tokenHashes[index])}, ${sqlQuote(fixture.memberEmails[index])})`
  )).join(',\n');
  return `BEGIN;
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       NULL, NULL, '{"providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES
${authValues}
) AS owned(id, email);
INSERT INTO public.members (email, full_name, completion_rank, work_status)
SELECT email, 'Inventory pagination fixture ' || n, 0, 'active'
FROM unnest(${sqlTextArray(fixture.memberEmails)}) WITH ORDINALITY AS owned(email, n);
INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id, u.id, lower(m.email), false
FROM public.members AS m
JOIN auth.users AS u ON u.email = replace(m.email, '-member-', '-auth-')
WHERE m.email = ANY(${sqlTextArray(fixture.memberEmails)});
INSERT INTO public.member_password_invitations (
  id, token_hash, member_id, normalized_email, purpose, expires_at, created_by, status
)
SELECT owned.id::uuid, owned.token_hash, m.id, lower(m.email), 'enroll', now() + interval '1 day', ${sqlQuote(fixture.actorId)}::uuid, 'pending'
FROM (VALUES
${invitationValues}
) AS owned(id, token_hash, email)
JOIN public.members AS m ON m.email = owned.email;
COMMIT;
SELECT id, email FROM public.members WHERE email = ANY(${sqlTextArray(fixture.memberEmails)}) ORDER BY email;`;
}

function parseRecordedMemberIds(output, fixture) {
  const rows = output.trim() === '' ? [] : output.trim().split('\n').map((line) => line.split('\t'));
  if (rows.length !== fixtureCount || rows.some((row) => row.length !== 2)) fail('fixture setup did not return exactly 1002 owned member IDs');
  const expected = new Set(fixture.memberEmails);
  const seen = new Set();
  const ids = [];
  for (const [idText, email] of rows) {
    if (!/^\d+$/u.test(idText) || !expected.has(email) || seen.has(email)) fail('fixture member ID record was not exact');
    seen.add(email); ids.push(Number(idText));
  }
  if (seen.size !== fixtureCount || new Set(ids).size !== fixtureCount) fail('fixture member IDs were not unique and complete');
  return ids;
}

function preflightCollisionSql(fixture) {
  return `SELECT
  (SELECT count(*) FROM auth.users WHERE id = ANY(${sqlUuidArray(fixture.allAuthIds)}) OR email = ANY(${sqlTextArray(fixture.allAuthEmails)}))
+ (SELECT count(*) FROM public.members WHERE email = ANY(${sqlTextArray(fixture.memberEmails)}))
+ (SELECT count(*) FROM public.member_password_invitations WHERE id = ANY(${sqlUuidArray(fixture.invitationIds)}) OR normalized_email = ANY(${sqlTextArray(fixture.memberEmails)}));`;
}

function cleanupSql(fixture) {
  const memberIds = sqlBigintArray(fixture.memberIds);
  const authIds = sqlUuidArray(fixture.allAuthIds);
  const invitationIds = sqlUuidArray(fixture.invitationIds);
  const memberEmails = sqlTextArray(fixture.memberEmails);
  const authEmails = sqlTextArray(fixture.allAuthEmails);
  return `BEGIN;
DELETE FROM public.member_password_audit
WHERE invitation_id = ANY(${invitationIds}) AND member_id = ANY(${memberIds});
DELETE FROM public.member_password_invitations
WHERE id = ANY(${invitationIds}) AND member_id = ANY(${memberIds})
  AND normalized_email = ANY(${memberEmails});
DELETE FROM public.member_auth_bindings
WHERE member_id = ANY(${memberIds}) AND auth_user_id = ANY(${authIds})
  AND normalized_email = ANY(${memberEmails});
DELETE FROM public.members
WHERE id = ANY(${memberIds}) AND email = ANY(${memberEmails});
DELETE FROM auth.users
WHERE id = ANY(${authIds}) AND email = ANY(${authEmails});
COMMIT;
SELECT
  (SELECT count(*) FROM public.members WHERE id = ANY(${memberIds}) AND email = ANY(${memberEmails}))
+ (SELECT count(*) FROM auth.users WHERE id = ANY(${authIds}) AND email = ANY(${authEmails}))
+ (SELECT count(*) FROM public.member_password_invitations WHERE id = ANY(${invitationIds}) AND member_id = ANY(${memberIds}) AND normalized_email = ANY(${memberEmails}));`;
}

function runInventory(status, operation, offset) {
  const args = [
    '-v', `current_operation=${operation}`,
    '-v', `member_limit=${pageLimit}`,
    '-v', `member_offset=${operation === 'member' ? offset : 0}`,
    '-v', `auth_limit=${pageLimit}`,
    '-v', `auth_offset=${operation === 'auth' ? offset : 0}`,
    '-v', `invitation_limit=${pageLimit}`,
    '-v', `invitation_offset=${operation === 'invitation' ? offset : 0}`,
    '-f', inventoryPath,
  ];
  const output = psql(status, args);
  const lines = output.trim() === '' ? [] : output.trim().split('\n');
  if (lines.length < 2) fail('inventory output omitted the metadata row');
  const metadata = lines[1].split('\t');
  if (metadata[1] !== 'on') fail('inventory transaction was not read-only');
  const limitColumn = operation === 'member' ? 5 : operation === 'auth' ? 7 : 9;
  if (metadata[limitColumn] !== String(pageLimit)) fail('inventory metadata did not preserve the bounded page limit');
  return lines.slice(2).map((line) => line.split('\t'));
}

function staticSafety() {
  const executable = inventorySql.replace(/--[^\n]*\n/gu, '\n').replace(/\/\*[\s\S]*?\*\//gu, '\n');
  return {
    readOnlyTransactions: /BEGIN;\s*SET TRANSACTION READ ONLY;/u.test(inventorySql),
    boundedLimits: (inventorySql.match(/LIMIT \(SELECT row_limit FROM params\)/gu) ?? []).length === 3,
    offsetsApplied: (inventorySql.match(/OFFSET \(SELECT row_offset FROM params\);/gu) ?? []).length === 3
      && !/OFFSET\s+0\s*;/iu.test(inventorySql),
    noDmlOrDdl: !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/iu.test(executable),
    secretBearingOutputExcluded: !/\b(?:AS\s+encrypted_password|AS\s+token_hash|\ba\.details\b|\bi\.token_hash\b|\bi\.note\b)\b/iu.test(inventorySql),
  };
}

function validateEvidence(evidence) {
  const keys = ['schema', 'runtime', 'fixtureRowsPerResult', 'operations', 'safety', 'cleanupStatus', 'passed'];
  if (Object.keys(evidence).length !== keys.length || keys.some((key) => !Object.hasOwn(evidence, key))
      || evidence.schema !== 'phantoms-member-password-inventory-pagination/v1') fail('evidence schema is outside the sanitized allowlist');
  if (!['native-disposable-postgresql-17', 'docker-disposable-postgresql-17'].includes(evidence.runtime)) fail('evidence runtime is outside the sanitized allowlist');
  if (!Number.isInteger(evidence.fixtureRowsPerResult)) fail('evidence numeric fields are not typed');
  if (!['not-started', 'failed', 'completed-exact-fixtures'].includes(evidence.cleanupStatus) || typeof evidence.passed !== 'boolean') fail('evidence status fields are not typed');
  for (const operation of ['member', 'auth', 'invitation']) {
    const value = evidence.operations[operation];
    if (!value || Object.keys(value).some((key) => !new Set(['limit', 'offsets', 'pageCounts', 'ownedRowsObserved', 'pagesDisjoint', 'overflowSafe']).has(key))
      || value.limit !== pageLimit || !Array.isArray(value.offsets) || !Array.isArray(value.pageCounts)
      || !Number.isInteger(value.ownedRowsObserved) || typeof value.pagesDisjoint !== 'boolean' || typeof value.overflowSafe !== 'boolean') {
      fail(`evidence operation ${operation} is outside the sanitized allowlist`);
    }
  }
  const safetyKeys = new Set(['readOnlyTransactions', 'boundedLimits', 'offsetsApplied', 'noDmlOrDdl', 'secretBearingOutputExcluded', 'ownedFixtureOnly', 'cleanupExact']);
  if (Object.keys(evidence.safety).some((key) => !safetyKeys.has(key)) || Object.values(evidence.safety).some((value) => typeof value !== 'boolean')) fail('evidence safety fields are not typed');
  return evidence;
}

function writeEvidence(evidence) {
  const safe = validateEvidence(evidence);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function writeReport(evidence) {
  const report = [
    '# Portable member-password inventory pagination runner',
    '',
    '- Source runner: backend/scripts/member-password-inventory.integration.test.mjs.',
    '- Runtime selection: official Supabase CLI Docker status by default, or the existing explicitly selected owned-native runtime helper; no hosted project, frontend/.env.local, ambient credentials, or hardcoded host paths.',
    `- Fixture proof: ${fixtureCount} generated Auth/member/binding/invitation rows, page size ${pageLimit}, offsets 0/500/1000, exact recorded-ID cleanup, and historical-count preservation.`,
    '- Evidence: fixed repository allowlist path frontend/test-results/member-password-inventory-pagination-evidence.json; the report contains no IDs, emails, URLs with credentials, keys, passwords, or raw status output.',
    '',
    '## Sanitized result',
    '',
    '```json',
    JSON.stringify(evidence, null, 2),
    '```',
    '',
    '## Gate instructions',
    '',
    'Run one CLI step, sequentially, after the complete PostgreSQL/pgTAP suite and before the Auth browser run (or, if the parent orchestration has already run the browser and SQL-concurrency checks, keep this step isolated from those runs to avoid Auth list-first-pages interference):',
    '',
    '```sh',
    'CI=true PHANTOMS_DISPOSABLE_E2E=1 node --test backend/scripts/member-password-inventory.integration.test.mjs',
    '```',
    '',
    'The parent gate should verify the fixed evidence path with a strict allowlist validator and require cleanup completion; this repair does not claim a final integration result.',
    '',
  ].join('\n');
  writeFileSync(reportPath, report, { encoding: 'utf8', mode: 0o600 });
}

test('owned local member-password inventory pages are disjoint and overflow-safe', () => {
  const safety = staticSafety();
  for (const value of Object.values(safety)) assert.equal(value, true);
  const selection = assertPreflightSafety();
  const status = readLocalStatus(selection);
  assertPsqlAvailable();
  const fixture = makeFixture(randomBytes(16).toString('hex'));
  const before = counts(status);
  let fixtureAttempted = false;
  let fixtureCommitted = false;
  let cleanupStatus = 'not-started';
  let cleanupFailure = null;
  let passed = false;
  const operations = {};
  let operationFailure = null;
  try {
    const collisions = scalar(status, preflightCollisionSql(fixture));
    if (collisions !== 0) fail('owned fixture namespace or generated IDs already exist; no mutation was attempted');
    fixtureAttempted = true;
    const fixtureOutput = psql(status, [], fixtureSql(fixture));
    fixtureCommitted = true;
    fixture.memberIds = parseRecordedMemberIds(fixtureOutput, fixture);
    for (const operation of ['member', 'auth', 'invitation']) {
      const pages = [0, pageLimit, fixtureCount - 2].map((offset) => ({ offset, rows: runInventory(status, operation, offset) }));
      const keys = pages.flatMap((page) => page.rows.map((row) => row[0]));
      const pageKeySets = pages.map((page) => new Set(page.rows.map((row) => row[0])));
      const disjoint = pageKeySets.every((left, leftIndex) => pageKeySets.slice(leftIndex + 1)
        .every((right) => [...left].every((key) => !right.has(key))));
      const ownedRows = pages.flatMap((page) => page.rows).filter((row) => {
        const email = operation === 'member' ? row[1] : operation === 'auth' ? row[1] : row[2];
        return operation === 'auth'
          ? email.startsWith(`inventory-${fixture.suffix}-auth-`)
          : email.startsWith(`inventory-${fixture.suffix}-`);
      });
      const overflowSafe = pages.every((page) => page.rows.length <= pageLimit) && pages[2].rows.length <= 3;
      assert.deepEqual(pages.map((page) => page.offset), [0, 500, 1000]);
      assert.ok(pages.every((page) => page.rows.length > 0), `${operation} pages must be nonzero`);
      assert.equal(disjoint, true);
      assert.equal(ownedRows.length, fixtureCount);
      assert.equal(overflowSafe, true);
      operations[operation] = {
        limit: pageLimit,
        offsets: pages.map((page) => page.offset),
        pageCounts: pages.map((page) => page.rows.length),
        ownedRowsObserved: ownedRows.length,
        pagesDisjoint: disjoint,
        overflowSafe,
      };
    }
    passed = true;
  } catch (error) {
    operationFailure = error;
  } finally {
    if (fixtureAttempted && status) {
      try {
        const remaining = Number(psql(status, [], cleanupSql(fixture)).trim());
        if (remaining !== 0) fail('exact owned fixture cleanup left rows behind');
        const after = counts(status);
        assert.deepEqual(after, before, 'historical row counts changed during fixture cleanup');
        cleanupStatus = 'completed-exact-fixtures';
      } catch (error) {
        cleanupStatus = 'failed';
        cleanupFailure = error;
      }
    } else {
      cleanupStatus = 'not-started';
    }
    for (const operation of ['member', 'auth', 'invitation']) {
      operations[operation] ??= {
        limit: pageLimit,
        offsets: [],
        pageCounts: [],
        ownedRowsObserved: 0,
        pagesDisjoint: false,
        overflowSafe: false,
      };
    }
    const evidence = {
      schema: 'phantoms-member-password-inventory-pagination/v1',
      runtime: selection.native ? 'native-disposable-postgresql-17' : 'docker-disposable-postgresql-17',
      fixtureRowsPerResult: fixtureCount,
      operations,
      safety: {
        ...safety,
        ownedFixtureOnly: fixtureAttempted && fixtureCommitted,
        cleanupExact: cleanupStatus === 'completed-exact-fixtures',
      },
      cleanupStatus,
      passed: passed && cleanupStatus === 'completed-exact-fixtures',
    };
    writeEvidence(evidence);
    writeReport(evidence);
  }
  if (cleanupFailure) fail('owned fixture cleanup or historical count restoration failed');
  if (operationFailure) throw operationFailure;
});
