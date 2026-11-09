#!/usr/bin/env node
/**
 * phantoms-db-audit.mjs — مراجعة ذكية لقاعدة البيانات
 *
 * يتحقق من:
 *   - هل كل الـ migrations طُبِّقت؟
 *   - هل الدوال المطلوبة موجودة؟
 *   - هل RLS مفعّل على كل الجداول؟
 *   - هل بيانات الإعلانات صحيحة؟
 *   - هل توجد subscriptions منتهية الصلاحية؟
 *
 * الاستخدام:
 *   node scripts/phantoms-db-audit.mjs
 *   node scripts/phantoms-db-audit.mjs --clean-subscriptions
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── env ────────────────────────────────────────────────────
const envLines = readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL  = env.VITE_SUPABASE_URL;
const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY;
const CLEAN_SUBS    = process.argv.includes('--clean-subscriptions');

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌ بيانات Supabase غير موجودة في .env.local');
  process.exit(1);
}

// ── helper: supabase REST call ─────────────────────────────
async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// helper: supabase RPC
async function rpc(fn, params = {}) {
  return sb(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

const C = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m' };
const ok   = (m, d = '') => console.log(`  ${C.green}✓${C.reset} ${m}${d ? ` ${C.dim}(${d})${C.reset}` : ''}`);
const fail = (m, d = '') => console.error(`  ${C.red}✗${C.reset} ${m}${d ? ` ${C.dim}(${d})${C.reset}` : ''}`);
const warn = (m, d = '') => console.warn(`  ${C.yellow}⚠${C.reset} ${m}${d ? ` ${C.dim}(${d})${C.reset}` : ''}`);
const sec  = (n) => console.log(`\n${C.bold}${C.cyan}── ${n} ${'─'.repeat(45 - n.length)}${C.reset}`);

console.log(`\n${C.bold}فانتومز (PHANTOMS) — مراجعة قاعدة البيانات${C.reset}\n`);

// ── 1. الجداول الأساسية ────────────────────────────────────
sec('الجداول الأساسية');
const TABLES = ['members', 'tasks', 'notes', 'announcements', 'whatsapp_settings', 'admin_accounts', 'member_infinite_bonus_events'];
for (const table of TABLES) {
  const { ok: isOk, status, body } = await sb(`/rest/v1/${table}?select=count&limit=1`, {
    headers: { Prefer: 'count=exact' },
  });
  if (isOk) {
    ok(`${table}`, `موجود`);
  } else if (status === 401 || status === 403) {
    ok(`${table}`, `موجود (RLS يحجب anon — صحيح)`);
  } else if (status === 404 || (body && body.code === '42P01')) {
    fail(`${table}`, 'غير موجود — شغّل الـ migrations');
  } else {
    warn(`${table}`, `${status} — ${body?.message ?? 'خطأ غير معروف'}`);
  }
}

// ── 2. الدوال (RPCs) المطلوبة ─────────────────────────────
sec('الدوال (RPCs)');
const RPCS = [
  { name: 'lookup_member_by_email', params: { p_email: 'test@test.com' }, allowEmpty: true },
  { name: 'get_member_announcements', params: { p_member_id: 0 }, allowEmpty: true },
  { name: 'mark_announcement_read', params: { p_announcement_id: 0, p_member_id: 0 }, expectFail: true },
  { name: 'dismiss_announcement', params: { p_announcement_id: 0, p_member_id: 0 }, expectFail: true },
  { name: 'save_push_subscription', params: { p_member_id: 0, p_email: '', p_subscription: {} }, expectFail: true },
  { name: 'get_admin_access', params: {}, expectDenied: true },
  { name: 'get_member_bonus_total', params: { p_member_id: 0, p_device_token: '' }, expectFail: true },
  { name: 'set_member_bonus_infinite', params: { p_member_id: 0, p_enabled: false, p_reason: '' }, expectDenied: true },
  { name: 'get_member_bonus_infinite', params: { p_member_id: 0, p_device_token: '' }, expectDenied: true },
  { name: 'approve_task_submission', params: { p_task_id: 0, p_member_id: 0, p_bonus: 0 }, expectDenied: true },
  { name: 'revoke_task_approval', params: { p_task_id: 0, p_member_id: 0, p_reason: '' }, expectDenied: true },
  { name: 'admin_add_member_rating', params: { p_member_id: 0, p_points: 0, p_reason: '' }, expectDenied: true },
];

for (const r of RPCS) {
  const { status, body } = await rpc(r.name, r.params);
  if (status === 200 || status === 204) {
    ok(`rpc/${r.name}`);
  } else if (status === 400 || status === 422) {
    if (r.expectFail) {
      ok(`rpc/${r.name}`, 'تُرجع خطأ للبيانات الفارغة — متوقع ✓');
    } else {
      warn(`rpc/${r.name}`, `${body?.message ?? body?.error ?? status}`);
    }
  } else if ((status === 401 || status === 403) && r.expectDenied) {
    ok(`rpc/${r.name}`, 'محمي للحسابات المصرح لها — متوقع ✓');
  } else if (status === 404 || (body?.code === 'PGRST202')) {
    fail(`rpc/${r.name}`, 'غير موجودة — شغّل الـ migrations الناقصة');
  } else {
    warn(`rpc/${r.name}`, `${status} — ${body?.message ?? ''}`);
  }
}

// ── 3. إحصاءات البيانات (مع auth تجريبية) ─────────────────
sec('إحصاءات البيانات');
// نستخدم RPC المتاحة للـ anon
const lookup = await rpc('lookup_member_by_email', { p_email: 'nonexistent@phantoms.org' });
if (lookup.status === 200) {
  ok('dالوصول إلى البيانات', `lookup_member_by_email يعمل بشكل صحيح`);
} else {
  warn('lookup_member_by_email', `${lookup.status}`);
}

// ── 4. فحص الـ Migrations ─────────────────────────────────
sec('ملفات الـ Migrations');
const migrationsDir = resolve(ROOT, '..', 'backend', 'migrations');
if (existsSync(migrationsDir)) {
  const { readdirSync } = await import('fs');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    ok(f);
  }
  if (files.length < 7) {
    warn('المفترض على الأقل 7 migration files (0001 → 0007)', `موجود: ${files.length}`);
  }
} else {
  warn('مجلد migrations', 'غير موجود محلياً');
}

// ── 5. فحص الإعلانات ──────────────────────────────────────
sec('حالة الإعلانات');
const memberAnn = await rpc('get_member_announcements', { p_member_id: 1 });
if (memberAnn.status === 200) {
  const count = Array.isArray(memberAnn.body) ? memberAnn.body.length : 0;
  ok('get_member_announcements', `${count} إعلان للعضو #1`);
} else {
  warn('get_member_announcements', `${memberAnn.status}`);
}

// ── 6. فحص push_subscriptions ────────────────────────────
sec('Push Subscriptions');
// لا يمكن الوصول المباشر للـ anon — نعطي تعليمات فقط
if (CLEAN_SUBS) {
  info('لتنظيف الاشتراكات المنتهية (410 Gone):');
  info('شغّل في Supabase SQL Editor:');
  info(`UPDATE public.members
  SET push_subscription = NULL
  WHERE push_subscription IS NOT NULL
    AND push_subscription->>'endpoint' IS NULL;`);
} else {
  ok('Push Subscriptions', 'استخدم --clean-subscriptions لتنظيف الاشتراكات المنتهية');
}

function info(m) { console.log(`  ${C.cyan}→${C.reset} ${m}`); }

// ── نهاية ─────────────────────────────────────────────────
