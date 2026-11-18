import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rewriteDisposableConfig, validateConfiguredUrls } from './configure-disposable-stack.mjs';

const script = new URL('./configure-disposable-stack.mjs', import.meta.url);
const config = new URL('../supabase/config.toml', import.meta.url);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phantoms-disposable-config-'));
  mkdirSync(join(root, 'backend/scripts'), { recursive: true });
  mkdirSync(join(root, 'backend/supabase'), { recursive: true });
  copyFileSync(script, join(root, 'backend/scripts/configure-disposable-stack.mjs'));
  copyFileSync(config, join(root, 'backend/supabase/config.toml'));
  return {
    root,
    script: join(root, 'backend/scripts/configure-disposable-stack.mjs'),
    config: join(root, 'backend/supabase/config.toml'),
    envFile: join(root, 'github-env'),
  };
}

function invoke(f, extra = {}) {
  return spawnSync(process.execPath, [f.script], {
    env: { PATH: process.env.PATH, CI: 'true', GITHUB_RUN_ID: '123456789', GITHUB_ENV: f.envFile, ...extra },
    encoding: 'utf8',
  });
}

function withConfig(f, transform) {
  const before = readFileSync(f.config, 'utf8');
  writeFileSync(f.config, transform(before));
  return before;
}

function assertInvalidFixtureUnchanged(transform) {
  const f = fixture();
  try {
    withConfig(f, transform);
    const expected = readFileSync(f.config, 'utf8');
    writeFileSync(f.envFile, 'KEEP=1\n');
    const result = invoke(f);
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(readFileSync(f.config, 'utf8'), expected);
    assert.equal(readFileSync(f.envFile, 'utf8'), 'KEEP=1\n');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

test('valid configuration rewrites exactly the disposable namespace and four selected ports', () => {
  const f = fixture();
  try {
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    const configText = readFileSync(f.config, 'utf8');
    const env = Object.fromEntries(readFileSync(f.envFile, 'utf8').trim().split('\n').map((line) => line.split('=')));
    const api = Number(env.PHANTOMS_LOCAL_API_PORT);
    assert.ok(api >= 20000 && api <= 60000);
    assert.equal(Number(env.PHANTOMS_LOCAL_DB_PORT), api + 1);
    assert.equal(Number(env.PHANTOMS_LOCAL_PREVIEW_PORT), api + 3);
    assert.match(configText, /project_id = "phantoms-disposable-123456789"/);
    assert.match(configText, new RegExp(`\\[api\\][\\s\\S]*?\\nport = ${api}`));
    assert.match(configText, new RegExp(`\\[db\\][\\s\\S]*?\\nport = ${api + 1}`));
    assert.match(configText, new RegExp(`shadow_port = ${api + 2}`));
    assert.match(configText, new RegExp(`site_url = "http://127\\.0\\.0\\.1:${api + 3}"`));
    assert.match(configText, new RegExp(`additional_redirect_urls = \\["http://127\\.0\\.0\\.1:${api + 3}", "http://127\\.0\\.0\\.1:${api + 3}/\\*\\*"\\]`));
    validateConfiguredUrls(configText, `http://127.0.0.1:${api + 3}`);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('reformatted active assignments are accepted while unrelated TOML remains unchanged', () => {
  const f = fixture();
  try {
    const before = withConfig(f, (text) => text
      .replace(/^project_id = "[^"]+"/m, '  project_id    =    "phantoms-local-fixture"   # preserve this comment')
      .replace('port = 54321', '  port    =    54321')
      .replace('port = 54322', '  port\t=\t54322')
      .replace('shadow_port = 54320', '  shadow_port = 54320')
      .replace('site_url = "http://127.0.0.1:4173"', '    site_url    =    "http://127.0.0.1:4173"')
      .replace('additional_redirect_urls = ["http://127.0.0.1:4173", "http://127.0.0.1:4173/**"]', '    additional_redirect_urls    =    ["http://127.0.0.1:4173", "http://127.0.0.1:4173/**"]')
      .replace('max_rows = 1000', 'max_rows = 777 # unrelated sentinel'));
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(f.config, 'utf8');
    assert.match(after, /max_rows = 777 # unrelated sentinel/);
    assert.match(after, /# preserve this comment/);
    assert.notEqual(after, before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('missing active assignment fails before changing config or GitHub environment output', () => {
  assertInvalidFixtureUnchanged((text) => text.replace(/^site_url = .*\n/m, ''));
});

test('duplicate active assignment fails before changing config or GitHub environment output', () => {
  assertInvalidFixtureUnchanged((text) => text.replace(/^(site_url = .*\n)/m, '$1$1'));
});

test('comment-only assignment is ignored and fails before changing config or GitHub environment output', () => {
  assertInvalidFixtureUnchanged((text) => text.replace(/^(site_url = .*\n)/m, '# $1'));
});

test('unsupported multiline redirect arrays fail before any partial assignment rewrite', () => {
  assertInvalidFixtureUnchanged((text) => text.replace(
    /^additional_redirect_urls = .*$/m,
    'additional_redirect_urls = [\n  "http://127.0.0.1:4173",\n  "http://127.0.0.1:4173/**"\n]',
  ));
});

test('an existing unexpected URL is never retained, and URL validation rejects unexpected resulting material', () => {
  const f = fixture();
  try {
    const before = withConfig(f, (text) => text.replace('site_url = "http://127.0.0.1:4173"', 'site_url = "http://evil.invalid"'));
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(f.config, 'utf8');
    assert.notEqual(after, before);
    const env = Object.fromEntries(readFileSync(f.envFile, 'utf8').trim().split('\n').map((line) => line.split('=')));
    const origin = `http://127.0.0.1:${env.PHANTOMS_LOCAL_PREVIEW_PORT}`;
    validateConfiguredUrls(after, origin);
    assert.throws(() => validateConfiguredUrls(after.replace(origin, 'http://evil.invalid'), origin), /site_url/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('non-CI and production-credential inputs fail before configuration writes', () => {
  for (const extra of [{ CI: 'false' }, { SUPABASE_ACCESS_TOKEN: 'not-a-real-fixture-token' }]) {
    const f = fixture();
    try {
      const before = readFileSync(f.config);
      assert.notEqual(invoke(f, extra).status, 0);
      assert.deepEqual(readFileSync(f.config), before);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('a remote project link fails before configuration writes', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, 'backend/supabase/.temp'));
    writeFileSync(join(f.root, 'backend/supabase/.temp/project-ref'), 'blocked-fixture-ref');
    const before = readFileSync(f.config);
    assert.notEqual(invoke(f).status, 0);
    assert.deepEqual(readFileSync(f.config), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('pure rewrite rejects a non-loopback selected origin without producing output', () => {
  const source = readFileSync(config, 'utf8');
  assert.throws(() => rewriteDisposableConfig(source, {
    projectId: 'fixture-project',
    apiPort: 20000,
    dbPort: 20001,
    shadowPort: 20002,
    previewOrigin: 'https://unexpected.example',
  }), /loopback origin/);
});
