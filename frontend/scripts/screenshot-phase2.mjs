import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT_DIR = 'C:/Users/aboha/.gemini/antigravity/brain/21b96b18-c72a-4236-8f5e-2d308cc8b054/artifacts/screenshots-after-phase2';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440' },
  { width: 1024, height: 768, name: '1024' },
  { width: 768, height: 1024, name: '768' },
  { width: 390, height: 844, name: '390' },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Logging in via DEV mock...');
  await page.goto('http://localhost:5173/admin/login');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("دخول تجريبي للمعاينة")');
  await page.waitForURL('**/admin/dashboard');

  console.log('Taking Members screenshots...');
  await page.goto('http://localhost:5173/admin/members');
  await page.waitForLoadState('networkidle');
  
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500); 
    await page.screenshot({ path: path.join(OUT_DIR, `Members-${vp.name}.png`) });
  }

  // Open drawer test
  console.log('Doing Members Drawer open...');
  await page.setViewportSize({ width: 1440, height: 900 });
  // Find first row and click
  await page.evaluate(() => {
    const row = document.querySelector('tbody tr');
    if (row) row.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'Members-1440-drawer.png') });

  // Close drawer
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="إغلاق"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  
  // Open kebab test
  console.log('Doing kebab menu...');
  await page.evaluate(() => {
    const btn = document.querySelector('.member-kebab');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'Members-1440-kebab.png') });

  await browser.close();
}

run().catch(console.error);
