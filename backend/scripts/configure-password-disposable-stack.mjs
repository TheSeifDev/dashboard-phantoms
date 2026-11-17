import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This supplemental fixture setting never changes the protected base helper,
// source Auth config, application credential budgets, or hosted configuration.
export function rewriteDisposablePasswordQuota(config) {
  const lines = config.split('\n');
  let section = '';
  let sections = 0;
  const assignments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = trimmed.match(/^\[([^\[\]]+)\]\s*(?:#.*)?$/);
    if (header) {
      section = header[1].trim();
      if (section === 'auth.rate_limit') sections += 1;
      continue;
    }
    if (section === 'auth.rate_limit' && /^\s*sign_in_sign_ups\s*=/.test(lines[index])) assignments.push(index);
  }
  if (sections !== 1 || assignments.length !== 1) throw new Error('Expected exactly one disposable Auth throughput assignment.');
  const index = assignments[0];
  const match = lines[index].match(/^(\s*sign_in_sign_ups\s*=\s*)\d+([ \t]*(?:#[^\r\n]*)?\r?)$/);
  if (!match) throw new Error('Invalid disposable Auth throughput assignment.');
  lines[index] = `${match[1]}300${match[2]}`;
  return lines.join('\n');
}

function main() {
  if (process.env.CI !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !process.env.GITHUB_ENV) {
    throw new Error('Password fixture configuration is restricted to GitHub CI.');
  }
  const scripts = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(scripts, '../supabase/config.toml');
  // Validate before the base helper can write config or GitHub environment output.
  rewriteDisposablePasswordQuota(readFileSync(configPath, 'utf8'));
  const result = spawnSync(process.execPath, [resolve(scripts, 'configure-disposable-stack.mjs')], {
    env: process.env, stdio: 'ignore', timeout: 30_000,
  });
  if (result.status !== 0 || result.error) throw new Error('Protected disposable base configuration failed.');
  const config = readFileSync(configPath, 'utf8');
  const expected = `project_id = "phantoms-disposable-${process.env.GITHUB_RUN_ID}"`;
  if (!config.split('\n').some((line) => line.trim() === expected)) throw new Error('Disposable namespace verification failed.');
  writeFileSync(configPath, rewriteDisposablePasswordQuota(config));
  console.log('Configured owned disposable password fixtures; protected base helper and hosted Auth settings unchanged.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { main(); } catch { console.error('Disposable password fixture configuration refused.'); process.exitCode = 1; }
}
