import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./configure-disposable-stack.mjs', import.meta.url);
const config = new URL('../supabase/config.toml', import.meta.url);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phantoms-local-ports-'));
  mkdirSync(join(root, 'backend/scripts'), { recursive: true });
  mkdirSync(join(root, 'backend/supabase'), { recursive: true });
  copyFileSync(script, join(root, 'backend/scripts/configure-disposable-stack.mjs'));
  copyFileSync(config, join(root, 'backend/supabase/config.toml'));
  return { root, script: join(root, 'backend/scripts/configure-disposable-stack.mjs'), config: join(root, 'backend/supabase/config.toml'), envFile: join(root, 'github-env') };
}
function invoke(f, extra = {}) {
  return spawnSync(process.execPath, [f.script], {
    env: { PATH: process.env.PATH, CI: 'true', GITHUB_RUN_ID: '123456789', GITHUB_ENV: f.envFile, ...extra },
    encoding: 'utf8',
  });
}

test('CI allocates a unique local namespace and four available ports without touching migration files', () => {
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
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('non-CI and production-credential inputs fail before configuration writes', () => {
  for (const extra of [{ CI: 'false' }, { SUPABASE_ACCESS_TOKEN: 'not-a-real-fixture-token' }]) {
    const f = fixture();
    try {
      const before = readFileSync(f.config);
      assert.notEqual(invoke(f, extra).status, 0);
      assert.deepEqual(readFileSync(f.config), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
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
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
