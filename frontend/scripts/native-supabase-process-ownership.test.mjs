import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExactNativeStackHost,
  isExactNativeStackWorkload,
  isExactOwnedNativeEdgeRuntime,
} from './native-supabase-process-ownership.mjs';

const executable = '/opt/supabase/bin/supabase';
const home = '/tmp/phantoms-disposable-stack-home';
const workloadId = 'b616821f-af6d-4638-acf7-cc19dc171dcc';
const hostPids = new Set([100]);
const workloadPidsBefore = new Set([101]);
const edgePidsBefore = new Set([90]);
const host = {
  pid: 100,
  parentPid: 1,
  comm: 'supabase',
  executable,
  command: `supabase __supabase_stack_host__ ${home}/stacks/stack/startup.json`,
};
const workload = {
  pid: 200,
  parentPid: 100,
  comm: 'supabase',
  executable,
  command: `supabase __supabase_stack_native__ supabase-workload-id=${workloadId}`,
};
const edge = {
  pid: 201,
  parentPid: 200,
  comm: '.edge-runtime-w',
  executable: '/opt/supabase/bin/.edge-runtime-wrapped',
  command: '.edge-runtime-wrapped',
};

function ownership(daemon = edge, wrapper = workload, overrides = {}) {
  return isExactOwnedNativeEdgeRuntime({
    daemon,
    wrapper,
    supabaseExecutable: executable,
    stackHostPids: hostPids,
    workloadPidsBefore,
    edgePidsBefore,
    ...overrides,
  });
}

test('accepts only a newly-created Edge worker under the pinned native stack workload', () => {
  assert.equal(isExactNativeStackHost(host, { supabaseExecutable: executable, supabaseHome: home }), true);
  assert.equal(isExactNativeStackWorkload(workload, { supabaseExecutable: executable, stackHostPids: hostPids }), true);
  assert.equal(ownership(), true);
});

test('rejects a host from another executable or Supabase home', () => {
  assert.equal(isExactNativeStackHost({ ...host, executable: '/tmp/other-supabase' }, { supabaseExecutable: executable, supabaseHome: home }), false);
  assert.equal(isExactNativeStackHost(host, { supabaseExecutable: executable, supabaseHome: '/tmp/other-home' }), false);
});

test('rejects workloads not parented by the selected native stack host', () => {
  assert.equal(isExactNativeStackWorkload({ ...workload, parentPid: 777 }, { supabaseExecutable: executable, stackHostPids: hostPids }), false);
  assert.equal(ownership(edge, { ...workload, parentPid: 777 }), false);
});

test('rejects pre-existing workload and Edge PIDs', () => {
  assert.equal(ownership(edge, { ...workload, pid: 101 }), false);
  assert.equal(ownership({ ...edge, pid: 90 }), false);
});

test('rejects a wrong CLI binary, missing workload marker, or unrelated daemon', () => {
  assert.equal(ownership(edge, { ...workload, executable: '/tmp/other-supabase' }), false);
  assert.equal(ownership(edge, { ...workload, command: 'supabase unrelated-command' }), false);
  assert.equal(ownership({ ...edge, parentPid: 999 }), false);
  assert.equal(ownership({ ...edge, executable: '/tmp/other-edge-runtime' }), false);
});
