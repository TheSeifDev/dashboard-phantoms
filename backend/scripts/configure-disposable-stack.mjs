import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.env.CI !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !process.env.GITHUB_ENV) {
  throw new Error('Disposable stack configuration is restricted to GitHub CI.');
}
if (existsSync(resolve(root, 'backend/supabase/.temp/project-ref')) || existsSync(resolve(root, 'frontend/.env.local'))) {
  throw new Error('Refusing disposable configuration with a remote project link or frontend local environment.');
}
for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[name]) throw new Error(`Refusing production credential environment variable ${name}.`);
}
const available = (port) => new Promise((resolvePort) => {
  const server = createServer();
  server.once('error', () => resolvePort(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
});
let base = 20000 + Number(BigInt(process.env.GITHUB_RUN_ID) % 5000n) * 4;
while (!(await Promise.all([0, 1, 2, 3].map((n) => available(base + n)))).every(Boolean)) {
  base += 4;
  if (base > 60000) throw new Error('No disposable port quartet available.');
}
const configPath = resolve(root, 'backend/supabase/config.toml');
let config = readFileSync(configPath, 'utf8');
config = config.replace(/^project_id\s*=.*$/m, `project_id = "phantoms-disposable-${process.env.GITHUB_RUN_ID}"`);
config = config.replace(/(\[api\][\s\S]*?\nport\s*=\s*)\d+/, (_, prefix) => `${prefix}${base}`);
config = config.replace(/(\[db\][\s\S]*?\nport\s*=\s*)\d+/, (_, prefix) => `${prefix}${base + 1}`);
config = config.replace(/(shadow_port\s*=\s*)\d+/, (_, prefix) => `${prefix}${base + 2}`);
const previewOrigin = `http://127.0.0.1:${base + 3}`;
config = config.replace(/(site_url\s*=\s*)"[^"]*"/, (_, prefix) => `${prefix}"${previewOrigin}"`);
config = config.replace(/additional_redirect_urls\s*=\s*\[[^\]]*\]/, `additional_redirect_urls = ["${previewOrigin}", "${previewOrigin}/**"]`);
writeFileSync(configPath, config);
appendFileSync(process.env.GITHUB_ENV, `PHANTOMS_LOCAL_API_PORT=${base}\nPHANTOMS_LOCAL_DB_PORT=${base + 1}\nPHANTOMS_LOCAL_PREVIEW_PORT=${base + 3}\n`);
console.log('Configured isolated disposable namespace and checked available loopback ports; no production connection.');
