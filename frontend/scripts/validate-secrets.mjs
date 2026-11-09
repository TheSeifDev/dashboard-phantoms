#!/usr/bin/env node
/**
 * =========================================================================
 * PHANTOMS Platform — Comprehensive Secret & Credential Validation Scanner
 * =========================================================================
 * Scans the active repository tree, outgoing Git history, production build
 * bundles (dist), source maps, and Android assets for private credentials.
 * 
 * REDACTION MANDATE:
 * All matching credentials are redacted to [REDACTED_<CATEGORY>].
 * Never prints raw secret values to stdout, stderr, or log files.
 * =========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('..'); // Repository root
const isBuildArtifactsOnly = process.argv.includes('--build-artifacts');

const IGNORED_SOURCE_DIRS = new Set([
  'node_modules',
  '.git',
  '.temp',
  '.system_generated',
  '.gemini',
]);

const FINDINGS = {
  trackedSource: [],
  outgoingCommits: [],
  buildArtifacts: [],
  localEnvFiles: [],
};

// Helper to safely redact a matched secret
function redact(str) {
  if (!str) return '[REDACTED]';
  return str.slice(0, 4) + '***[REDACTED]***' + str.slice(-3);
}

// Credential regex patterns with categorization
const PATTERNS = [
  {
    category: 'Supabase Secret Key',
    regex: /\b(sb_secret_[a-zA-Z0-9_-]{20,})\b/g,
    severity: 'CRITICAL',
    isSecret: true,
  },
  {
    category: 'Private Key Block',
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    severity: 'CRITICAL',
    isSecret: true,
  },
  {
    category: 'Groq API Key',
    regex: /\b(gsk_[a-zA-Z0-9]{20,})\b/g,
    severity: 'HIGH',
    isSecret: true,
    filter: (_match, line) => {
      // Ignore prefix checks like .startsWith('gsk_') or test mocks
      return !line.includes("startsWith('gsk_')") && !line.includes('gsk_...') && !line.includes('/gsk_');
    },
  },
  {
    category: 'OpenAI API Key',
    regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
    severity: 'HIGH',
    isSecret: true,
    filter: (_m, line) => !line.includes('sk-...') && !line.includes('sk-placeholder'),
  },
  {
    category: 'GitHub Personal Access Token',
    regex: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{80,})\b/g,
    severity: 'CRITICAL',
    isSecret: true,
  },
  {
    category: 'Meta Access Token',
    regex: /\b(EAAB[a-zA-Z0-9]{20,}|EAAC[a-zA-Z0-9]{20,})\b/g,
    severity: 'HIGH',
    isSecret: true,
  },
  {
    category: 'Database Connection URI with Password',
    regex: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@[^\s/]+/g,
    severity: 'CRITICAL',
    isSecret: true,
    filter: (_m, line) => !line.includes('user:password') && !line.includes('[password]'),
  },
  {
    category: 'Supabase Service Role JWT',
    regex: /\beyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/g,
    severity: 'CRITICAL',
    isSecret: true,
    filter: (match) => {
      try {
        const parts = match.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload.role === 'service_role';
      } catch {
        return false;
      }
    },
  },
  {
    category: 'Private VAPID Key in Client Config',
    regex: /\bVAPID_PRIVATE_KEY\s*=\s*[a-zA-Z0-9_-]{30,}\b/g,
    severity: 'CRITICAL',
    isSecret: true,
  },
];

function scanContent(content, filePath, isArtifact = false) {
  const normPath = filePath.replace(/\\/g, '/');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    PATTERNS.forEach((p) => {
      let match;
      const re = new RegExp(p.regex.source, p.regex.flags);
      while ((match = re.exec(line)) !== null) {
        const matchedVal = match[0];
        if (p.filter && !p.filter(matchedVal, line)) continue;

        const record = {
          file: normPath,
          line: index + 1,
          category: p.category,
          severity: p.severity,
          redactedPreview: redact(matchedVal),
        };

        if (isArtifact) {
          FINDINGS.buildArtifacts.push(record);
        } else if (normPath.includes('.env')) {
          FINDINGS.localEnvFiles.push(record);
        } else {
          let isTracked = false;
          try {
            execSync(`git ls-files --error-unmatch "${filePath}"`, { stdio: 'pipe' });
            isTracked = true;
          } catch {
            isTracked = false;
          }

          if (isTracked) {
            FINDINGS.trackedSource.push(record);
          } else {
            FINDINGS.localEnvFiles.push(record);
          }
        }
      }
    });
  });
}

function scanFile(filePath, isArtifact = false) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 20_000_000) return; // Skip files > 20MB
    const content = fs.readFileSync(filePath, 'utf8');
    scanContent(content, path.relative(ROOT, filePath), isArtifact);
  } catch {
    // Unreadable binary
  }
}

function traverseDirectory(dir, isArtifact = false) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!isArtifact && IGNORED_SOURCE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      traverseDirectory(fullPath, isArtifact);
    } else if (entry.isFile()) {
      scanFile(fullPath, isArtifact);
    }
  }
}

// ── 1. Scan Build Artifacts ────────────────────────────────────────────────
const ARTIFACT_DIRS = [
  path.join(ROOT, 'frontend', 'dist'),
  path.join(ROOT, 'frontend', 'android', 'app', 'src', 'main', 'assets', 'public'),
  path.join(ROOT, 'frontend', 'android', 'app', 'build', 'outputs'),
  path.join(ROOT, 'frontend', 'build'),
  path.join(ROOT, 'dist'),
];

console.log('=== PHANTOMS Security: Global API & Build Artifact Scanner ===');

console.log('Scanning build artifacts...');
let artifactCount = 0;
ARTIFACT_DIRS.forEach((d) => {
  if (fs.existsSync(d)) {
    console.log(` - Inspecting artifact directory: ${path.relative(ROOT, d)}`);
    traverseDirectory(d, true);
    artifactCount++;
  }
});
if (artifactCount === 0) {
  console.log(' - No existing artifact directories found (clean state).');
}

// Also check root for any *.apk
const rootEntries = fs.readdirSync(ROOT, { withFileTypes: true });
for (const e of rootEntries) {
  if (e.isFile() && e.name.endsWith('.apk')) {
    scanFile(path.join(ROOT, e.name), true);
  }
}

// ── 2. Scan Tracked Source Files (if not --build-artifacts only) ─────────────
if (!isBuildArtifactsOnly) {
  console.log(`\nScanning source workspace at: ${ROOT}`);
  traverseDirectory(ROOT, false);

  console.log('\nScanning outgoing Git commits (origin/main..HEAD)...');
  try {
    const revs = execSync('git rev-list origin/main..HEAD', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    for (const rev of revs) {
      PATTERNS.forEach((p) => {
        try {
          const diff = execSync(`git show ${rev} -U0`, { encoding: 'utf8' });
          diff.split('\n').forEach((line) => {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              let match;
              const re = new RegExp(p.regex.source, p.regex.flags);
              while ((match = re.exec(line)) !== null) {
                const matchedVal = match[0];
                if (p.filter && !p.filter(matchedVal, line)) continue;
                FINDINGS.outgoingCommits.push({
                  commit: rev.slice(0, 7),
                  category: p.category,
                  severity: p.severity,
                  redactedPreview: redact(matchedVal),
                });
              }
            }
          });
        } catch {}
      });
    }
  } catch (e) {
    console.log('Could not scan git outgoing range:', e.message);
  }
}

// ── 3. Summary & Reporting ────────────────────────────────────────────────
console.log('\n================================================================');
console.log('PHANTOMS SECRET SCANNER AUDIT REPORT');
console.log('================================================================');
if (!isBuildArtifactsOnly) {
  console.log(`Tracked Codebase Findings   : ${FINDINGS.trackedSource.length}`);
  console.log(`Outgoing Commits Findings   : ${FINDINGS.outgoingCommits.length}`);
  console.log(`Local Untracked .env Keys   : ${FINDINGS.localEnvFiles.length}`);
}
console.log(`Production Build Artifacts  : ${FINDINGS.buildArtifacts.length}`);
console.log('================================================================\n');

let hasViolations = false;

if (FINDINGS.buildArtifacts.length > 0) {
  hasViolations = true;
  console.error('❌ CRITICAL: Private credentials detected in production build artifacts:');
  FINDINGS.buildArtifacts.forEach((f) => {
    console.error(`   ${f.file}:${f.line} [${f.category}] -> ${f.redactedPreview}`);
  });
} else {
  console.log('✅ ZERO private credentials found in production build artifacts or Android assets.');
}

if (!isBuildArtifactsOnly) {
  if (FINDINGS.trackedSource.length > 0) {
    hasViolations = true;
    console.error('❌ CRITICAL: Tracked private secrets detected in working tree:');
    FINDINGS.trackedSource.forEach((f) => {
      console.error(`   ${f.file}:${f.line} [${f.category}] -> ${f.redactedPreview}`);
    });
  } else {
    console.log('✅ ZERO tracked private credentials found in repository tree.');
  }

  if (FINDINGS.outgoingCommits.length > 0) {
    hasViolations = true;
    console.error('❌ CRITICAL: Secrets detected in outgoing Git commits:');
    FINDINGS.outgoingCommits.forEach((f) => {
      console.error(`   Commit ${f.commit} [${f.category}] -> ${f.redactedPreview}`);
    });
  } else {
    console.log('✅ ZERO secrets found in outgoing Git commits (origin/main..HEAD).');
  }
}

if (hasViolations) {
  process.exit(1);
} else {
  console.log('\n🛡️  All scanned surfaces are clean and free of secret exposures.');
  process.exit(0);
}
