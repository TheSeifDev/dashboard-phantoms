#!/usr/bin/env node
/**
 * Validate the repository-only migration rename manifest.
 *
 * This module deliberately performs local filesystem checks only. It does not
 * connect to Supabase, apply SQL, or write any files.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateForwardMigrations } from './forward-migrations.mjs';

export const EXPECTED_MIGRATION_COUNT = 24;
export const FIRST_ORIGINAL_VERSION = '20261112000000';
export const DEFAULT_MANIFEST_RELATIVE_PATH = 'backend/supabase/production-initialization-manifest.json';
export const DEFAULT_MIGRATIONS_RELATIVE_PATH = 'backend/supabase/migrations';

const TIMESTAMP14 = /^\d{14}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SQL_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function addError(errors, message) {
  errors.push(message);
}

function expectedOriginalVersion(index) {
  return (BigInt(FIRST_ORIGINAL_VERSION) + BigInt(index)).toString();
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  return value === parts.join('/') && !value.split('/').some((part) => /[\u0000-\u001f\u007f]/.test(part));
}

function resolveLocalPath(rootDir, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const absoluteRoot = resolve(rootDir);
  const absolutePath = resolve(absoluteRoot, ...relativePath.split('/'));
  const outside = relative(absoluteRoot, absolutePath);
  if (outside === '..' || outside.startsWith(`..${sep}`) || outside.startsWith('/') || /^[A-Za-z]:/.test(outside)) {
    return null;
  }
  return absolutePath;
}

function readManifest(manifestPath, suppliedManifest, errors) {
  if (suppliedManifest !== undefined) return suppliedManifest;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    addError(errors, `Could not read or parse manifest ${manifestPath}: ${error.message}`);
    return null;
  }
}

function checkStringField(entry, field, index, errors) {
  const value = entry?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    addError(errors, `Entry ${index + 1}: ${field} must be a non-empty string.`);
    return null;
  }
  return value;
}

/**
 * Validate all 24 canonical migration files and their manifest provenance.
 *
 * Options:
 *   - rootDir: repository/fixture root (defaults to this repository root)
 *   - manifestPath: absolute path or safe path relative to rootDir
 *   - migrationsDir: absolute path or safe path relative to rootDir
 *   - manifest: an already parsed array (useful for callers/tests)
 *
 * The return value is stable and non-throwing for validation failures:
 * `{ valid, errors, entryCount, migrationFiles }`.
 */
export function validateMigrationManifest(options = {}) {
  if (typeof options === 'string') options = { rootDir: options };
  if (Array.isArray(options)) options = { manifest: options };
  const {
    rootDir = moduleRoot,
    manifestPath: requestedManifestPath = DEFAULT_MANIFEST_RELATIVE_PATH,
    migrationsDir: requestedMigrationsDir = DEFAULT_MIGRATIONS_RELATIVE_PATH,
    manifest: suppliedManifest,
  } = options ?? {};

  const errors = [];
  const root = resolve(rootDir);
  const manifestPath = requestedManifestPath.startsWith('/')
    ? resolve(requestedManifestPath)
    : resolveLocalPath(root, requestedManifestPath);
  const migrationsDir = requestedMigrationsDir.startsWith('/')
    ? resolve(requestedMigrationsDir)
    : resolveLocalPath(root, requestedMigrationsDir);

  if (!manifestPath) addError(errors, 'Manifest path must be a safe non-empty relative path without traversal.');
  if (!migrationsDir) addError(errors, 'Migrations directory must be a safe non-empty relative path without traversal.');

  const manifest = manifestPath ? readManifest(manifestPath, suppliedManifest, errors) : suppliedManifest;
  if (!Array.isArray(manifest)) {
    addError(errors, 'Manifest must be a JSON array of migration entries.');
  }

  const forward = validateForwardMigrations({
    rootDir: root,
    lastInitializationVersion: Array.isArray(manifest) ? manifest.at(-1)?.remote_version : null,
    initializationFiles: Array.isArray(manifest)
      ? manifest.map((entry) => typeof entry?.canonical_repository_filename === 'string'
        ? basename(entry.canonical_repository_filename) : '') : [],
  });
  errors.push(...forward.errors);

  let migrationFiles = [];
  if (migrationsDir) {
    try {
      migrationFiles = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((item) => item.isFile() && item.name.endsWith('.sql'))
        .map((item) => item.name)
        .sort();
    } catch (error) {
      addError(errors, `Could not read migrations directory ${migrationsDir}: ${error.message}`);
    }
  }
  const expectedFileCount = EXPECTED_MIGRATION_COUNT + forward.entries.length;
  if (migrationFiles.length !== expectedFileCount) {
    addError(errors, `Expected exactly ${expectedFileCount} SQL migration files (${EXPECTED_MIGRATION_COUNT} initialization + ${forward.entries.length} registered forward); found ${migrationFiles.length}.`);
  }

  if (Array.isArray(manifest)) {
    if (manifest.length !== EXPECTED_MIGRATION_COUNT) {
      addError(errors, `Expected exactly ${EXPECTED_MIGRATION_COUNT} manifest entries; found ${manifest.length}.`);
    }

    const seenOriginalVersions = new Set();
    const seenRemoteVersions = new Set();
    const seenCanonicalPaths = new Set();
    let previousRemoteVersion = null;
    const expectedCanonicalFiles = new Set(forward.files);

    for (let index = 0; index < manifest.length; index += 1) {
      const entry = manifest[index];
      const label = `Entry ${index + 1}`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        addError(errors, `${label}: entry must be an object.`);
        continue;
      }

      const sourceFile = checkStringField(entry, 'source_file', index, errors);
      const sourceVersion = checkStringField(entry, 'source_version', index, errors);
      const mcpName = checkStringField(entry, 'mcp_name', index, errors);
      const sha256 = checkStringField(entry, 'sha256', index, errors);
      const remoteVersion = checkStringField(entry, 'remote_version', index, errors);
      const originalTimestamp = checkStringField(entry, 'original_source_timestamp', index, errors);
      const originalFilename = checkStringField(entry, 'original_source_filename', index, errors);
      const canonicalFile = checkStringField(entry, 'canonical_repository_filename', index, errors);
      const remoteApplied = checkStringField(entry, 'remote_applied_timestamp', index, errors);

      if (entry.success !== true) addError(errors, `${label}: success must be true.`);
      if (sourceVersion && !TIMESTAMP14.test(sourceVersion)) addError(errors, `${label}: source_version must be a 14-digit timestamp.`);
      if (originalTimestamp && !TIMESTAMP14.test(originalTimestamp)) addError(errors, `${label}: original_source_timestamp must be a 14-digit timestamp.`);
      if (remoteVersion && !TIMESTAMP14.test(remoteVersion)) addError(errors, `${label}: remote_version must be a 14-digit timestamp.`);
      if (remoteApplied && !TIMESTAMP14.test(remoteApplied)) addError(errors, `${label}: remote_applied_timestamp must be a 14-digit timestamp.`);
      if (sha256 && !SHA256.test(sha256)) addError(errors, `${label}: sha256 must be 64 lowercase hexadecimal characters.`);
      if (mcpName && !NAME.test(mcpName)) addError(errors, `${label}: mcp_name is not a valid migration name.`);

      if (sourceFile && !isSafeRelativePath(sourceFile)) addError(errors, `${label}: source_file is not a safe relative path.`);
      if (originalFilename && !isSafeRelativePath(originalFilename)) addError(errors, `${label}: original_source_filename is not a safe relative path.`);
      if (canonicalFile && !isSafeRelativePath(canonicalFile)) addError(errors, `${label}: canonical_repository_filename is not a safe relative path.`);

      const sourceBase = sourceFile ? basename(sourceFile) : '';
      const sourceMatch = sourceBase.match(/^(\d{14})_(.+\.sql)$/);
      const canonicalBase = canonicalFile ? basename(canonicalFile) : '';
      const canonicalMatch = canonicalBase.match(/^(\d{14})_(.+\.sql)$/);
      const sourceSuffix = sourceMatch?.[2] ?? '';

      if (sourceFile && sourceVersion && sourceMatch && sourceMatch[1] !== sourceVersion) {
        addError(errors, `${label}: source_file timestamp does not match source_version.`);
      }
      if (sourceFile && originalFilename && originalFilename !== sourceFile) {
        addError(errors, `${label}: original_source_filename must preserve source_file exactly.`);
      }
      if (sourceFile && originalFilename && sourceBase !== basename(originalFilename)) {
        addError(errors, `${label}: original_source_filename basename does not match source_file.`);
      }
      if (sourceVersion && originalTimestamp && sourceVersion !== originalTimestamp) {
        addError(errors, `${label}: original_source_timestamp must equal source_version.`);
      }
      if (sourceVersion && expectedOriginalVersion(index) !== sourceVersion) {
        addError(errors, `${label}: original migration sequence must be ${expectedOriginalVersion(index)} at this position.`);
      }
      if (sourceVersion && seenOriginalVersions.has(sourceVersion)) addError(errors, `${label}: duplicate source_version ${sourceVersion}.`);
      if (sourceVersion) seenOriginalVersions.add(sourceVersion);
      if (sourceFile && sourceVersion && sourceSuffix && sourceFile !== `backend/supabase/migrations/${sourceVersion}_${sourceSuffix}`) {
        addError(errors, `${label}: source_file is inconsistent with the legacy migration path.`);
      }
      if (sourceMatch && mcpName && mcpName !== sourceBase.slice(0, -4)) {
        addError(errors, `${label}: mcp_name is inconsistent with the legacy source filename.`);
      }
      if (sourceSuffix && !SQL_FILENAME.test(sourceSuffix)) addError(errors, `${label}: original migration suffix is not a valid SQL filename.`);

      if (remoteVersion && remoteApplied && remoteVersion !== remoteApplied) {
        addError(errors, `${label}: remote_applied_timestamp must equal remote_version.`);
      }
      if (remoteVersion && previousRemoteVersion !== null && remoteVersion <= previousRemoteVersion) {
        addError(errors, `${label}: remote_version values must be strictly increasing.`);
      }
      if (remoteVersion && seenRemoteVersions.has(remoteVersion)) addError(errors, `${label}: duplicate remote_version ${remoteVersion}.`);
      if (remoteVersion) {
        seenRemoteVersions.add(remoteVersion);
        previousRemoteVersion = remoteVersion;
      }

      if (canonicalFile && canonicalFile !== `backend/supabase/migrations/${remoteVersion}_${sourceSuffix}`) {
        addError(errors, `${label}: canonical_repository_filename must use remote_version and preserve the original suffix.`);
      }
      if (canonicalMatch && remoteVersion && canonicalMatch[1] !== remoteVersion) {
        addError(errors, `${label}: canonical filename timestamp does not match remote_version.`);
      }
      if (canonicalMatch && sourceSuffix && canonicalMatch[2] !== sourceSuffix) {
        addError(errors, `${label}: canonical filename suffix does not match the original filename.`);
      }

      if (canonicalFile) {
        if (seenCanonicalPaths.has(canonicalFile)) addError(errors, `${label}: duplicate canonical_repository_filename ${canonicalFile}.`);
        seenCanonicalPaths.add(canonicalFile);
        expectedCanonicalFiles.add(canonicalBase);
      }

      const canonicalAbsolutePath = canonicalFile ? resolveLocalPath(root, canonicalFile) : null;
      if (canonicalAbsolutePath && existsSync(canonicalAbsolutePath)) {
        try {
          if (!statSync(canonicalAbsolutePath).isFile()) {
            addError(errors, `${label}: canonical migration path is not a regular file.`);
          } else if (sha256 && SHA256.test(sha256)) {
            const actualSha256 = createHash('sha256').update(readFileSync(canonicalAbsolutePath)).digest('hex');
            if (actualSha256 !== sha256) addError(errors, `${label}: sha256/content mismatch for ${canonicalFile}; migration content was changed.`);
          }
        } catch (error) {
          addError(errors, `${label}: could not hash ${canonicalFile}: ${error.message}`);
        }
      } else if (canonicalFile) {
        addError(errors, `${label}: canonical migration file is missing: ${canonicalFile}.`);
      }

      const originalAbsolutePath = sourceFile ? resolveLocalPath(root, sourceFile) : null;
      if (originalAbsolutePath && existsSync(originalAbsolutePath)) {
        addError(errors, `${label}: original migration file still exists: ${sourceFile}. Rename cleanup is incomplete.`);
      }
    }

    const actualCanonicalFiles = new Set(migrationFiles);
    for (const file of expectedCanonicalFiles) {
      if (!actualCanonicalFiles.has(file)) addError(errors, `Manifest canonical file is not present in migrations directory: ${file}.`);
    }
    for (const file of actualCanonicalFiles) {
      if (!expectedCanonicalFiles.has(file)) addError(errors, `Unexpected migration file is not represented by the manifest: ${file}.`);
      if (!SQL_FILENAME.test(file)) addError(errors, `Migration file has an invalid name: ${file}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    entryCount: Array.isArray(manifest) ? manifest.length : 0,
    migrationFiles,
    forwardEntryCount: forward.entries.length,
    forwardFiles: forward.files,
    forwardEntries: forward.entries,
  };
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--check') continue;
    if (argument === '--root' || argument === '--root-dir') {
      options.rootDir = argv[++index];
    } else if (argument === '--manifest') {
      options.manifestPath = argv[++index];
    } else if (argument === '--migrations' || argument === '--migrations-dir') {
      options.migrationsDir = argv[++index];
    } else {
      throw new Error(`Unknown argument ${argument}. Use --help for usage.`);
    }
  }
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === '') throw new Error(`${name} requires a value.`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: node backend/scripts/migration-manifest.mjs [--check] [--root DIR] [--manifest PATH] [--migrations DIR]');
      process.exit(0);
    }
    const result = validateMigrationManifest(options);
    if (!result.valid) {
      console.error(`Migration manifest validation failed with ${result.errors.length} error(s):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      const pendingForwardCount = result.forwardEntries?.filter((entry) => entry.production_status === 'not_applied').length ?? 0;
      const appliedForwardCount = result.forwardEntries?.filter((entry) => entry.production_status === 'applied').length ?? 0;
      console.log(`Migration manifest valid: ${result.entryCount} entries and ${result.migrationFiles.length} canonical SQL files (${pendingForwardCount} pending forward, ${appliedForwardCount} applied forward).`);
    }
  } catch (error) {
    console.error(`Migration manifest check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
