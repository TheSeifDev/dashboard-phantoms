import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT_DIR = 'C:/Users/aboha/.gemini/antigravity/brain/21b96b18-c72a-4236-8f5e-2d308cc8b054/artifacts/screenshots';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440' },
  { width: 1024, height: 768, name: '1024' },
  { width: 768, height: 1024, name: '768' },
  { width: 390, height: 844, name: '390' },
];

const ADMIN_PAGES = [
  { path: '/admin/dashboard', name: 'dashboard' },
  { path: '/admin/members', name: 'members' },
  { path: '/admin/tasks', name: 'tasks' },
  { path: '/admin/ranking', name: 'ranking' },
  { path: '/admin/notes', name: 'notes' },
  { path: '/admin/announcements', name: 'announcements' },
  { path: '/admin/ai-assistant', name: 'ai-assistant' },
  { path: '/admin/whatsapp', name: 'whatsapp' },
];

const MEMBER_PAGES = [
  { path: '/portal', name: 'portal' },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`[${page.url()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    errors.push(`[${page.url()}] ${err.message}`);
  });

  // Admin login via Mock button
  console.log('Logging in via DEV mock...');
  await page.goto('http://localhost:5173/admin/login');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("دخول تجريبي للمعاينة")');
  await page.waitForURL('**/admin/dashboard');

  console.log('Taking admin screenshots...');
  for (const p of ADMIN_PAGES) {
    await page.goto(`http://localhost:5173${p.path}`);
    await page.waitForLoadState('networkidle');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500); // give it a moment to resize and render
      await page.screenshot({ path: path.join(OUT_DIR, `${p.name}-${vp.name}.png`) });
    }
  }

  // Member login injection
  console.log('Logging in as Member...');
  await page.evaluate(() => {
    localStorage.setItem('wasla_member_session', JSON.stringify({
      id: 'mock-member',
      full_name: 'عضو تجريبي',
      email: 'member@wasla.com',
      role: 'DEV',
      work_status: 'ACTIVE',
      device_status: 'LAPTOP'
    }));
  });

  console.log('Taking member portal screenshots...');
  for (const p of MEMBER_PAGES) {
    await page.goto(`http://localhost:5173${p.path}`);
    await page.waitForLoadState('networkidle');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT_DIR, `${p.name}-${vp.name}.png`) });
    }
  }

  await browser.close();

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:');
    errors.forEach(e => console.log(e));
  } else {
    console.log('NO CONSOLE ERRORS.');
  }
}

run().catch(console.error);
