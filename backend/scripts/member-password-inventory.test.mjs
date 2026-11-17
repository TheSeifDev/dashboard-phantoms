import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const inventoryPath = fileURLToPath(new URL('./member-password-inventory.sql', import.meta.url));
const sql = readFileSync(inventoryPath, 'utf8');
const integrationRunnerPath = fileURLToPath(new URL('./member-password-inventory.integration.test.mjs', import.meta.url));
const integrationRunner = readFileSync(integrationRunnerPath, 'utf8');
const inputNames = [
  'current_operation',
  'member_limit',
  'member_offset',
  'auth_limit',
  'auth_offset',
  'invitation_limit',
  'invitation_offset',
  'selected_member_id',
  'selected_auth_user_id',
  'selected_invitation_id',
];

function guardBody(source) {
  const start = source.indexOf('DO $guard$');
  const end = source.indexOf('$guard$;', start);
  assert.notEqual(start, -1, 'guard DO block must exist');
  assert.notEqual(end, -1, 'guard DO block must terminate');
  return source.slice(start, end);
}

function executableSql(source) {
  return source
    .replace(/--[^\n]*\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '\n');
}

test('quoted psql inputs are copied outside DO and the guard uses transaction-local settings', () => {
  const body = guardBody(sql);
  assert.doesNotMatch(body, /:\s*'[^']+'/u, 'psql variables must not occur inside the quoted DO body');
  for (const name of inputNames) {
    assert.match(
      sql,
      new RegExp(`set_config\\('phantoms_inventory\\.${name}', :\\'${name}\\', true\\)`),
      `${name} must be safely quoted before entering DO`,
    );
    assert.match(
      body,
      new RegExp(`current_setting\\('phantoms_inventory\\.${name}'\\)`),
      `${name} must be read from a transaction-local setting inside DO`,
    );
  }
});

test('inventory execution is explicitly bounded and read-only', () => {
  assert.match(sql, /BEGIN;\s*SET TRANSACTION READ ONLY;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  const executable = executableSql(sql);
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/iu,
    'inventory must not contain write, DDL, privilege, or procedure-call statements',
  );
  assert.equal((sql.match(/LIMIT \(SELECT row_limit FROM params\)/gu) ?? []).length, 3);
  assert.equal((sql.match(/OFFSET \(SELECT row_offset FROM params\)/gu) ?? []).length, 3);
  for (const name of ['member_limit', 'member_offset', 'auth_limit', 'auth_offset', 'invitation_limit', 'invitation_offset']) {
    assert.match(sql, new RegExp(`:'${name}'`), `${name} must remain an explicit bounded input`);
  }
  assert.doesNotMatch(sql, /https?:\/\//iu, 'inventory must not contain production connector URLs');
});

test('each result query applies its validated parameterized offset', () => {
  assert.doesNotMatch(sql, /OFFSET\s+0\s*;/iu, 'result queries must not silently reset pagination to page one');
  assert.equal(
    (sql.match(/OFFSET \(SELECT row_offset FROM params\);/gu) ?? []).length,
    3,
    'member, Auth, and invitation final result queries must use scalar row_offset values',
  );
  for (const marker of [
    /ORDER BY m\.id\s+LIMIT \(SELECT row_limit FROM params\)\s+OFFSET \(SELECT row_offset FROM params\);/u,
    /ORDER BY u\.id\s+LIMIT \(SELECT row_limit FROM params\)\s+OFFSET \(SELECT row_offset FROM params\);/u,
    /ORDER BY created_at, id\s+LIMIT \(SELECT row_limit FROM params\)\s+OFFSET \(SELECT row_offset FROM params\);/u,
  ]) {
    assert.match(sql, marker, 'each final inventory result must honor its operation-specific row_offset');
  }
});

test('all ten state classifications and exact identity boundaries remain represented', () => {
  for (const classification of [
    'member_with_auth_binding',
    'member_without_auth_binding',
    'unconfirmed_bound_identity',
    'confirmed_passwordless_bound_identity',
    'passworded_bound_identity',
    'disabled_or_revoked_member',
    'auth_identity_unassociated',
    'admin_member_overlap_excluded',
    'duplicate_or_ambiguous_binding',
    'reserved_or_review_required',
  ]) {
    assert.match(sql, new RegExp(`\\b${classification}\\b`), `${classification} must remain explicit`);
  }
  assert.match(sql, /auth_email_candidate_unbound/);
  assert.match(sql, /selected_auth_user_id IS NULL OR u\.id = p\.selected_auth_user_id/);
  assert.match(sql, /NULLIF\(:'selected_auth_user_id', ''\)::UUID/);
  assert.match(sql, /\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[1-8\]/);
  assert.match(sql, /\[89abAB\]\[0-9a-fA-F\]\{3\}/);
});

test('bulk Auth fixtures cast generated textual IDs to UUIDs before insertion', () => {
  assert.match(integrationRunner, /SELECT id::uuid, '00000000-0000-0000-0000-000000000000'/);
});

test('secret-bearing values are reduced to safe booleans and safe audit fields', () => {
  for (const exposedAlias of ['encrypted_password', 'token_hash', 'note', 'raw_app_meta_data', 'details']) {
    assert.doesNotMatch(sql, new RegExp(`\\bAS\\s+${exposedAlias}\\b`, 'iu'), `${exposedAlias} must not be an output alias`);
  }
  assert.doesNotMatch(sql, /\ba\.details\b/iu);
  assert.doesNotMatch(sql, /\bi\.token_hash\b/iu);
  assert.doesNotMatch(sql, /\bi\.note\b/iu);
  assert.match(sql, /has_password/);
  assert.match(sql, /has_email_provider/);
  assert.match(sql, /latest_audit_action/);
});
