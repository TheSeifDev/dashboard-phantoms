#!/usr/bin/env node
/**
 * wasla-health-check.mjs — فحص صحة النظام الكامل
 * يفحص: Supabase DB، Edge Functions، Push VAPID، Vercel deployment
 *
 * الاستخدام:
 *   node scripts/wasla-health-check.mjs
 *   node scripts/wasla-health-check.mjs --json   (للـ CI/CD)
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── تحميل env ───────────────────────────────────────────
const ENV_FILE = resolve(ROOT, '.env.local');
if (!existsSync(ENV_FILE)) {
  fatal('لا يوجد ملف .env.local — أنشئه أولاً.');
}
const envLines = readFileSync(ENV_FILE, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL     = env.VITE_SUPABASE_URL;
const SUPABASE_ANON    = env.VITE_SUPABASE_ANON_KEY;
const VAPID_PUBLIC     = env.VITE_VAPID_PUBLIC_KEY;
const JSON_MODE        = process.argv.includes('--json');

const results = [];
let exitCode = 0;

// ── helpers ─────────────────────────────────────────────
function pass(label, detail = '') {
  results.push({ status: 'PASS', label, detail });
  if (!JSON_MODE) console.log(`  ✓  ${label}${detail ? `  →  ${detail}` : ''}`);
}
function warn(label, detail = '', hint = '') {
  results.push({ status: 'WARN', label, detail, hint });
  if (!JSON_MODE) console.warn(`  ⚠  ${label}${detail ? `  →  ${detail}` : ''}${hint ? `\n     تلميح: ${hint}` : ''}`);
}
function fail(label, detail = '', hint = '') {
  results.push({ status: 'FAIL', label, detail, hint });
  if (!JSON_MODE) console.error(`  ✗  ${label}${detail ? `  →  ${detail}` : ''}${hint ? `\n     تلميح: ${hint}` : ''}`);
  exitCode = 1;
}
function fatal(msg) {
  console.error(`\n[FATAL] ${msg}\n`);
  process.exit(2);
}
function section(name) {
  if (!JSON_MODE) console.log(`\n── ${name} ${'─'.repeat(50 - name.length)}`);
}

// ── 1. فحص متغيرات البيئة ───────────────────────────────
section('متغيرات البيئة');
if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder')) {
  fail('VITE_SUPABASE_URL', 'مفقود أو placeholder', 'أضفه في .env.local');
} else {
  pass('VITE_SUPABASE_URL', SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]);
}

if (!SUPABASE_ANON || SUPABASE_ANON.includes('placeholder')) {
  fail('VITE_SUPABASE_ANON_KEY', 'مفقود', 'انسخه من Supabase Dashboard → Settings → API');
} else {
  pass('VITE_SUPABASE_ANON_KEY', `${SUPABASE_ANON.slice(0, 20)}…`);
}

if (!VAPID_PUBLIC) {
  fail('VITE_VAPID_PUBLIC_KEY', 'مفقود — الإشعارات لن تعمل', 'شغّل: npx web-push generate-vapid-keys');
} else if (VAPID_PUBLIC.length < 80) {
  warn('VITE_VAPID_PUBLIC_KEY', 'قصير جداً — قد يكون خاطئاً');
} else {
  pass('VITE_VAPID_PUBLIC_KEY', `${VAPID_PUBLIC.slice(0, 20)}…`);
}

// ── 2. فحص الاتصال بـ Supabase ──────────────────────────
section('Supabase — اتصال');
if (SUPABASE_URL && !SUPABASE_URL.includes('placeholder')) {
  try {
    const pingRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    // 200 = OK, 401 = RLS/auth required (طبيعي بعد migration 0003)
    if (pingRes.ok || pingRes.status === 401) {
      pass('REST endpoint', `${pingRes.status} — Supabase متاح`);
    } else {
      fail('REST endpoint', `${pingRes.status} ${pingRes.statusText}`, 'تحقق من صحة المفاتيح');
    }
  } catch (e) {
    fail('REST endpoint', e.message, 'تأكد من الاتصال بالإنترنت');
  }

  // فحص members table
  try {
    const membersRes = await fetch(`${SUPABASE_URL}/rest/v1/members?select=count&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: 'count=exact' },
    });
    if (membersRes.ok) {
      pass('جدول members موجود', 'OK');
    } else if (membersRes.status === 401 || membersRes.status === 403) {
      pass('جدول members موجود', 'RLS يحجب anon — صحيح بعد migration 0003');
    } else {
      const body = await membersRes.json().catch(() => ({}));
      if (body.code === '42P01') {
        fail('جدول members', 'غير موجود — شغّل supabase_setup.sql');
      } else {
        warn('جدول members', body.message || membersRes.statusText);
      }
    }
  } catch (e) {
    warn('جدول members', e.message);
  }

  // فحص tasks table
  try {
    const tasksRes = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=count&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: 'count=exact' },
    });
    if (tasksRes.ok) {
      pass('جدول tasks موجود');
    } else {
      fail('جدول tasks', tasksRes.statusText);
    }
  } catch (e) {
    warn('جدول tasks', e.message);
  }

  // فحص announcements table
  try {
    const annRes = await fetch(`${SUPABASE_URL}/rest/v1/announcements?select=count&limit=1`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (annRes.ok || annRes.status === 401) {
      pass('جدول announcements موجود', 'RLS يحجب anon — متوقع ✓');
    } else if (annRes.status === 404) {
      fail('جدول announcements', 'غير موجود', 'شغّل: backend/migrations/0005_announcements_system.sql');
    } else {
      warn('جدول announcements', annRes.statusText);
    }
  } catch (e) {
    warn('جدول announcements', e.message);
  }
}

// ── 3. فحص Edge Functions ───────────────────────────────
section('Edge Functions');
const FUNCTIONS = ['push-notify', 'wasla-ai', 'whatsapp-tasks', 'admin-invite', 'admin-delete-account'];
if (SUPABASE_URL && !SUPABASE_URL.includes('placeholder')) {
  for (const fn of FUNCTIONS) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      });
      if (res.status === 200 || res.status === 204) {
        pass(`Edge Function: ${fn}`, 'OPTIONS 200 — CORS OK');
      } else {
        warn(`Edge Function: ${fn}`, `OPTIONS → ${res.status}`, 'الدالة قد لا تكون منشورة');
      }
    } catch (e) {
      fail(`Edge Function: ${fn}`, e.message, `انشر: supabase functions deploy ${fn}`);
    }
  }

  const RPC_CHECKS = [
    {
      name: 'get_member_bonus_infinite',
      params: { p_member_id: 0, p_device_token: '' },
      expectedStatuses: [400, 422],
      migration: '0016_member_infinite_bonus.sql',
    },
    {
      name: 'set_member_bonus_infinite',
      params: { p_member_id: 0, p_enabled: false, p_reason: '' },
      expectedStatuses: [401, 403],
      migration: '0016_member_infinite_bonus.sql',
    },
    {
      name: 'get_member_bonus_total',
      params: { p_member_id: 0, p_device_token: '' },
      expectedStatuses: [400, 422],
      migration: '0017_member_bonus_privacy.sql',
    },
    {
      name: 'revoke_task_approval',
      params: { p_task_id: 0, p_member_id: 0, p_reason: '' },
      expectedStatuses: [401, 403],
      migration: '0018_task_approval_reversal_and_ratings.sql',
    },
  ];
  for (const check of RPC_CHECKS) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${check.name}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(check.params),
      });
      if (check.expectedStatuses.includes(res.status)) {
        pass(`RPC: ${check.name}`, 'موجودة ومقيّدة كما هو مطلوب');
      } else if (res.status === 404) {
        fail(`RPC: ${check.name}`, 'غير موجودة', `طبّق ${check.migration}`);
      } else {
        warn(`RPC: ${check.name}`, `HTTP ${res.status}`, `تحقق من ${check.migration} وصلاحيات الدالة`);
      }
    } catch (e) {
      fail(`RPC: ${check.name}`, e.message);
    }
  }
}

// ── 4. فحص ملفات البناء ─────────────────────────────────
section('ملفات المشروع');
const requiredFiles = [
  ['frontend/.env.local', 'ضروري للبناء'],
  ['frontend/public/manifest.json', 'ضروري للـ PWA'],
  ['frontend/public/wasla-logo.png', 'لوجو التطبيق'],
  ['frontend/public/icons/icon-192.png', 'أيقونة الإشعارات'],
  ['frontend/public/icons/icon-512.png', 'أيقونة التثبيت'],
  ['frontend/src/sw.ts', 'Service Worker'],
  ['backend/migrations/0005_announcements_system.sql', 'نظام الإعلانات'],
];

const MIGRATIONS_DIR = resolve(ROOT, '..', 'backend', 'migrations');
if (existsSync(MIGRATIONS_DIR)) {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latestMigration = migrationFiles.at(-1);
  if (latestMigration) {
    requiredFiles.push([`backend/migrations/${latestMigration}`, `آخر ملف migration من ${migrationFiles.length}`]);
  }
}

for (const [rel, desc] of requiredFiles) {
  const abs = resolve(ROOT, '..', rel);
  if (existsSync(abs)) {
    pass(rel.split('/').pop(), desc);
  } else {
    fail(rel.split('/').pop(), 'مفقود', `المسار المتوقع: ${rel}`);
  }
}

// ── 5. فحص dist (هل بُني المشروع؟) ─────────────────────
section('حالة البناء');
const distIndex = resolve(ROOT, 'dist', 'index.html');
const distSW    = resolve(ROOT, 'dist', 'sw.js');
if (existsSync(distIndex) && existsSync(distSW)) {
  const stat = await import('fs').then(m => m.statSync(distIndex));
  const ageMs = Date.now() - stat.mtimeMs;
  const ageMin = Math.round(ageMs / 60000);
  if (ageMin > 60) {
    warn('dist/index.html', `آخر بناء منذ ${ageMin} دقيقة`, 'قد تكون هناك تغييرات غير مبنية — شغّل: npm run build');
  } else {
    pass('dist/index.html', `بُني منذ ${ageMin} دقيقة`);
  }
  pass('dist/sw.js', 'Service Worker مبني');
} else {
  warn('dist/', 'المشروع لم يُبنَ بعد', 'شغّل: npm run build');
}

// ── 6. فحص الـ manifest ──────────────────────────────────
section('PWA Manifest');
const manifestPath = resolve(ROOT, 'public', 'manifest.json');
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.theme_color === '#6D28D9' || manifest.theme_color?.includes('6D28D9')) {
      fail('theme_color', 'بنفسجي — يخالف Design System', 'يجب أن يكون #14110F');
    } else {
      pass('theme_color', manifest.theme_color);
    }
    if (manifest.icons?.length >= 4) {
      pass('icons', `${manifest.icons.length} أيقونة مُعرَّفة`);
    } else {
      warn('icons', 'أيقونات أقل من المطلوب');
    }
    if (!manifest.start_url) {
      warn('start_url', 'غير محددة');
    } else {
      pass('start_url', manifest.start_url);
    }
  } catch {
    fail('manifest.json', 'JSON غير صالح');
  }
}

// ── 7. فحص VAPID Key Format ─────────────────────────────
section('VAPID Key Validation');
if (VAPID_PUBLIC) {
  try {
    const padding = '='.repeat((4 - (VAPID_PUBLIC.length % 4)) % 4);
    const base64 = (VAPID_PUBLIC + padding).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(base64, 'base64');
    if (decoded.length === 65) {
      pass('VAPID public key format', '65 bytes — صالح (uncompressed EC point)');
    } else {
      fail('VAPID public key format', `${decoded.length} bytes — يجب 65`, 'أعد توليد المفاتيح: npx web-push generate-vapid-keys');
    }
  } catch (e) {
    fail('VAPID public key decode', e.message);
  }
}

// ── تقرير نهائي ──────────────────────────────────────────
section('ملخص التقرير');
const passed = results.filter(r => r.status === 'PASS').length;
const warned = results.filter(r => r.status === 'WARN').length;
const failed = results.filter(r => r.status === 'FAIL').length;

if (!JSON_MODE) {
  console.log(`\n  نجح: ${passed}  |  تحذير: ${warned}  |  فشل: ${failed}`);
  if (exitCode === 0) {
    console.log('  النظام سليم.\n');
  } else {
    console.log(`  يوجد ${failed} مشكلة تحتاج معالجة.\n`);
  }
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ summary: { passed, warned, failed }, results }, null, 2) + '\n');
}

process.exitCode = exitCode;
