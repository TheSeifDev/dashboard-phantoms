import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const FORWARD_MANIFEST_PATH = 'backend/supabase/forward-migration-manifest.json';
const TIMESTAMP = /^\d{14}$/;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Local inventory only. Status metadata records whether production application was independently reconciled. */
export function validateForwardMigrations({ rootDir, lastInitializationVersion, initializationFiles = [] }) {
  const root = resolve(rootDir);
  const manifestPath = resolve(root, FORWARD_MANIFEST_PATH);
  const errors = [];
  let entries = [];
  if (existsSync(manifestPath)) {
    try {
      entries = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      errors.push(`Could not parse forward migration manifest: ${error.message}`);
    }
    if (!Array.isArray(entries)) {
      errors.push('Forward migration manifest must be an array.');
      entries = [];
    }
  }
  const files = [];
  const seen = new Set(initializationFiles);
  let previousVersion = lastInitializationVersion;
  for (const [index, entry] of entries.entries()) {
    const label = `Forward entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label}: must be an object.`);
      continue;
    }
    const { version, name, canonical_repository_filename: path, sha256,
      production_status: status, remote_applied_timestamp: remote,
      original_source_version: originalVersion, original_source_filename: originalPath } = entry;
    if (typeof version !== 'string' || !TIMESTAMP.test(version)) errors.push(`${label}: invalid 14-digit version.`);
    if (typeof name !== 'string' || !NAME.test(name)) errors.push(`${label}: invalid migration name.`);
    if (typeof sha256 !== 'string' || !HASH.test(sha256)) errors.push(`${label}: invalid SHA-256.`);
    const pendingState = status === 'not_applied' && remote === null;
    const appliedState = status === 'applied' && typeof remote === 'string' && TIMESTAMP.test(remote) && remote === version;
    if (!pendingState && !appliedState) {
      errors.push(`${label}: production_status/remote_applied_timestamp must be either not_applied/null or applied with a timestamp equal to version.`);
    }
    if (typeof originalVersion !== 'string' || !TIMESTAMP.test(originalVersion)) {
      errors.push(`${label}: invalid original source version.`);
    }
    if (typeof originalPath !== 'string' || !originalPath.startsWith('backend/supabase/migrations/')) {
      errors.push(`${label}: invalid original source filename.`);
    }
    if (typeof version === 'string' && previousVersion && version <= previousVersion) {
      errors.push(`${label}: versions must be unique, strictly increasing and later than initialization.`);
    }
    if (typeof version === 'string') previousVersion = version;
    const expectedPath = `backend/supabase/migrations/${version}_${name}.sql`;
    if (path !== expectedPath || !TIMESTAMP.test(version ?? '') || !NAME.test(name ?? '')) {
      errors.push(`${label}: canonical path must exactly match the safe version and name.`);
      continue;
    }
    const expectedOriginalPath = `backend/supabase/migrations/${originalVersion}_${name}.sql`;
    if (originalPath !== expectedOriginalPath) {
      errors.push(`${label}: original source filename must preserve the original version and name.`);
    }
    const filename = `${version}_${name}.sql`;
    if (seen.has(filename)) errors.push(`${label}: duplicate registered migration filename.`);
    seen.add(filename);
    files.push(filename);
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`${label}: registered forward migration is missing: ${path}.`);
      continue;
    }
    const actualHash = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
    if (actualHash !== sha256) errors.push(`${label}: sha256/content mismatch for ${path}.`);
  }
  return { valid: errors.length === 0, errors, entries, files };
}
