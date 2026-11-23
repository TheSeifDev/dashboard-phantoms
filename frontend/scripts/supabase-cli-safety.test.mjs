import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const inventoryHelper = resolve(scriptDir, 'run-migrations.mjs');
const approvedRef = 'wxwoaputugxwysuhcebv';

function runInventory(projectRef) {
  const env = { ...process.env };
  delete env.PHANTOMS_SUPABASE_PROJECT_REF;
  if (projectRef !== undefined) env.PHANTOMS_SUPABASE_PROJECT_REF = projectRef;
  return spawnSync(process.execPath, [inventoryHelper, '--print'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
}

function runCheck() {
  return spawnSync(process.execPath, [inventoryHelper, '--check'], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });
}
test('local inventory retains fifty-one applied forwards including exact app-use and Owner-erasure timestamps', () => {
  const result = runCheck();
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(readFileSync(resolve(repoRoot, 'backend/supabase/forward-migration-manifest.json'), 'utf8'));
  const pending = entries.filter((entry) => entry.production_status === 'not_applied').length;
  const applied = entries.length - pending;
  assert.equal(pending, 0);
  assert.equal(applied, 51);
  const appUsage = entries.find((entry) => entry.version === '20261121090000');
  assert.equal(appUsage.name, 'member_app_usage');
  assert.equal(appUsage.production_status, 'applied');
  assert.equal(appUsage.remote_applied_timestamp, '20261121091846');
  assert.equal(appUsage.canonical_repository_filename, 'backend/supabase/migrations/20261121090000_member_app_usage.sql');
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, appUsage.canonical_repository_filename))).digest('hex'), appUsage.sha256);
  const ownerErasure = entries.find((entry) => entry.version === '20261121110000');
  assert.equal(ownerErasure.name, 'owner_member_erasure');
  assert.equal(ownerErasure.production_status, 'applied');
  assert.equal(ownerErasure.remote_applied_timestamp, '20261121133819');
  assert.equal(ownerErasure.canonical_repository_filename, 'backend/supabase/migrations/20261121110000_owner_member_erasure.sql');
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, ownerErasure.canonical_repository_filename))).digest('hex'), ownerErasure.sha256);
  const erasureLockFix = entries.find((entry) => entry.version === '20261121135000');
  assert.equal(erasureLockFix?.name, 'owner_member_erasure_pg17_lock_scope_fix');
  assert.equal(erasureLockFix?.production_status, 'applied');
  assert.equal(erasureLockFix?.remote_applied_timestamp, '20261121140809');
  assert.equal(erasureLockFix?.canonical_repository_filename, 'backend/supabase/migrations/20261121135000_owner_member_erasure_pg17_lock_scope_fix.sql');
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, erasureLockFix.canonical_repository_filename))).digest('hex'), erasureLockFix.sha256);
  const realtimeMetadataFix = entries.find((entry) => entry.version === '20261121142000');
  assert.equal(realtimeMetadataFix?.name, 'owner_member_erasure_realtime_metadata_lock_fix');
  assert.equal(realtimeMetadataFix?.production_status, 'applied');
  assert.equal(realtimeMetadataFix?.remote_applied_timestamp, '20261121142446');
  assert.equal(realtimeMetadataFix?.canonical_repository_filename, 'backend/supabase/migrations/20261121142000_owner_member_erasure_realtime_metadata_lock_fix.sql');
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, realtimeMetadataFix.canonical_repository_filename))).digest('hex'), realtimeMetadataFix.sha256);
  const lockAliasFix = entries.find((entry) => entry.version === '20261121142709');
  assert.equal(lockAliasFix?.name, 'owner_member_erasure_lock_record_reference_fix');
  assert.equal(lockAliasFix?.production_status, 'applied');
  assert.equal(lockAliasFix?.remote_applied_timestamp, '20261121142709');
  assert.equal(lockAliasFix?.canonical_repository_filename, 'backend/supabase/migrations/20261121142709_owner_member_erasure_lock_record_reference_fix.sql');
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, lockAliasFix.canonical_repository_filename))).digest('hex'), lockAliasFix.sha256);
  const realtimeSchemaExclusion = entries.find((entry) => entry.version === '20261121143800');
  assert.equal(realtimeSchemaExclusion?.name, 'owner_member_erasure_realtime_schema_lock_exclusion');
  assert.equal(realtimeSchemaExclusion?.production_status, 'applied');
  assert.equal(realtimeSchemaExclusion?.remote_applied_timestamp, '20261121144002');
  assert.equal(realtimeSchemaExclusion?.canonical_repository_filename, 'backend/supabase/migrations/20261121143800_owner_member_erasure_realtime_schema_lock_exclusion.sql');
  assert.equal(realtimeSchemaExclusion?.original_source_version, realtimeSchemaExclusion.version);
  assert.equal(realtimeSchemaExclusion?.original_source_filename, realtimeSchemaExclusion.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, realtimeSchemaExclusion.canonical_repository_filename))).digest('hex'), realtimeSchemaExclusion.sha256);
  const storageVectorExclusion = entries.find((entry) => entry.version === '20261121144600');
  assert.equal(storageVectorExclusion?.name, 'owner_member_erasure_storage_vector_index_lock_exclusion');
  assert.equal(storageVectorExclusion?.production_status, 'applied');
  assert.equal(storageVectorExclusion?.remote_applied_timestamp, '20261121144753');
  assert.equal(storageVectorExclusion?.canonical_repository_filename, 'backend/supabase/migrations/20261121144600_owner_member_erasure_storage_vector_index_lock_exclusion.sql');
  assert.equal(storageVectorExclusion?.original_source_version, storageVectorExclusion.version);
  assert.equal(storageVectorExclusion?.original_source_filename, storageVectorExclusion.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(resolve(repoRoot, storageVectorExclusion.canonical_repository_filename))).digest('hex'), storageVectorExclusion.sha256);
  const posture = readFileSync(resolve(repoRoot, 'backend/supabase/tests/database/01_schema_and_posture.test.sql'), 'utf8');
  const tableAllowlist = posture.match(/SELECT tables_are\('public', ARRAY\[([\s\S]*?)\]/)?.[1];
  assert.ok(tableAllowlist?.includes("'member_app_usage'"), 'new app-use table must be in the exact pgTAP schema allowlist');
  assert.ok(tableAllowlist?.includes("'owner_member_erasure_operations'") && tableAllowlist?.includes("'owner_member_erasure_storage_objects'"), 'both Owner erasure tables must be in the exact pgTAP schema allowlist');
  assert.match(posture, /SELECT plan\(57\);/, 'preserve all historical posture assertions');
  const demotion = entries.find((entry) => entry.version === '20261121074500');
  assert.equal(demotion.name, 'owner_admin_demotion');
  assert.equal(demotion.production_status, 'applied');
  assert.equal(demotion.remote_applied_timestamp, '20261121082239');
  const appliedMemberTimestamps = new Map([['20261121002000', '20261121003655'], ['20261121003000', '20261121003716']]);
  for (const [version, remoteTimestamp] of appliedMemberTimestamps) {
    const entry = entries.find((item) => item.version === version);
    assert.equal(entry?.production_status, 'applied');
    assert.equal(entry?.remote_applied_timestamp, remoteTimestamp);
  }
  const webProjects = entries.find((entry) => entry.version === '20261120223000');
  assert.equal(webProjects?.name, 'web_projects_foundation');
  assert.equal(webProjects?.production_status, 'applied');
  assert.equal(webProjects?.remote_applied_timestamp, '20261120223727');
  assert.ok(result.stdout.includes(`All ${24 + entries.length} canonical migrations are present (${pending} pending forward, ${applied} applied forward)`));
  const ownerReview = entries.find((entry) => entry.version === '20261119005000');
  assert.equal(ownerReview.production_status, 'applied');
  assert.equal(ownerReview.remote_applied_timestamp, '20261119054418');
  const contribution = entries.find((entry) => entry.version === '20261119183000');
  assert.equal(contribution.production_status, 'applied');
  assert.equal(contribution.remote_applied_timestamp, '20261119193932');
  const teamMigrations = [
    ['20261120120000', '20261120074604', 'internal_teams_foundation'],
    ['20261120121000', '20261120074634', 'internal_teams_owner_management'],
    ['20261120122000', '20261120074653', 'internal_teams_update_details'],
    ['20261120122500', '20261120074723', 'internal_team_access_hardening'],
    ['20261120123000', '20261120074850', 'internal_team_tasks'],
    ['20261120124000', '20261120074944', 'internal_team_records'],
    ['20261120125000', '20261120075039', 'internal_team_announcements'],
  ];
  for (const [originalVersion, remoteVersion, name] of teamMigrations) {
    const entry = entries.find((item) => item.name === name);
    assert.ok(entry, `${name} must be registered`);
    assert.equal(entry.version, remoteVersion);
    assert.equal(entry.production_status, 'applied');
    assert.equal(entry.remote_applied_timestamp, remoteVersion);
    assert.equal(entry.original_source_version, originalVersion);
    assert.equal(entry.original_source_filename, `backend/supabase/migrations/${originalVersion}_${name}.sql`);
  }
});

test('remote commands are not printed when target is omitted', () => {
  const result = runInventory();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set PHANTOMS_SUPABASE_PROJECT_REF explicitly/);
  assert.doesNotMatch(result.stdout + result.stderr, /supabase db push/);
});

test('remote commands are pinned to the approved PHANTOMS project and dry-run only', () => {
  const result = runInventory(approvedRef);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`migration list --workdir backend --remote=${approvedRef}`));
  assert.match(result.stdout, new RegExp(`db push --dry-run --workdir backend --remote=${approvedRef} --skip-vault`));
  assert.doesNotMatch(result.stdout, /db push --workdir backend(?!.*--dry-run)/);
});

test('remote commands are not printed for another syntactically valid project reference', () => {
  const result = runInventory('abcdefghijklmnopqrst');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unapproved project target/);
  assert.doesNotMatch(result.stdout + result.stderr, /supabase db push/);
});

test('Supabase CLI ephemeral cache paths are ignored and no longer tracked', () => {
  const cacheFiles = [
    'backend/supabase/.temp/cli-latest',
    'backend/supabase/.temp/linked-project.json',
    'backend/supabase/.temp/project-ref',
  ];

  const tracked = spawnSync('git', ['ls-files', '--cached', '--', 'backend/supabase/.temp'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout.trim(), '', 'Supabase CLI cache files must not be tracked');

  for (const cachePath of cacheFiles) {
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', cachePath], {
      cwd: repoRoot,
    });
    assert.equal(ignored.status, 0, `${cachePath} must match an ignore rule`);
  }
});
