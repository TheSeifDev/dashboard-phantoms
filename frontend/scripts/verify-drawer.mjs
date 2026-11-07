import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const OUT = './drawer-debug';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const results = [];

for (const vp of viewports) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'دخول تجريبي للمعاينة' }).click();
    await page.waitForTimeout(600);

    if (vp.name.startsWith('mobile')) {
      await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
      await page.waitForTimeout(400);
      await page.getByRole('dialog', { name: 'القائمة الرئيسية' }).getByRole('link', { name: 'الأعضاء', exact: true }).click();
    } else {
      await page.locator('aside').getByRole('link', { name: 'الأعضاء', exact: true }).click();
    }
    await page.waitForTimeout(800);

    if (theme === 'dark') {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(200);
    }

    // Open first member (which has long name >50 chars)
    if (vp.name.startsWith('mobile')) {
      await page.locator('ul[aria-label="قائمة الأعضاء"] li button').first().click();
    } else {
      await page.locator('tbody tr').first().click();
    }
    await page.waitForTimeout(500);

    // Capture screenshot
    const shotPath = `${OUT}/drawer-${vp.name}-${theme}.png`;
    await page.screenshot({ path: shotPath });

    // Inspect layout and overlap
    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const dialog = document.querySelector('section[role="dialog"]');
      if (!dialog) return { found: false };

      const h2 = dialog.querySelector('header h2');
      const closeBtn = dialog.querySelector('header button');
      const heroName = dialog.querySelector('h3');
      const dRect = dialog.getBoundingClientRect();
      const h2Rect = h2 ? h2.getBoundingClientRect() : null;
      const btnRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
      const heroRect = heroName ? heroName.getBoundingClientRect() : null;

      // Check header overlap: horizontal gap between btn and h2
      // In RTL: h2 is to the right of btn.
      // btn is on the left: btnRect.right <= h2Rect.left
      const headerOverlap = btnRect && h2Rect
        ? !(btnRect.right <= h2Rect.left || h2Rect.right <= btnRect.left)
        : false;

      // Check hero name overflow outside dialog
      const heroOverflow = heroRect
        ? heroRect.left < dRect.left - 1 || heroRect.right > dRect.right + 1
        : false;

      // Check all children inside dialog
      const allElements = Array.from(dialog.querySelectorAll('*'));
      let clippedChildren = 0;
      for (const el of allElements) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          if (r.left < dRect.left - 2 || r.right > dRect.right + 2) {
            clippedChildren++;
          }
        }
      }

      return {
        found: true,
        h2Text: h2?.textContent,
        h2TextLength: h2?.textContent?.length ?? 0,
        headerOverlap,
        heroOverflow,
        clippedChildren,
        scrollWidth: de.scrollWidth,
        innerWidth: window.innerWidth,
        hasHorizontalOverflow: de.scrollWidth > window.innerWidth,
        dialogWidth: dRect.width,
        btnRect,
        h2Rect,
      };
    });

    results.push({
      viewport: vp.name,
      theme,
      metrics,
    });

    await context.close();
  }
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
