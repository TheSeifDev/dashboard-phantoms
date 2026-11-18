import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, '../../.github/workflows/database-runtime-validation.yml');
const workflow = readFileSync(workflowPath, 'utf8');

function position(fragment) {
  const value = workflow.indexOf(fragment);
  assert.notEqual(value, -1, `workflow is missing: ${fragment}`);
  return value;
}

test('runtime workflow keeps the required branch and pinned toolchain contract', () => {
  assert.match(workflow, /^      - main$/m);
  assert.match(workflow, /^      - 'fix\/\*\*'$/m);
  assert.match(workflow, /^      - 'feat\/\*\*'$/m);
  assert.match(workflow, /NODE_VERSION: '22\.23\.4'/);
  assert.match(workflow, /SUPABASE_CLI_VERSION: '3\.1\.0'/);
  assert.equal((workflow.match(/^    runs-on: ubuntu-24\.04$/gm) ?? []).length, 2);
  assert.doesNotMatch(workflow, /runs-on: ubuntu-latest/);
  assert.equal((workflow.match(/test "\$\(node --version\)" = "v\$\{NODE_VERSION\}"/g) ?? []).length, 2);
  assert.match(workflow, /test "\$\(supabase --version 2>\/dev\/null \| head -n 1\)" = "\$\{SUPABASE_CLI_VERSION\}"/);
  assert.match(workflow, /docker context show/);
});

test('Docker loopback lock covers default and Supabase user-defined bridge networks without relaxing validation', () => {
  const lockStart = position('- name: Lock default and user-defined Docker bridge ports to loopback');
  const stackStart = position('- name: Start fresh disposable local Supabase stack');
  const migrationStart = position('- name: Validate migration manifest, immutable checksums, and local-only safety');
  const healthStart = position('- name: Verify owned stack health, PG17, and exact loopback bindings');
  const migrationHistory = position('- name: Verify local migration history and run entire history all pgTAP suites including 09 operator and 10 guards');
  const dockerLock = workflow.slice(lockStart, migrationStart);
  const healthCheck = workflow.slice(healthStart, migrationHistory);
  assert.ok(lockStart < stackStart, 'Docker default bridge options must be in place before Supabase creates its network');
  assert.match(dockerLock, /config\['ip'\] = '127\.0\.0\.1'/);
  assert.match(dockerLock, /default-network-opts/);
  assert.match(dockerLock, /com\.docker\.network\.bridge\.host_binding_ipv4/);
  assert.match(dockerLock, /bridge_defaults\['com\.docker\.network\.bridge\.host_binding_ipv4'\] = '127\.0\.0\.1'/);
  assert.match(healthCheck, /host_ip not in \("127\.0\.0\.1", "::1"\)/);
  assert.match(healthCheck, /nonLoopbackBindings/);
  assert.match(healthCheck, /containerPort/);
});

test('runtime workflow uses local migration history and retains every SQL suite', () => {
  assert.match(workflow, /supabase migration list --local --workdir backend/);
  for (const suite of [
    '01_schema_and_posture',
    '02_rbac_owner_admin',
    '03_rls_tables',
    '04_member_portal',
    '05_tasks_bonus_ratings',
    '06_invites_evaluations',
    '07_admin_member_projection',
    '08_member_password_auth',
    '09_member_password_operator',
    '10_member_password_runtime_guards',
    '11_member_password_session_guards',
    '12_member_password_limiter_storage_guards',
  ]) {
    assert.match(workflow, new RegExp(suite));
  }
});

test('disposable job installs locked frontend dependencies before runtime and always-on evidence validation', () => {
  const install = position('- name: Install locked frontend dependencies for runtime and evidence validation');
  const stackStart = position('- name: Start fresh disposable local Supabase stack');
  const finalValidator = position('- name: Validate sanitized evidence and remove forbidden runtime files');
  const browserInstall = position('- name: Install locked browser dependencies');
  const authLifecycle = position('- name: Test Auth fixture lifecycle and native process ownership');
  assert.ok(install < stackStart && install < finalValidator);
  assert.match(workflow.slice(install, stackStart), /working-directory: frontend/);
  assert.match(workflow.slice(install, stackStart), /run: npm ci --no-audit --no-fund/);
  assert.doesNotMatch(workflow.slice(browserInstall, authLifecycle), /npm ci/);
  assert.match(workflow, /cache-dependency-path: frontend\/package-lock\.json/);
});

test('bounded inventory integration runs after pgTAP, before browser fixtures, and retains only exact evidence', () => {
  const pgTap = position('supabase test db --workdir backend');
  const inventory = position('node --test backend/scripts/member-password-inventory.integration.test.mjs');
  const dashboard = position('run-disposable-dashboard-e2e.mjs');
  const sanitizer = position('- name: Validate sanitized evidence and remove forbidden runtime files');
  const upload = position('- name: Upload only fixed sanitized JSON evidence after owned stack cleanup');
  assert.ok(inventory > pgTap && inventory < dashboard && inventory < sanitizer && upload > sanitizer);
  assert.match(workflow, /apt-get install -y -qq postgresql-client/);
  assert.match(workflow, /isCompleteInventoryPaginationEvidence\(inventory\)/);
  assert.match(workflow, /member-password-inventory-pagination-evidence\.json/);
  assert.match(workflow, /CI=true PHANTOMS_DISPOSABLE_E2E=1 node --test backend\/scripts\/member-password-inventory\.integration\.test\.mjs/);
});

test('SQL evidence runs after browser/dashboard work and before sanitization', () => {
  const dashboard = position('run-disposable-dashboard-e2e.mjs');
  const sql = position('- name: Run PG17 SQL-only concurrency and validate sanitized evidence');
  const sanitizer = position('- name: Validate sanitized evidence and remove forbidden runtime files');
  assert.ok(sql > dashboard, 'SQL artifact must not be produced before dashboard cleanup');
  assert.ok(sql < sanitizer, 'SQL evidence must be validated by the final sanitizer');
  assert.match(workflow, /assert set\(evidence\) == \{'schema', 'mode', 'boundary', 'pg17', 'passed', 'checks', 'cleanupStatus'\}/);
  assert.match(workflow, /'reviewRejected': 7/);
  assert.match(workflow, /'blockedWrites': 1/);
  assert.match(workflow, /'durableAttempts': 12/);
  assert.match(workflow, /check\['passed'\] is True/);
  assert.match(workflow, /Object\.keys\(value \?\? \{\}\)/);
});

test('runtime and cleanup gates are wired without broad resource matching', () => {
  assert.match(workflow, /node --test frontend\/scripts\/local-stack-runtime\.test\.mjs/);
  assert.match(workflow, /\^phantoms-disposable-\[0-9\]\+\$/);
  assert.match(workflow, /suffix "\$"/);
  assert.match(workflow, /docker network ls -q --filter "label=com\.supabase\.cli\.project=\$project_id"/);
  assert.match(workflow, /docker network inspect --format '\{\{\.ID\}\}\\t\{\{\.Name\}\}\\t\{\{index \.Labels "com\.supabase\.cli\.project"\}\}'/);
  assert.match(workflow, /supabase_network_\$\{project_id\}/);
  assert.match(workflow, /'networksRemaining': networks/);
  assert.doesNotMatch(workflow, /index\(\$0, project\)/);
  const stop = position('- name: Stop disposable stack and verify owned cleanup');
  const upload = position('- name: Upload only fixed sanitized JSON evidence after owned stack cleanup');
  assert.ok(upload > stop, 'sanitized evidence upload must follow teardown');
});

test('cleanup failure remains fatal while always-on teardown and evidence gates run', () => {
  const stop = position('- name: Stop disposable stack and verify owned cleanup');
  const upload = position('- name: Upload only fixed sanitized JSON evidence after owned stack cleanup');
  const cleanup = workflow.slice(stop, upload);
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /::error::Disposable Supabase cleanup failed/);
  assert.match(cleanup, /if \[ "\$stop_status" -eq 0 \] && \[ -z "\$remaining" \] && \[ -z "\$volumes" \] && \[ -z "\$network_ids" \] && \[ "\$network_query_failed" -eq 0 \]; then[\s\S]*?else\s+exit 1\s+fi/);
  assert.match(workflow, /- name: Require verified owned stack cleanup/);
  assert.match(workflow, /owned disposable stack cleanup was not fully verified/);
  assert.match(workflow, /classification: cli-start-failed/);
  assert.match(workflow, /stack-start-evidence\.json/);
  assert.doesNotMatch(workflow, /docker ps --format '\{\{json \.\}\}'/);
});

test('supplemental password fixture config and exact-origin tests are required without replacing the protected helper tests', () => {
  assert.match(workflow, /run: node backend\/scripts\/configure-password-disposable-stack\.mjs/);
  assert.match(workflow, /backend\/scripts\/configure-disposable-stack\.test\.mjs/);
  assert.match(workflow, /backend\/scripts\/configure-password-disposable-stack\.test\.mjs/);
  assert.match(workflow, /member-password-enrollment\/pureorigins\.test\.ts/);
});

test('disposable Auth gate explicitly rejects public signup and requires confirmed email', () => {
  assert.match(workflow, /grep -Eq '\^enable_signup = false\$' backend\/supabase\/config\.toml/);
  assert.match(workflow, /grep -Eq '\^enable_confirmations = true\$' backend\/supabase\/config\.toml/);
  assert.match(workflow, /settings\.get\("disable_signup"\) is True/);
  assert.match(workflow, /settings\.get\("mailer_autoconfirm"\) is False/);
});
