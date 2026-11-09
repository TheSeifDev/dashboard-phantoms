#!/usr/bin/env node
/**
 * run-migrations.mjs — مشغّل Migrations ذكي
 *
 * يطبق ملفات SQL على Supabase بالترتيب الصحيح.
 * يستخدم Supabase REST API (pg) أو يطبع الأوامر فقط.
 *
 * الاستخدام:
 *   node scripts/run-migrations.mjs --print      (طباعة فقط، بدون تنفيذ)
 *   node scripts/run-migrations.mjs --check      (يتحقق فقط أي migrations ناقصة)
 *   node scripts/run-migrations.mjs --apply=0005 (يطبّق migration محدد فقط)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'backend', 'migrations');

const PRINT_ONLY = process.argv.includes('--print');
const CHECK_ONLY = process.argv.includes('--check');
const APPLY_ARG  = process.argv.find(a => a.startsWith('--apply='));
const APPLY_NUM  = APPLY_ARG ? APPLY_ARG.split('=')[1] : null;

const C = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m', dim: '\x1b[2m',
};

console.log(`\n${C.bold}فانتومز (PHANTOMS) — مشغّل Migrations${C.reset}\n`);

// ── تحميل env ──────────────────────────────────────────
const ROOT_FE = resolve(__dirname, '..');
const envPath = existsSync(resolve(ROOT_FE, '.env.local'))
  ? resolve(ROOT_FE, '.env.local')
  : (existsSync(resolve(ROOT_FE, '.env.production')) ? resolve(ROOT_FE, '.env.production') : null);
const env = {};
if (envPath) {
  const envLines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of envLines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const SUPABASE_URL  = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// ── فحص مجلد migrations ────────────────────────────────
if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`  ${C.red}✗${C.reset}  مجلد migrations غير موجود: ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const MIGRATION_ORDER = [
  { file: '0001_security_hardening.sql',               desc: 'RLS + Column Security + Vault' },
  { file: '0002_whatsapp_settings.sql',                desc: 'WhatsApp Settings Table' },
  { file: '0003_atomic_approval_and_member_lookup.sql', desc: 'Atomic Approval + Member Lookup RPC' },
  { file: '0004_push_notifications.sql',               desc: 'Push Subscription Column + RPC' },
  { file: '0005_announcements_system.sql',             desc: 'Announcements System (6 RPCs)' },
  { file: '0006_remove_team_concept.sql',              desc: 'Remove Team Concept' },
  { file: '0007_device_session_token.sql',          desc: 'Single Device Session Token' },
  { file: '0008_admin_email_rls.sql',                desc: 'Admin Emails RLS restriction' },
  { file: '0009_member_device_binding.sql',          desc: 'Device-Bound Member RPCs (BOLA fix)' },
  { file: '0010_announcement_views.sql',             desc: 'Announcement View Tracking + Per-Member Details' },
  { file: '0011_rogue_policy_cleanup.sql',           desc: 'Remove Rogue Database Policies' },
  { file: '0012_task_bonus_and_deadline_time.sql',   desc: 'Per-Task Bonus + Deadline Time' },
  { file: '0013_member_device_sessions.sql',         desc: 'Multi-Device Member Sessions' },
  { file: '0014_admin_access_control.sql',           desc: 'Immutable Owner + Admin Account Management' },
  { file: '0015_admin_permissions_and_full_delete.sql', desc: 'Per-Section Permissions + Full Auth Account Deletion' },
  { file: '0016_member_infinite_bonus.sql',          desc: 'Audited Infinite Member Bonus' },
  { file: '0017_member_bonus_privacy.sql',           desc: 'Device-Verified Bonus Read + Private Notes' },
  { file: '0018_task_approval_reversal_and_ratings.sql', desc: 'Permission-Safe Task Approval Reversal + Rating RPC' },
  { file: '0019_member_information_and_ratings.sql', desc: 'Custom Member Information Forms + Admin Ratings' },
  { file: '0020_member_custom_fields.sql',        desc: 'Dynamic Member Custom Fields (JSONB + Metadata)' },
  { file: '0021_member_evaluations.sql',          desc: 'Structured Member Evaluations System' },
  { file: '0022_dynamic_system_ownership.sql',    desc: 'Dynamic System Ownership + Hardened Auth Sessions' },
];

// ── قراءة الملفات ──────────────────────────────────────
const migrations = [];
for (const m of MIGRATION_ORDER) {
  const path = resolve(MIGRATIONS_DIR, m.file);
  if (existsSync(path)) {
    const sql = readFileSync(path, 'utf8');
    migrations.push({ ...m, path, sql, exists: true });
  } else {
    migrations.push({ ...m, exists: false });
  }
}

// ── عرض قائمة الـ Migrations ──────────────────────────
console.log(`${C.bold}قائمة الـ Migrations (${migrations.length} ملف):${C.reset}\n`);
for (const m of migrations) {
  if (m.exists) {
    const lines = m.sql.split('\n').length;
    console.log(`  ${C.green}✓${C.reset}  ${m.file}  ${C.dim}(${lines} سطر)${C.reset}`);
    console.log(`     ${C.dim}${m.desc}${C.reset}`);
  } else {
    console.log(`  ${C.red}✗${C.reset}  ${m.file} — ${C.red}مفقود${C.reset}`);
  }
}

if (CHECK_ONLY) {
  const missing = migrations.filter(m => !m.exists);
  if (missing.length === 0) {
    console.log(`\n  ${C.green}كل الـ migrations موجودة.${C.reset}\n`);
  } else {
    console.log(`\n  ${C.red}${missing.length} migration(s) مفقودة.${C.reset}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ── وضع PRINT فقط ──────────────────────────────────────
if (PRINT_ONLY) {
  console.log(`\n${C.bold}الأوامر اللازمة للتطبيق اليدوي:${C.reset}
  
  ${C.cyan}عبر Supabase SQL Editor:${C.reset}
  افتح: https://supabase.com/dashboard/project/mukqrnmveydxfphftlaq/sql/new
  
  الصق كل ملف بالترتيب وشغّله:
`);
  for (const m of migrations.filter(m => m.exists)) {
    console.log(`  ${C.dim}── ${m.file} ──────────────────────────────${C.reset}`);
    const preview = m.sql.slice(0, 300).replace(/\n/g, '\n  ');
    console.log(`  ${preview}...\n`);
  }
  process.exit(0);
}

// ── تطبيق migration محدد أو الكل ──────────────────────
const toApply = APPLY_NUM
  ? migrations.filter(m => m.file.startsWith(APPLY_NUM))
  : migrations;

if (toApply.length === 0) {
  console.error(`  ${C.red}✗${C.reset}  لم يُعثر على migration رقم ${APPLY_NUM}`);
  process.exit(1);
}

console.log(`\n${C.bold}تطبيق ${toApply.length} migration(s)...${C.reset}\n`);

for (const m of toApply) {
  if (!m.exists) {
    console.log(`  ${C.yellow}⚠${C.reset}  ${m.file} — مفقود، تخطى`);
    continue;
  }

  process.stdout.write(`  → ${m.file} ... `);

  try {
    // استخدام Supabase REST API للتنفيذ
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: m.sql }),
    });

    if (res.ok) {
      console.log(`${C.green}✓${C.reset}`);
    } else {
      const body = await res.json().catch(() => ({}));
      // كثير من الـ migrations تُرجع error إذا طُبِّقت مرة ثانية (idempotent)
      if (body.message?.includes('already exists') || body.code === '42710') {
        console.log(`${C.yellow}⚠ مطبّق سابقاً${C.reset}`);
      } else {
        console.log(`${C.red}✗${C.reset} — ${body.message || res.status}`);
        console.log(`\n  ${C.yellow}انتبه: هذا الـ migration يحتاج تنفيذاً يدوياً في Supabase SQL Editor.${C.reset}`);
        console.log(`  ${C.cyan}https://supabase.com/dashboard/project/mukqrnmveydxfphftlaq/sql/new${C.reset}\n`);
      }
    }
  } catch (e) {
    console.log(`${C.red}✗${C.reset} — ${e.message}`);
  }
}

// ── ملخص + تعليمات ─────────────────────────────────────
const migrationSequence = MIGRATION_ORDER
  .map(({ file }) => file.match(/^\d+/)?.[0])
  .filter(Boolean)
  .join(' → ');

console.log(`
${C.bold}تعليمات مهمة:${C.reset}

  الـ migrations تحتاج صلاحيات SUPERUSER — طبّقها من:
  ${C.cyan}Supabase Dashboard → SQL Editor${C.reset}
  أو عبر: ${C.cyan}supabase db push${C.reset} (Supabase CLI)
  
  المسار: ${C.dim}${MIGRATIONS_DIR}${C.reset}
  الترتيب: ${migrationSequence}
`);
