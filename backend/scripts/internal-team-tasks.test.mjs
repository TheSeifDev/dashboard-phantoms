import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '..');
const migrations = resolve(backend, 'supabase/migrations');
const migrationName = '20261120074850_internal_team_tasks.sql';
const sql = await readFile(resolve(migrations, migrationName), 'utf8');
const pgTap = await readFile(resolve(backend, 'supabase/tests/database/16_internal_team_tasks.test.sql'), 'utf8');
const normalized = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const testSql = pgTap.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

function functionDefinition(name) {
  const start = normalized.indexOf(`function public.${name}(`);
  assert.notEqual(start, -1, `${name} is defined`);
  const end = normalized.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} body terminates`);
  return normalized.slice(start, end + 3);
}

test('team task migration is forward-only after shared team access hardening', async () => {
  const files = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort();
  const ownIndex = files.indexOf(migrationName);
  assert.ok(ownIndex > 0, 'assigned migration is present in the forward migration chain');
  assert.equal(files[ownIndex - 1], '20261120074723_internal_team_access_hardening.sql');
  assert.ok(files.indexOf('20261120074604_internal_teams_foundation.sql') < ownIndex);
  assert.ok(files.indexOf('20261120074634_internal_teams_owner_management.sql') < ownIndex);
  assert.ok(files.indexOf('20261120074653_internal_teams_update_details.sql') < ownIndex);
});

test('all required RPC names, exact SQL argument types, and return types are present', () => {
  const contracts = [
    /create (or replace )?function public\.team_list_tasks\(p_team_id uuid\) returns jsonb/,
    /create function public\.team_create_task\( p_team_id uuid, p_title text, p_description text, p_assigned_to jsonb, p_has_deadline boolean, p_deadline_date timestamptz, p_bonus_points int \) returns bigint/,
    /create function public\.team_delete_task\(p_team_id uuid,p_task_id bigint\) returns boolean/,
    /create function public\.team_review_task\( p_team_id uuid, p_task_id bigint, p_member_id bigint, p_action text, p_reason text \) returns jsonb/,
    /create function public\.get_team_task_contributions\( p_team_id uuid, p_year int, p_member_id bigint default null \) returns jsonb/,
    /create or replace function public\.get_member_tasks\(p_member_id bigint,p_device_token text\) returns jsonb/,
    /create or replace function public\.submit_task_status\( p_task_id bigint, p_member_id bigint, p_device_token text default null, p_status text default 'under_review', p_note text default '', p_submission_url text default '' \) returns jsonb/,
    /create (or replace )?function public\.team_list_roster\(p_team_id uuid, p_feature text\) returns jsonb/,
  ];
  for (const contract of contracts) assert.match(normalized, contract);
});

test('each client-callable SECURITY DEFINER RPC authenticates, checks active team and exact feature, and is tightly granted', () => {
  const rpcGrants = [
    ['team_list_tasks', 'uuid'],
    ['team_create_task', 'uuid,text,text,jsonb,boolean,timestamptz,int'],
    ['team_delete_task', 'uuid,bigint'],
    ['team_review_task', 'uuid,bigint,bigint,text,text'],
    ['get_team_task_contributions', 'uuid,int,bigint'],
    ['team_list_roster', 'uuid,text'],
  ];
  for (const [name, signature] of rpcGrants) {
    const fn = functionDefinition(name);
    assert.match(fn, /security definer set search_path = ''/i, `${name} has an empty search_path`);
    assert.match(fn, /auth\.uid\(\) is null/, `${name} requires an authenticated identity`);
    assert.match(fn, /is_active/, `${name} verifies active team state`);
    assert.match(normalized, new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) from public,anon,service_role`));
    assert.match(normalized, new RegExp(`grant execute on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) to authenticated`));
  }
  assert.match(functionDefinition('team_list_tasks'), /has_team_permission\(p_team_id,'tasks'\)/);
  assert.match(functionDefinition('team_create_task'), /has_team_permission\(p_team_id,'tasks'\)/);
  assert.match(functionDefinition('team_delete_task'), /has_team_permission\(p_team_id,'tasks'\)/);
  assert.match(functionDefinition('team_review_task'), /has_team_permission\(p_team_id,'tasks'\)/);
  assert.match(functionDefinition('get_team_task_contributions'), /has_team_permission\(p_team_id,'dashboard'\)/);
});

test('team assignment JSON is normalized and server-validated against active same-team members', () => {
  const create = functionDefinition('team_create_task');
  assert.match(create, /jsonb_typeof\(p_assigned_to\)<>'array'/);
  assert.match(create, /v_target_text !~ '\^\[1-9\]\[0-9\]\{0,18\}\$'/);
  assert.match(create, /tm\.team_id=p_team_id and tm\.member_id=v_target_id/);
  assert.match(create, /tm\.status='active' and m\.work_status='active'/);
  assert.match(create, /v_target_id=any\(v_target_ids\)/);
  assert.match(create, /to_jsonb\('all'::text\)/);
  assert.match(testSql, /rejects an active member from another team/);
  assert.match(testSql, /rejects non-array target json/);
});

test('team-scoped task writes are narrow, immutable in scope, and direct global-row behavior is preserved', () => {
  const guard = functionDefinition('guard_team_task_mutation');
  assert.match(guard, /create:/);
  assert.match(guard, /delete:/);
  assert.match(guard, /member_submit:/);
  assert.match(guard, /review:/);
  assert.match(guard, /team_task_scope_immutable/);
  assert.match(normalized, /before insert or update or delete on public\.tasks/);
  assert.match(pgTap, /direct global task-table insert cannot forge team scope/);
  assert.match(pgTap, /global approval still updates only the global canonical rank/);
});

test('team approvals and reversals use team metrics and scoped append-only events, not canonical member rank or global notes', () => {
  const review = functionDefinition('team_review_task');
  assert.match(review, /team_member_metrics/);
  assert.match(review, /v_status is distinct from 'under_review'/);
  assert.match(review, /v_status is distinct from 'approved'/);
  assert.match(review, /set completion_rank=v_new_rank,bonus_points=mm\.bonus_points\+v_bonus_delta/);
  assert.match(review, /set completion_rank=v_new_rank,bonus_points=greatest\(0,mm\.bonus_points-v_bonus_delta\)/);
  assert.match(functionDefinition('capture_task_contribution_transition'), /team_id\)/);
  assert.match(functionDefinition('get_team_task_contributions'), /e\.team_id=p_team_id/);
  assert.doesNotMatch(normalized, /update public\.members\s+set/);
  assert.doesNotMatch(review, /insert into public\.notes/);
  assert.match(pgTap, /team approval never changes canonical global member rank/);
  assert.match(pgTap, /team contribution summary counts approvals but does not subtract reversals/);
});

test('member portal reuses device guards and restricts team tasks to active membership and assignment', () => {
  const list = functionDefinition('get_member_tasks');
  const submit = functionDefinition('submit_task_status');
  assert.match(list, /perform public\.assert_member_device\(p_member_id,p_device_token\)/);
  assert.match(list, /public\.has_team_member_identity\(t\.team_id,p_member_id\)/);
  assert.match(submit, /perform public\.assert_member_device\(p_member_id,p_device_token\)/);
  assert.match(submit, /tm\.status='active' and m\.work_status='active'/);
  assert.match(submit, /public\.has_team_member_identity\(v_team_id,p_member_id\)/);
  assert.match(submit, /admin_approval_forbidden/);
  assert.match(pgTap, /existing device identity guard/);
  assert.match(pgTap, /without active membership in its team/);
  assert.match(pgTap, /anonymous device-token-only team submission remains denied by the password guard/);
});

test('global contribution reader excludes all team events without changing the applied ledger migration', () => {
  assert.match(functionDefinition('get_task_contributions'), /e\.team_id is null/);
  assert.match(functionDefinition('get_team_task_contributions'), /e\.team_id=p_team_id/);
  assert.match(pgTap, /team approval events remain excluded from the legacy global heatmap/);
});

test('active-only roster and rollback pgTAP exercise privacy, permissions, ledger safety, and global compatibility', () => {
  const roster = functionDefinition('team_list_roster');
  assert.match(roster, /tm\.status='active' and m\.work_status='active'/);
  assert.match(roster, /'member_id',m\.id/);
  assert.match(roster, /'full_name',m\.full_name/);
  assert.match(roster, /'membership_status',tm\.status/);
  assert.doesNotMatch(roster, /'email'|'phone'/);
  assert.match(testSql, /select no_plan\(\)/);
  assert.match(testSql, /task with ledger history cannot be deleted after reversal/);
  assert.match(testSql, /global contribution event retains null team scope/);
  assert.match(testSql, /rollback/);
});
