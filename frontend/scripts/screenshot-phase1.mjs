import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT_DIR = 'C:/Users/aboha/.gemini/antigravity/brain/21b96b18-c72a-4236-8f5e-2d308cc8b054/artifacts/screenshots-after-phase1';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440' },
  { width: 1024, height: 768, name: '1024' },
  { width: 768, height: 1024, name: '768' },
  { width: 390, height: 844, name: '390' },
];

const TARGET_PAGES = [
  { path: '/admin/dashboard', name: 'Home' },
  { path: '/admin/tasks', name: 'Tasks' },
  { path: '/admin/members', name: 'Members' },
  { path: '/admin/ranking', name: 'Leaderboard' },
];

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

  console.log('Taking admin screenshots...');
  for (const p of TARGET_PAGES) {
    await page.goto(`http://localhost:5173${p.path}`);
    await page.waitForLoadState('networkidle');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500); 
      await page.screenshot({ path: path.join(OUT_DIR, `${p.name}-${vp.name}.png`) });
    }
    
    // extra finding for members row menu
    if (p.name === 'Members') {
      await page.setViewportSize({ width: 1440, height: 900 });
      // open kebab on the first row
      const firstKebab = await page.locator('.member-kebab').first();
      if (await firstKebab.count() > 0) {
        await firstKebab.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT_DIR, 'Members-1440-kebab-open.png') });
        // click again to close
        await firstKebab.click();
      }
    }
  }
  
  // mobile drawer open test on Home
  await page.goto('http://localhost:5173/admin/dashboard');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState('networkidle');
  await page.click('button[aria-label="فتح القائمة الرئيسية"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'Home-390-drawer-open.png') });

  await browser.close();
}

run().catch(console.error);
