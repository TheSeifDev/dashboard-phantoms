import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rewriteDisposablePasswordQuota } from './configure-password-disposable-stack.mjs';

const configUrl = new URL('../supabase/config.toml', import.meta.url);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phantoms-password-quota-'));
  mkdirSync(join(root, 'backend/scripts'), { recursive: true });
  mkdirSync(join(root, 'backend/supabase'), { recursive: true });
  for (const name of ['configure-disposable-stack.mjs', 'configure-password-disposable-stack.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'backend/scripts', name));
  }
  const config = join(root, 'backend/supabase/config.toml');
  copyFileSync(configUrl, config);
  return { root, config, script: join(root, 'backend/scripts/configure-password-disposable-stack.mjs'), envFile: join(root, 'github-env') };
}
function invoke(f, extra = {}) {
  return spawnSync(process.execPath, [f.script], { env: { PATH: process.env.PATH, CI: 'true', GITHUB_RUN_ID: '123456790', GITHUB_ENV: f.envFile, ...extra }, encoding: 'utf8' });
}

test('local Auth remains invitation-only and requires email confirmation after the disposable rewrite', () => {
  const before = readFileSync(configUrl, 'utf8');
  const after = rewriteDisposablePasswordQuota(before);
  assert.match(before, /^enable_signup = false$/m);
  assert.match(before, /^enable_confirmations = true$/m);
  assert.match(after, /^enable_signup = false$/m);
  assert.match(after, /^enable_confirmations = true$/m);
});

test('supplemental fixture quota changes only the one Auth sign-in quota assignment', () => {
  const before = readFileSync(configUrl, 'utf8');
  const after = rewriteDisposablePasswordQuota(before);
  assert.equal(after, before.replace(/^sign_in_sign_ups = \d+$/m, 'sign_in_sign_ups = 300'));
  assert.match(before, /^sign_in_sign_ups = 30$/m);
});

test('supplemental quota rejects missing, duplicate, commented, or malformed assignments', () => {
  const source = readFileSync(configUrl, 'utf8');
  for (const invalid of [source.replace(/^sign_in_sign_ups = .*\n/m, ''), source.replace(/^(sign_in_sign_ups = .*\n)/m, '$1$1'), source.replace(/^sign_in_sign_ups = /m, '# sign_in_sign_ups = '), source.replace(/^sign_in_sign_ups = .*$/m, 'sign_in_sign_ups = "unsafe"')]) {
    assert.throws(() => rewriteDisposablePasswordQuota(invalid));
  }
});

test('supplemental quota preserves inline comments, spacing, and CRLF', () => {
  const source = '[auth.rate_limit]\r\n  sign_in_sign_ups\t= 30 # sentinel\r\n';
  assert.equal(rewriteDisposablePasswordQuota(source), source.replace('= 30', '= 300'));
});

test('supplemental CI wrapper uses the protected namespace/loopback guard before applying its quota', () => {
  const f = fixture();
  try {
    const result = invoke(f); assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(f.config, 'utf8');
    assert.match(config, /^project_id = "phantoms-disposable-123456790"$/m);
    assert.match(config, /^site_url = "http:\/\/127\.0\.0\.1:\d+"$/m);
    assert.match(config, /^sign_in_sign_ups = 300$/m);
    assert.match(readFileSync(f.envFile, 'utf8'), /PHANTOMS_LOCAL_API_PORT=\d+/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('supplemental missing quota fails before either config or GitHub environment output changes', () => {
  const f = fixture();
  try {
    const invalid = readFileSync(f.config, 'utf8').replace(/^sign_in_sign_ups = .*\n/m, '');
    writeFileSync(f.config, invalid); writeFileSync(f.envFile, 'KEEP=1\n');
    assert.notEqual(invoke(f).status, 0);
    assert.equal(readFileSync(f.config, 'utf8'), invalid);
    assert.equal(readFileSync(f.envFile, 'utf8'), 'KEEP=1\n');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('supplemental wrapper preserves protected rejection of non-CI, credentials, and remote links', () => {
  for (const input of [{ CI: 'false' }, { SUPABASE_ACCESS_TOKEN: 'dummy-refusal-input' }, { remote: true }]) {
    const f = fixture();
    try {
      if (input.remote) { mkdirSync(join(f.root, 'backend/supabase/.temp')); writeFileSync(join(f.root, 'backend/supabase/.temp/project-ref'), 'blocked-fixture'); }
      const before = readFileSync(f.config, 'utf8'); writeFileSync(f.envFile, 'KEEP=1\n');
      assert.notEqual(invoke(f, input.remote ? {} : input).status, 0);
      assert.equal(readFileSync(f.config, 'utf8'), before);
      assert.equal(readFileSync(f.envFile, 'utf8'), 'KEEP=1\n');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
