import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const assignmentLinePattern = /^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.*)$/;
const linePattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;

function activeAssignments(text) {
  const assignments = [];
  linePattern.lastIndex = 0;
  let section = '';
  let match;
  while ((match = linePattern.exec(text)) !== null) {
    const [fullLine, line] = match;
    if (fullLine.length === 0) break;

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const header = trimmed.match(/^\[([^\x5b\x5d]+)\]\s*(?:#.*)?$/);
    if (header) {
      section = header[1].trim();
      continue;
    }

    const assignment = line.match(assignmentLinePattern);
    if (!assignment) continue;
    assignments.push({
      section,
      key: assignment[2],
      prefix: `${assignment[1]}${assignment[2]}${assignment[3]}`,
      rawValue: assignment[4],
      start: match.index,
      end: match.index + line.length,
    });
  }
  return assignments;
}

function findSingleAssignment(text, section, key) {
  const matches = activeAssignments(text).filter((assignment) => assignment.section === section && assignment.key === key);
  if (matches.length !== 1) {
    const location = section ? `[${section}].${key}` : key;
    throw new Error(`Expected exactly one active ${location} assignment; found ${matches.length}.`);
  }
  return matches[0];
}

function splitInlineComment(rawValue) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === '#') {
      return { value: rawValue.slice(0, index), comment: rawValue.slice(index) };
    }
  }
  return { value: rawValue, comment: '' };
}

function replacementValue(rawValue, value) {
  const { value: beforeComment, comment } = splitInlineComment(rawValue);
  const spacing = beforeComment.match(/\s*$/)?.[0] ?? '';
  const trailing = comment ? `${spacing}${comment}` : beforeComment.match(/\s*$/)?.[0] ?? '';
  return `${value}${trailing}`;
}

function parseTomlString(rawValue, label) {
  const { value } = splitInlineComment(rawValue);
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'string') throw new Error('not a string');
    return parsed;
  } catch {
    throw new Error(`Unable to validate ${label}; expected a TOML string.`);
  }
}

function parseTomlStringArray(rawValue, label) {
  const { value } = splitInlineComment(rawValue);
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) throw new Error('not a string array');
    return parsed;
  } catch {
    throw new Error(`Unable to validate ${label}; expected a TOML string array.`);
  }
}

function assertLoopbackOrigin(origin) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    throw new Error(`Refusing disposable Auth URL outside the exact loopback origin: ${origin}`);
  }
}

export function validateConfiguredUrls(config, previewOrigin) {
  assertLoopbackOrigin(previewOrigin);
  const siteUrl = parseTomlString(
    findSingleAssignment(config, 'auth', 'site_url').rawValue,
    '[auth].site_url',
  );
  const redirectUrls = parseTomlStringArray(
    findSingleAssignment(config, 'auth', 'additional_redirect_urls').rawValue,
    '[auth].additional_redirect_urls',
  );
  const expectedRedirectUrls = [previewOrigin, `${previewOrigin}/**`];
  if (siteUrl !== previewOrigin) {
    throw new Error(`Disposable Auth site_url did not resolve to the selected loopback origin: ${siteUrl}`);
  }
  if (redirectUrls.length !== expectedRedirectUrls.length || redirectUrls.some((url, index) => url !== expectedRedirectUrls[index])) {
    throw new Error('Disposable Auth additional_redirect_urls did not resolve to the selected loopback origin.');
  }
}

export function rewriteDisposableConfig(config, values) {
  const { projectId, apiPort, dbPort, shadowPort, previewOrigin } = values;
  assertLoopbackOrigin(previewOrigin);
  const redirectValue = `[${JSON.stringify(previewOrigin)}, ${JSON.stringify(`${previewOrigin}/**`)}]`;
  const replacements = [
    ['', 'project_id', JSON.stringify(projectId)],
    ['api', 'port', String(apiPort)],
    ['db', 'port', String(dbPort)],
    ['db', 'shadow_port', String(shadowPort)],
    ['auth', 'site_url', JSON.stringify(previewOrigin)],
    ['auth', 'additional_redirect_urls', redirectValue],
    // Many independent fixture logins share one loopback IP in this finite CI
    // run. This changes only generated disposable config; credential/invitation
    // SQL limits and the source/hosted Auth configuration remain unchanged.
    ['auth.rate_limit', 'sign_in_sign_ups', '300'],
  ].map(([section, key, value]) => {
    const assignment = findSingleAssignment(config, section, key);
    // Do not replace only the opening line of a multiline/malformed array and
    // accidentally leave stray TOML behind. Unsupported shapes fail closed.
    if (section === 'auth' && key === 'additional_redirect_urls') {
      parseTomlStringArray(assignment.rawValue, '[auth].additional_redirect_urls');
    }
    return {
      ...assignment,
      replacement: `${assignment.prefix}${replacementValue(assignment.rawValue, value)}`,
    };
  });

  let rewritten = config;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
  }
  validateConfiguredUrls(rewritten, previewOrigin);
  return rewritten;
}

async function available(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
  });
}

async function main() {
  if (process.env.CI !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !process.env.GITHUB_ENV) {
    throw new Error('Disposable stack configuration is restricted to GitHub CI.');
  }
  if (existsSync(resolve(root, 'backend/supabase/.temp/project-ref')) || existsSync(resolve(root, 'frontend/.env.local'))) {
    throw new Error('Refusing disposable configuration with a remote project link or frontend local environment.');
  }
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[name]) throw new Error(`Refusing production credential environment variable ${name}.`);
  }

  let base = 20000 + Number(BigInt(process.env.GITHUB_RUN_ID) % 5000n) * 4;
  while (!(await Promise.all([0, 1, 2, 3].map((n) => available(base + n)))).every(Boolean)) {
    base += 4;
    if (base > 60000) throw new Error('No disposable port quartet available.');
  }

  const configPath = resolve(root, 'backend/supabase/config.toml');
  const config = readFileSync(configPath, 'utf8');
  const previewOrigin = `http://127.0.0.1:${base + 3}`;
  const rewritten = rewriteDisposableConfig(config, {
    projectId: `phantoms-disposable-${process.env.GITHUB_RUN_ID}`,
    apiPort: base,
    dbPort: base + 1,
    shadowPort: base + 2,
    previewOrigin,
  });

  writeFileSync(configPath, rewritten);
  appendFileSync(process.env.GITHUB_ENV, `PHANTOMS_LOCAL_API_PORT=${base}\nPHANTOMS_LOCAL_DB_PORT=${base + 1}\nPHANTOMS_LOCAL_PREVIEW_PORT=${base + 3}\n`);
  console.log('Configured isolated disposable namespace and checked available loopback ports; no production connection.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
