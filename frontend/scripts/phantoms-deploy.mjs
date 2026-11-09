#!/usr/bin/env node
/**
 * phantoms-deploy.mjs — نظام نشر ذكي متكامل
 *
 * المراحل:
 *   1. فحص صحة (health check)
 *   2. فحص TypeScript
 *   3. بناء Vite + PWA
 *   4. نشر Vercel
 *   5. تقرير نهائي مع روابط
 *
 * الاستخدام:
 *   node scripts/phantoms-deploy.mjs
 *   node scripts/phantoms-deploy.mjs --dry-run    (بدون نشر فعلي)
 *   node scripts/phantoms-deploy.mjs --skip-check (تخطى فحص الصحة)
 *   node scripts/phantoms-deploy.mjs --prod       (نشر للإنتاج الحقيقي)
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DRY_RUN     = process.argv.includes('--dry-run');
const SKIP_CHECK  = process.argv.includes('--skip-check');
const PROD        = process.argv.includes('--prod');

// ── coloring ─────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};
const ok   = (m) => console.log(`${C.green}${C.bold}  ✓${C.reset}  ${m}`);
const err  = (m) => console.error(`${C.red}${C.bold}  ✗${C.reset}  ${m}`);
const info = (m) => console.log(`${C.cyan}  →${C.reset}  ${m}`);
const warn = (m) => console.warn(`${C.yellow}  ⚠${C.reset}  ${m}`);
const step = (n, m) => console.log(`\n${C.bold}${C.blue}[${n}]${C.reset} ${C.bold}${m}${C.reset}`);

function run(cmd, opts = {}) {
  if (DRY_RUN && !opts.alwaysRun) {
    info(`[dry-run] ${cmd}`);
    return '';
  }
  info(`$ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8' });
}

const startTime = Date.now();
let stepsPassed = 0;
let stepsFailed = 0;

// ── شعار البداية ─────────────────────────────────────────
console.log(`
${C.bold}╔══════════════════════════════════════════╗
║     PHANTOMS — نظام النشر الذكي          ║
║     PHANTOMS Smart Deploy v1.0           ║
╚══════════════════════════════════════════╝${C.reset}
`);

if (DRY_RUN) warn('وضع المعاينة (dry-run) — لن يُنشر شيء فعلياً');
if (PROD)    warn('وضع الإنتاج — سيُنشر للـ production domain');

// ── المرحلة 1: فحص الصحة ────────────────────────────────
step(1, 'فحص صحة النظام');
if (!SKIP_CHECK) {
  try {
    const healthScript = resolve(ROOT, 'scripts', 'phantoms-health-check.mjs');
    if (existsSync(healthScript)) {
      const result = execSync(`node "${healthScript}" --json`, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const report = JSON.parse(result);
      const { passed, warned, failed } = report.summary;
      ok(`فحص الصحة: نجح ${passed}, تحذير ${warned}, فشل ${failed}`);
      if (failed > 0) {
        err(`${failed} فحص فاشل — أصلح المشاكل قبل النشر`);
        const failedItems = report.results.filter(r => r.status === 'FAIL');
        for (const item of failedItems) {
          err(`  • ${item.label}: ${item.detail}`);
          if (item.hint) info(`    تلميح: ${item.hint}`);
        }
        process.exit(1);
      }
      stepsPassed++;
    } else {
      warn('سكريبت فحص الصحة غير موجود — تخطى');
      stepsPassed++;
    }
  } catch (e) {
    const parsed = (() => { try { return JSON.parse(e.stdout || '{}'); } catch { return null; } })();
    if (parsed?.summary?.failed > 0) {
      err('فحص الصحة كشف عن مشاكل حرجة');
      process.exit(1);
    }
    warn(`تحذير في فحص الصحة: ${e.message.slice(0, 100)}`);
    stepsPassed++;
  }
} else {
  warn('تخطى فحص الصحة (--skip-check)');
  stepsPassed++;
}

// ── المرحلة 2: TypeScript Check ──────────────────────────
step(2, 'فحص TypeScript');
try {
  run('npx tsc -b --noEmit', { silent: false });
  ok('TypeScript — لا أخطاء');
  stepsPassed++;
} catch {
  err('TypeScript — يوجد أخطاء في الأنواع');
  err('أصلح الأخطاء أعلاه قبل المتابعة');
  stepsFailed++;
  process.exit(1);
}

// ── المرحلة 3: UX Guard ──────────────────────────────────
step(3, 'فحص UX Guard (قواعد التصميم)');
try {
  run('node scripts/ux-guard.mjs', { silent: false });
  ok('UX Guard — النظام يلتزم بمعايير التصميم');
  stepsPassed++;
} catch {
  warn('UX Guard — يوجد انتهاكات تصميمية (غير موقف للنشر)');
  stepsPassed++;
}

// ── المرحلة 4: بناء Vite ─────────────────────────────────
step(4, 'بناء الإنتاج (Vite + PWA)');
const buildStart = Date.now();
try {
  run('npx vite build');
  const buildMs = Date.now() - buildStart;
  ok(`البناء اكتمل في ${(buildMs / 1000).toFixed(1)}s`);

  // التحقق من وجود الملفات الأساسية
  const critical = ['dist/index.html', 'dist/sw.js', 'dist/manifest.json'];
  for (const f of critical) {
    if (existsSync(resolve(ROOT, f))) {
      ok(`موجود: ${f}`);
    } else {
      err(`مفقود بعد البناء: ${f}`);
      process.exit(1);
    }
  }
  stepsPassed++;
} catch {
  err('فشل البناء');
  stepsFailed++;
  process.exit(1);
}

// ── المرحلة 5: النشر على Vercel ──────────────────────────
step(5, `النشر على Vercel ${PROD ? '(إنتاج)' : '(preview)'}`);
if (!DRY_RUN) {
  const vercelCmd = PROD ? 'npx vercel --prod --yes' : 'npx vercel --yes';
  try {
    const output = execSync(vercelCmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    const deployUrl = urlMatch ? urlMatch[0] : '(انظر Vercel Dashboard)';
    ok(`النشر اكتمل`);
    info(`الرابط: ${C.bold}${deployUrl}${C.reset}`);
    stepsPassed++;
  } catch (e) {
    const output = e.stdout || e.stderr || e.message;
    err(`فشل النشر: ${output.slice(0, 200)}`);
    stepsFailed++;
  }
} else {
  info('[dry-run] سيُنفَّذ: ' + (PROD ? 'npx vercel --prod --yes' : 'npx vercel --yes'));
  stepsPassed++;
}

// ── تقرير نهائي ──────────────────────────────────────────
const totalMs = Date.now() - startTime;
const totalSec = (totalMs / 1000).toFixed(1);

console.log(`
${C.bold}══════════════════════════════════════════${C.reset}
  نجح: ${C.green}${stepsPassed}${C.reset}  |  فشل: ${C.red}${stepsFailed}${C.reset}  |  وقت: ${totalSec}s
${C.bold}══════════════════════════════════════════${C.reset}
`);

if (stepsFailed > 0) {
  process.exit(1);
}
