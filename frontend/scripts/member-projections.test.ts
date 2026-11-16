import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_MEMBER_COLUMNS, PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS } from '../src/features/members/memberColumns.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const readSource = (relativePath: string) => readFileSync(path.join(FRONTEND, relativePath), 'utf8');
const api = readSource('src/features/members/api.ts');
const inviteApi = readSource('src/features/members/memberInviteApi.ts');

const ADMIN_COLUMNS = [
  'id', 'created_at', 'email', 'full_name', 'completion_rank', 'team_notes',
  'residence', 'work_conditions', 'bio', 'phone', 'device', 'gender',
  'meeting_attendance', 'work_status', 'can_go_alexandria', 'bonus_infinite', 'custom_fields',
];
const PUBLIC_PROJECTION =
  'id, created_at, email, full_name, completion_rank, bio, device, meeting_attendance, work_status, can_go_alexandria';

function projectionLiteral(source: string, constantName: string) {
  const match = source.match(new RegExp(`${constantName}\\s*=\\s*['"]([^'"]+)['"]`));
  assert.ok(match, `${constantName} literal was not found`);
  return match[1];
}

test('actual exported administrator projection contains exactly the 17 safe columns', () => {
  assert.equal(ADMIN_MEMBER_COLUMNS, ADMIN_COLUMNS.join(','));
  assert.deepEqual(ADMIN_MEMBER_COLUMNS.split(','), ADMIN_COLUMNS);
  assert.equal(new Set(ADMIN_MEMBER_COLUMNS.split(',')).size, 17);
  assert.doesNotMatch(ADMIN_MEMBER_COLUMNS, /session_token|push_subscription/);
  assert.match(api, /export \{ ADMIN_MEMBER_COLUMNS \} from '\.\/memberColumns'/);
});

test('the pre-custom-fields projection omits only the unavailable column and remains secret-free', () => {
  assert.deepEqual(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS.split(','), ADMIN_COLUMNS.filter((column) => column !== 'custom_fields'));
  assert.equal(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS.split(',').length, 16);
  assert.doesNotMatch(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS, /session_token|push_subscription|custom_fields/);
});

test('the restricted public member projection remains unchanged', () => {
  assert.equal(projectionLiteral(api, 'PUBLIC_MEMBER_COLUMNS'), PUBLIC_PROJECTION);
  assert.match(api, /\.select\(PUBLIC_MEMBER_COLUMNS\)/);
});

test('authenticated member list uses explicit projection and no wildcard result selections remain', () => {
  assert.match(api, /if \(sessionData\.session\)[\s\S]*?\.select\(ADMIN_MEMBER_COLUMNS\)\.order\('full_name'/);
  for (const source of [api, inviteApi]) {
    assert.doesNotMatch(source, /\.select\(\s*['"]\*['"]\s*\)|\.select\(\s*\)/);
  }
});

test('member create/update/upsert primary responses and existing fallback responses remain explicit', () => {
  assert.equal((api.match(/\.select\(ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 4);
  assert.equal((api.match(/\.select\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 3);
  for (const operation of ['insert', 'update', 'upsert']) {
    assert.match(api, new RegExp(`\\.${operation}\\([\\s\\S]*?\\.select\\(ADMIN_MEMBER_COLUMNS\\)`));
  }
  for (const [operation, payload] of [['insert', 'fallbackPayload'], ['update', 'fallbackPayload'], ['upsert', 'fallbackRows']]) {
    assert.match(api, new RegExp(`if \\(isMissingCustomFieldsColumnError\\(error\\)\\)[\\s\\S]*?\\.${operation}\\(${payload}[\\s\\S]*?\\.select\\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\\)`));
  }
});

test('invitation registration primary update and both legacy paths use safe compatible projections', () => {
  assert.equal((inviteApi.match(/\.select\(ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 1);
  assert.equal((inviteApi.match(/\.select\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\)/g) ?? []).length, 2);
  assert.match(inviteApi, /\.update\(updateBody\)[\s\S]*?\.select\(ADMIN_MEMBER_COLUMNS\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(inviteApi, /team_notes: packTeamNotesWithCustomFields[\s\S]*?\.select\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(inviteApi, /const allMembersRes = await supabase[\s\S]*?\.from\(TABLES\.members\)[\s\S]*?\.select\(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS\)/);
});

test('member result selections exclude secrets while write-field protections remain intact', () => {
  assert.doesNotMatch(`${api}\n${inviteApi}`, /\.select\([^)]*(?:session_token|push_subscription)/);
  assert.match(api, /MEMBER_WRITABLE_FIELDS/);
  assert.match(api, /session_token: _st, push_subscription: _ps/);
});
