import { expect, test, type Page, type Route } from '@playwright/test';

const apiPort = process.env.PHANTOMS_LOCAL_API_PORT ?? '54321';
const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (![apiPort, previewPort].every((port) => /^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535)) {
  throw new Error('Invalid disposable loopback ports.');
}

const API_ORIGIN = `http://127.0.0.1:${apiPort}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${previewPort}`;
const bridgeOrigin = process.env.PHANTOMS_LOCAL_FIXTURE_BRIDGE_URL ?? '';
const adminEmail = process.env.PHANTOMS_AUTH_ADMIN_EMAIL ?? '';
const adminPassword = process.env.PHANTOMS_AUTH_ADMIN_PASSWORD ?? '';
const existingMemberEmail = process.env.PHANTOMS_AUTH_EXISTING_MEMBER_EMAIL ?? '';
const firstTimeMemberEmail = process.env.PHANTOMS_AUTH_FIRST_TIME_MEMBER_EMAIL ?? '';
const outsiderEmail = process.env.PHANTOMS_AUTH_OUTSIDER_EMAIL ?? '';

type AuthSafetyMetadata = {
  noVerifyBeforeCode: boolean;
  noEmailRedirectTo: boolean;
  memberLogoutScoped: boolean;
  nonmemberLogoutScoped: boolean;
};

type RequestGate = {
  blocked: string[];
  markCodeEntered: () => void;
};

function requireFixtureEnv(): void {
  for (const [name, value] of Object.entries({ bridgeOrigin, adminEmail, adminPassword, existingMemberEmail, firstTimeMemberEmail, outsiderEmail })) {
    if (!value) throw new Error(`Missing disposable Auth fixture environment value: ${name}`);
  }
  const parsedBridge = new URL(bridgeOrigin);
  if (parsedBridge.protocol !== 'http:' || parsedBridge.hostname !== '127.0.0.1') {
    throw new Error('Auth E2E requires an exact loopback fixture bridge.');
  }
  if (process.env.VITE_SUPABASE_URL !== API_ORIGIN) throw new Error('Auth E2E requires the exact local Supabase API origin.');
}

function memberEmailInput(page: Page) {
  return page.locator('#member-email, input[type="email"]').first();
}

function memberOtpInput(page: Page) {
  return page.locator('#member-otp, input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
}

function memberSubmit(page: Page) {
  return page.getByRole('button', { name: /ادخل مساحة العمل|دخول|continue|sign in/i }).first();
}

function verifySubmit(page: Page) {
  return page.getByRole('button', { name: /تأكيد|تحقق|ربط الجهاز|verify|confirm/i }).first();
}

function alert(page: Page) {
  return page.getByRole('alert').first();
}

function differentEightDigitOtp(code: string): string {
  const next = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
  return next === code ? '00000000' : next;
}

async function installRequestGate(page: Page, metadata: AuthSafetyMetadata): Promise<RequestGate> {
  const blocked: string[] = [];
  const bridge = new URL(bridgeOrigin);
  let codeEntered = false;
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === API_ORIGIN && url.pathname.endsWith('/auth/v1/verify') && !codeEntered) {
      metadata.noVerifyBeforeCode = false;
    }
    if (url.origin === API_ORIGIN && url.pathname.endsWith('/auth/v1/otp')) {
      let hasRedirect = url.searchParams.has('redirect_to');
      const body = request.postData();
      if (!hasRedirect && body) {
        try {
          const payload = JSON.parse(body) as { redirect_to?: unknown };
          hasRedirect = typeof payload.redirect_to === 'string' && payload.redirect_to.length > 0;
        } catch {
          // The request body is not retained or reported.
        }
      }
      if (hasRedirect) metadata.noEmailRedirectTo = false;
    }
    const allowed = url.protocol === 'data:'
      || url.protocol === 'blob:'
      || url.origin === PREVIEW_ORIGIN
      || url.origin === API_ORIGIN
      || url.origin === bridge.origin
      || url.origin === 'https://fonts.googleapis.com'
      || url.origin === 'https://fonts.gstatic.com';
    if (!allowed) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return { blocked, markCodeEntered: () => { codeEntered = true; } };
}

async function bridgeOtp(email: string): Promise<string> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${bridgeOrigin}/otp?email=${encodeURIComponent(email)}`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const payload = await response.json() as { code?: unknown };
        const code = typeof payload.code === 'string' ? payload.code : '';
        expect(/^\d{8}$/.test(code)).toBe(true);
        return code;
      }
    } catch {
      // A bounded bridge request can abort while Mailpit is still delivering; retry until the overall deadline.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  throw new Error('Disposable OTP email was not delivered by the local mail service.');
}

async function requestOtp(page: Page, email: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_100);
  await memberEmailInput(page).fill(email);
  await memberSubmit(page).click();
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
  await expect(memberOtpInput(page)).toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
}

async function verifyOtp(page: Page, email: string, gate: RequestGate): Promise<void> {
  const code = await bridgeOtp(email);
  gate.markCodeEntered();
  await memberOtpInput(page).fill(code);
  await verifySubmit(page).click();
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#admin-email').fill(adminEmail);
  await page.locator('#admin-password').fill(adminPassword);
  await page.getByRole('button', { name: /ادخل مركز الإدارة|دخول الإدارة|sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

async function logoutMember(page: Page): Promise<void> {
  await page.getByRole('button', { name: /خروج|تسجيل الخروج|logout/i }).click();
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
}

async function memberStorageMetadata(page: Page): Promise<{ adminSessionPresent: boolean; memberSessionPresent: boolean; memberStatePresent: boolean }> {
  return page.evaluate(() => {
    const keys = [...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)), ...Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))].filter((key): key is string => Boolean(key));
    return {
      adminSessionPresent: keys.some((key) => key.startsWith('sb-')),
      memberSessionPresent: keys.includes('phantoms-member-auth'),
      memberStatePresent: keys.includes('phantoms_member_session') || keys.includes('phantoms_device_token'),
    };
  });
}

async function setPasswordFromActionLink(page: Page, action: 'invite' | 'recovery'): Promise<void> {
  const initialPath = action === 'invite' ? '/admin/invite' : '/admin/recovery';
  await page.goto(`${bridgeOrigin}${initialPath}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/admin\/(?:recovery\/callback|set-password)$/);
  await expect(page.locator('#invite-password')).toBeVisible({ timeout: 30_000 });
  await page.locator('#invite-password').fill('Disposable-Set-Password-2026!');
  await page.locator('#invite-password-confirm').fill('Disposable-Set-Password-2026!');
  await page.getByRole('button', { name: /حفظ وفتح لوحة الإدارة|حفظ|save/i }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/admin\/dashboard$/);
}

test.describe('disposable local Auth', () => {
  test('real numeric OTP, isolated member/admin sessions, rejection, retry, invite, and recovery', async ({ page, browser }) => {
    requireFixtureEnv();
    const metadata: AuthSafetyMetadata = {
      noVerifyBeforeCode: true,
      noEmailRedirectTo: true,
      memberLogoutScoped: false,
      nonmemberLogoutScoped: false,
    };
    const gates: RequestGate[] = [];
    try {
      const primaryGate = await installRequestGate(page, metadata);
      gates.push(primaryGate);
      await test.step('admin login', async () => {
        await loginAdmin(page);
        await expect(page.getByRole('heading', { name: /مركز عمليات PHANTOMS|dashboard/i }).first()).toBeVisible();
      });

      await test.step('same-account member OTP and scoped member logout', async () => {
        await requestOtp(page, existingMemberEmail);
        await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
        await expect(memberOtpInput(page)).toHaveCount(1);
        await verifyOtp(page, existingMemberEmail, primaryGate);
        await expect(page).toHaveURL(/\/portal$/);
        await expect(page.getByText(/Disposable existing OTP member/)).toBeVisible();
        const beforeLogout = await memberStorageMetadata(page);
        await logoutMember(page);
        const afterLogout = await memberStorageMetadata(page);
        metadata.memberLogoutScoped = beforeLogout.adminSessionPresent
          && !afterLogout.memberSessionPresent
          && !afterLogout.memberStatePresent
          && afterLogout.adminSessionPresent;
        expect(metadata.memberLogoutScoped).toBe(true);
        await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/admin\/dashboard$/);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/admin\/dashboard$/);
      });

      await test.step('real invalid eight-digit OTP and retry', async () => {
        const invalidContext = await browser.newContext();
        const invalidPage = await invalidContext.newPage();
        try {
          const gate = await installRequestGate(invalidPage, metadata);
          gates.push(gate);
          await requestOtp(invalidPage, existingMemberEmail);
          const actualCode = await bridgeOtp(existingMemberEmail);
          const invalidCode = differentEightDigitOtp(actualCode);
          const verifyFailure = invalidPage.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.origin === API_ORIGIN && url.pathname.endsWith('/auth/v1/verify');
          }).then((response) => response.status() >= 400);
          gate.markCodeEntered();
          await memberOtpInput(invalidPage).fill(invalidCode);
          await verifySubmit(invalidPage).click();
          expect(await verifyFailure).toBe(true);
          await expect(invalidPage).toHaveURL(/\/login(?:[?#].*)?$/);
          await expect(memberOtpInput(invalidPage)).toBeVisible();
          await expect(alert(invalidPage)).toBeVisible();
          gate.markCodeEntered();
          await memberOtpInput(invalidPage).fill(actualCode);
          await verifySubmit(invalidPage).click();
          await expect(invalidPage).toHaveURL(/\/portal$/);
        } finally {
          await invalidContext.close();
        }
      });

      await test.step('expired OTP and resend retry', async () => {
        const expiredContext = await browser.newContext();
        const expiredPage = await expiredContext.newPage();
        try {
          const gate = await installRequestGate(expiredPage, metadata);
          gates.push(gate);
          await requestOtp(expiredPage, existingMemberEmail);
          const expiredCode = await bridgeOtp(existingMemberEmail);
          await expiredPage.waitForTimeout(16_000);
          gate.markCodeEntered();
          await memberOtpInput(expiredPage).fill(expiredCode);
          await verifySubmit(expiredPage).click();
          await expect(expiredPage).toHaveURL(/\/login(?:[?#].*)?$/);
          await expect(memberOtpInput(expiredPage)).toBeVisible();
          await expect(alert(expiredPage)).toBeVisible();
          const resend = expiredPage.getByRole('button', { name: 'إرسال رمز جديد', exact: true });
          await expect(resend).toBeVisible();
          await resend.click();
          await expect(memberOtpInput(expiredPage)).toBeVisible();
          await verifyOtp(expiredPage, existingMemberEmail, gate);
          await expect(expiredPage).toHaveURL(/\/portal$/);
        } finally {
          await expiredContext.close();
        }
      });

      await test.step('first-time member OTP', async () => {
        const firstTimeContext = await browser.newContext();
        const firstTimePage = await firstTimeContext.newPage();
        try {
          const gate = await installRequestGate(firstTimePage, metadata);
          gates.push(gate);
          await requestOtp(firstTimePage, firstTimeMemberEmail);
          await verifyOtp(firstTimePage, firstTimeMemberEmail, gate);
          await expect(firstTimePage).toHaveURL(/\/portal$/);
          await expect(firstTimePage.getByText(/Disposable first-time OTP member/)).toBeVisible();
        } finally {
          await firstTimeContext.close();
        }
      });

      await test.step('non-member rejection and local cleanup', async () => {
        const outsiderContext = await browser.newContext();
        const outsiderPage = await outsiderContext.newPage();
        try {
          const gate = await installRequestGate(outsiderPage, metadata);
          gates.push(gate);
          await requestOtp(outsiderPage, outsiderEmail);
          await verifyOtp(outsiderPage, outsiderEmail, gate);
          await expect(outsiderPage).toHaveURL(/\/login(?:[?#].*)?$/);
          await expect(alert(outsiderPage)).toBeVisible();
          const storage = await memberStorageMetadata(outsiderPage);
          metadata.nonmemberLogoutScoped = !storage.memberSessionPresent && !storage.memberStatePresent;
          expect(metadata.nonmemberLogoutScoped).toBe(true);
        } finally {
          await outsiderContext.close();
        }
      });

      await test.step('delivered invite action link and local admin session', async () => {
        const inviteContext = await browser.newContext();
        const invitePage = await inviteContext.newPage();
        try {
          const gate = await installRequestGate(invitePage, metadata);
          gates.push(gate);
          await setPasswordFromActionLink(invitePage, 'invite');
        } finally {
          await inviteContext.close();
        }
      });

      await test.step('delivered recovery action link and local admin session', async () => {
        const recoveryContext = await browser.newContext();
        const recoveryPage = await recoveryContext.newPage();
        try {
          const gate = await installRequestGate(recoveryPage, metadata);
          gates.push(gate);
          await setPasswordFromActionLink(recoveryPage, 'recovery');
        } finally {
          await recoveryContext.close();
        }
      });

      expect(gates.flatMap((gate) => gate.blocked)).toEqual([]);
      expect(metadata.noVerifyBeforeCode).toBe(true);
      expect(metadata.noEmailRedirectTo).toBe(true);
    } finally {
      test.info().annotations.push({ type: 'auth-safety', description: JSON.stringify(metadata) });
    }
  });
});
