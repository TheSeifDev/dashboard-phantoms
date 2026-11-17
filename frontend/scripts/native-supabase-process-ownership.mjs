import path from 'node:path';

const WORKLOAD_ID = /(?:^|\s)supabase-workload-id=[0-9a-f-]{36}(?:\s|$)/i;

export function isExactNativeStackHost(record, expected = {}) {
  return Boolean(
    record
      && Number.isInteger(record.pid)
      && record.comm === 'supabase'
      && path.isAbsolute(expected.supabaseExecutable ?? '')
      && record.executable === expected.supabaseExecutable
      && typeof expected.supabaseHome === 'string'
      && path.isAbsolute(expected.supabaseHome)
      && typeof record.command === 'string'
      && record.command.includes('__supabase_stack_host__')
      && record.command.includes(expected.supabaseHome),
  );
}

export function isExactNativeStackWorkload(record, expected = {}) {
  const stackHostPids = expected.stackHostPids;
  return Boolean(
    record
      && Number.isInteger(record.pid)
      && record.comm === 'supabase'
      && path.isAbsolute(expected.supabaseExecutable ?? '')
      && record.executable === expected.supabaseExecutable
      && stackHostPids instanceof Set
      && stackHostPids.has(record.parentPid)
      && typeof record.command === 'string'
      && record.command.includes('__supabase_stack_native__')
      && WORKLOAD_ID.test(record.command),
  );
}

export function isExactOwnedNativeEdgeRuntime({
  daemon,
  wrapper,
  supabaseExecutable,
  stackHostPids,
  workloadPidsBefore,
  edgePidsBefore,
} = {}) {
  return Boolean(
    daemon
      && wrapper
      && Number.isInteger(daemon.pid)
      && Number.isInteger(wrapper.pid)
      && daemon.parentPid === wrapper.pid
      && daemon.comm?.startsWith('.edge-runtime')
      && path.basename(daemon.executable ?? '') === '.edge-runtime-wrapped'
      && stackHostPids instanceof Set
      && workloadPidsBefore instanceof Set
      && edgePidsBefore instanceof Set
      && !edgePidsBefore.has(daemon.pid)
      && !workloadPidsBefore.has(wrapper.pid)
      && isExactNativeStackWorkload(wrapper, { supabaseExecutable, stackHostPids }),
  );
}
