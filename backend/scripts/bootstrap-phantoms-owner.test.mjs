import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = new URL('./bootstrap-phantoms-owner.mjs', import.meta.url);
const ref = 'wxwoaputugxwysuhcebv';
const owner = '11111111-1111-4111-8111-111111111111';
const env = {
  ...process.env,
  PHANTOMS_INITIAL_OWNER_ID: owner,
  PHANTOMS_SUPABASE_PROJECT_REF: ref,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-server-key-not-a-real-key',
};
function reject(overrides, message) {
  const result = spawnSync(process.execPath, [script.pathname], {
    env: { ...env, ...overrides }, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, message);
  assert.doesNotMatch(result.stdout, /Checking target Auth user/);
}

test('active bootstrap and local Supabase configuration pin PHANTOMS production', () => {
  const source = readFileSync(script, 'utf8');
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`EXPECTED_PROJECT_REF = '${ref}'`));
  assert.match(config, new RegExp(`project_id = "${ref}"`));
  assert.doesNotMatch(source, /cbuiwgrmsmsidyjhzvla/);
});
test('obsolete project reference is refused before any network request', () => {
  reject({ PHANTOMS_SUPABASE_PROJECT_REF: 'cbuiwgrmsmsidyjhzvla' }, /unexpected Supabase project/);
});
test('mismatched URL is refused before any network request', () => {
  reject({ SUPABASE_URL: 'https://cbuiwgrmsmsidyjhzvla.supabase.co' }, /does not match the approved target/);
});
test('public publishable key cannot bootstrap an Owner', () => {
  reject({ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_local_test_fixture' }, /server-side Supabase service key/);
});
test('Owner UUID is mandatory', () => {
  reject({ PHANTOMS_INITIAL_OWNER_ID: '' }, /valid UUID/);
});
