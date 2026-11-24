import { chromium } from 'playwright';
const exe = '/home/ubuntu/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe });
for (const [name, width, height] of [['desk', 1440, 1000], ['tab', 1024, 900], ['mob', 390, 900]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8813/index.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  console.log(name, JSON.stringify(overflow));
  await page.close();
}
await browser.close();
