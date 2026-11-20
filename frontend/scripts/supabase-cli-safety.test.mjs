import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('local inventory records twenty applied and one pending Web Projects migration', () => {
  const result = runCheck();
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(readFileSync(resolve(repoRoot, 'backend/supabase/forward-migration-manifest.json'), 'utf8'));
  const pending = entries.filter((entry) => entry.production_status === 'not_applied').length;
  const applied = entries.length - pending;
  assert.equal(pending, 1);
  assert.equal(applied, 20);
  const pendingEntry = entries.find((entry) => entry.production_status === 'not_applied');
  assert.equal(pendingEntry?.version, '20261120223000');
  assert.equal(pendingEntry?.name, 'web_projects_foundation');
  assert.equal(pendingEntry?.remote_applied_timestamp, null);
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
