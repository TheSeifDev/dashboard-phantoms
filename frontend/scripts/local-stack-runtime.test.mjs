import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localRuntimeWorkdir, localStatusArgs } from './local-stack-runtime.mjs';

function fixture(backendProjectId = 'phantoms-password-local', runtimeProjectId = backendProjectId) {
  const root = mkdtempSync(path.join(tmpdir(), 'phantoms-disposable-runtime-'));
  const backend = path.join(root, 'backend');
  const runtime = path.join(root, 'runtime');
  for (const [dir, projectId] of [[backend, backendProjectId], [runtime, runtimeProjectId]]) {
    mkdirSync(path.join(dir, 'supabase'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase/config.toml'), `project_id = "${projectId}"\n`);
  }
  return { root, backend, runtime, env: { SUPABASE_EXPERIMENTAL_STACK: '1', PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR: runtime } };
}

test('classic local status retains its command only for a generated disposable project', () => {
  const f = fixture('phantoms-disposable-123456');
  try {
    assert.deepEqual(localStatusArgs(f.backend, {}), ['status', '--workdir', f.backend, '-o', 'env']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('classic runtime rejects production IDs and any implicit workdir override', () => {
  const remote = fixture('wxwoaputugxw');
  const disposable = fixture('phantoms-disposable-123456');
  try {
    assert.throws(() => localRuntimeWorkdir(remote.backend, {}), /explicitly owned disposable Supabase namespace/);
    assert.throws(() => localRuntimeWorkdir(disposable.backend, { PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR: '/fixture/native' }), /override/);
  } finally {
    rmSync(remote.root, { recursive: true, force: true });
    rmSync(disposable.root, { recursive: true, force: true });
  }
});

test('native local status requires the exact matching owned namespace and explicit native flags', () => {
  const f = fixture();
  try {
    assert.equal(localRuntimeWorkdir(f.backend, f.env), f.runtime);
    assert.deepEqual(localStatusArgs(f.backend, f.env), ['stack', 'status', '--experimental', '--workdir', f.runtime, '--env', '--output-format', 'text']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('native runtime rejects missing, relative, mismatched, and linked workdirs', () => {
  const f = fixture();
  try {
    assert.throws(() => localRuntimeWorkdir(f.backend, { SUPABASE_EXPERIMENTAL_STACK: '1' }), /absolute workdir/);
    assert.throws(() => localRuntimeWorkdir(f.backend, { ...f.env, PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR: 'relative' }), /absolute workdir/);
    writeFileSync(path.join(f.runtime, 'supabase/config.toml'), 'project_id = "unapproved-project"\n');
    assert.throws(() => localRuntimeWorkdir(f.backend, f.env), /explicitly owned disposable Supabase namespace/);
    writeFileSync(path.join(f.runtime, 'supabase/config.toml'), 'project_id = "phantoms-password-local"\n');
    mkdirSync(path.join(f.runtime, 'supabase/.temp'));
    writeFileSync(path.join(f.runtime, 'supabase/.temp/project-ref'), 'forbidden');
    assert.throws(() => localRuntimeWorkdir(f.backend, f.env), /hosted project link/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('project metadata with duplicate assignments is rejected instead of trusting the first', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.backend, 'supabase/config.toml'), 'project_id = "phantoms-password-local"\nproject_id = "phantoms-disposable-123456"\n');
    assert.throws(() => localRuntimeWorkdir(f.backend, f.env), /exactly one/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
