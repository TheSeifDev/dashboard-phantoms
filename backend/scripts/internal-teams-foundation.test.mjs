import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '..');
const migrations = resolve(backend, 'supabase/migrations');
const migrationName = '20261120074604_internal_teams_foundation.sql';
const managementMigrationName = '20261120074634_internal_teams_owner_management.sql';
const detailsMigrationName = '20261120074653_internal_teams_update_details.sql';
const sql = await readFile(resolve(migrations, migrationName), 'utf8');
const managementSql = await readFile(resolve(migrations, managementMigrationName), 'utf8');
const detailsSql = await readFile(resolve(migrations, detailsMigrationName), 'utf8');
const pgTap = await readFile(resolve(backend, 'supabase/tests/database/15_internal_teams_foundation.test.sql'), 'utf8');
const normalized = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const management = managementSql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const details = detailsSql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

 test('foundation migration is forward-only after the applied task ledger', async () => {
  const files = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort();
  const foundationIndex = files.indexOf(migrationName);
  assert.ok(foundationIndex > 0);
  assert.equal(files[foundationIndex - 1], '20261119183000_task_contribution_ledger.sql');
  assert.equal(files[foundationIndex + 1], managementMigrationName);
  assert.equal(files[foundationIndex + 2], detailsMigrationName);
});

test('historical operational rows are not assigned or defaulted to a team', () => {
  assert.doesNotMatch(normalized, /update public\.(tasks|notes|member_evaluations|announcements|member_custom_fields|task_contribution_events)\s+set\s+team_id/);
  assert.doesNotMatch(normalized, /add column team_id uuid not null/);
  assert.doesNotMatch(normalized, /add column team_id uuid default/);
  for (const table of ['tasks', 'notes', 'member_evaluations', 'announcements', 'member_custom_fields', 'task_contribution_events']) {
    assert.match(normalized, new RegExp(`alter table public\\.${table} add column team_id uuid references public\\.teams\\(id\\) on delete restrict`));
  }
});

test('team memberships are many-to-many while one team has a single seat per role', () => {
  assert.match(normalized, /create table public\.team_memberships/);
  assert.match(normalized, /primary key \(team_id, member_id\)/);
  assert.match(normalized, /create table public\.team_admin_assignments/);
  assert.match(normalized, /unique \(team_id, user_id\)/);
  assert.match(normalized, /on public\.team_admin_assignments \(team_id, role\)/);
  assert.match(normalized, /role in \('head', 'monitor'\)/);
  assert.match(normalized, /status in \('pending', 'active', 'suspended', 'removed'\)/);
});

test('global admin identity and permission helpers remain untouched', () => {
  assert.doesNotMatch(normalized, /create\s+or\s+replace\s+function public\.is_admin\s*\(/);
  assert.doesNotMatch(normalized, /create\s+or\s+replace\s+function public\.is_owner\s*\(/);
  assert.doesNotMatch(normalized, /create\s+or\s+replace\s+function public\.has_admin_permission\s*\(/);
  assert.doesNotMatch(normalized, /insert\s+into public\.admin_accounts/);
  assert.match(normalized, /'is_admin', coalesce\(v_role in \('owner', 'admin'\), false\)/);
  assert.match(normalized, /'is_team_admin', exists/);
});

test('team permission lookup uses authenticated identity, exact role assignment, active team, and feature allowlist', () => {
  assert.match(normalized, /create function public\.has_team_permission\(p_team_id uuid, p_permission text\)/);
  assert.match(normalized, /auth\.uid\(\)/);
  assert.match(normalized, /join public\.teams as t on t\.id = a\.team_id and t\.is_active/);
  assert.match(normalized, /a\.permissions @> jsonb_build_object\(p_permission, true\)/);
  assert.match(normalized, /grant execute on function public\.has_team_permission\(uuid, text\) to authenticated/);
  assert.match(normalized, /from public, anon, service_role/);
});

test('membership existence checks do not become an authenticated-user enumeration oracle', () => {
  const helper = normalized.slice(normalized.indexOf('create function public.has_team_membership'), normalized.indexOf('create function public.has_team_member_identity'));
  assert.match(helper, /public\.has_team_permission\(p_team_id, 'members'\)/);
  assert.match(helper, /public\.member_auth_bindings b where b\.member_id=p_member_id and b\.auth_user_id=auth\.uid\(\)/);
  assert.doesNotMatch(normalized, /u\.\(/);
  assert.match(normalized, /work_status='active'/);
  assert.match(normalized, /u\.banned_until is null or u\.banned_until <= now\(\)/);
  assert.match(pgTap, /SELECT plan\(38\);/);
  assert.match(pgTap, /unassigned user cannot enumerate another member team membership/);
});

test('cross-team membership isolation is exercised against existing fixture rows', () => {
  assert.match(normalized, /create policy teams_read_global_admin_only/);
  assert.doesNotMatch(normalized, /create policy teams_read_authorized[\s\S]{0,200}team_admin_assignments/);
  assert.match(pgTap, /Software Monitor can read a membership in the assigned team/);
  assert.match(pgTap, /Software Monitor cannot read the existing Hardware membership/);
  assert.match(pgTap, /Software Monitor cannot use the team roster RPC to read Hardware/);
});

test('only Owner RPCs create teams and team-admin assignments; team roles cannot self-escalate', () => {
  for (const name of ['owner_create_team', 'owner_set_team_active', 'owner_assign_team_admin', 'owner_revoke_team_admin']) {
    const fn = normalized.slice(normalized.indexOf(`create function public.${name}`));
    assert.ok(fn.length > 0, `${name} exists`);
    assert.match(fn.slice(0, fn.indexOf('end; $$;')), /public\.is_owner\(\)/, `${name} checks Owner`);
    assert.match(normalized, new RegExp(`revoke all on function public\\.${name}\\(`));
  }
  assert.match(normalized, /create policy team_admin_assignments_read_self_or_owner/);
  assert.doesNotMatch(normalized, /create policy[^;]+on public\.team_admin_assignments\s+for (insert|update|delete)/);
});

test('membership actions are team-scoped, audited, soft-revoked, and do not change global work_status', () => {
  assert.match(normalized, /create function public\.team_add_member\(p_team_id uuid, p_member_id bigint\)/);
  assert.match(normalized, /create function public\.team_review_member\(p_team_id uuid, p_member_id bigint, p_decision text\)/);
  assert.match(normalized, /public\.has_team_permission\(p_team_id, 'members'\)/);
  assert.match(normalized, /'removed'/);
  assert.match(normalized, /insert into public\.team_access_audit/);
  assert.match(normalized, /self_review_forbidden/);
  assert.doesNotMatch(normalized, /update public\.members set work_status/);
  assert.doesNotMatch(normalized, /delete from auth\.users/);
});

test('example teams are empty and external operations are not part of the foundation migration', () => {
  assert.match(normalized, /\('software', 'software'\), \('hardware', 'hardware'\), \('ai', 'ai'\)/);
  assert.doesNotMatch(normalized, /fetch\(|http|create\s+extension/);
  assert.doesNotMatch(normalized, /service_role\)\s+with\s+grant\s+option/);
});


test('Owner can atomically replace team seats and only Owner can enumerate member candidates', () => {
  assert.match(management, /create function public\.owner_set_team_admin_seat/);
  assert.match(management, /if not public\.is_owner\(\) then raise exception 'owner_only'/);
  assert.match(management, /team_admin_already_has_other_seat/);
  assert.match(management, /'replaced_by',p_user_id/);
  assert.match(management, /create function public\.owner_list_team_member_candidates/);
  assert.match(management, /grant execute on function public\.owner_list_team_member_candidates\(uuid\) to authenticated/);
  assert.match(management, /if not public\.is_owner\(\) then raise exception 'owner_only'/);
});

test('team identity changes are Owner-only, validated, and audited with non-sensitive before/after values', () => {
  assert.match(details, /create function public\.owner_update_team_details\(p_team_id uuid, p_slug text, p_name text\)/);
  assert.match(details, /if not public\.is_owner\(\) then raise exception 'owner_only'/);
  assert.match(details, /p_slug !~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,38\}\[a-z0-9\]\$'/);
  assert.match(details, /'team_renamed'/);
  assert.match(details, /'old_name',v_old_name,'new_name',btrim\(p_name\)/);
  assert.match(details, /revoke all on function public\.owner_update_team_details\(uuid,text,text\) from public,anon/);
});
