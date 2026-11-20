import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '..');
const migrationPath = resolve(backend, 'supabase/migrations/20261120075039_internal_team_announcements.sql');
const pgTapPath = resolve(backend, 'supabase/tests/database/18_internal_team_announcements.test.sql');
const migration = await readFile(migrationPath, 'utf8');
const pgTap = await readFile(pgTapPath, 'utf8');
const normalized = migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();

function functionBlock(name) {
  const match = migration.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  assert.ok(match, `${name} function exists`);
  return match[0].replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
}

test('team announcement RPCs have exact PostgREST signatures and narrow authenticated grants', () => {
  const signatures = [
    ['team_list_announcements', 'public.team_list_announcements(uuid)', 'jsonb'],
    ['team_create_announcement', 'public.team_create_announcement(uuid, text, text, text, jsonb)', 'bigint'],
    ['team_set_announcement_active', 'public.team_set_announcement_active(uuid, bigint, boolean)', 'boolean'],
    ['team_delete_announcement', 'public.team_delete_announcement(uuid, bigint)', 'boolean'],
  ];
  for (const [name, signature] of signatures) {
    const block = functionBlock(name);
    assert.match(block, /returns\s+(?:jsonb|bigint|boolean)/);
    assert.match(block, /security definer/);
    assert.match(block, /set search_path = ''/);
    assert.match(block, /auth\.uid\(\) is null/);
    assert.match(block, /public\.teams as t where t\.id = p_team_id and t\.is_active is true/);
    assert.match(block, /public\.has_team_permission\(p_team_id, 'announcements'\)/);
    assert.match(normalized, new RegExp(`revoke all on function ${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} from public, anon, service_role`));
    assert.match(normalized, new RegExp(`grant execute on function ${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to authenticated`));
  }
  assert.match(normalized, /p_member_ids jsonb default null/);
});

test('specific audiences are validated and recipients are atomically snapshotted from active team members', () => {
  const create = functionBlock('team_create_announcement');
  assert.match(create, /jsonb_typeof\(p_member_ids\) <> 'array'/);
  assert.match(create, /duplicate_announcement_recipient/);
  assert.match(create, /announcement_recipient_not_active_team_member/);
  assert.match(create, /tm\.status = 'active'/);
  assert.match(create, /m\.work_status = 'active'/);
  assert.match(create, /insert into public\.announcement_recipients/);
  assert.match(create, /v_target_audience := '\{"type":"all"\}'::jsonb/);
  assert.match(create, /send_push, send_whatsapp/);
  assert.match(create, /false, false/);
  assert.doesNotMatch(normalized, /update public\.members\s+set/);
  assert.doesNotMatch(normalized, /insert into public\.admin_accounts/);
});

test('member portal access is device-bound or explicitly globally authorized and team receipts stay normalized', () => {
  const identity = functionBlock('announcement_member_identity');
  assert.match(identity, /public\.has_admin_permission\('announcements'\)/);
  assert.match(identity, /public\.assert_member_device\(p_member_id, p_device_token\)/);
  assert.match(identity, /b\.auth_user_id = v_user_id/);
  assert.match(identity, /b\.password_ready is true/);
  for (const name of ['get_member_announcements', 'mark_announcement_read', 'dismiss_announcement', 'mark_announcement_viewed']) {
    const block = functionBlock(name);
    assert.match(block, /set search_path = ''/);
    assert.match(block, /public\.announcement_member_identity\(p_member_id, p_device_token\)/);
    assert.match(block, /a\.team_id is null/);
    assert.match(block, /a\.is_active is true/);
    assert.match(block, /a\.expires_at is null or a\.expires_at > now\(\)/);
  }
  assert.match(functionBlock('get_member_announcements'), /public\.announcement_recipients as ar/);
  assert.match(functionBlock('get_member_announcements'), /t\.is_active is true/);
  assert.match(functionBlock('get_member_announcements'), /tm\.status = 'active'/);
  assert.match(functionBlock('mark_announcement_viewed'), /view_count = ar\.view_count \+ 1/);
  assert.match(normalized, /grant execute on function public\.get_member_announcements\(bigint, text\) to anon, authenticated/);
});

test('announcement stats and details authorize either the exact global permission or the same active team feature', () => {
  for (const name of ['get_announcement_stats', 'get_announcement_details']) {
    const block = functionBlock(name);
    assert.match(block, /auth\.uid\(\) is null/);
    assert.match(block, /public\.has_admin_permission\('announcements'\)/);
    assert.match(block, /public\.has_team_permission\(v_team_id, 'announcements'\)/);
    assert.match(block, /public\.teams as t where t\.id = v_team_id and t\.is_active is true/);
    assert.match(block, /public\.announcement_recipients as ar/);
    assert.match(block, /tm\.status = 'active'/);
    assert.match(block, /m\.work_status = 'active'/);
  }
  assert.doesNotMatch(normalized, /if not coalesce\(v_is_admin/);
});

test('migration adds no broad table policies or provider sends and preserves global NULL-scope receipt logic', () => {
  assert.match(normalized, /a\.team_id is null/);
  assert.match(normalized, /read_receipts = pg_catalog\.jsonb_set/);
  assert.doesNotMatch(normalized, /create\s+(?:or replace\s+)?function public\.(?:is_admin|is_owner|has_admin_permission)\s*\(/);
  assert.doesNotMatch(normalized, /create policy|grant\s+[^;]*\s+on\s+public\.announcements/);
  assert.doesNotMatch(normalized, /fetch\s*\(|net\.http|sendgrid|twilio|webhook/);
  assert.match(normalized, /send_push, send_whatsapp/);
  assert.match(normalized, /false, false/);
});

test('rollback pgTAP covers audience, device, active membership, global portal, and cross-team boundaries', () => {
  assert.match(pgTap, /^BEGIN;/);
  assert.match(pgTap, /SELECT no_plan\(\);/);
  assert.match(pgTap, /\\ir _helpers\.psql/);
  assert.match(pgTap, /ROLLBACK;/);
  for (const phrase of [
    'publish-time snapshot',
    'specific audience rejects an active member from another team',
    'device token for a different member cannot read this portal identity',
    'anonymous device-token-only portal transport remains denied by password guards',
    'team-only role cannot view global announcement stats',
    'another team cannot inspect Software announcement statistics',
    'global announcements permission is the explicit device-free exception',
  ]) assert.ok(pgTap.toLowerCase().includes(phrase.toLowerCase()), `pgTAP covers ${phrase}`);
});
