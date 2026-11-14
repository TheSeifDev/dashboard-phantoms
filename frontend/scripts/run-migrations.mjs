#!/usr/bin/env node
/**
 * PHANTOMS migration inventory helper.
 * Supabase CLI is the only supported migration application mechanism.
 * This script is inventory/print-only.
 *
 * Usage:
 *   node scripts/run-migrations.mjs --check
 *   PHANTOMS_SUPABASE_PROJECT_REF=<approved-ref> node scripts/run-migrations.mjs --print
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'backend', 'supabase', 'migrations');
const args = process.argv.slice(2);
const PRINT_ONLY = args.includes('--print');
const CHECK_ONLY = args.includes('--check');
const APPROVED_PROJECT_REF = 'wxwoaputugxwysuhcebv';
const unknownArgs = args.filter((arg) => !['--print', '--check'].includes(arg));
const C = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m', dim: '\x1b[2m' };

if (unknownArgs.length) {
  console.error(`${C.red}✗${C.reset} Unsupported option: ${unknownArgs[0]}. Apply migrations only with Supabase CLI.`);
  process.exit(2);
}

const migrationFiles = [
  '20261112000000_base_schema.sql', '20261112000001_security_hardening.sql',
  '20261112000002_whatsapp_settings.sql', '20261112000003_atomic_approval_and_member_lookup.sql',
  '20261112000004_push_notifications.sql', '20261112000005_announcements_system.sql',
  '20261112000006_remove_team_concept.sql', '20261112000007_device_session_token.sql',
  '20261112000008_admin_email_rls.sql', '20261112000009_member_device_binding.sql',
  '20261112000010_announcement_views.sql', '20261112000011_rogue_policy_cleanup.sql',
  '20261112000012_task_bonus_and_deadline_time.sql', '20261112000013_member_device_sessions.sql',
  '20261112000014_admin_access_control.sql', '20261112000015_admin_permissions_and_full_delete.sql',
  '20261112000016_member_infinite_bonus.sql', '20261112000017_member_bonus_privacy.sql',
  '20261112000018_task_approval_reversal_and_ratings.sql', '20261112000019_member_information_and_ratings.sql',
  '20261112000020_member_custom_fields.sql', '20261112000021_member_evaluations.sql',
  '20261112000022_dynamic_system_ownership.sql', '20261112000023_phantoms_identity_migration.sql',
];

console.log(`\n${C.bold}PHANTOMS — Supabase migration inventory${C.reset}\n`);
if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`${C.red}✗${C.reset} Missing migrations directory: ${MIGRATIONS_DIR}`);
  process.exit(1);
}
const missing = [];
for (const file of migrationFiles) {
  const path = resolve(MIGRATIONS_DIR, file);
  if (!existsSync(path)) {
    missing.push(file);
    console.log(`  ${C.red}✗${C.reset} ${file} — missing`);
    continue;
  }
  const lines = readFileSync(path, 'utf8').split('\n').length;
  console.log(`  ${C.green}✓${C.reset} ${file} ${C.dim}(${lines} lines)${C.reset}`);
}
if (missing.length) {
  console.error(`\n${C.red}${missing.length} migration(s) missing.${C.reset}`);
  process.exit(1);
}
if (CHECK_ONLY) {
  console.log(`\n${C.green}All ${migrationFiles.length} canonical migrations are present.${C.reset}`);
  process.exit(0);
}
if (PRINT_ONLY) {
  const projectRef = process.env.PHANTOMS_SUPABASE_PROJECT_REF?.trim();
  if (!projectRef) {
    console.error(`${C.red}✗${C.reset} Set PHANTOMS_SUPABASE_PROJECT_REF explicitly before printing remote commands.`);
    process.exit(2);
  }
  if (!/^[a-z]{20}$/.test(projectRef) || projectRef !== APPROVED_PROJECT_REF) {
    console.error(`${C.red}✗${C.reset} Refusing to print commands for an unapproved project target.`);
    process.exit(2);
  }
  console.log(`\n${C.bold}Read-only inventory and dry-run commands for ${projectRef}:${C.reset}`);
  console.log(`  supabase migration list --workdir backend --remote=${projectRef}`);
  console.log(`  supabase db push --dry-run --workdir backend --remote=${projectRef} --skip-vault`);
  console.log(`\n${C.yellow}No SQL was executed by this helper.${C.reset}\n`);
  process.exit(0);
}
console.log(`\n${C.cyan}Use --check or --print. No migration was applied.${C.reset}\n`);
