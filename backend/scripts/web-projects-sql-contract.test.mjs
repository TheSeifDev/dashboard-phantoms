import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const migrationPath = 'backend/supabase/migrations/20261120223000_web_projects_foundation.sql';
const migration = readFileSync(resolve(root, migrationPath), 'utf8');
const helper = readFileSync(resolve(root, 'backend/supabase/tests/database/_helpers.psql'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'backend/supabase/forward-migration-manifest.json'), 'utf8'));
const webProjects = manifest.find((entry) => entry.version === '20261120223000');

function tableDefinition(name) {
  const match = migration.match(new RegExp(`CREATE TABLE public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `expected CREATE TABLE public.${name}`);
  return match[1];
}

test('Web Projects SQL migration is additive, transactional, and keeps unique table columns', () => {
  assert.match(migration, /\nBEGIN;/);
  assert.match(migration.trimEnd(), /COMMIT;$/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM public\.(tasks|members)/i);
  const tables = [...migration.matchAll(/CREATE TABLE public\.([a-z0-9_]+) \(([\s\S]*?)\n\);/g)];
  assert.ok(tables.length >= 20, 'migration creates the expected domain tables');
  for (const [, tableName, body] of tables) {
    const columns = [...body.matchAll(/^  ([a-z][a-z0-9_]*)\s+/gm)].map(([, name]) => name);
    assert.equal(new Set(columns).size, columns.length, `${tableName} has duplicate column declarations`);
  }
  assert.match(tableDefinition('web_project_member_reports'), /status TEXT NOT NULL DEFAULT 'submitted' CHECK/);
  assert.match(tableDefinition('web_project_tasks'), /FOREIGN KEY \(project_id, milestone_id\)/);
});

test('authorization stays project-scoped and task status is RPC-only', () => {
  assert.match(migration, /m\.accepted_agreement_version = p\.current_agreement_version/);
  assert.match(migration, /CREATE POLICY web_project_resource_refs_insert[\s\S]*?AND public\.web_is_project_lead\(project_id\)/);
  assert.doesNotMatch(migration, /CREATE POLICY web_project_resource_refs_insert[\s\S]{0,220}web_can_access_project\(project_id\)/);
  assert.match(migration, /GRANT UPDATE \(title, description, priority, start_date, due_date, estimated_effort,[\s\S]*?actual_effort, labels, parent_task_id, milestone_id, sprint_id, updated_at\)\s+ON public\.web_project_tasks/);
  assert.doesNotMatch(migration, /GRANT UPDATE \([^)]*status[^)]*\)\s+ON public\.web_project_tasks/);
  assert.match(migration, /CREATE FUNCTION public\.web_delete_project_task\([\s\S]*?SET status = 'cancelled'/);
});

test('unsafe task attachment links fail closed and shared resources do not create invalid project audit rows', () => {
  assert.match(tableDefinition('web_project_task_attachments'), /external_url IS NULL OR external_url ~\* '\^https\?:\/\//);
  assert.match(migration, /TG_TABLE_NAME = 'web_resources' AND NULLIF\(v_source ->> 'project_id',''\) IS NULL/);
});

test('deliverable request/resubmission, shared-resource approval and metadata-only integrations are supported narrowly', () => {
  assert.match(migration, /CREATE POLICY web_project_deliverables_lead_request[\s\S]*?status = 'draft' AND submitted_at IS NULL/);
  assert.match(migration, /CREATE POLICY web_project_deliverables_member_resubmit[\s\S]*?status IN \('draft','submitted'\)/);
  assert.match(migration, /CREATE TRIGGER web_project_deliverable_review_metadata/);
  assert.match(migration, /scope_id = project_id\)\)\n  \);/);
  assert.match(tableDefinition('web_project_integrations'), /'figma','design','product','live_demo'/);
  assert.match(tableDefinition('web_project_integrations'), /connection_state TEXT NOT NULL DEFAULT 'metadata_only' CHECK \(connection_state = 'metadata_only'\)/);
});

test('progress is derived in invoker-security views, not stored as a completion input', () => {
  for (const name of ['web_project_progress','web_project_milestone_progress','web_project_sprint_progress']) {
    assert.match(migration, new RegExp(`CREATE VIEW public\\.${name} WITH \\(security_invoker = true\\)`));
  }
  assert.doesNotMatch(tableDefinition('web_projects'), /progress_percent|completion_percentage/);
  assert.doesNotMatch(tableDefinition('web_project_milestones'), /progress_percent|completion_percentage/);
  assert.doesNotMatch(tableDefinition('web_project_sprints'), /progress_percent|completion_percentage/);
});

test('registered Web Projects migration keeps historical applied provenance', () => {
  assert.ok(manifest.every((entry) => entry.production_status === 'applied'));
  assert.ok(webProjects);
  assert.equal(manifest.filter((entry) => entry.version === '20261120223000').length, 1);
  assert.equal(manifest.find((entry) => entry.version === '20261120223000'), webProjects);
  assert.ok(manifest.length > 20);
  assert.equal(webProjects.version, '20261120223000');
  assert.equal(webProjects.name, 'web_projects_foundation');
  assert.equal(webProjects.production_status, 'applied');
  assert.equal(webProjects.remote_applied_timestamp, '20261120223727');
  assert.equal(webProjects.original_source_version, webProjects.version);
  assert.equal(webProjects.original_source_filename, webProjects.canonical_repository_filename);
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, webProjects.canonical_repository_filename))).digest('hex'), webProjects.sha256);
});

test('legacy Internal Teams permissions remain eight-key; only admin fixture grant appends the false feature bit', () => {
  assert.match(helper, /CREATE FUNCTION phantoms_test\.perms\(VARIADIC p_enabled TEXT\[\]\)/,
    'legacy eight-key permission helper remains available');
  assert.match(helper, /ARRAY\['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant'\]/);
  assert.doesNotMatch(helper.slice(helper.indexOf('CREATE FUNCTION phantoms_test.perms(VARIADIC'), helper.indexOf('-- Switch the session')),
    /web_projects/);
  assert.match(helper, /WHEN p_permissions \? 'web_projects' THEN p_permissions[\s\S]*?ELSE p_permissions \|\| '\{"web_projects":false\}'::jsonb/);
});
