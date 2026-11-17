import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const branches = ['fix/phantoms-production-init-wxwo', 'fix/phantoms-member-projections-wxwo'];
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Git integration deployment is disabled only for both approved no-deployment branches at both roots', () => {
  for (const path of ['vercel.json', 'frontend/vercel.json']) {
    const config = JSON.parse(read(path));
    assert.deepEqual(config.git.deploymentEnabled, Object.fromEntries(branches.map((branch) => [branch, false])));
  }
});

test('legacy deployment workflow excludes this PR from health and preview paths', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const qualityGuard = workflow.match(/quality:\s*#[^\n]*\n\s*if: ([^\n]+)/)?.[1];
  const previewGuard = workflow.match(/if: github\.event_name == 'pull_request'([^\n]+)/)?.[1];
  for (const branch of branches) {
    assert.ok(qualityGuard?.includes(`github.head_ref != '${branch}'`));
    assert.ok(previewGuard?.includes(`github.head_ref != '${branch}'`));
  }
});

test('disposable workflow has no production credentials, remote database commands, repair, push, or deployment steps', () => {
  const workflow = read('.github/workflows/database-runtime-validation.yml');
  assert.doesNotMatch(workflow, /secrets\.|--remote|--linked|--db-url|migration repair|db push|vercel deploy/);
  assert.match(workflow, /test ! -e backend\/supabase\/\.temp\/project-ref/);
  assert.match(workflow, /for name in \\\n[\s\S]*?SUPABASE_ACCESS_TOKEN[\s\S]*?; do\s+test -z "\$\{!name:-\}"/);
  assert.match(workflow, /supabase start --workdir backend/);
  assert.match(workflow, /supabase test db --workdir backend/);
  assert.match(workflow, /supabase stop --workdir backend --no-backup/);
  assert.match(workflow, /VITE_SUPABASE_URL: http:\/\/127\.0\.0\.1:54321/);
});

test('dashboard browser evidence is local-only and uploads only fixed sanitized JSON without screenshots or traces', () => {
  const workflow = read('.github/workflows/database-runtime-validation.yml');
  assert.match(workflow, /PHANTOMS_DISPOSABLE_E2E: '1'/);
  assert.match(workflow, /node scripts\/run-disposable-dashboard-e2e\.mjs/);
  const uploadBlock = workflow.match(/name: Upload only fixed sanitized JSON evidence after owned stack cleanup[\s\S]*?retention-days: 7/)?.[0] ?? '';
  assert.match(uploadBlock, /frontend\/test-results\/dashboard-contract-missing\.json/);
  assert.match(uploadBlock, /frontend\/test-results\/dashboard-contract-invalid\.json/);
  assert.doesNotMatch(uploadBlock, /dashboard-.*\.png|playwright-report|trace\.zip|storageState/);
  assert.doesNotMatch(workflow, /playwright-report|trace\.zip|storageState/);
});
