import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMigrationManifest } from './migration-manifest.mjs';
import { FORWARD_MANIFEST_PATH } from './forward-migrations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const initial = JSON.parse(readFileSync(join(root, 'backend/supabase/production-initialization-manifest.json'), 'utf8'));
const forwardVersion = '20261116100646';
const originalVersion = '20261116061247';
const forwardName = 'admin_member_column_access';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'phantoms-forward-inventory-'));
  for (const entry of initial) {
    const target = join(dir, entry.canonical_repository_filename);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, entry.canonical_repository_filename), target);
  }
  writeFileSync(join(dir, 'backend/supabase/production-initialization-manifest.json'), JSON.stringify(initial));
  const sql = 'BEGIN;\nGRANT SELECT (custom_fields) ON public.members TO authenticated;\nCOMMIT;\n';
  const entry = {
    version: forwardVersion,
    name: forwardName,
    canonical_repository_filename: `backend/supabase/migrations/${forwardVersion}_${forwardName}.sql`,
    sha256: createHash('sha256').update(sql).digest('hex'),
    production_status: 'not_applied',
    remote_applied_timestamp: null,
    original_source_version: originalVersion,
    original_source_filename: `backend/supabase/migrations/${originalVersion}_${forwardName}.sql`,
  };
  writeFileSync(join(dir, entry.canonical_repository_filename), sql);
  const entries = [entry];
  const save = () => writeFileSync(join(dir, FORWARD_MANIFEST_PATH), JSON.stringify(entries));
  save();
  return { dir, entry, entries, save, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function invalid(f, pattern) {
  f.save();
  const result = validateMigrationManifest({ rootDir: f.dir });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), pattern);
}

function withFixture(body) {
  const f = fixture();
  try { body(f); } finally { f.cleanup(); }
}

test('repository retains 24 initialized files, the applied correction and nine pending password migrations', () => {
  const result = validateMigrationManifest({ rootDir: root });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.entryCount, 24);
  assert.equal(result.forwardEntryCount, 10);
  assert.equal(result.migrationFiles.length, 34);
  assert.deepEqual(result.forwardFiles, [`${forwardVersion}_${forwardName}.sql`, '20261116234800_member_password_auth.sql', '20261117163000_member_password_runtime_guards.sql', '20261117164800_member_password_session_guards.sql', '20261117170000_member_password_invitation_lock_guards.sql', '20261117172500_member_password_anonymous_session_guards.sql', '20261117173500_member_password_gotrue_insert_compat.sql', '20261117174000_member_password_gotrue_bound_guard_reconciliation.sql', '20261117175500_member_password_limiter_storage_guards.sql', '20261118153000_member_password_self_service_join.sql']);
  const entries = JSON.parse(readFileSync(join(root, FORWARD_MANIFEST_PATH), 'utf8'));
  assert.equal(entries[0].version, forwardVersion);
  assert.equal(entries[0].canonical_repository_filename, `backend/supabase/migrations/${forwardVersion}_${forwardName}.sql`);
  assert.equal(entries[0].production_status, 'applied');
  assert.equal(entries[0].remote_applied_timestamp, forwardVersion);
  assert.equal(entries[0].original_source_version, originalVersion);
  assert.equal(entries[0].original_source_filename, `backend/supabase/migrations/${originalVersion}_${forwardName}.sql`);
  assert.equal(entries[0].sha256, 'c3ec586e6fc50bc31733fcffbb8e3903eb87fe2979ee2fc8906f725168916be6');
  assert.equal(entries[1].version, '20261116234800');
  assert.equal(entries[1].production_status, 'not_applied');
  assert.equal(entries[1].remote_applied_timestamp, null);
  assert.equal(entries[1].original_source_version, entries[1].version);
  assert.equal(entries[1].original_source_filename, entries[1].canonical_repository_filename);
  assert.equal(entries[2].version, '20261117163000');
  assert.equal(entries[2].production_status, 'not_applied');
  assert.equal(entries[2].remote_applied_timestamp, null);
  assert.equal(entries[2].original_source_version, entries[2].version);
  assert.equal(entries[2].original_source_filename, entries[2].canonical_repository_filename);
  assert.equal(entries[3].version, '20261117164800');
  assert.equal(entries[3].production_status, 'not_applied');
  assert.equal(entries[3].remote_applied_timestamp, null);
  assert.equal(entries[3].original_source_version, entries[3].version);
  assert.equal(entries[3].original_source_filename, entries[3].canonical_repository_filename);
  assert.equal(entries[4].version, '20261117170000');
  assert.equal(entries[4].production_status, 'not_applied');
  assert.equal(entries[4].remote_applied_timestamp, null);
  assert.equal(entries[4].original_source_version, entries[4].version);
  assert.equal(entries[4].original_source_filename, entries[4].canonical_repository_filename);
  assert.equal(entries[5].version, '20261117172500');
  assert.equal(entries[5].production_status, 'not_applied');
  assert.equal(entries[5].remote_applied_timestamp, null);
  assert.equal(entries[5].original_source_version, entries[5].version);
  assert.equal(entries[7].version, '20261117174000');
  assert.equal(entries[7].production_status, 'not_applied');
  assert.equal(entries[7].remote_applied_timestamp, null);
  assert.equal(entries[7].original_source_version, entries[7].version);
  assert.equal(entries[7].original_source_filename, entries[7].canonical_repository_filename);
  assert.equal(entries[6].version, '20261117173500');
  assert.equal(entries[6].remote_applied_timestamp, null);
  assert.equal(entries[6].original_source_version, entries[6].version);
  assert.equal(entries[5].original_source_filename, entries[5].canonical_repository_filename);
});

test('a valid separate forward registration does not change initialization provenance', () => {
  withFixture((f) => {
    const result = validateMigrationManifest({ rootDir: f.dir });
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.equal(result.entryCount, 24);
    assert.equal(result.forwardEntryCount, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(f.dir, 'backend/supabase/production-initialization-manifest.json'), 'utf8')), initial);
  });
});

test('an unregistered new SQL file remains rejected', () => {
  withFixture((f) => {
    rmSync(join(f.dir, FORWARD_MANIFEST_PATH));
    const result = validateMigrationManifest({ rootDir: f.dir });
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /Unexpected migration file|exactly 24 SQL/);
  });
});

test('forward SQL checksum tampering is rejected', () => {
  withFixture((f) => {
    writeFileSync(join(f.dir, f.entry.canonical_repository_filename), '-- changed SQL\n');
    invalid(f, /sha256\/content mismatch/);
  });
});

test('missing registered forward SQL is rejected', () => {
  withFixture((f) => {
    rmSync(join(f.dir, f.entry.canonical_repository_filename));
    invalid(f, /registered forward migration is missing/);
  });
});

test('duplicate and out-of-order forward registrations are rejected', () => {
  withFixture((f) => {
    f.entries.push(structuredClone(f.entry));
    invalid(f, /unique, strictly increasing|duplicate registered/);
  });
});

test('forward registration cannot precede the last initialized version', () => {
  withFixture((f) => {
    f.entry.version = initial.at(-1).remote_version;
    invalid(f, /later than initialization/);
  });
});

test('path traversal, mismatched names and invalid timestamps are rejected', () => {
  withFixture((f) => {
    f.entry.canonical_repository_filename = '../../outside.sql';
    f.entry.version = 'bad-version';
    invalid(f, /invalid 14-digit version|safe version and name/);
  });
});

test('an applied registration with a mismatched timestamp is rejected', () => {
  withFixture((f) => {
    f.entry.production_status = 'applied';
    f.entry.remote_applied_timestamp = '20261116110000';
    invalid(f, /production_status\/remote_applied_timestamp/);
  });
});

test('an applied registration with matching version and timestamp is accepted', () => {
  withFixture((f) => {
    f.entry.production_status = 'applied';
    f.entry.remote_applied_timestamp = forwardVersion;
    const result = validateMigrationManifest({ rootDir: f.dir });
    assert.equal(result.valid, true, result.errors.join('\n'));
  });
});

test('inconsistent forward status and timestamp pairs are rejected fail-closed', () => {
  for (const [status, remote] of [
    ['pending', null],
    ['applied', null],
    ['applied', '20261116110000'],
    ['applied', 'not-a-timestamp'],
    ['not_applied', '20261116110000'],
  ]) {
    withFixture((f) => {
      f.entry.production_status = status;
      f.entry.remote_applied_timestamp = remote;
      invalid(f, /production_status\/remote_applied_timestamp/);
    });
  }
});

test('a malformed forward manifest is rejected rather than ignored', () => {
  withFixture((f) => {
    writeFileSync(join(f.dir, FORWARD_MANIFEST_PATH), '{bad json');
    const result = validateMigrationManifest({ rootDir: f.dir });
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /Could not parse forward migration manifest/);
  });
});
