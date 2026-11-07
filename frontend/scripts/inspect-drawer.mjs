import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const OUT = './drawer-debug';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'دخول تجريبي للمعاينة' }).click();
  await page.waitForTimeout(1000);
  
  if (vp.name === 'mobile') {
    await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('dialog', { name: 'القائمة الرئيسية' }).getByRole('link', { name: 'الأعضاء', exact: true }).click();
  } else {
    await page.locator('aside').getByRole('link', { name: 'الأعضاء', exact: true }).click();
  }
  await page.waitForTimeout(1000);
  
  // Click first member
  if (vp.name === 'mobile') {
    await page.locator('ul[aria-label="قائمة الأعضاء"] li button').first().click();
  } else {
    await page.locator('tbody tr').first().click();
  }
  await page.waitForTimeout(600);
  
  // Screenshot
  await page.screenshot({ path: `${OUT}/drawer-${vp.name}.png` });
  
  // Check metrics
  const info = await page.evaluate(() => {
    const dialog = document.querySelector('section[role="dialog"]');
    if (!dialog) return { found: false };
    const h2 = dialog.querySelector('header h2');
    const closeBtn = dialog.querySelector('header button');
    const h2Rect = h2 ? h2.getBoundingClientRect() : null;
    const btnRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
    const de = document.documentElement;
    return {
      found: true,
      h2Text: h2?.textContent,
      h2Rect,
      btnRect,
      dialogRect: dialog.getBoundingClientRect(),
      scrollWidth: de.scrollWidth,
      innerWidth: window.innerWidth,
      overflowX: de.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log(`[${vp.name}]`, JSON.stringify(info, null, 2));
  
  await context.close();
}

await browser.close();
