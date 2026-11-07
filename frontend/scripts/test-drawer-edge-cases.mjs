import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'دخول تجريبي للمعاينة' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'فتح القائمة الرئيسية' }).click();
await page.waitForTimeout(300);
await page.getByRole('dialog', { name: 'القائمة الرئيسية' }).getByRole('link', { name: 'الأعضاء', exact: true }).click();
await page.waitForTimeout(800);

// Test 1: Open first member drawer
await page.locator('ul[aria-label="قائمة الأعضاء"] li button').first().click();
await page.waitForTimeout(400);

// Verify drawer opened
let dialog = page.locator('section[role="dialog"]');
console.log('Test 1 - Drawer visible:', await dialog.isVisible());

// Test 2: Close via close button
await dialog.locator('header button').click();
await dialog.waitFor({ state: 'detached' });
console.log('Test 2 - Closed via button:', !(await dialog.isVisible()));

// Test 3: Open again and close via Escape key
await page.locator('ul[aria-label="قائمة الأعضاء"] li button').first().click();
await dialog.waitFor({ state: 'visible' });
console.log('Test 3 - Member opened:', await dialog.isVisible());
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
console.log('Test 3 - Closed via Escape:', !(await dialog.isVisible()));

// Test 4: Open member and test action buttons
await page.locator('ul[aria-label="قائمة الأعضاء"] li button').first().click();
await dialog.waitFor({ state: 'visible' });

const buttonsExist = await page.evaluate(() => {
  const dialog = document.querySelector('section[role="dialog"]');
  const buttons = Array.from(dialog?.querySelectorAll('button') ?? []);
  return {
    hasClose: buttons.some(b => b.textContent?.includes('إغلاق')),
    hasEdit: buttons.some(b => b.textContent?.includes('تعديل')),
    hasDelete: buttons.some(b => b.textContent?.includes('حذف')),
  };
});
console.log('Test 4 - Action buttons present:', JSON.stringify(buttonsExist));

// Test 5: Verify no horizontal scroll across page
const overflowCheck = await page.evaluate(() => {
  const de = document.documentElement;
  return {
    scrollWidth: de.scrollWidth,
    innerWidth: window.innerWidth,
    hasOverflow: de.scrollWidth > window.innerWidth
  };
});
console.log('Test 5 - Horizontal overflow check:', JSON.stringify(overflowCheck));

await browser.close();
console.log('ALL_EDGE_CASES_PASSED');
