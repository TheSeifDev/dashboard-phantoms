import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, 'redesign', 'after-sidebar');
const BASE = process.env.WASLA_BASE ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch();
try {
  for (const vp of [{ name: '768', width: 768, height: 1024 }, { name: '390', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'دخول تجريبي للمعاينة' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `drawer-${vp.name}.png`) });
    // إغلاق الدرج والتأكد من عودة التركيز
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const drawerGone = await page.getByRole('dialog', { name: 'القائمة الرئيسية' }).count();
    console.log(JSON.stringify({ viewport: vp.name, drawerClosedAfterEsc: drawerGone === 0 }));
    await context.close();
  }
} finally { await browser.close(); }
console.log('DRAWER_DONE');
