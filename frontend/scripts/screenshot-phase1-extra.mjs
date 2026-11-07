import { chromium } from '@playwright/test';
import path from 'path';

const OUT_DIR = 'C:/Users/aboha/.gemini/antigravity/brain/21b96b18-c72a-4236-8f5e-2d308cc8b054/artifacts/screenshots-after-phase1';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Admin login via Mock button
  console.log('Logging in via DEV mock...');
  await page.goto('http://localhost:5173/admin/login');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("دخول تجريبي للمعاينة")');
  await page.waitForURL('**/admin/dashboard');

  console.log('Doing kebab menu...');
  await page.goto('http://localhost:5173/admin/members');
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 1440, height: 900 });
  
  // click kebab using evaluate for safety
  await page.evaluate(() => {
    const btn = document.querySelector('.member-kebab');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'Members-1440-kebab-open.png') });

  console.log('Doing mobile drawer...');
  await page.goto('http://localhost:5173/admin/dashboard');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="فتح القائمة الرئيسية"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'Home-390-drawer-open.png') });

  await browser.close();
}

run().catch(console.error);
