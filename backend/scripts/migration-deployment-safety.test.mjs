import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const branch = 'fix/phantoms-production-init-wxwo';
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Git integration deployment is disabled only for the database-only branch at both project roots', () => {
  for (const path of ['vercel.json', 'frontend/vercel.json']) {
    const config = JSON.parse(read(path));
    assert.deepEqual(config.git.deploymentEnabled, { [branch]: false });
  }
});

test('legacy deployment workflow excludes this PR from health and preview paths', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /quality:\s*#[^\n]*\n\s*if: github\.head_ref != 'fix\/phantoms-production-init-wxwo'/);
  assert.match(workflow, /if: github\.event_name == 'pull_request' && github\.head_ref != 'fix\/phantoms-production-init-wxwo'/);
});

test('disposable workflow has no production credentials, remote database commands, repair, push, or deployment steps', () => {
  const workflow = read('.github/workflows/database-runtime-validation.yml');
  assert.doesNotMatch(workflow, /secrets\.|--remote|--linked|--db-url|migration repair|db push|vercel deploy/);
  assert.match(workflow, /test ! -e backend\/supabase\/\.temp\/project-ref/);
  assert.match(workflow, /test -z "\$\{SUPABASE_ACCESS_TOKEN:-\}"/);
  assert.match(workflow, /supabase start --workdir backend/);
  assert.match(workflow, /supabase test db --workdir backend/);
  assert.match(workflow, /supabase stop --workdir backend --no-backup/);
  assert.match(workflow, /VITE_SUPABASE_URL: http:\/\/127\.0\.0\.1:54321/);
});
