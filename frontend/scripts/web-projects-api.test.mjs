import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = new URL('../src/features/web-projects/', import.meta.url);
const api = readFileSync(fileURLToPath(new URL('api.ts', base)), 'utf8');
const resources = readFileSync(fileURLToPath(new URL('ResourcesPanel.tsx', base)), 'utf8');

test('project repository selects separate existing admin/member Auth clients explicitly', () => {
  assert.match(api, /mode === 'member' \? memberSupabase : supabase/);
  assert.doesNotMatch(api, /createClient\(/);
});
test('every feature query is keyed by both role mode and canonical account identity', () => {
  assert.match(api, /const actor = mode === 'member' \? memberId : userId/);
  assert.match(api, /\['web-projects', mode, actor\]/);
  assert.match(api, /enabled: scope.enabled && enabled/);
  assert.match(api, /invalidateQueries\(\{ queryKey: scope.key \}\)/);
});
test('feature repository never writes Internal Teams or legacy task tables', () => {
  assert.doesNotMatch(api, /['"](?:tasks|teams|team_memberships|members|admin_accounts)['"]/);
  assert.match(api, /if \(!TABLES.has\(input.table\)/);
  assert.match(api, /if \(!RPCS.has\(name\)\)/);
});
test('bulk-unscoped writes and direct task transitions fail closed', () => {
  assert.match(api, /input.operation !== 'insert' && !input.id && !Object.keys\(input.filters/);
  assert.match(api, /Task status changes require the transition RPC/);
  assert.match(api, /No authorized row changed/);
  assert.match(api, /rows.length < pageSize/);
  assert.match(api, /exceeds the supported page limit/);
});
test('shared-resource edits never change scope and URLs are checked before use', () => {
  assert.match(resources, /editing === 'new' \? \{ project_id: null, scope_id:/);
  assert.match(resources, /const external = safeHref/);
  assert.match(resources, /File uploads require a configured private bucket/);
});

test('Web Projects upgrade validates the replacement constraint before backfilling existing admin rows', () => {
  const migration = readFileSync(fileURLToPath(new URL('../../backend/supabase/migrations/20261120223000_web_projects_foundation.sql', import.meta.url)), 'utf8');
  const drop = migration.indexOf('DROP CONSTRAINT IF EXISTS admin_accounts_permissions_valid');
  const add = migration.indexOf('ADD CONSTRAINT admin_accounts_permissions_valid CHECK (');
  const update = migration.indexOf('UPDATE public.admin_accounts');
  const end = migration.indexOf("    ]::text[] = '{}'::jsonb\n  );", add);
  assert.ok(drop >= 0 && add > drop && end > add && update > end);
  assert.match(migration.slice(add, update), /COALESCE\(jsonb_typeof\(permissions -> 'web_projects'\) = 'boolean', TRUE\)/);
  assert.match(migration.slice(update), /SET permissions = permissions \|\| '\{"web_projects":false\}'::jsonb\nWHERE NOT \(permissions \? 'web_projects'\);/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration.trimEnd(), /COMMIT;$/);
});
