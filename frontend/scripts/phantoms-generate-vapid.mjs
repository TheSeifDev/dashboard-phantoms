#!/usr/bin/env node
/**
 * wasla-generate-vapid.mjs — مولّد مفاتيح VAPID ذكي
 *
 * يولّد مفاتيح VAPID جديدة ويحدّث .env.local تلقائياً
 * ويطبع الأوامر اللازمة لتحديث Supabase secrets.
 *
 * الاستخدام:
 *   node scripts/wasla-generate-vapid.mjs
 *   node scripts/wasla-generate-vapid.mjs --print-only  (بدون كتابة)
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_FILE = resolve(ROOT, '.env.local');
const PRINT_ONLY = process.argv.includes('--print-only');

const C = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m', dim: '\x1b[2m',
};

console.log(`\n${C.bold}وصلة — مولّد مفاتيح VAPID${C.reset}\n`);

// ── توليد المفاتيح ──────────────────────────────────────
let publicKey, privateKey;

try {
  // تجربة web-push أولاً
  const output = execSync('npx web-push generate-vapid-keys --json 2>/dev/null', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output.trim());
  publicKey = parsed.publicKey;
  privateKey = parsed.privateKey;
  console.log(`  ${C.green}✓${C.reset}  تم توليد المفاتيح بنجاح (web-push)`);
} catch {
  // توليد يدوي بـ Web Crypto API
  console.log(`  ${C.yellow}⚠${C.reset}  web-push غير متاح — استخدام Web Crypto API`);
  try {
    const { webcrypto } = await import('crypto');
    const keyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const pubRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
    const privJwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);

    publicKey = Buffer.from(pubRaw).toString('base64url');
    privateKey = privJwk.d;
    console.log(`  ${C.green}✓${C.reset}  تم توليد المفاتيح بـ Web Crypto API`);
  } catch (e) {
    console.error(`  ${C.red}✗${C.reset}  فشل توليد المفاتيح: ${e.message}`);
    process.exit(1);
  }
}

// ── التحقق من صحة المفتاح العام ────────────────────────
const pubDecoded = Buffer.from(
  (publicKey + '='.repeat((4 - (publicKey.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/'),
  'base64'
);
if (pubDecoded.length !== 65) {
  console.error(`  ${C.red}✗${C.reset}  المفتاح العام غير صالح (${pubDecoded.length} bytes، يجب 65)`);
  process.exit(1);
}
console.log(`  ${C.green}✓${C.reset}  المفتاح العام: ${pubDecoded.length} bytes ✓`);

// ── عرض المفاتيح ────────────────────────────────────────
console.log(`
${C.bold}المفاتيح الجديدة:${C.reset}
  Public Key:  ${C.cyan}${publicKey}${C.reset}
  Private Key: ${C.dim}${privateKey.slice(0, 10)}…(مخفي)${C.reset}
`);

if (PRINT_ONLY) {
  console.log(`${C.yellow}وضع --print-only: لم يتم تحديث أي ملف.${C.reset}\n`);
  process.exit(0);
}

// ── تحديث .env.local ────────────────────────────────────
if (!existsSync(ENV_FILE)) {
  console.error(`  ${C.red}✗${C.reset}  ملف .env.local غير موجود`);
  process.exit(1);
}

let envContent = readFileSync(ENV_FILE, 'utf8');
const oldPublic = envContent.match(/VITE_VAPID_PUBLIC_KEY=(.+)/)?.[1];
const oldPrivate = envContent.match(/VITE_VAPID_PRIVATE_KEY=(.+)/)?.[1];

if (oldPublic) {
  envContent = envContent.replace(/VITE_VAPID_PUBLIC_KEY=.+/, `VITE_VAPID_PUBLIC_KEY=${publicKey}`);
} else {
  envContent += `\nVITE_VAPID_PUBLIC_KEY=${publicKey}`;
}

if (oldPrivate) {
  envContent = envContent.replace(/VITE_VAPID_PRIVATE_KEY=.+/, `VITE_VAPID_PRIVATE_KEY=${privateKey}`);
} else {
  envContent += `\nVITE_VAPID_PRIVATE_KEY=${privateKey}`;
}

writeFileSync(ENV_FILE, envContent, 'utf8');
console.log(`  ${C.green}✓${C.reset}  تم تحديث .env.local`);

// ── تعليمات Supabase ────────────────────────────────────
console.log(`
${C.bold}الخطوات التالية — حدّث Supabase Edge Function Secrets:${C.reset}

  ${C.cyan}الطريقة 1: Supabase CLI${C.reset}
  supabase secrets set VAPID_PUBLIC_KEY="${publicKey}"
  supabase secrets set VAPID_PRIVATE_KEY="${privateKey}"

  ${C.cyan}الطريقة 2: Supabase Dashboard${C.reset}
  Project Settings → Edge Functions → Secrets → أضف:
  VAPID_PUBLIC_KEY = ${publicKey}
  VAPID_PRIVATE_KEY = (قيمة كاملة — لا تعرضها)

  ${C.yellow}⚠ بعد تحديث المفاتيح:${C.reset}
  • أعد نشر edge function: supabase functions deploy push-notify
  • أعد بناء الـ frontend: npm run build
  • أعد تفعيل الإشعارات من بوابة الأعضاء (الاشتراك القديم لن يعمل)
`);
