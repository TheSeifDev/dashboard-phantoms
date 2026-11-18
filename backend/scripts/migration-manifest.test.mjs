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

test('the reconciled forward migration preserves original provenance and canonical bytes outside initialization history', () => {
  const forward = JSON.parse(readFileSync(forwardManifestPath, 'utf8'));
  assert.equal(currentManifest.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(forward.length, 9);
  const [entry] = forward;
  assert.equal(entry.version, '20261116100646');
  assert.equal(entry.production_status, 'applied');
  assert.equal(entry.remote_applied_timestamp, entry.version);
  assert.equal(entry.original_source_version, '20261116061247');
  assert.equal(entry.original_source_filename, 'backend/supabase/migrations/20261116061247_admin_member_column_access.sql');
  assert.equal(entry.canonical_repository_filename, 'backend/supabase/migrations/20261116100646_admin_member_column_access.sql');
  assert.equal(existsSync(join(repositoryRoot, entry.original_source_filename)), false);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, entry.canonical_repository_filename))).digest('hex'), entry.sha256);
  assert.equal(forward[1].version, '20261116234800');
  assert.equal(forward[1].production_status, 'not_applied');
  assert.equal(forward[1].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[1].canonical_repository_filename))).digest('hex'), forward[1].sha256);
  assert.equal(forward[2].version, '20261117163000');
  assert.equal(forward[2].production_status, 'not_applied');
  assert.equal(forward[2].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[2].canonical_repository_filename))).digest('hex'), forward[2].sha256);
  assert.equal(forward[3].version, '20261117164800');
  assert.equal(forward[3].production_status, 'not_applied');
  assert.equal(forward[3].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[3].canonical_repository_filename))).digest('hex'), forward[3].sha256);
  assert.equal(forward[4].version, '20261117170000');
  assert.equal(forward[4].production_status, 'not_applied');
  assert.equal(forward[4].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[4].canonical_repository_filename))).digest('hex'), forward[4].sha256);
  assert.equal(forward[5].version, '20261117172500');
  assert.equal(forward[5].production_status, 'not_applied');
  assert.equal(forward[5].remote_applied_timestamp, null);
  assert.equal(forward[7].version, '20261117174000');
  assert.equal(forward[7].production_status, 'not_applied');
  assert.equal(forward[7].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[7].canonical_repository_filename))).digest('hex'), forward[7].sha256);
  assert.equal(forward[8].version, '20261117175500');
  assert.equal(forward[8].production_status, 'not_applied');
  assert.equal(forward[8].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[8].canonical_repository_filename))).digest('hex'), forward[8].sha256);
  assert.equal(forward[6].version, '20261117173500');
  assert.equal(forward[6].production_status, 'not_applied');
  assert.equal(forward[6].remote_applied_timestamp, null);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[6].canonical_repository_filename))).digest('hex'), forward[6].sha256);
  assert.equal(createHash('sha256').update(readFileSync(join(repositoryRoot, forward[5].canonical_repository_filename))).digest('hex'), forward[5].sha256);
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
