#!/usr/bin/env node
/**
 * =========================================================================
 * PHANTOMS: Zero Legacy Identity Automated Verification Suite
 * =========================================================================
 * Scans the entire repository workspace to assert:
 * ZERO occurrences of retired product identity spellings.
 * 
 * Required outcome: 0 files, 0 lines.
 * =========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.gemini',
  'dist',
  'dist-apk',
  'build',
  '.gradle',
]);

// Dynamically construct search pattern without embedding retired brand strings
const charSeq = (...codes) => String.fromCharCode(...codes);
const p1 = charSeq(119, 97, 115, 108, 97); // w-a-s-l-a
const p2 = charSeq(1608, 1589, 1604, 1577); // w-s-l-t_marbuta: و-ص-ل-ة
const p3 = charSeq(1608, 1589, 1604, 1607); // w-s-l-ha: و-ص-ل-ه

const REGEX = new RegExp(`${p1}|${p2}|${p3}`, 'i');

const fileHits = [];
const nameHits = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, fullPath);

    if (REGEX.test(entry.name)) {
      nameHits.push({ path: relPath, isDir: entry.isDirectory() });
    }

    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.ico', '.pdf', '.jar', '.webp', '.apk'].includes(ext)) {
        continue;
      }
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 5 * 1024 * 1024) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        if (REGEX.test(content)) {
          const lines = content.split(/\r?\n/);
          const matches = [];
          lines.forEach((l, idx) => {
            if (REGEX.test(l)) {
              matches.push({ line: idx + 1, text: l.trim().slice(0, 150) });
            }
          });
          fileHits.push({ file: relPath, count: matches.length, matches });
        }
      } catch {
        // Unreadable or binary
      }
    }
  }
}

console.log('Scanning workspace for zero retired identity occurrences...');
walk(ROOT);

console.log(`\nMatching file/dir names: ${nameHits.length}`);
nameHits.forEach((n) => console.log(`  ${n.isDir ? '[DIR]' : '[FILE]'} ${n.path}`));

console.log(`\nMatching files by content: ${fileHits.length}`);
let totalLines = 0;
fileHits.forEach((f) => {
  totalLines += f.count;
  console.log(`  ${f.file} (${f.count} matches)`);
  f.matches.slice(0, 3).forEach((m) => console.log(`    L${m.line}: ${m.text}`));
});
console.log(`Total matching lines: ${totalLines}`);

if (nameHits.length > 0 || fileHits.length > 0) {
  console.error(`\nFAILED: Found ${nameHits.length} matching names and ${fileHits.length} files (${totalLines} lines) with retired identity.`);
  process.exit(1);
} else {
  console.log('\nPASSED: Zero retired identity found in workspace. Verification SUCCESS.');
  process.exit(0);
}
