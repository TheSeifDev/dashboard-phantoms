import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMigrationManifest, EXPECTED_MIGRATION_COUNT } from './migration-manifest.mjs';

const scriptPath = fileURLToPath(new URL('./migration-manifest.mjs', import.meta.url));
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = join(repositoryRoot, 'backend/supabase/production-initialization-manifest.json');
const baselinePath = fileURLToPath(new URL('./fixtures/production-initialization-baseline.json', import.meta.url));
const currentManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const baselineManifest = JSON.parse(readFileSync(baselinePath, 'utf8'));
const forwardManifestPath = join(repositoryRoot, 'backend/supabase/forward-migration-manifest.json');

function makeFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), 'phantoms-migration-manifest-'));
  const migrationDir = join(rootDir, 'backend/supabase/migrations');
  mkdirSync(migrationDir, { recursive: true });
  const entries = structuredClone(currentManifest);
  for (const entry of entries) {
    const source = join(repositoryRoot, entry.canonical_repository_filename);
    const destination = join(rootDir, entry.canonical_repository_filename);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
  writeFileSync(join(rootDir, 'backend/supabase/production-initialization-manifest.json'), `${JSON.stringify(entries, null, 2)}\n`);
  return {
    rootDir,
    entries,
    manifestPath: join(rootDir, 'backend/supabase/production-initialization-manifest.json'),
    migrationDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

function validateFixture(fixture, entries = fixture.entries) {
  writeFileSync(fixture.manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
  return validateMigrationManifest({ rootDir: fixture.rootDir });
}

function assertInvalid(result, pattern) {
  assert.equal(result.valid, false, 'fixture should fail validation');
  assert.match(result.errors.join('\n'), pattern);
}

test('the repository preserves exactly 24 initialization migrations plus registered forward files', () => {
  const result = validateMigrationManifest({ rootDir: repositoryRoot });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.entryCount, EXPECTED_MIGRATION_COUNT);
  assert.equal(result.migrationFiles.length, EXPECTED_MIGRATION_COUNT + result.forwardEntryCount);
  assert.equal(result.forwardFiles.length, result.forwardEntryCount);
});

test('the forward manifest preserves provenance and records the applied Owner erasure migration', () => {
  const forward = JSON.parse(readFileSync(forwardManifestPath, 'utf8'));
  assert.equal(currentManifest.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(forward.length, 55);
  const appUsage = forward[24];
  assert.equal(appUsage.version, '20261121090000');
  assert.equal(appUsage.name, 'member_app_usage');
  assert.equal(appUsage.production_status, 'applied');
  assert.equal(appUsage.remote_applied_timestamp, '20261121091846');
  assert.equal(appUsage.canonical_repository_filename, 'backend/supabase/migrations/20261121090000_member_app_usage.sql');
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, appUsage.canonical_repository_filename))).digest('hex'), appUsage.sha256);
  const ownerErasure = forward[25];
  assert.equal(ownerErasure.version, '20261121110000');
  assert.equal(ownerErasure.name, 'owner_member_erasure');
  assert.equal(ownerErasure.production_status, 'applied');
  assert.equal(ownerErasure.remote_applied_timestamp, '20261121133819');
  assert.equal(ownerErasure.canonical_repository_filename, 'backend/supabase/migrations/20261121110000_owner_member_erasure.sql');
  assert.equal(ownerErasure.original_source_version, ownerErasure.version);
  assert.equal(ownerErasure.original_source_filename, ownerErasure.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, ownerErasure.canonical_repository_filename))).digest('hex'), ownerErasure.sha256);
  const erasureLockFix = forward[26];
  assert.equal(erasureLockFix.version, '20261121135000');
  assert.equal(erasureLockFix.name, 'owner_member_erasure_pg17_lock_scope_fix');
  assert.equal(erasureLockFix.production_status, 'applied');
  assert.equal(erasureLockFix.remote_applied_timestamp, '20261121140809');
  assert.equal(erasureLockFix.canonical_repository_filename, 'backend/supabase/migrations/20261121135000_owner_member_erasure_pg17_lock_scope_fix.sql');
  assert.equal(erasureLockFix.original_source_version, erasureLockFix.version);
  assert.equal(erasureLockFix.original_source_filename, erasureLockFix.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, erasureLockFix.canonical_repository_filename))).digest('hex'), erasureLockFix.sha256);
  const realtimeMetadataFix = forward[27];
  assert.equal(realtimeMetadataFix.version, '20261121142000');
  assert.equal(realtimeMetadataFix.name, 'owner_member_erasure_realtime_metadata_lock_fix');
  assert.equal(realtimeMetadataFix.production_status, 'applied');
  assert.equal(realtimeMetadataFix.remote_applied_timestamp, '20261121142446');
  assert.equal(realtimeMetadataFix.canonical_repository_filename, 'backend/supabase/migrations/20261121142000_owner_member_erasure_realtime_metadata_lock_fix.sql');
  assert.equal(realtimeMetadataFix.original_source_version, realtimeMetadataFix.version);
  assert.equal(realtimeMetadataFix.original_source_filename, realtimeMetadataFix.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, realtimeMetadataFix.canonical_repository_filename))).digest('hex'), realtimeMetadataFix.sha256);
  const lockAliasFix = forward[28];
  assert.equal(lockAliasFix.version, '20261121142709');
  assert.equal(lockAliasFix.name, 'owner_member_erasure_lock_record_reference_fix');
  assert.equal(lockAliasFix.production_status, 'applied');
  assert.equal(lockAliasFix.remote_applied_timestamp, '20261121142709');
  assert.equal(lockAliasFix.canonical_repository_filename, 'backend/supabase/migrations/20261121142709_owner_member_erasure_lock_record_reference_fix.sql');
  assert.equal(lockAliasFix.original_source_version, lockAliasFix.version);
  assert.equal(lockAliasFix.original_source_filename, lockAliasFix.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, lockAliasFix.canonical_repository_filename))).digest('hex'), lockAliasFix.sha256);
  const realtimeSchemaExclusion = forward[29];
  assert.equal(realtimeSchemaExclusion.version, '20261121143800');
  assert.equal(realtimeSchemaExclusion.name, 'owner_member_erasure_realtime_schema_lock_exclusion');
  assert.equal(realtimeSchemaExclusion.production_status, 'applied');
  assert.equal(realtimeSchemaExclusion.remote_applied_timestamp, '20261121144002');
  assert.equal(realtimeSchemaExclusion.canonical_repository_filename, 'backend/supabase/migrations/20261121143800_owner_member_erasure_realtime_schema_lock_exclusion.sql');
  assert.equal(realtimeSchemaExclusion.original_source_version, realtimeSchemaExclusion.version);
  assert.equal(realtimeSchemaExclusion.original_source_filename, realtimeSchemaExclusion.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, realtimeSchemaExclusion.canonical_repository_filename))).digest('hex'), realtimeSchemaExclusion.sha256);
  const storageVectorExclusion = forward[30];
  assert.equal(storageVectorExclusion.version, '20261121144600');
  assert.equal(storageVectorExclusion.name, 'owner_member_erasure_storage_vector_index_lock_exclusion');
  assert.equal(storageVectorExclusion.production_status, 'applied');
  assert.equal(storageVectorExclusion.remote_applied_timestamp, '20261121144753');
  assert.equal(storageVectorExclusion.canonical_repository_filename, 'backend/supabase/migrations/20261121144600_owner_member_erasure_storage_vector_index_lock_exclusion.sql');
  assert.equal(storageVectorExclusion.original_source_version, storageVectorExclusion.version);
  assert.equal(storageVectorExclusion.original_source_filename, storageVectorExclusion.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, storageVectorExclusion.canonical_repository_filename))).digest('hex'), storageVectorExclusion.sha256);
  const profileMigration = forward[31];
  assert.equal(profileMigration.version, '20261122010000');
  assert.equal(profileMigration.name, 'member_profile_all_required');
  assert.equal(profileMigration.production_status, 'applied');
  assert.equal(profileMigration.remote_applied_timestamp, '20261122054238');
  assert.equal(profileMigration.canonical_repository_filename, 'backend/supabase/migrations/20261122010000_member_profile_all_required.sql');
  assert.equal(profileMigration.original_source_version, profileMigration.version);
  assert.equal(profileMigration.original_source_filename, profileMigration.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, profileMigration.canonical_repository_filename))).digest('hex'), profileMigration.sha256);
  const [entry] = forward;
  assert.equal(entry.version, '20261116100646');
  assert.equal(entry.production_status, 'applied');
  assert.equal(entry.remote_applied_timestamp, entry.version);
  assert.equal(entry.original_source_version, '20261116061247');
  assert.equal(entry.original_source_filename, 'backend/supabase/migrations/20261116061247_admin_member_column_access.sql');
  assert.equal(entry.canonical_repository_filename, 'backend/supabase/migrations/20261116100646_admin_member_column_access.sql');
  assert.equal(existsSync(join(repositoryRoot, entry.original_source_filename)), false);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, entry.canonical_repository_filename))).digest('hex'), entry.sha256);
  const appliedPasswordMigrations = [
    ['20261116234800', '20261118213009'],
    ['20261117163000', '20261118213050'],
    ['20261117164800', '20261118213127'],
    ['20261117170000', '20261118213154'],
    ['20261117172500', '20261118213219'],
    ['20261117173500', '20261118213253'],
    ['20261117174000', '20261118213313'],
    ['20261117175500', '20261118213334'],
    ['20261118153000', '20261118213439'],
    ['20261118200500', '20261118213525'],
    ['20261119005000', '20261119054418'],
  ];
  assert.equal(forward.slice(1, 12).length, appliedPasswordMigrations.length);
  for (const [index, [version, remoteTimestamp]] of appliedPasswordMigrations.entries()) {
    const applied = forward[index + 1];
    assert.equal(applied.version, version);
    assert.equal(applied.production_status, 'applied');
    assert.equal(applied.remote_applied_timestamp, remoteTimestamp);
    assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, applied.canonical_repository_filename))).digest('hex'), applied.sha256);
  }
  assert.equal(forward[11].version, '20261119005000');
  assert.equal(forward[11].production_status, 'applied');
  assert.equal(forward[11].remote_applied_timestamp, '20261119054418');
  assert.equal(forward[11].canonical_repository_filename, 'backend/supabase/migrations/20261119005000_member_password_owner_join_review.sql');
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[11].canonical_repository_filename))).digest('hex'), forward[11].sha256);
  assert.equal(forward[12].version, '20261119183000');
  assert.equal(forward[12].production_status, 'applied');
  assert.equal(forward[12].remote_applied_timestamp, '20261119193932');
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[12].canonical_repository_filename))).digest('hex'), forward[12].sha256);
  const appliedTeams = [
    ['20261120120000', '20261120074604', 'internal_teams_foundation'],
    ['20261120121000', '20261120074634', 'internal_teams_owner_management'],
    ['20261120122000', '20261120074653', 'internal_teams_update_details'],
    ['20261120122500', '20261120074723', 'internal_team_access_hardening'],
    ['20261120123000', '20261120074850', 'internal_team_tasks'],
    ['20261120124000', '20261120074944', 'internal_team_records'],
    ['20261120125000', '20261120075039', 'internal_team_announcements'],
  ];
  assert.equal(forward.slice(13, 20).length, appliedTeams.length);
  for (const [index, [originalVersion, remoteVersion, name]] of appliedTeams.entries()) {
    const entry = forward[index + 13];
    assert.equal(entry.version, remoteVersion);
    assert.equal(entry.name, name);
    assert.equal(entry.production_status, 'applied');
    assert.equal(entry.remote_applied_timestamp, remoteVersion);
    assert.equal(entry.original_source_version, originalVersion);
    assert.equal(entry.original_source_filename, `backend/supabase/migrations/${originalVersion}_${name}.sql`);
    assert.equal(entry.canonical_repository_filename, `backend/supabase/migrations/${remoteVersion}_${name}.sql`);
    assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, entry.canonical_repository_filename))).digest('hex'), entry.sha256);
  }
  const webProjects = forward[20];
  assert.equal(webProjects.version, '20261120223000');
  assert.equal(webProjects.name, 'web_projects_foundation');
  assert.equal(webProjects.production_status, 'applied');
  assert.equal(webProjects.remote_applied_timestamp, '20261120223727');
  assert.equal(webProjects.original_source_version, webProjects.version);
  assert.equal(webProjects.original_source_filename, webProjects.canonical_repository_filename);
  assert.equal(webProjects.canonical_repository_filename,
    'backend/supabase/migrations/20261120223000_web_projects_foundation.sql');
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, webProjects.canonical_repository_filename))).digest('hex'), webProjects.sha256);
});

test('new manifest provenance is anchored to the historical 85a36fc manifest and canonical bytes', () => {
  assert.equal(currentManifest.length, baselineManifest.length);
  assert.equal(currentManifest.length, EXPECTED_MIGRATION_COUNT);
  const provenanceFields = ['source_file', 'source_version', 'mcp_name', 'sha256', 'remote_version', 'success'];
  for (let index = 0; index < currentManifest.length; index += 1) {
    const current = currentManifest[index];
    const baseline = baselineManifest[index];
    for (const field of provenanceFields) assert.deepEqual(current[field], baseline[field], `entry ${index + 1} ${field}`);
    const canonicalBytes = readFileSync(join(repositoryRoot, current.canonical_repository_filename));
    const actualSha256 = createHash('sha256').update(canonicalBytes).digest('hex');
    assert.equal(actualSha256, baseline.sha256, `canonical bytes changed for entry ${index + 1}`);
    assert.equal(current.original_source_timestamp, baseline.source_version);
    assert.equal(current.original_source_filename, baseline.source_file);
    assert.equal(current.remote_applied_timestamp, baseline.remote_version);
  }
});

test('content tampering is detected by the recorded SHA256', () => {
  const fixture = makeFixture();
  try {
    const target = join(fixture.rootDir, fixture.entries[0].canonical_repository_filename);
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- tampered fixture\n`);
    assertInvalid(validateFixture(fixture), /sha256\/content mismatch/);
  } finally { fixture.cleanup(); }
});

test('missing migration files and manifest entries are rejected', () => {
  const fixture = makeFixture();
  try {
    rmSync(join(fixture.rootDir, fixture.entries[0].canonical_repository_filename));
    assertInvalid(validateFixture(fixture, fixture.entries.slice(1)), /exactly 24 manifest entries|exactly 24 SQL migration files|canonical migration file is missing/);
  } finally { fixture.cleanup(); }
});

test('extra migration files are rejected', () => {
  const fixture = makeFixture();
  try {
    writeFileSync(join(fixture.migrationDir, '20990101000000_unlisted_fixture.sql'), 'select 1;\n');
    assertInvalid(validateFixture(fixture), /exactly 24 SQL migration files|Unexpected migration file/);
  } finally { fixture.cleanup(); }
});

test('duplicate source and remote entries are rejected', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    entries[1] = structuredClone(entries[0]);
    assertInvalid(validateFixture(fixture, entries), /duplicate source_version|duplicate remote_version|duplicate canonical_repository_filename/);
  } finally { fixture.cleanup(); }
});

test('out-of-order remote versions are rejected', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    [entries[0], entries[1]] = [entries[1], entries[0]];
    assertInvalid(validateFixture(fixture, entries), /original migration sequence|remote_version values must be strictly increasing/);
  } finally { fixture.cleanup(); }
});

test('remote version and applied timestamp mismatches are rejected', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    entries[0].remote_applied_timestamp = '20261114170000';
    assertInvalid(validateFixture(fixture, entries), /remote_applied_timestamp must equal remote_version/);
  } finally { fixture.cleanup(); }
});

test('canonical timestamp or suffix changes are rejected', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    entries[0].canonical_repository_filename = `backend/supabase/migrations/${entries[0].remote_version}_changed_suffix.sql`;
    assertInvalid(validateFixture(fixture, entries), /canonical_repository_filename must use remote_version and preserve the original suffix|canonical filename suffix/);
  } finally { fixture.cleanup(); }
});

test('an original migration filename remaining in the directory is rejected', () => {
  const fixture = makeFixture();
  try {
    const oldPath = join(fixture.rootDir, fixture.entries[0].source_file);
    mkdirSync(dirname(oldPath), { recursive: true });
    writeFileSync(oldPath, 'select 1;\n');
    assertInvalid(validateFixture(fixture), /original migration file still exists/);
  } finally { fixture.cleanup(); }
});

test('a provenance SHA change is rejected even when canonical content is unchanged', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    entries[0].sha256 = '0'.repeat(64);
    assertInvalid(validateFixture(fixture, entries), /sha256\/content mismatch/);
  } finally { fixture.cleanup(); }
});

test('non-14-digit timestamps, legacy inconsistency, and path traversal are rejected', () => {
  const fixture = makeFixture();
  try {
    const entries = structuredClone(fixture.entries);
    entries[0].source_version = '2026111200000';
    entries[0].source_file = '../escape.sql';
    entries[0].original_source_filename = '../escape.sql';
    entries[0].mcp_name = '';
    assertInvalid(validateFixture(fixture, entries), /source_version must be a 14-digit|source_file is not a safe relative path|mcp_name must be a non-empty string/);
  } finally { fixture.cleanup(); }
});

test('CLI reports a meaningful failure and succeeds for an isolated valid fixture', () => {
  const fixture = makeFixture();
  try {
    const valid = spawnSync(process.execPath, [scriptPath, '--check', '--root', fixture.rootDir], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Migration manifest valid: 24 entries and 24 canonical SQL files/);

    const target = join(fixture.rootDir, fixture.entries[0].canonical_repository_filename);
    writeFileSync(target, `${readFileSync(target, 'utf8')}tamper`);
    const invalid = spawnSync(process.execPath, [scriptPath, '--check', '--root', fixture.rootDir], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Migration manifest validation failed/);
    assert.match(invalid.stderr, /sha256\/content mismatch/);
  } finally { fixture.cleanup(); }
});

test('CLI rejects unknown arguments without touching repository files', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--not-a-check'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument/);
});
