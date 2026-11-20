import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '..');
const migration = await readFile(resolve(backend, 'supabase/migrations/20261120074944_internal_team_records.sql'), 'utf8');
const pgTap = await readFile(resolve(backend, 'supabase/tests/database/17_internal_team_records.test.sql'), 'utf8');
const normalized = migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const normalizedPgTap = pgTap.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

const contracts = [
  ['team_list_notes', 'uuid'],
  ['team_create_note', 'uuid, text, bigint'],
  ['team_delete_note', 'uuid, bigint'],
  ['team_list_evaluations', 'uuid'],
  ['team_create_evaluation', 'uuid, bigint, text, text, int, text'],
  ['team_delete_evaluation', 'uuid, bigint'],
  ['team_list_ranking', 'uuid'],
  ['team_list_custom_fields', 'uuid'],
  ['team_create_custom_field', 'uuid, text, text, jsonb'],
  ['team_set_custom_field_value', 'uuid, bigint, bigint, jsonb'],
  ['team_list_custom_field_values', 'uuid, bigint'],
];

function functionDefinition(name) {
  const start = normalized.indexOf(`create function public.${name}(`);
  assert.notEqual(start, -1, `${name} is defined`);
  const end = normalized.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} body is terminated`);
  return normalized.slice(start, end + 3);
}

function replacementFunctionDefinition(name) {
  const start = normalized.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} replacement is defined`);
  const end = normalized.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} replacement body is terminated`);
  return normalized.slice(start, end + 3);
}

test('every assigned team-record RPC is SECURITY DEFINER, search-path hardened, and explicitly granted only to authenticated', () => {
  for (const [name, signature] of contracts) {
    const definition = functionDefinition(name);
    assert.match(definition, /security definer set search_path = ''/i, `${name} has an empty search_path`);
    assert.match(definition, /auth\.uid\(\) is null/, `${name} explicitly requires an authenticated identity`);
    assert.match(definition, /v_team_active/, `${name} explicitly loads active team state`);
    assert.match(definition, /not v_team_active/, `${name} rejects disabled teams`);
    assert.match(normalized, new RegExp(`revoke all on function public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) from public, anon`));
    assert.match(normalized, new RegExp(`grant execute on function public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) to authenticated`));
    assert.match(normalizedPgTap, new RegExp(`public\\.${name}\\(`), `${name} is exercised in pgTAP`);
  }
});

test('notes and evaluation RPCs enforce their separate team feature permissions and active-member targets', () => {
  for (const name of ['team_list_notes', 'team_create_note', 'team_delete_note']) {
    assert.match(functionDefinition(name), /public\.has_team_permission\(p_team_id, 'notes'\)/, `${name} requires team notes permission`);
  }
  for (const name of ['team_list_evaluations', 'team_create_evaluation', 'team_delete_evaluation', 'team_list_ranking']) {
    assert.match(functionDefinition(name), /public\.has_team_permission\(p_team_id, 'ranking'\)/, `${name} requires team ranking permission`);
  }
  for (const name of ['team_list_custom_fields', 'team_create_custom_field', 'team_set_custom_field_value', 'team_list_custom_field_values']) {
    assert.match(functionDefinition(name), /public\.has_team_permission\(p_team_id, 'members'\)/, `${name} requires team members permission`);
  }
  assert.match(functionDefinition('team_create_note'), /tm\.status = 'active'/);
  assert.match(functionDefinition('team_create_evaluation'), /tm\.status = 'active'/);
  assert.match(functionDefinition('team_set_custom_field_value'), /tm\.status = 'active'/);
  assert.match(normalized, /m\.work_status = 'active'/);
});

test('team records stay isolated from global notes, canonical member rank, and legacy custom-field values', () => {
  assert.match(functionDefinition('team_create_note'), /target_member_id, target_name, team_id/);
  assert.match(functionDefinition('team_create_note'), /team administration/);
  assert.match(functionDefinition('team_create_note'), /position\('\[b:' in upper\(p_text\)\)/);
  assert.match(functionDefinition('team_create_evaluation'), /bonus_note_id, created_by, team_id/);
  assert.match(functionDefinition('team_create_evaluation'), /team_member_metrics/);
  assert.match(functionDefinition('team_create_evaluation'), /if p_points > 0 then/);
  assert.match(functionDefinition('team_delete_evaluation'), /team_member_metrics/);
  assert.match(functionDefinition('team_delete_evaluation'), /bonus_points >= v_points::bigint/);
  assert.match(functionDefinition('team_delete_evaluation'), /team_metric_reversal_blocked/);
  assert.doesNotMatch(normalized, /update public\.members\s+set\s+(completion_rank|bonus_infinite|custom_fields)/);
  assert.match(functionDefinition('team_create_custom_field'), /public\.member_custom_fields/);
  assert.match(functionDefinition('team_create_custom_field'), /team_id/);
  assert.match(functionDefinition('team_set_custom_field_value'), /public\.team_member_custom_field_values/);
  assert.doesNotMatch(functionDefinition('team_set_custom_field_value'), /update public\.members/);
  assert.match(functionDefinition('team_list_ranking'), /public\.team_member_metrics/);
  assert.match(functionDefinition('team_list_ranking'), /tm\.status = 'active'/);
  assert.match(normalizedPgTap, /notes permission does not cross team boundaries/);
  assert.match(normalizedPgTap, /team notes remain scoped and are not stored as global notes/);
  assert.match(normalizedPgTap, /team evaluation operations leave canonical global completion rank unchanged/);
  assert.match(normalizedPgTap, /team custom-field values do not write to the legacy member json\/custom-field storage/);
});

test('team custom-field value validation matches definition type and select options', () => {
  const setValue = functionDefinition('team_set_custom_field_value');
  assert.match(setValue, /when 'short_text'/);
  assert.match(setValue, /when 'long_text'/);
  assert.match(setValue, /when 'number'/);
  assert.match(setValue, /when 'date'/);
  assert.match(setValue, /when 'yes_no'/);
  assert.match(setValue, /when 'select'/);
  assert.match(setValue, /jsonb_array_elements_text\(v_field\.options\)/);
  assert.match(functionDefinition('team_create_custom_field'), /jsonb_array_length\(p_options\) not between 1 and 100/);
  assert.match(functionDefinition('team_create_custom_field'), /options_only_allowed_for_select/);
  assert.match(normalizedPgTap, /select custom-field values must match the declared options/);
  assert.match(normalizedPgTap, /custom-field option labels cannot be blank/);
});

test('device-bound evaluation APIs preserve global rows and require the same active team membership for scoped rows', () => {
  for (const name of ['get_member_evaluations', 'mark_member_evaluation_read']) {
    const definition = replacementFunctionDefinition(name);
    assert.match(definition, /public\.assert_member_device\(p_member_id, p_device_token\)/);
    assert.match(definition, /e\.team_id is null or exists/);
    assert.match(definition, /tm\.team_id = e\.team_id and tm\.member_id = e\.member_id/);
    assert.match(definition, /tm\.status = 'active'/);
    assert.match(definition, /t\.is_active/);
    assert.match(definition, /m\.work_status = 'active'/);
  }
  assert.match(normalizedPgTap, /device-bound member cannot read an evaluation from a suspended other-team membership/);
  assert.match(normalizedPgTap, /device-bound member cannot acknowledge an evaluation from a suspended other team/);
  assert.match(normalizedPgTap, /device-bound member receives legacy global and own active-team evaluations only/);
});

test('pgTAP suite creates only transactional fixtures and rolls them back', () => {
  assert.match(pgTap, /^BEGIN;/);
  assert.match(pgTap, /SELECT no_plan\(\);/);
  assert.match(pgTap, /SELECT \* FROM finish\(\);/);
  assert.match(pgTap.trim(), /ROLLBACK;$/);
  assert.match(normalizedPgTap, /notes permission does not cross team boundaries/);
  assert.match(normalizedPgTap, /evaluation target must be an active member of the same team/);
  assert.match(normalizedPgTap, /custom-field values require an active same-team member/);
});
