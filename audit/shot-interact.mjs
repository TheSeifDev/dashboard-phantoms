import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, 'redesign', 'after');
const BASE = process.env.WASLA_BASE ?? 'http://127.0.0.1:5173';
const EMAIL = process.env.WASLA_ADMIN_EMAIL;
const PASSWORD = process.env.WASLA_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('MISSING_CREDS'); process.exit(2); }

const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#admin-email').fill(EMAIL);
  await page.locator('#admin-password').fill(PASSWORD);
  await page.locator('button[type="submit"].auth-submit').click();
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/admin/members`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 1) فتح قائمة الكباب لأول صف
  const kebabs = page.getByRole('button', { name: /خيارات/ });
  await kebabs.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'members-kebab.png') });

  // 2) عرض التفاصيل = الدرج
  await page.getByRole('menuitem', { name: 'عرض التفاصيل' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'members-drawer.png') });
  const drawerVisible = await page.getByRole('dialog').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3) حذف = حوار التأكيد (بدون تأكيد فعلي — نلغي)
  await kebabs.first().click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'members-delete-dialog.png') });
  const dialogShowsName = await page.getByRole('dialog').getByText('آلاء فرج سالم الصاوي').count();
  // إلغاء بدل التأكيد — لا نغير بيانات حقيقية
  await page.getByRole('button', { name: 'إلغاء' }).click();
  await page.waitForTimeout(400);

  console.log(JSON.stringify({ drawerVisible, dialogShowsName, errors }));
  await context.close();
} finally { await browser.close(); }
console.log('INTERACT_DONE');
