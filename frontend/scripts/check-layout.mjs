import { chromium } from '@playwright/test';

const VIEWPORTS = [
  { width: 1440, height: 900, name: '1440' },
  { width: 1024, height: 768, name: '1024' },
  { width: 768, height: 1024, name: '768' },
  { width: 390, height: 844, name: '390' },
];

const PAGES = [
  { path: '/admin/dashboard', name: 'Home' },
  { path: '/admin/ranking', name: 'Leaderboard' },
  { path: '/admin/notes', name: 'Notes' },
  { path: '/admin/announcements', name: 'Announcements' },
  { path: '/admin/tasks', name: 'Tasks' },
  { path: '/portal', name: 'Members Portal' },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/admin/login');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("دخول تجريبي للمعاينة")');
  await page.waitForURL('**/admin/dashboard');

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

  const report = {};

  for (const p of PAGES) {
    report[p.name] = { overflow: {} };
    await page.goto(`http://localhost:5173${p.path}`);
    await page.waitForLoadState('networkidle');
    
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);
      const isOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      report[p.name].overflow[vp.name] = isOverflow;
    }
    
    // gather some element sizes or generic layout issues to report
    const layoutDetails = await page.evaluate(() => {
        const issues = [];
        const bodyH = document.body.scrollHeight;
        const winH = window.innerHeight;
        if (bodyH < winH) {
            issues.push(`Page background doesn't cover full height (${bodyH}px vs ${winH}px)`);
        }
        
        // Check tables if any
        const tables = document.querySelectorAll('table');
        if (tables.length > 0) {
            tables.forEach(t => {
                if (t.scrollWidth > t.clientWidth) issues.push('Table overflows horizontally');
            });
        }
        
        // Find empty/white strips
        const shell = document.querySelector('.main-content, main, .page-shell');
        if (shell && getComputedStyle(shell).padding) {
            issues.push(`Container padding is ${getComputedStyle(shell).padding}`);
        }
        
        return issues;
    });
    report[p.name].issues = layoutDetails;
  }

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

run().catch(console.error);
