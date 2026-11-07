import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.WASLA_URL ?? 'http://127.0.0.1:4173';
const output = path.resolve('../screenshots/mobile-first-after');
const widths = [360, 390, 412, 768, 1024, 1366, 1440];
const pages = [
  ['/admin/login', 'admin-login'], ['/login', 'member-login'], ['/portal', 'member-portal'],
  ['/admin', 'dashboard'], ['/admin/tasks', 'tasks'], ['/admin/members', 'members'],
  ['/admin/ranking', 'ranking'], ['/admin/notes', 'notes'], ['/admin/ai-assistant', 'ai-assistant'],
  ['/admin/whatsapp', 'whatsapp'],
];
const onlyPage = process.env.WASLA_ONLY_PAGE ?? (process.env.WASLA_ONLY_WHATSAPP === 'true' ? 'whatsapp' : '');
const adminPages = onlyPage ? pages.filter(([, name]) => name === onlyPage) : pages.slice(3, 10);
const members = [{ id: 701, created_at: '2026-09-01T12:00:00Z', email: 'demo.member@example.test', full_name: 'سلمى محمود', team: 'التصميم', completion_rank: 86, bio: 'مصممة واجهات', device: 'لابتوب', meeting_attendance: 'منتظم', work_status: 'active', phone: '+201001234567', can_go_alexandria: true }];
const tasks = [{ id: 801, created_at: '2026-09-10T12:00:00Z', title: 'إعداد واجهة لوحة التحكم', description: 'مراجعة تجربة الاستخدام ودعم الشاشات الصغيرة.', has_deadline: true, deadline_date: '2026-10-12', assigned_to: 'ALL', tracking: { '701': { status: 'under_review', note: 'جاهز للمراجعة', submission_url: 'https://example.test/demo', updated_at: '2026-09-11T12:00:00Z' } } }];
const notes = [{ id: 901, created_at: '2026-09-12T12:00:00Z', text: 'تذكير بمراجعة التصميم قبل الاجتماع الأسبوعي.', author: 'إدارة وصلة', author_role: 'Admin', date: '2026-09-12', team: null, target_team: 'التصميم', target_member_id: null, target_name: null }];
const memberSession = JSON.stringify(members[0]);
let whatsappEnabled = false;

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript((member) => localStorage.setItem('wasla_member_session', member), memberSession);
await page.route('**/rest/v1/**', async (route) => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').at(-1);
  const body = table === 'members' ? members : table === 'tasks' ? tasks : table === 'notes' ? notes : [];
  const filtered = url.searchParams.has('email') ? body.filter((row) => row.email === 'demo.member@example.test') : body;
  const result = route.request().headers().accept?.includes('application/vnd.pgrst.object') ? filtered[0] ?? null : filtered;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
});
await page.route('**/functions/v1/whatsapp-tasks', async (route) => {
  const payload = route.request().postDataJSON();
  if (payload.action === 'set-enabled') whatsappEnabled = payload.enabled;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, enabled: whatsappEnabled, templateName: 'wasla_task_assignment' }) });
});

for (const width of widths) {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : width < 1100 ? 1024 : 900 });
    await page.goto(`${origin}/admin/login`);
    await page.evaluate((value) => { localStorage.setItem('tms_theme', value); document.documentElement.dataset.theme = value; }, theme);
    const changeRoute = async (route) => page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    for (const [, name] of pages.slice(0, 1)) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(output, `${name}-${width}-${theme}.png`), fullPage: true });
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (metrics.document > metrics.viewport) console.warn(`Horizontal overflow ${name} ${width}px ${theme}: ${metrics.document}px`);
    }
    await page.getByRole('button', { name: 'دخول تجريبي للمعاينة' }).click();
    for (const [route, name] of adminPages) {
      await changeRoute(route);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(output, `${name}-${width}-${theme}.png`), fullPage: true });
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (metrics.document > metrics.viewport) console.warn(`Horizontal overflow ${name} ${width}px ${theme}: ${metrics.document}px`);
      if (name === 'whatsapp') {
        const activateButton = page.getByRole('button', { name: 'تفعيل البوت' });
        if (await activateButton.count()) await activateButton.click();
        await page.getByRole('button', { name: 'إيقاف البوت' }).waitFor();
        await page.getByLabel('اختر المهمة').selectOption('801');
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'معاينة وإرسال للمحدد' }).click();
        await page.getByLabel(/أؤكد أن كل شخص محدد/).check();
        await page.screenshot({ path: path.join(output, `whatsapp-review-${width}-${theme}.png`), fullPage: true });
        const reviewMetrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        if (reviewMetrics.document > reviewMetrics.viewport) console.warn(`Horizontal overflow whatsapp review ${width}px ${theme}: ${reviewMetrics.document}px`);
      }
    }
    for (const [route, name] of onlyPage ? [] : pages.slice(1, 3)) {
      await changeRoute(route);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(output, `${name}-${width}-${theme}.png`), fullPage: true });
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (metrics.document > metrics.viewport) console.warn(`Horizontal overflow ${name} ${width}px ${theme}: ${metrics.document}px`);
    }
  }
}
await browser.close();
const captureCount = widths.length * 2 * (1 + adminPages.length + (onlyPage ? 0 : 2));
console.log(`Captured ${captureCount} screens in ${output}`);
