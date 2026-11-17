import { readFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';

export function nativeRuntimeEnabled(env = process.env) {
  return env.SUPABASE_EXPERIMENTAL_STACK === '1';
}

function readOwnedProjectNamespace(dir) {
  const config = readFileSync(path.join(dir, 'supabase/config.toml'), 'utf8');
  const matches = [...config.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1 || !/^phantoms-(?:password-local|disposable-\d+)$/.test(matches[0]?.[1] ?? '')) {
    throw new Error('runtime requires exactly one explicitly owned disposable Supabase namespace');
  }
  return matches[0][1];
}

export function localRuntimeWorkdir(backend, env = process.env) {
  const selected = env.PHANTOMS_DISPOSABLE_RUNTIME_WORKDIR;
  const expected = readOwnedProjectNamespace(backend);
  if (!nativeRuntimeEnabled(env)) {
    if (selected) throw new Error('runtime workdir override requires the explicit native runtime');
    return backend;
  }
  if (!selected || !path.isAbsolute(selected)) throw new Error('native runtime requires an explicit owned absolute workdir');
  const runtime = path.resolve(selected);
  for (const dir of [backend, runtime]) {
    if (existsSync(path.join(dir, 'supabase/.temp/project-ref'))) throw new Error('hosted project link is forbidden');
  }
  if (readOwnedProjectNamespace(runtime) !== expected) {
    throw new Error('native runtime must use the exact owned disposable namespace');
  }
  return runtime;
}

export function localStatusArgs(backend, env = process.env) {
  const runtime = localRuntimeWorkdir(backend, env);
  return nativeRuntimeEnabled(env)
    ? ['stack', 'status', '--experimental', '--workdir', runtime, '--env', '--output-format', 'text']
    : ['status', '--workdir', backend, '-o', 'env'];
}

export function synchronizeNativeTestSource(backend, env = process.env) {
  if (!nativeRuntimeEnabled(env)) return;
  const runtime = localRuntimeWorkdir(backend, env);
  if (runtime === path.resolve(backend)) return;
  // Only application/test source is copied. Never copy .temp, config, keys,
  // generated environment, stack metadata, Auth output, or database data.
  const originalMigrations = path.join(backend, 'supabase/migrations');
  const runtimeMigrations = path.join(runtime, 'supabase/migrations');
  const names = readdirSync(originalMigrations).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const copiedNames = readdirSync(runtimeMigrations).filter((name) => name.endsWith('.sql')).sort();
  if (JSON.stringify(names) !== JSON.stringify(copiedNames)) throw new Error('native migration source set differs');
  for (const name of names) {
    if (!readFileSync(path.join(originalMigrations, name)).equals(readFileSync(path.join(runtimeMigrations, name)))) {
      throw new Error('native migration source bytes differ');
    }
  }
  cpSync(path.join(backend, 'supabase/functions/member-password-enrollment'), path.join(runtime, 'supabase/functions/member-password-enrollment'), { recursive: true });
  cpSync(path.join(backend, 'supabase/tests/database'), path.join(runtime, 'supabase/tests/database'), { recursive: true });
}

export function localFunctionServeArgs(backend, envFile, env = process.env) {
  synchronizeNativeTestSource(backend, env);
  const runtime = localRuntimeWorkdir(backend, env);
  return ['functions', 'serve', 'member-password-enrollment', '--workdir', runtime,
    ...(nativeRuntimeEnabled(env) ? ['--experimental'] : ['--no-verify-jwt']), '--env-file', envFile];
}
