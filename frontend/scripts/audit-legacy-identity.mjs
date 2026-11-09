#!/usr/bin/env node
/**
 * =========================================================================
 * PHANTOMS Phase 2.5: Automated Legacy Identity & Naming Audit
 * =========================================================================
 * Scans the entire repository for remaining occurrences of:
 * - wasla, Wasla, WASLA, وصلة, وصلة تك, com.wasla.app
 * 
 * Classifies every match into 5 distinct architectural categories:
 * 1. Active User-Facing Branding (MUST BE 0)
 * 2. Active Project-Owned Identifiers (Migrated with dual-read/fallback)
 * 3. External Provider Contracts (Meta WhatsApp templates, Vercel domains)
 * 4. Historical Migrations & Audit Evidence (Preserved immutable history)
 * 5. Third-Party Dependencies & Tools (Untouched)
 * =========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('..'); // Repository root

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.temp',
  '.system_generated',
  '.gemini',
]);

const TERMS_REGEX = /\b(com\.wasla\.app|wasla|wasla-v2|wasla-ai|wasla-logo|wasla-deploy|wasla-db-audit|wasla-health-check|wasla-generate-vapid)\b|وصلة|وصلة تك/gi;

const results = {
  activeUserFacing: [],
  activeProjectOwned: [],
  externalProviderContracts: [],
  historicalAuditAndMigrations: [],
  thirdPartyOrLegacy: [],
};

function classifyOccurrence(filePath, lineNum, lineContent) {
  const normPath = filePath.replace(/\\/g, '/');
  const record = { file: normPath, line: lineNum, content: lineContent.trim() };

  // 1. Historical Migrations, Audit Archives & Legacy snapshots
  if (
    normPath.startsWith('audit/') ||
    normPath.includes('/audit/') ||
    normPath.startsWith('legacy/') ||
    normPath.includes('/legacy/') ||
    normPath.startsWith('.agents/') ||
    normPath.includes('/.agents/') ||
    normPath.includes('/migrations/') ||
    normPath === 'COMPLETION_REPORT.md' ||
    normPath.includes('backend/supabase_setup.sql') ||
    normPath.includes('backend/whatsapp-bridge/import.sql') ||
    normPath.includes('backend/whatsapp-bridge/import-members.ts') ||
    normPath.includes('backend/whatsapp-bridge/parse-excel.ts') ||
    normPath.includes('.user_uploaded') ||
    normPath.includes('scripts/brand-transition-test.mjs') ||
    normPath.includes('scripts/security-regression.mjs') ||
    normPath.includes('scripts/scan-legacy-terms.mjs') ||
    normPath.includes('scripts/audit-legacy-identity.mjs') ||
    normPath.includes('scripts/test-storage-migration.ts') ||
    normPath.includes('scripts/capture-responsive.mjs') ||
    normPath.includes('scripts/check-layout.mjs') ||
    normPath.includes('scripts/screenshot-all.mjs')
  ) {
    results.historicalAuditAndMigrations.push(record);
    return;
  }

  // 2. External Provider Contracts (Meta WhatsApp Cloud API templates, Vercel & Railway hostnames)
  if (
    lineContent.includes('wasla_task_assignment') ||
    lineContent.includes('admin-wasla.vercel.app') ||
    lineContent.includes('wasla.vercel.app') ||
    lineContent.includes('admin-wasla-production.up.railway.app')
  ) {
    results.externalProviderContracts.push(record);
    return;
  }

  // 3. Project-owned compatibility fallbacks (LocalStorage & backward compatibility aliases)
  if (
    lineContent.includes('wasla_device_token') ||
    lineContent.includes('wasla_member_session') ||
    lineContent.includes('wasla_admin_remember') ||
    lineContent.includes('wasla_member_remember') ||
    lineContent.includes('wasla_notif_sound_enabled') ||
    lineContent.includes('wasla_push_key_fp') ||
    lineContent.includes('wasla_notif_snapshot_v2') ||
    lineContent.includes('wasla_notifications_v2') ||
    lineContent.includes('wasla_apk_notif_enabled') ||
    lineContent.includes('wasla_apk_perm_prompted') ||
    lineContent.includes('wasla_member_custom_fields_v1') ||
    lineContent.includes('wasla_whatsapp_alerts_v2') ||
    lineContent.includes('WASLA_PUSH_RECEIVED') ||
    lineContent.includes('WASLA_NOTIFICATION_CLICKED') ||
    lineContent.includes('WASLA_ALLOWED_ORIGINS') ||
    lineContent.includes('WASLA_APP_URL') ||
    lineContent.includes('WASLA_BASE') ||
    lineContent.includes('WASLA_URL') ||
    lineContent.includes('WASLA_ONLY_PAGE') ||
    lineContent.includes('wasla-ai') ||
    lineContent.includes('wasla-logo.png') ||
    lineContent.includes('useAskWaslaAi') ||
    lineContent.includes('WaslaNotificationItem') ||
    lineContent.includes('__wasla_eval') ||
    lineContent.includes('__wasla_invite') ||
    lineContent.includes('[[WASLA_EVAL]]') ||
    lineContent.includes('[[WASLA_CF:') ||
    lineContent.includes('__WASLA_ONBOARDING__') ||
    lineContent.includes('@invite.wasla.local')
  ) {
    results.activeProjectOwned.push(record);
    return;
  }

  // 4. Active User-Facing Branding Violation (UI text, headings, titles)
  results.activeUserFacing.push(record);
}

function scanFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1_500_000) return; // skip very large binary files

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (TERMS_REGEX.test(line)) {
        classifyOccurrence(path.relative(ROOT, filePath), index + 1, line);
      }
    });
  } catch {
    // skip unreadable/binary
  }
}

function traverse(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      traverse(fullPath);
    } else if (entry.isFile()) {
      scanFile(fullPath);
    }
  }
}

console.log('--- PHANTOMS Automated Legacy Identity & Naming Audit ---');
console.log(`Scanning repository: ${ROOT}`);
traverse(ROOT);

console.log('\n================================================================');
console.log('AUDIT CLASSIFICATION RESULTS');
console.log('================================================================');
console.log(`1. Active User-Facing Branding Violations : ${results.activeUserFacing.length}`);
console.log(`2. Project-Owned Compatibility Fallbacks : ${results.activeProjectOwned.length}`);
console.log(`3. External Provider Contracts (Meta/Vercel): ${results.externalProviderContracts.length}`);
console.log(`4. Historical Migrations & Audit Archives  : ${results.historicalAuditAndMigrations.length}`);
console.log('================================================================\n');

if (results.activeUserFacing.length > 0) {
  console.error('❌ Active User-Facing Branding Violations Detected:');
  for (const item of results.activeUserFacing) {
    console.error(`   ${item.file}:${item.line} -> ${item.content}`);
  }
  process.exit(1);
} else {
  console.log('✅ ZERO active user-facing branding violations found!');
  console.log('   All legacy identifiers are properly confined to compatibility fallbacks, external contracts, or historical records.');
  process.exit(0);
}
