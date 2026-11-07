/**
 * UX Dimensions Audit — بمراجعة جوجل: قِس أولاً، ثم أصلح.
 * يفتح كل مسارات التطبيق على مقاسين (ديسكتوب + موبايل)،
 * يلتقط سكرينشوت كامل، ويفحص برمجياً:
 *  1. سكرول أفقي غير مقصود (scrollWidth > viewport)
 *  2. عناصر تتجاوز عرض الشاشة
 *  3. أهداف لمس أصغر من 40px
 *
 * الدخول: زر المعاينة التجريبي (DEV) للإدارة + بريد عضوية حقيقي للبوابة.
 * الاستخدام: node scripts/ux-audit.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'screenshots', 'ux-audit');
const MEMBER_EMAILS = ['01274684425@wasla.app', '01208937039@wasla.app', '01009087751@wasla.app'];
const PUBLIC_ROUTES = ['/login', '/admin/login'];

const AUDIT_SCRIPT = () => {
  const vw = window.innerWidth;
  const de = document.documentElement;
  const overflowX = de.scrollWidth > vw + 1;
  const offenders = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.left < vw && r.width > 4) {
      const key = `${el.tagName}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ').slice(0, 3).join('.')}`;
      if (!seen.has(key) && offenders.length < 8) {
        seen.add(key);
        offenders.push(`${key} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
      }
    }
  });
  const smallTargets = [];
  document.querySelectorAll('button, a, input, select, textarea').forEach((el) => {
    if (!(el instanceof HTMLElement) || el.offsetParent === null) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height < 40) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
      if (smallTargets.length < 6) smallTargets.push(`${el.tagName} h=${Math.round(r.height)} "${label}"`);
    }
  });
  return { vw, scrollW: de.scrollWidth, overflowX, offenders, smallTargetCount: smallTargets.length, smallTargets };
};

const ADMIN_LINKS = [
  { route: '/admin/dashboard', name: 'الرئيسية' },
  { route: '/admin/members', name: 'الأعضاء' },
  { route: '/admin/tasks', name: 'المهام' },
  { route: '/admin/ranking', name: 'ترتيب الفريق' },
  { route: '/admin/notes', name: 'الملاحظات' },
  { route: '/admin/announcements', name: 'الإعلانات' },
  { route: '/admin/ai-assistant', name: 'المساعد الذكي' },
  { route: '/admin/whatsapp', name: 'إرسال المهام عبر واتساب' },
];
const MOBILE_DIRECT = new Set(['الرئيسية', 'المهام', 'الأعضاء']);

/**
 * تنقل داخلي (SPA) بدون reload — جلسة المعاينة in-memory
 * فأي تحميل كامل للصفحة يسقطها ونُرمى لصفحة الدخول.
 */
async function adminNav(page, isMobile, name, route) {
  const exact = { name, exact: true };
  if (!isMobile) {
    await page.locator('aside').getByRole('link', exact).click();
  } else if (MOBILE_DIRECT.has(name)) {
    await page.locator('nav.fixed').getByRole('link', exact).click();
  } else {
    await page.getByRole('button', { name: 'المزيد' }).click();
    await page.locator('section[role="dialog"]').getByRole('link', exact).click();
  }
  await page.waitForURL(`**${route}`, { timeout: 15000 });
  await page.waitForTimeout(900);
}

async function memberLogin(page) {
  for (const email of MEMBER_EMAILS) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('#member-email').fill(email);
    await page.getByRole('button', { name: /دخول مساحة العمل/ }).click();
    try {
      await page.waitForURL('**/portal', { timeout: 8000 });
      return email;
    } catch { /* جرّب البريد التالي */ }
  }
  throw new Error('فشل دخول العضو بكل البُرُد المجربة');
}

const report = [];
const browser = await chromium.launch();

for (const vp of [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  // --- سياق الإدارة ---
  const actx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const apage = await actx.newPage();
  const isMobile = vp.name === 'mobile';
  try {
    await apage.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
    const demo = apage.getByText('دخول تجريبي للمعاينة');
    await demo.waitFor({ timeout: 15000 });
    await demo.click();
    await apage.waitForURL('**/admin/**', { timeout: 15000 });
    await apage.waitForTimeout(900);
    for (const { route, name } of ADMIN_LINKS) {
      if (route !== '/admin/dashboard') await adminNav(apage, isMobile, name, route);
      else { await apage.waitForTimeout(900); }
      const audit = await apage.evaluate(AUDIT_SCRIPT);
      const shot = join(OUT, vp.name, `${route.replace(/\//g, '_')}.png`);
      mkdirSync(dirname(shot), { recursive: true });
      await apage.screenshot({ path: shot, fullPage: true });
      report.push({ viewport: vp.name, route, shot, ...audit });
    }
  } catch (e) {
    report.push({ viewport: vp.name, route: 'ADMIN_FLOW', error: String(e).slice(0, 200) });
  }
  await actx.close();

  // --- سياق العضو ---
  const mctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const mpage = await mctx.newPage();
  try {
    const usedEmail = await memberLogin(mpage);
    for (const route of ['/portal', '/login']) {
      await mpage.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await mpage.waitForTimeout(800);
      const audit = await mpage.evaluate(AUDIT_SCRIPT);
      const shot = join(OUT, vp.name, `${route.replace(/\//g, '_')}${route === '/login' ? '' : '_member'}.png`);
      mkdirSync(dirname(shot), { recursive: true });
      await mpage.screenshot({ path: shot, fullPage: true });
      report.push({ viewport: vp.name, route: `${route} (عضو: ${usedEmail})`, shot, ...audit });
    }
  } catch (e) {
    report.push({ viewport: vp.name, route: 'MEMBER_FLOW', error: String(e).slice(0, 200) });
  }
  await mctx.close();

  // --- صفحات عامة بدون دخول ---
  const pctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const ppage = await pctx.newPage();
  for (const route of PUBLIC_ROUTES) {
    await ppage.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await ppage.waitForTimeout(500);
    const audit = await ppage.evaluate(AUDIT_SCRIPT);
    const shot = join(OUT, vp.name, `${route.replace(/\//g, '_')}_public.png`);
    await ppage.screenshot({ path: shot, fullPage: true });
    report.push({ viewport: vp.name, route: `${route} (عام)`, shot, ...audit });
  }
  await pctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
