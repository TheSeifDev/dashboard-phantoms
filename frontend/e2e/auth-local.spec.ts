import { expect, test, type Page, type Route } from '@playwright/test';

const apiPort = process.env.PHANTOMS_LOCAL_API_PORT ?? '54321';
const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (![apiPort, previewPort].every((port) => /^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535)) {
  throw new Error('Invalid disposable loopback ports.');
}

const API_ORIGIN = `http://127.0.0.1:${apiPort}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${previewPort}`;
const bridgeOrigin = process.env.PHANTOMS_LOCAL_FIXTURE_BRIDGE_URL ?? '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const adminEmail = process.env.PHANTOMS_AUTH_ADMIN_EMAIL ?? '';
const adminPassword = process.env.PHANTOMS_AUTH_ADMIN_PASSWORD ?? '';
const existingMemberEmail = process.env.PHANTOMS_AUTH_EXISTING_MEMBER_EMAIL ?? '';
const firstTimeMemberEmail = process.env.PHANTOMS_AUTH_FIRST_TIME_MEMBER_EMAIL ?? '';
const joinMemberEmail = process.env.PHANTOMS_AUTH_JOIN_MEMBER_EMAIL ?? '';
const joinInvitationNote = process.env.PHANTOMS_AUTH_JOIN_INVITE_NOTE ?? '';
const outsiderEmail = process.env.PHANTOMS_AUTH_OUTSIDER_EMAIL ?? '';
const existingMemberId = Number(process.env.PHANTOMS_AUTH_EXISTING_MEMBER_ID ?? '0');
const firstTimeMemberId = Number(process.env.PHANTOMS_AUTH_FIRST_TIME_MEMBER_ID ?? '0');
const existingMemberAuthUserId = process.env.PHANTOMS_AUTH_EXISTING_MEMBER_AUTH_USER_ID ?? '';

// Disposable fixture values only. They are never written to evidence or emitted by the reporter.
const EXISTING_MEMBER_PASSWORD = 'Disposable-Existing-Member-2026!';
const FIRST_TIME_MEMBER_PASSWORD = 'Disposable-First-Time-Member-2026!';
const RESET_MEMBER_PASSWORD = 'Disposable-Reset-Member-2026!';

if (anonKey && /secret|service|sbp_/i.test(anonKey)) throw new Error('Disposable browser key must not be a service credential.');

type AuthSafetyMetadata = {
  noMemberOtpCalls: boolean;
  noBrowserSignup: boolean;
  memberLogoutScoped: boolean;
  nonmemberLogoutScoped: boolean;
};

type RequestGate = {
  blocked: string[];
};

type EnrollmentResponse = {
  status: number;
  ok: boolean;
  code?: string;
  invite?: { id: string; token: string };
};

function requireFixtureEnv(): void {
  for (const [name, value] of Object.entries({
    bridgeOrigin,
    anonKey,
    adminEmail,
    adminPassword,
    existingMemberEmail,
    firstTimeMemberEmail,
    joinMemberEmail,
    joinInvitationNote,
    outsiderEmail,
    existingMemberAuthUserId,
  })) {
    if (!value) throw new Error(`Missing disposable Auth fixture environment value: ${name}`);
  }
  if (![existingMemberId, firstTimeMemberId].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Missing disposable member fixture IDs.');
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

function memberPasswordInput(page: Page) {
  return page.locator('#member-password, input[autocomplete="current-password"], input[type="password"]').first();
}

function memberJoinPasswordInputs(page: Page) {
  return page.locator('#member-join-password, #join-password, input[autocomplete="new-password"], input[type="password"]');
}

function memberSubmit(page: Page) {
  return page.getByRole('button', { name: /ادخل مساحة العمل|دخول|sign in|log in/i }).first();
}

function joinSubmit(page: Page) {
  return page.getByRole('button', { name: /حفظ البيانات وكلمة المرور|تحديث كلمة المرور|إنشاء|تسجيل|تأكيد|انضمام|enroll|join|create password/i }).last();
}

function alert(page: Page) {
  return page.getByRole('alert').first();
}

async function installRequestGate(page: Page, metadata: AuthSafetyMetadata): Promise<RequestGate> {
  const blocked: string[] = [];
  const bridge = new URL(bridgeOrigin);
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === API_ORIGIN && url.pathname.endsWith('/auth/v1/otp')) metadata.noMemberOtpCalls = false;
    if (url.origin === API_ORIGIN && url.pathname.endsWith('/auth/v1/signup')) metadata.noBrowserSignup = false;
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
  return { blocked };
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#admin-email').fill(adminEmail);
  await page.locator('#admin-password').fill(adminPassword);
  await page.getByRole('button', { name: /ادخل مركز الإدارة|دخول الإدارة|sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

async function loginMember(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await memberEmailInput(page).fill(email);
  await memberPasswordInput(page).fill(password);
  await memberSubmit(page).click();
}

async function logoutMember(page: Page): Promise<void> {
  await page.getByRole('button', { name: /خروج|تسجيل الخروج|logout/i }).click();
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
}

async function memberStorageMetadata(page: Page): Promise<{ adminSessionPresent: boolean; memberSessionPresent: boolean; memberStatePresent: boolean }> {
  return page.evaluate(() => {
    const keys = [...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)), ...Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))]
      .filter((key): key is string => Boolean(key));
    return {
      adminSessionPresent: keys.some((key) => key.startsWith('sb-')),
      memberSessionPresent: keys.includes('phantoms-member-auth'),
      memberStatePresent: keys.includes('phantoms_member_session') || keys.includes('phantoms_device_token'),
    };
  });
}

async function browserFunctionRequest(page: Page, body: Record<string, unknown>, useAdminSession = true): Promise<EnrollmentResponse> {
  return page.evaluate(async ({ origin, key, requestBody, includeAdmin }) => {
    const tokenKeys = [...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)), ...Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))]
      .filter((value): value is string => typeof value === 'string' && value.startsWith('sb-'));
    let accessToken = '';
    for (const storageKey of tokenKeys) {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey) ?? '{}') as { access_token?: unknown };
        if (typeof parsed.access_token === 'string' && parsed.access_token) accessToken = parsed.access_token;
      } catch {
        // Ignore non-session storage values without retaining them.
      }
    }
    const response = await fetch(`${origin}/functions/v1/member-password-enrollment`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: includeAdmin && accessToken ? `Bearer ${accessToken}` : `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    let payload: Record<string, unknown> = {};
    try {
      const parsed = await response.json() as unknown;
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
    } catch {
      // Keep only the status when the local function has no JSON response.
    }
    const invite = payload.invite;
    const safeInvite = invite && typeof invite === 'object'
      ? {
        id: typeof (invite as { id?: unknown }).id === 'string' ? (invite as { id: string }).id : '',
        token: typeof (invite as { token?: unknown }).token === 'string' ? (invite as { token: string }).token : '',
      }
      : undefined;
    return {
      status: response.status,
      ok: payload.ok === true,
      code: typeof payload.code === 'string' ? payload.code : undefined,
      invite: safeInvite && safeInvite.id && safeInvite.token ? safeInvite : undefined,
    };
  }, { origin: API_ORIGIN, key: anonKey, requestBody: body, includeAdmin: useAdminSession });
}

async function issueInvite(page: Page, input: { memberId: number | null; email: string | null; purpose: 'enroll' | 'reset' | 'join'; note?: string }): Promise<{ id: string; token: string }> {
  const response = await browserFunctionRequest(page, {
    action: 'issue',
    memberId: input.memberId,
    email: input.email,
    purpose: input.purpose,
    expiresInHours: 24,
    note: input.note ?? 'local disposable password migration fixture',
  });
  expect(response.status).toBe(200);
  expect(response.ok).toBe(false);
  expect(response.invite?.token ?? '').toMatch(/^phpw_[0-9a-f]{64}$/);
  return response.invite as { id: string; token: string };
}

async function publicEnrollmentRequest(page: Page, input: { email: string; token: string; password: string; confirmPassword: string }): Promise<EnrollmentResponse> {
  return browserFunctionRequest(page, { action: 'enroll', ...input }, false);
}

async function enrollFromJoin(
  page: Page,
  email: string,
  token: string,
  password: string,
  options: { mode?: 'join' | 'reset'; fullName?: string } = {},
): Promise<void> {
  const mode = options.mode ?? 'join';
  const route = mode === 'reset' ? '/reset' : '/join';
  await page.goto(`${route}#invite=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('#join-email, #member-join-email, input[type="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 30_000 });
  await emailInput.fill(email);
  if (mode === 'join') {
    await page.locator('#join-full-name').fill(options.fullName ?? 'Disposable self-entered member');
  }
  const passwords = memberJoinPasswordInputs(page);
  await expect(passwords).toHaveCount(2, { timeout: 10_000 });
  await passwords.nth(0).fill(password);
  await passwords.nth(1).fill(password);
  await joinSubmit(page).click();
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
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

async function fixtureIdentity(email: string, expectedUserId?: string): Promise<{ count: number; idMatches: boolean }> {
  const params = new URLSearchParams({ email });
  if (expectedUserId) params.set('expectedAuthUserId', expectedUserId);
  const response = await fetch(`${bridgeOrigin}/identity-check?${params}`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error('Disposable fixture identity check failed.');
  const payload = await response.json() as { count?: unknown; idMatches?: unknown };
  return {
    count: typeof payload.count === 'number' ? payload.count : -1,
    idMatches: payload.idMatches === true,
  };
}

async function assertPublicSignupRejected(): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `public-signup-${Date.now()}@phantoms-test.example`, password: 'Disposable-Public-Signup-2026!' }),
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
}

test.describe('disposable local Auth', () => {
  test('real member password migration, isolated sessions, invitations, and recovery', async ({ page, browser }) => {
    requireFixtureEnv();
    const metadata: AuthSafetyMetadata = {
      noMemberOtpCalls: true,
      noBrowserSignup: true,
      memberLogoutScoped: false,
      nonmemberLogoutScoped: false,
    };
    const gates: RequestGate[] = [];
    try {
      const primaryGate = await installRequestGate(page, metadata);
      gates.push(primaryGate);
      let existingInvite!: { id: string; token: string };
      let firstTimeInvite!: { id: string; token: string };
      let joinInvite!: { id: string; token: string };

      await test.step('admin login', async () => {
        await loginAdmin(page);
        await expect(page.getByRole('heading', { name: /مركز عمليات PHANTOMS|dashboard/i }).first()).toBeVisible();
        existingInvite = await issueInvite(page, {
          memberId: existingMemberId,
          email: existingMemberEmail,
          purpose: 'enroll',
        });
        firstTimeInvite = await issueInvite(page, {
          memberId: firstTimeMemberId,
          email: firstTimeMemberEmail,
          purpose: 'enroll',
        });
        joinInvite = await issueInvite(page, {
          memberId: null,
          email: null,
          purpose: 'join',
          note: joinInvitationNote,
        });
      });

      await test.step('existing member password enrollment and scoped member logout', async () => {
        await enrollFromJoin(page, existingMemberEmail, existingInvite.token, EXISTING_MEMBER_PASSWORD, { fullName: 'Disposable existing password member' });
        await loginMember(page, existingMemberEmail, EXISTING_MEMBER_PASSWORD);
        await expect(page).toHaveURL(/\/portal$/);
        await expect(page.getByText(/Disposable existing password member/i)).toBeVisible();
        const beforeLogout = await memberStorageMetadata(page);
        await logoutMember(page);
        const afterLogout = await memberStorageMetadata(page);
        metadata.memberLogoutScoped = beforeLogout.adminSessionPresent
          && beforeLogout.memberSessionPresent
          && !afterLogout.memberSessionPresent
          && !afterLogout.memberStatePresent
          && afterLogout.adminSessionPresent;
        expect(metadata.memberLogoutScoped).toBe(true);
        await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/admin\/dashboard$/);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/admin\/dashboard$/);
      });

      await test.step('wrong password retry', async () => {
        const invalidContext = await browser.newContext();
        const invalidPage = await invalidContext.newPage();
        try {
          const gate = await installRequestGate(invalidPage, metadata);
          gates.push(gate);
          await loginMember(invalidPage, existingMemberEmail, 'Disposable-Wrong-Password-2026!');
          await expect(invalidPage).toHaveURL(/\/login(?:[?#].*)?$/);
          await expect(alert(invalidPage)).toBeVisible();
          await memberPasswordInput(invalidPage).fill(EXISTING_MEMBER_PASSWORD);
          await memberSubmit(invalidPage).click();
          await expect(invalidPage).toHaveURL(/\/portal$/);
        } finally {
          await invalidContext.close();
        }
      });

      await test.step('existing passwordless identity preserves UID without duplicate', async () => {
        const identity = await fixtureIdentity(existingMemberEmail, existingMemberAuthUserId);
        expect(identity.count).toBe(1);
        expect(identity.idMatches).toBe(true);
      });

      await test.step('new member enrollment and no auto-login', async () => {
        const before = await fixtureIdentity(firstTimeMemberEmail);
        expect(before.count).toBe(0);
        await enrollFromJoin(page, firstTimeMemberEmail, firstTimeInvite.token, FIRST_TIME_MEMBER_PASSWORD, { fullName: 'Disposable first-time password member' });
        await expect(page).not.toHaveURL(/\/portal$/);
        await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
        const after = await fixtureIdentity(firstTimeMemberEmail);
        expect(after.count).toBe(1);
        await loginMember(page, firstTimeMemberEmail, FIRST_TIME_MEMBER_PASSWORD);
        await expect(page).toHaveURL(/\/portal$/);
        await expect(page.getByText(/Disposable first-time password member/i)).toBeVisible();
      });

      await test.step('new self-service join waits for Admin review and never opens the portal', async () => {
        const before = await fixtureIdentity(joinMemberEmail);
        expect(before.count).toBe(0);
        await enrollFromJoin(page, joinMemberEmail, joinInvite.token, 'Disposable-Join-Member-2026!', { fullName: 'Self-entered pending-review member' });
        await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
        await expect(page.getByText(/تم استلام بياناتك وكلمة مرورك.*بانتظار مراجعة الإدارة/s)).toBeVisible();
        const after = await fixtureIdentity(joinMemberEmail);
        expect(after.count).toBe(1);
        await loginMember(page, joinMemberEmail, 'Disposable-Join-Member-2026!');
        await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
        await expect(alert(page)).toContainText(/مراجعة الإدارة|بانتظار المراجعة/);
        await expect(page).not.toHaveURL(/\/portal$/);
      });

      await test.step('non-member password rejection and local cleanup', async () => {
        const outsiderContext = await browser.newContext();
        const outsiderPage = await outsiderContext.newPage();
        try {
          const gate = await installRequestGate(outsiderPage, metadata);
          gates.push(gate);
          await loginMember(outsiderPage, outsiderEmail, 'Disposable-Auth-Local-2026!');
          await expect(outsiderPage).toHaveURL(/\/login(?:[?#].*)?$/);
          await expect(alert(outsiderPage)).toBeVisible();
          const storage = await memberStorageMetadata(outsiderPage);
          metadata.nonmemberLogoutScoped = !storage.memberSessionPresent && !storage.memberStatePresent;
          expect(metadata.nonmemberLogoutScoped).toBe(true);
        } finally {
          await outsiderContext.close();
        }
      });

      await test.step('public signup disabled', async () => {
        await assertPublicSignupRejected();
      });

      let resetInvite!: { id: string; token: string };
      await test.step('invalid invitation email and token states', async () => {
        resetInvite = await issueInvite(page, {
          memberId: existingMemberId,
          email: existingMemberEmail,
          purpose: 'reset',
        });
        const wrongEmail = await publicEnrollmentRequest(page, {
          email: firstTimeMemberEmail,
          token: resetInvite.token,
          password: RESET_MEMBER_PASSWORD,
          confirmPassword: RESET_MEMBER_PASSWORD,
        });
        expect(wrongEmail.code).toBe('WRONG_EMAIL');
        const malformed = await publicEnrollmentRequest(page, {
          email: existingMemberEmail,
          token: 'phpw_' + '0'.repeat(64),
          password: RESET_MEMBER_PASSWORD,
          confirmPassword: RESET_MEMBER_PASSWORD,
        });
        expect(malformed.code).toMatch(/INVALID_TOKEN|ALREADY_USED/);
      });

      await test.step('reset invitation exact ID and one-use', async () => {
        expect(resetInvite.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        await enrollFromJoin(page, existingMemberEmail, resetInvite.token, RESET_MEMBER_PASSWORD, { mode: 'reset' });
        await expect(page).toHaveURL(/\/login(?:[?#].*)?$/);
        const reused = await publicEnrollmentRequest(page, {
          email: existingMemberEmail,
          token: resetInvite.token,
          password: EXISTING_MEMBER_PASSWORD,
          confirmPassword: EXISTING_MEMBER_PASSWORD,
        });
        expect(reused.code).toBe('ALREADY_USED');
        await loginMember(page, existingMemberEmail, RESET_MEMBER_PASSWORD);
        await expect(page).toHaveURL(/\/portal$/);
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
      expect(metadata.noMemberOtpCalls).toBe(true);
      expect(metadata.noBrowserSignup).toBe(true);
    } finally {
      test.info().annotations.push({ type: 'auth-safety', description: JSON.stringify(metadata) });
    }
  });
});
