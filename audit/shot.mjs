import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const stage = process.env.WASLA_STAGE ?? 'before';
const outDir = path.join(repoRoot, 'audit', 'members', stage);

const BASE = process.env.WASLA_BASE ?? 'http://127.0.0.1:5173';
const EMAIL = process.env.WASLA_ADMIN_EMAIL;
const PASSWORD = process.env.WASLA_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('MISSING_CREDS: set WASLA_ADMIN_EMAIL and WASLA_ADMIN_PASSWORD');
  process.exit(2);
}

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
];

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const summary = [];
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 500)));

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('#admin-email').fill(EMAIL);
    await page.locator('#admin-password').fill(PASSWORD);
    await page.locator('button[type="submit"].auth-submit').click();
    await page.waitForTimeout(2000);
    const afterLoginUrl = page.url();

    await page.goto(`${BASE}/admin/members`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        scrollWidth: de.scrollWidth,
        innerWidth: window.innerWidth,
        ok: de.scrollWidth <= window.innerWidth + 1,
        url: location.pathname,
        title: document.title.slice(0, 120),
      };
    });
    const shotPath = path.join(outDir, `${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    summary.push({
      viewport: `${vp.width}x${vp.height}`,
      file: `audit/members/before/${vp.name}.png`,
      afterLoginUrl,
      membersUrl: page.url(),
      overflow,
      consoleErrors,
      pageErrors,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));
