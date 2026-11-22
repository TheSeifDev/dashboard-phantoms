import { expect, test, type Page, type Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADMIN_MEMBER_COLUMNS } from '../src/features/members/memberColumns';

const apiPort = process.env.PHANTOMS_LOCAL_API_PORT ?? '54321';
const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (![apiPort, previewPort].every((port) => /^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535)) throw new Error('Invalid disposable loopback ports.');
const API_ORIGIN = `http://127.0.0.1:${apiPort}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${previewPort}`;
const MEMBER_PASSWORD_ENDPOINT = new RegExp(
  `^${API_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/functions/v1/member-password-enrollment(?:/)?(?:\\?.*)?$`,
);
const SAFE_MEMBER_COLUMNS = ADMIN_MEMBER_COLUMNS;
const ownerEmail = process.env.PHANTOMS_DASHBOARD_OWNER_EMAIL ?? '';
const ownerPassword = process.env.PHANTOMS_DASHBOARD_OWNER_PASSWORD ?? '';
const outsiderEmail = process.env.PHANTOMS_DASHBOARD_OUTSIDER_EMAIL ?? '';
const outsiderPassword = process.env.PHANTOMS_DASHBOARD_OUTSIDER_PASSWORD ?? '';
const memberEmails = [
  process.env.PHANTOMS_DASHBOARD_MEMBER_ONE_EMAIL ?? '',
  process.env.PHANTOMS_DASHBOARD_MEMBER_TWO_EMAIL ?? '',
];
const UI_SPECIFIC_TASK_TITLE = 'Disposable UI selected member task';
const UI_ALL_TASK_TITLE = 'Disposable UI all members task';
const UI_FAILURE_TASK_TITLE = 'Disposable UI failed task';
const UI_RESTORED_TASK_TITLE = 'Disposable UI restored task';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const evidenceDir = path.resolve('test-results');
const vapidMode = process.env.PHANTOMS_VAPID_MODE ?? 'unknown';

function requireFixtureEnv(): void {
  for (const [name, value] of Object.entries({ ownerEmail, ownerPassword, outsiderEmail, outsiderPassword, anonKey, ...Object.fromEntries(memberEmails.map((value, index) => [`member${index}`, value])) })) {
    if (!value) throw new Error(`Missing disposable fixture environment value: ${name}`);
  }
  if (process.env.VITE_SUPABASE_URL !== API_ORIGIN) {
    throw new Error('Dashboard E2E requires the exact local Supabase API origin.');
  }
}

function localClient(): SupabaseClient {
  requireFixtureEnv();
  return createClient(API_ORIGIN, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(client: SupabaseClient, email: string, password: string): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Disposable auth sign-in failed (${error.code ?? 'unknown'}).`);
}

async function loginInBrowser(page: Page): Promise<void> {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#admin-email').fill(ownerEmail);
  await page.locator('#admin-password').fill(ownerPassword);
  await page.getByRole('button', { name: 'ادخل مركز الإدارة' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'لوحة الفريق', exact: true })).toBeVisible();
}

function requestIsAllowed(url: URL): boolean {
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (url.origin === PREVIEW_ORIGIN) return true;
  if (url.origin === API_ORIGIN) return true;
  // The app declares these font assets and the GitHub avatar hosts used by member pictures.
  return url.origin === 'https://fonts.googleapis.com'
    || url.origin === 'https://fonts.gstatic.com'
    || url.origin === 'https://github.com'
    || url.origin === 'https://avatars.githubusercontent.com'
    || url.origin === 'https://github-contributions-api.jogruber.de';
}

async function installRequestGate(page: Page): Promise<{ blocked: string[]; pushRequests: string[]; setResource403: (resource: 'members' | 'tasks' | 'notes', value: boolean) => void; setTaskInsertFailure: (title: string | null) => void; getResource403Count: (resource: 'members' | 'tasks' | 'notes') => number }> {
  const blocked: string[] = [];
  const pushRequests: string[] = [];
  let taskInsertFailureTitle: string | null = null;
  const failures = { members: false, tasks: false, notes: false };
  const failureCounts = { members: 0, tasks: 0, notes: 0 };
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (!requestIsAllowed(url)) {
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin === API_ORIGIN && url.pathname === '/functions/v1/push-notify') {
      pushRequests.push(`${route.request().method()} ${url.pathname}`);
    }
    if (url.origin === API_ORIGIN && url.pathname === '/functions/v1/member-password-enrollment' && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { action?: string } | null;
      if (payload?.action === 'list_join_reviews') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) });
        return;
      }
    }
    if (url.origin === API_ORIGIN && url.pathname === '/rest/v1/tasks' && route.request().method() === 'POST' && taskInsertFailureTitle) {
      const payload = route.request().postDataJSON() as { title?: string } | Array<{ title?: string }> | null;
      const title = Array.isArray(payload) ? payload[0]?.title : payload?.title;
      if (title === taskInsertFailureTitle) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: '23514', message: 'controlled task insert regression denial' }),
        });
        return;
      }
    }
    const resource = url.origin === API_ORIGIN && url.pathname.match(/^\/rest\/v1\/(members|tasks|notes)$/)?.[1] as 'members' | 'tasks' | 'notes' | undefined;
    if (resource && failures[resource] && route.request().method() === 'GET') {
      failureCounts[resource] += 1;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: '42501', message: 'controlled dashboard regression denial' }),
      });
      return;
    }
    await route.continue();
  });
  return {
    blocked,
    pushRequests,
    setResource403: (resource, value) => { failures[resource] = value; },
    setTaskInsertFailure: (title) => { taskInsertFailureTitle = title; },
    getResource403Count: (resource) => failureCounts[resource],
  };
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(metrics.document, `horizontal overflow at ${metrics.viewport}px`).toBeLessThanOrEqual(metrics.viewport + 1);
}

async function assertCorePage(page: Page, route: string, heading: RegExp): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('disposable local dashboard', () => {
  test('authenticated local data path, safe CRUD, RLS boundaries, and dashboard recovery', async ({ page }) => {
    requireFixtureEnv();
    const owner = localClient();
    await signIn(owner, ownerEmail, ownerPassword);

    const { data: members, error: memberError } = await owner.from('members').select(SAFE_MEMBER_COLUMNS).order('id').limit(10);
    expect(memberError).toBeNull();
    expect(members).toHaveLength(2);
    expect(new Set((members ?? []).map((row) => row.email))).toEqual(new Set(memberEmails));
    const firstMember = members?.find((row) => row.email === memberEmails[0]);
    const secondMember = members?.find((row) => row.email === memberEmails[1]);
    expect(firstMember?.id).toEqual(expect.any(Number));
    expect(secondMember?.id).toEqual(expect.any(Number));

    const protectedRead = await owner.from('members').select('session_token').limit(1);
    expect(protectedRead.data).toBeNull();
    expect(protectedRead.error?.code).toBe('42501');
    const pushRead = await owner.from('members').select('push_subscription').limit(1);
    expect(pushRead.data).toBeNull();
    expect(pushRead.error?.code).toBe('42501');

    const anon = localClient();
    const anonRead = await anon.from('members').select(SAFE_MEMBER_COLUMNS).limit(1);
    expect(anonRead.data).toBeNull();
    expect(anonRead.error?.code).toBe('42501');

    const outsider = localClient();
    await signIn(outsider, outsiderEmail, outsiderPassword);
    const outsiderRead = await outsider.from('members').select(SAFE_MEMBER_COLUMNS).limit(10);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);
    await outsider.auth.signOut();

    const [tasksRead, notesRead, customFieldsRead, legacyInvitesRead] = await Promise.all([
      owner.from('tasks').select('id,title,description,has_deadline,deadline_date,assigned_to,tracking,bonus_points').limit(20),
      owner.from('notes').select('id,created_at,text,author,author_role,date,target_member_id,target_name,source_task_id,source_member_id').limit(20),
      owner.from('member_custom_fields').select('id,label,field_type,options,placeholder,show_in_card,is_required,is_active,sort_order').eq('is_active', true).order('sort_order').order('id').limit(20),
      owner.from('member_registration_invites').select('id,note,expires_at,used_at,is_revoked,created_at').eq('is_revoked', false).is('used_at', null).order('created_at', { ascending: false }).limit(20),
    ]);
    expect(tasksRead.error).toBeNull();
    expect(tasksRead.data?.length).toBeGreaterThan(0);
    expect(notesRead.error).toBeNull();
    expect(notesRead.data?.length).toBeGreaterThan(0);
    expect(customFieldsRead.error).toBeNull();
    expect(customFieldsRead.data?.length).toBeGreaterThan(0);
    // Retired legacy invitation history remains unavailable through direct authenticated table reads.
    expect(legacyInvitesRead.data).toBeNull();
    expect(legacyInvitesRead.error?.code).toBe('42501');

    // The old public invite-context RPC is retired; onboarding uses the guarded member-password API.
    const { data: retiredInvite, error: retiredInviteError } = await anon.rpc('get_member_invite_context', { p_token: 'not-a-real-reserved-domain-invite-token-000000' });
    expect(retiredInvite).toBeNull();
    expect(retiredInviteError?.code).toBe('42501');

    const tempEmail = `crud-${Date.now()}@phantoms-test.example`;
    const insert = await owner.from('members').insert({
      email: tempEmail,
      full_name: 'Disposable CRUD Member',
      completion_rank: 3,
      team_notes: 'CRUD fixture',
      residence: 'Alexandria',
      work_conditions: 'remote',
      bio: 'Projection verification',
      phone: '+201000000099',
      device: 'لابتوب',
      gender: 'other',
      meeting_attendance: 'present',
      work_status: 'active',
      can_go_alexandria: true,
      custom_fields: { fixture: 'crud' },
    }).select(SAFE_MEMBER_COLUMNS).single();
    expect(insert.error).toBeNull();
    expect(insert.data?.email).toBe(tempEmail);
    expect(Object.keys(insert.data ?? {}).sort()).toEqual(SAFE_MEMBER_COLUMNS.split(',').sort());

    const insertedId = insert.data?.id;
    expect(insertedId).toEqual(expect.any(Number));
    const update = await owner.from('members').update({ full_name: 'Disposable CRUD Updated', phone: '+201000000098' }).eq('id', insertedId).select(SAFE_MEMBER_COLUMNS).single();
    expect(update.error).toBeNull();
    expect(update.data?.full_name).toBe('Disposable CRUD Updated');
    expect(update.data?.phone).toBe('+201000000098');

    const upsert = await owner.from('members').upsert({ email: tempEmail, full_name: 'Disposable CRUD Upserted', custom_fields: { fixture: 'upsert' } }, { onConflict: 'email' }).select(SAFE_MEMBER_COLUMNS).single();
    expect(upsert.error).toBeNull();
    expect(upsert.data?.full_name).toBe('Disposable CRUD Upserted');
    expect(upsert.data?.phone).toBe('+201000000098');

    const reread = await owner.from('members').select(SAFE_MEMBER_COLUMNS).eq('email', tempEmail).limit(2);
    expect(reread.error).toBeNull();
    expect(reread.data).toHaveLength(1);
    expect(reread.data?.[0]?.full_name).toBe('Disposable CRUD Upserted');
    expect(reread.data?.[0]?.custom_fields).toEqual({ fixture: 'upsert' });
    const remove = await owner.from('members').delete().eq('id', insertedId).select(SAFE_MEMBER_COLUMNS).single();
    expect(remove.error).toBeNull();
    expect(remove.data?.email).toBe(tempEmail);
    const afterCleanup = await owner.from('members').select('id').eq('email', tempEmail).limit(2);
    expect(afterCleanup.error).toBeNull();
    expect(afterCleanup.data).toEqual([]);

    const requestEvidence: Array<{ endpoint: string; status: number; method: string; columns: string | null }> = [];
    const pageErrors: string[] = [];
    page.on('pageerror', () => pageErrors.push('Uncaught application error'));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === API_ORIGIN) requestEvidence.push({
        endpoint: url.pathname, status: response.status(), method: response.request().method(), columns: url.searchParams.get('select'),
      });
    });
    const gate = await installRequestGate(page);
    await loginInBrowser(page);
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets')).toBeVisible();
    await expect(page.getByTestId('dashboard-metrics').getByText(new Intl.NumberFormat('ar-EG').format(2), { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Disposable local dashboard task').first()).toBeVisible();
    await expect(page.getByText('Disposable owner أضاف ملاحظة لـ Disposable member one').first()).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets').getByText(new Intl.NumberFormat('ar-EG').format(12), { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets').locator('li').filter({ hasText: 'تحت المراجعة' }).first()).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets').locator('li').filter({ hasText: 'متأخر' }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    for (const table of ['members', 'tasks', 'notes']) {
      expect(requestEvidence.some((r) => r.endpoint === `/rest/v1/${table}` && r.status === 200)).toBe(true);
    }
    expect(requestEvidence.some((r) => r.endpoint === '/rest/v1/members' && r.columns === SAFE_MEMBER_COLUMNS && r.status === 200)).toBe(true);

    await test.step('Admin invitation UI is email-free and copies either the link or WhatsApp invitation', async () => {
      const invitationEndpoint = MEMBER_PASSWORD_ENDPOINT;
      let joinIssuePayload: { action?: string; memberId?: number | null; purpose?: string; email?: string | null; expiresInHours?: number } | null = null;
      const mockJoinIssue = async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_INPUT' }) });
          return;
        }
        const payload = route.request().postDataJSON() as { action?: string; memberId?: number | null; purpose?: string; email?: string | null; expiresInHours?: number };
        if (payload.action === 'list') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invites: [] }) });
          return;
        }
        if (payload.action === 'list_join_reviews') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) });
          return;
        }
        if (payload.action !== 'issue' || payload.memberId !== null || payload.purpose !== 'join' || payload.email !== null) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_INPUT' }) });
          return;
        }
        joinIssuePayload = payload;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ invite: {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            token: `phpw_${'a'.repeat(64)}`,
            email: null,
            member_id: null,
            purpose: 'join',
            note: null,
            expires_at: '2099-12-31T00:00:00.000Z',
          } }),
        });
      };
      await page.route(invitationEndpoint, mockJoinIssue);
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/admin/members', { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'إضافة عضو', exact: true }).click();
        await page.getByRole('button', { name: 'توليد رابط تسجيل للعضو', exact: true }).click();
        const purpose = page.locator('#member-invite-purpose');
        const inviteEmail = page.locator('#member-invite-email');
        const joinOptions = page.getByTestId('member-invite-join-options');
        const expiry = page.locator('#member-invite-expiry');
        const messageName = page.locator('#member-invite-message-name');
        await expect(purpose).toHaveValue('join');
        await expect(expiry).toHaveValue('24');
        await expect(page.getByText('ملاحظة داخلية (اختيارية)', { exact: true })).toHaveCount(0);
        await expect(page.getByText('أنت ترسل الرابط فقط — العضو يكتب بياناته وكلمة مروره')).toBeVisible();
        await expect(page.getByText(/الرابط يُستخدم مرة واحدة وينتهي في الموعد المحدد/)).toBeVisible();
        await expect(joinOptions).toBeVisible();
        await expect(joinOptions.locator('input[type="email"]')).toHaveCount(0);
        await expect(inviteEmail).toHaveCount(0);
        await expect(page.getByTestId('member-invite-join-email-note')).toHaveCount(0);
        await expect(messageName).toBeVisible();
        await expect(messageName).not.toHaveAttribute('required', '');
        await messageName.fill('سلمى');
        await assertNoHorizontalOverflow(page);
        await expect(page.locator('#member-invite-auth-id')).toHaveCount(0);
        await expiry.selectOption('72');
        const inviteScreenshotDir = process.env.PHANTOMS_MOBILE_SCREENSHOT_DIR;
        if (inviteScreenshotDir && vapidMode === 'missing') {
          await mkdir(inviteScreenshotDir, { recursive: true, mode: 0o700 });
          await page.locator('form').screenshot({ path: path.join(inviteScreenshotDir, 'invite-link-modal-390.png'), animations: 'disabled' });
        }
        await page.getByRole('button', { name: 'إنشاء رابط خاص', exact: true }).click();
        await expect(page.getByText(/#invite=phpw_a{64}$/)).toBeVisible();
        await expect(page.getByText('مرة واحدة فقط', { exact: true })).toBeVisible();
        const copyInviteLink = page.getByRole('button', { name: 'نسخ رابط الدعوة', exact: true });
        await expect(copyInviteLink).toBeVisible();
        await expect(messageName).toBeVisible();
        await expect(page.getByText(/يُستخدم في التحية داخل الرسالة فقط؛ لا يُحفظ ولا يُرسل إلى الخادم/)).toBeVisible();
        await expect(page.getByTestId('member-invite-created-result')).toBeVisible();
        // Keep the browser test deterministic: headless localhost may deny OS clipboard access.
        await page.evaluate(() => {
          let contents = '';
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: async (text: string) => { contents = text; },
              readText: async () => contents,
            },
          });
        });
        const clipboardStubProbe = await page.evaluate(async () => {
          await navigator.clipboard.writeText('clipboard-fixture-probe');
          return navigator.clipboard.readText();
        });
        expect(clipboardStubProbe).toBe('clipboard-fixture-probe');
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await copyInviteLink.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toContain('#invite=phpw_a');
        const copiedInviteLink = await page.evaluate(() => navigator.clipboard.readText());
        expect(copiedInviteLink).toContain('#invite=phpw_a');
        const whatsappPreview = page.locator('#member-invite-whatsapp-preview');
        await expect(whatsappPreview).toBeVisible();
        await expect(whatsappPreview).toHaveValue(/أهلًا يا سلمى،/);
        expect(await whatsappPreview.inputValue()).toContain('ده رابط الدعوة لمنصة PHANTOMS:');
        const copyWhatsAppMessage = page.getByTestId('member-invite-copy-whatsapp');
        await expect(copyWhatsAppMessage).toBeVisible();
        await copyWhatsAppMessage.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toContain('أهلًا يا سلمى،');
        const personalizedMessage = await page.evaluate(() => navigator.clipboard.readText());
        expect(personalizedMessage).toContain('أهلًا يا سلمى،');
        expect(personalizedMessage).toContain('ده رابط الدعوة لمنصة PHANTOMS:');
        expect(personalizedMessage).toContain('اكتب بريدك الإلكتروني وبياناتك وكلمة مرورك بنفسك');
        expect(personalizedMessage).toContain('#invite=phpw_a');
        expect(personalizedMessage).toContain('مرة واحدة فقط');
        expect(personalizedMessage).toContain('الرابط صالح لحد');
        await messageName.fill('');
        await expect(whatsappPreview).toHaveValue(/أهلًا،/);
        await copyWhatsAppMessage.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toContain('أهلًا،');
        const genericMessage = await page.evaluate(() => navigator.clipboard.readText());
        expect(genericMessage).toContain('أهلًا،');
        expect(genericMessage).not.toContain('سلمى');
        await expect(page.getByRole('dialog').locator('details')).toHaveCount(0);
        await expect(page.getByText(/الكود اليدوي/)).toHaveCount(0);
        await assertNoHorizontalOverflow(page);
        expect(joinIssuePayload).toMatchObject({ action: 'issue', memberId: null, purpose: 'join', email: null, expiresInHours: 72 });
        expect(joinIssuePayload).toHaveProperty('note', '');
        expect(joinIssuePayload).not.toHaveProperty('messageName');
        expect(joinIssuePayload).not.toHaveProperty('whatsAppName');
        if (typeof firstMember?.id !== 'number') throw new Error('owned invite member fixture is unavailable');
        await purpose.selectOption('enroll');
        const existingMember = page.locator('#member-invite-member');
        await expect(existingMember).toBeVisible();
        await existingMember.selectOption(String(firstMember.id));
        await expect(inviteEmail).toHaveAttribute('readonly', '');
        await expect(inviteEmail).toHaveValue(memberEmails[0]);
        await purpose.selectOption('reset');
        await expect(existingMember).toBeVisible();
        await existingMember.selectOption(String(firstMember.id));
        await expect(inviteEmail).toHaveValue(memberEmails[0]);
        await purpose.selectOption('join');
        await expect(inviteEmail).toHaveCount(0);
        await expect(joinOptions).toBeVisible();
        await page.getByRole('button', { name: 'إغلاق', exact: true }).last().click();
        await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
        await page.setViewportSize({ width: 1440, height: 1000 });
      } finally {
        await page.unroute(invitationEndpoint, mockJoinIssue);
      }
    });

    await test.step('Owner can review a completed self-service registration and explicitly activate it', async () => {
      const reviewEndpoint = MEMBER_PASSWORD_ENDPOINT;
      const pendingReview = {
        invitation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        member_id: 4545,
        full_name: 'Self-service pending member',
        email: 'pending-review@phantoms-test.example',
        invitation_email: 'pending-review@phantoms-test.example',
        email_identity_matches: true,
        phone: '+201011112222',
        residence: 'Cairo',
        work_conditions: 'Remote',
        bio: 'Student supplied profile',
        device: 'لابتوب',
        gender: 'ذكر',
        submitted_at: '2026-11-19T00:00:00.000Z',
      };
      const newestReview = {
        ...pendingReview,
        invitation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        member_id: 4546,
        full_name: 'Newest self-service member',
        email: 'newest-review@phantoms-test.example',
        invitation_email: 'newest-review@phantoms-test.example',
        submitted_at: '2026-11-19T00:01:00.000Z',
      };
      let approved = false;
      let emailMatches = false;
      let mockNewReviewArrived = false;
      let approvalPayload: unknown = null;
      const mockReviewActions = async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_INPUT' }) });
          return;
        }
        const payload = route.request().postDataJSON() as { action?: string; memberId?: number };
        if (payload.action === 'list_join_reviews') {
          const reviews = [
            ...(mockNewReviewArrived ? [newestReview] : []),
            ...(!approved ? [{ ...pendingReview, email_identity_matches: emailMatches }] : []),
          ];
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ reviews }),
          });
          return;
        }
        if (payload.action === 'approve_join' && payload.memberId === pendingReview.member_id) {
          approvalPayload = payload;
          approved = true;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, approved: true }) });
          return;
        }
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_INPUT' }) });
      };
      await page.route(reviewEndpoint, mockReviewActions);
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/admin/members', { waitUntil: 'domcontentloaded' });
        const queue = page.getByTestId('member-join-review-queue');
        await expect(queue).toBeVisible();
        await expect(queue.getByTestId('member-join-review-count')).toHaveText('1');
        const item = page.getByTestId('member-join-review-item').filter({ hasText: 'Self-service pending member' });
        await expect(item).toContainText('Self-service pending member');
        await expect(item).toContainText('pending-review@phantoms-test.example');
        await expect(item).toContainText('Student supplied profile');
        await expect(item.getByTestId('member-join-review-email-mismatch')).toBeVisible();
        await expect(item.getByRole('button', { name: 'قبول وتفعيل العضوية' })).toBeDisabled();
        emailMatches = true;
        await queue.getByRole('button', { name: 'تحديث الطلبات' }).click();
        await expect(item.getByTestId('member-join-review-email-mismatch')).toHaveCount(0);
        await expect(item.getByRole('button', { name: 'قبول وتفعيل العضوية' })).toBeVisible();
        await expect(item.getByRole('button', { name: 'قبول وتفعيل العضوية' })).toBeEnabled();
        mockNewReviewArrived = true;
        await queue.getByRole('button', { name: 'تحديث الطلبات' }).click();
        await expect(queue.getByTestId('member-join-review-count')).toHaveText('2');
        await expect(page.getByText('وصل طلب انضمام جديد للمراجعة.', { exact: true })).toBeVisible();
        await expect(queue.getByTestId('member-join-review-item').filter({ hasText: 'Newest self-service member' })).toBeVisible();
        const reviewScreenshotDir = process.env.PHANTOMS_MOBILE_SCREENSHOT_DIR;
        if (reviewScreenshotDir && vapidMode === 'missing') {
          await mkdir(path.resolve(reviewScreenshotDir), { recursive: true, mode: 0o700 });
          await item.screenshot({ path: path.join(path.resolve(reviewScreenshotDir), 'owner-join-review-queue-390.png') });
        }
        await item.getByRole('button', { name: 'قبول وتفعيل العضوية' }).click();
        const confirm = page.getByRole('heading', { name: 'تأكيد تفعيل العضوية' });
        await expect(confirm).toBeVisible();
        await expect(page.getByText(/بعد الموافقة ستصبح العضوية نشطة/)).toBeVisible();
        await page.getByRole('button', { name: 'موافقة وتفعيل', exact: true }).click();
        await expect(queue.getByTestId('member-join-review-count')).toHaveText('1');
        await expect(queue.getByTestId('member-join-review-item')).toContainText('Newest self-service member');
        expect(approvalPayload).toEqual({ action: 'approve_join', memberId: pendingReview.member_id });
        await expect(page.getByText('تم قبول Self-service pending member وتفعيل عضويته.', { exact: true })).toBeVisible();
        await assertNoHorizontalOverflow(page);
      } finally {
        await page.unroute(reviewEndpoint, mockReviewActions);
      }
    });

    for (const resource of ['members', 'tasks', 'notes'] as const) {
      gate.setResource403(resource, true);
      await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('alert')).toContainText('معرفناش نحمّل بيانات لوحة التحكم.');
      expect(gate.getResource403Count(resource)).toBeGreaterThan(0);
      await expect(page.getByTestId('dashboard-metrics')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-widgets')).toHaveCount(0);
      gate.setResource403(resource, false);
      await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-metrics').getByText(new Intl.NumberFormat('ar-EG').format(2), { exact: true }).first()).toBeVisible();
    }

    const screenshots: Array<{ theme: 'light' | 'dark'; viewport: 'desktop' | 'mobile'; path: string }> = [];
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((value) => {
        localStorage.setItem('tms_theme', value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(theme);
      for (const viewport of [{ name: 'desktop' as const, width: 1440, height: 1000 }, { name: 'mobile' as const, width: 390, height: 844 }]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await assertNoHorizontalOverflow(page);
        // Recharts uses 1500ms data-entry animations; capture settled real charts,
        // not the transient zero-height bars/empty sectors immediately after resize.
        await page.waitForTimeout(1800);
        await expect(page.locator('.recharts-pie-sector')).toHaveCount(2);
        const nonzeroBars = await page.locator('.recharts-bar-rectangle').evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height > 10).length);
        expect(nonzeroBars).toBeGreaterThanOrEqual(2);
        const screenshotPath = path.join(evidenceDir, `dashboard-${vapidMode}-${theme}-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshots.push({ theme, viewport: viewport.name, path: screenshotPath });
      }
    }

    const mobileScreenshotDir = process.env.PHANTOMS_MOBILE_SCREENSHOT_DIR
      ? path.resolve(process.env.PHANTOMS_MOBILE_SCREENSHOT_DIR)
      : null;
    if (mobileScreenshotDir && vapidMode === 'missing') {
      await mkdir(mobileScreenshotDir, { recursive: true, mode: 0o700 });
    }
    const longArabicName = 'عضو تجريبي ذو اسم عربي طويل جداً لاختبار التفاف العنوان داخل نافذة الملف على شاشة الهاتف';
    if (typeof firstMember?.id !== 'number') throw new Error('mobile profile fixture member ID is unavailable');
    const longNameUpdate = await owner.from('members').update({ full_name: longArabicName }).eq('id', firstMember.id).select('id').single();
    expect(longNameUpdate.error).toBeNull();
    expect(longNameUpdate.data?.id).toBe(firstMember.id);
    const persistedLongName = await owner.from('members').select('full_name').eq('id', firstMember.id).single();
    expect(persistedLongName.data?.full_name).toBe(longArabicName);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const mobileCoverage: Array<{ width: number; theme: 'light' | 'dark'; drawerFullScreen: true; nameFromDatabase: true; nameWrapped: true; closeButton: true; escapeClose: true }> = [];
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        localStorage.setItem('tms_theme', value);
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
        await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(theme);
        await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await page.getByRole('button', { name: 'افتح القائمة الرئيسية' }).click();
        const navigationDrawer = page.getByRole('dialog', { name: 'القائمة الرئيسية' });
        await expect(navigationDrawer).toBeVisible();
        await page.waitForTimeout(220);
        const navigationLayout = await navigationDrawer.evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            centerCovered: Boolean(hit && dialog.contains(hit)),
            backgroundColor: getComputedStyle(dialog).backgroundColor,
          };
        });
        expect(navigationLayout.left).toBeLessThanOrEqual(1);
        expect(navigationLayout.top).toBeLessThanOrEqual(1);
        expect(navigationLayout.right).toBeGreaterThanOrEqual(width - 1);
        expect(navigationLayout.bottom).toBeGreaterThanOrEqual(844 - 1);
        expect(navigationLayout.width).toBeGreaterThanOrEqual(width - 1);
        expect(navigationLayout.height).toBeGreaterThanOrEqual(844 - 1);
        expect(navigationLayout.centerCovered).toBe(true);
        expect(navigationLayout.backgroundColor).not.toBe('transparent');
        expect(navigationLayout.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        if (mobileScreenshotDir && vapidMode === 'missing') {
          await page.screenshot({ path: path.join(mobileScreenshotDir, `admin-navigation-${width}-${theme}.png`) });
        }
        await navigationDrawer.getByRole('link', { name: 'الأعضاء', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/members$/);
        await expect(page.getByRole('heading', { name: 'دليل الأعضاء وجاهزيتهم', exact: true })).toBeVisible();
        await page.getByRole('button', { name: longArabicName, exact: true }).click();
        const memberDialog = page.getByRole('dialog', { name: 'ملف العضو' });
        await expect(memberDialog).toBeVisible();
        await expect(memberDialog).toHaveCSS('opacity', '1');
        const dialogVisual = await memberDialog.evaluate((dialog) => ({
          opacity: Number.parseFloat(getComputedStyle(dialog).opacity),
          backgroundColor: getComputedStyle(dialog).backgroundColor,
        }));
        expect(dialogVisual.opacity).toBe(1);
        expect(dialogVisual.backgroundColor).not.toBe('transparent');
        expect(dialogVisual.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        const memberNameHeading = memberDialog.locator('h3');
        await expect(memberNameHeading).toHaveText(longArabicName);
        const layout = await memberDialog.evaluate((dialog) => {
          const bounds = (element: Element | null) => element ? (element as HTMLElement).getBoundingClientRect() : null;
          const panel = dialog.getBoundingClientRect();
          const title = bounds(dialog.querySelector('header h2'));
          const close = bounds(dialog.querySelector('header button'));
          const hero = bounds(dialog.querySelector('h3'));
          const heroElement = dialog.querySelector('h3') as HTMLElement | null;
          const heroStyle = heroElement ? getComputedStyle(heroElement) : null;
          const heroLineHeight = heroStyle ? Number.parseFloat(heroStyle.lineHeight) : 0;
          const overlaps = title && close
            ? !(title.right <= close.left || close.right <= title.left || title.bottom <= close.top || close.bottom <= title.top)
            : false;
          let clippedChildren = 0;
          for (const element of Array.from(dialog.querySelectorAll('*'))) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.left < panel.left - 2 || rect.right > panel.right + 2)) clippedChildren += 1;
          }
          return {
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            dialogWidth: panel.width,
            headerOverlap: overlaps,
            heroOverflow: Boolean(hero && (hero.left < panel.left - 1 || hero.right > panel.right + 1)),
            heroClientWidth: heroElement?.clientWidth ?? 0,
            heroScrollWidth: heroElement?.scrollWidth ?? 0,
            heroLineCount: hero && heroLineHeight > 0 ? Math.round(hero.height / heroLineHeight) : 0,
            heroWhiteSpace: heroStyle?.whiteSpace ?? '',
            clippedChildren,
          };
        });
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
        expect(layout.dialogWidth).toBeLessThanOrEqual(layout.viewport + 1);
        expect(layout.headerOverlap).toBe(false);
        expect(layout.heroOverflow).toBe(false);
        expect(layout.heroLineCount).toBeGreaterThan(1);
        expect(layout.heroWhiteSpace).not.toBe('nowrap');
        expect(layout.heroScrollWidth).toBeLessThanOrEqual(layout.heroClientWidth + 1);
        expect(layout.clippedChildren).toBe(0);
        if (mobileScreenshotDir && vapidMode === 'missing') {
          await page.screenshot({ path: path.join(mobileScreenshotDir, `member-profile-${width}-${theme}.png`) });
        }
        await memberDialog.getByRole('button', { name: 'اقفل' }).click();
        await expect(memberDialog).toHaveCount(0);
        await page.getByRole('button', { name: longArabicName, exact: true }).click();
        await expect(memberDialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(memberDialog).toHaveCount(0);
        mobileCoverage.push({ width, theme, drawerFullScreen: true, nameFromDatabase: true, nameWrapped: true, closeButton: true, escapeClose: true });
      }
    }
    const restoredMemberName = await owner.from('members').update({ full_name: 'Disposable member one' }).eq('id', firstMember.id).select('id').single();
    expect(restoredMemberName.error).toBeNull();
    expect(restoredMemberName.data?.id).toBe(firstMember.id);
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
    await expect(page.getByTestId('dashboard-contributions').locator('.dashboard-contribution-number')).toHaveText(new Intl.NumberFormat('ar-EG').format(0));
    await assertCorePage(page, '/admin/tasks', /إدارة وتكليف المهام/);
    await expect(page.getByText('Disposable local dashboard task').first()).toBeVisible();

    const seededTaskCard = page.locator('article').filter({ hasText: 'Disposable local dashboard task' }).first();
    await seededTaskCard.getByRole('button', { name: 'مراجعة تسليم Disposable member one' }).click();
    const reviewDialog = page.getByRole('dialog', { name: 'مراجعة تسليم المهمة' });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog).toContainText('Disposable member one');
    await reviewDialog.getByRole('button', { name: /اعتمد/ }).click();
    await expect(reviewDialog).toHaveCount(0);
    const approvedRead = await owner.from('tasks').select('id,tracking').eq('title', 'Disposable local dashboard task').limit(2);
    expect(approvedRead.error).toBeNull();
    expect(approvedRead.data).toHaveLength(1);
    expect((approvedRead.data?.[0]?.tracking as Record<string, { status?: string }> | null)?.[String(firstMember?.id)]?.status).toBe('approved');
    expect(gate.pushRequests).toEqual([]);

    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    const contributions = page.getByTestId('dashboard-contributions');
    await expect(contributions).toBeVisible();
    // Honeycomb cells are responsive pointy-top hexagons: width scales with the panel (clamped
    // between 14px and 26px) and height keeps the regular-hexagon ratio of 2/sqrt(3).
    await expect.poll(async () => {
      const box = await contributions.locator('button.dashboard-heatmap-cell').first().boundingBox();
      const width = box?.width ?? -1;
      const height = box?.height ?? -1;
      return { widthInRange: width >= 13 && width <= 27, hexRatio: width > 0 && Math.abs(height / width - 2 / Math.sqrt(3)) < 0.05 };
    }).toEqual({ widthInRange: true, hexRatio: true });
    await expect(contributions.locator('.dashboard-contribution-number')).toHaveText(new Intl.NumberFormat('ar-EG').format(1));
    await expect(contributions.locator('.dashboard-streak strong').first()).toHaveText(new Intl.NumberFormat('ar-EG').format(1));
    await expect(contributions.locator('[data-untracked="true"]').first()).toBeVisible();
    const yearSelect = contributions.getByLabel('سنة سجل المساهمات', { exact: true });
    const currentYearValue = await yearSelect.inputValue();
    await yearSelect.selectOption(String(Number(currentYearValue) - 1));
    await expect(contributions.locator('.dashboard-streak strong').first()).toHaveText('—');
    await yearSelect.selectOption(currentYearValue);
    await expect(contributions.locator('.dashboard-contribution-number')).toHaveText(new Intl.NumberFormat('ar-EG').format(1));
    const designShotDir = process.env.PHANTOMS_REDESIGN_SCREENSHOT_DIR;
    if (designShotDir && vapidMode === 'missing') await mkdir(designShotDir, { recursive: true, mode: 0o700 });
    const privateCopy = page.locator('.header-account-copy, .header-avatar, .dashboard-person-name, .dashboard-late-person, .dashboard-activity-copy');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'شغّل الوضع الفاتح', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(1600); // Recharts finite data-entry animation; not an application delay.
    if (designShotDir && vapidMode === 'missing') await page.screenshot({ path: path.join(designShotDir, 'dashboard-ar-light.png'), fullPage: true, mask: [privateCopy], maskColor: '#dce5ef' });
    await page.locator('.language-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Team dashboard', exact: true })).toBeVisible();
    await expect(contributions.locator('.dashboard-contribution-number')).toHaveText('1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Team dashboard', exact: true })).toBeVisible();
    await page.waitForTimeout(1600);
    if (designShotDir && vapidMode === 'missing') await page.screenshot({ path: path.join(designShotDir, 'dashboard-en-light.png'), fullPage: true, mask: [privateCopy], maskColor: '#dce5ef' });
    await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (designShotDir && vapidMode === 'missing') await page.screenshot({ path: path.join(designShotDir, 'dashboard-en-dark.png'), fullPage: true, mask: [privateCopy], maskColor: '#263b52' });
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await assertNoHorizontalOverflow(page);
      await expect(page.getByRole('button', { name: 'Open main menu', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Open main menu', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    if (designShotDir && vapidMode === 'missing') await page.screenshot({ path: path.join(designShotDir, 'dashboard-en-mobile.png'), fullPage: true, mask: [privateCopy], maskColor: '#263b52' });
    await page.locator('.language-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'اعمل مهمة جديدة', exact: true })).toBeVisible();

    // This is the real assignment UI path, not an SDK-only insert. VAPID is a
    // local placeholder, so every task must persist without a push request.
    await page.getByRole('button', { name: 'اعمل مهمة جديدة' }).click();
    let assignmentDialog = page.getByRole('dialog', { name: 'تكليف مهمة جديدة' });
    await expect(assignmentDialog).toBeVisible();
    await assignmentDialog.getByLabel('عنوان المهمة').fill(UI_SPECIFIC_TASK_TITLE);
    await assignmentDialog.getByText('أعضاء محددين', { exact: true }).click();
    await assignmentDialog.locator('label').filter({ hasText: 'Disposable member one' }).getByRole('checkbox').check();
    await assignmentDialog.getByRole('button', { name: 'اعمل المهمة' }).click();
    await expect(assignmentDialog).toHaveCount(0);
    await expect(page.getByText(UI_SPECIFIC_TASK_TITLE, { exact: true })).toBeVisible();
    const specificCard = page.locator('article').filter({ hasText: UI_SPECIFIC_TASK_TITLE }).first();
    await expect(specificCard).toContainText('Disposable member one');
    await expect(specificCard).not.toContainText('Disposable member two');
    const specificRead = await owner.from('tasks').select('id,title,assigned_to,tracking').eq('title', UI_SPECIFIC_TASK_TITLE).limit(2);
    expect(specificRead.error).toBeNull();
    expect(specificRead.data).toHaveLength(1);
    expect(specificRead.data?.[0]?.assigned_to).toEqual([String(firstMember?.id)]);
    expect(Object.keys((specificRead.data?.[0]?.tracking ?? {}) as Record<string, unknown>)).toEqual([String(firstMember?.id)]);
    expect(specificRead.data?.[0]?.tracking).toMatchObject({ [String(firstMember?.id)]: { status: 'pending', note: '', submission_url: '', updated_at: expect.any(String) } });
    await page.screenshot({ path: path.join(evidenceDir, `dashboard-task-specific-${vapidMode}.png`), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(UI_SPECIFIC_TASK_TITLE, { exact: true })).toBeVisible();

    gate.setTaskInsertFailure(UI_FAILURE_TASK_TITLE);
    await page.getByRole('button', { name: 'اعمل مهمة جديدة' }).click();
    assignmentDialog = page.getByRole('dialog', { name: 'تكليف مهمة جديدة' });
    await assignmentDialog.getByLabel('عنوان المهمة').fill(UI_FAILURE_TASK_TITLE);
    await assignmentDialog.getByRole('button', { name: 'اعمل المهمة' }).click();
    await expect(assignmentDialog).toBeVisible();
    await expect(assignmentDialog.getByRole('alert')).toContainText('controlled task insert regression denial');
    const failedRead = await owner.from('tasks').select('id').eq('title', UI_FAILURE_TASK_TITLE).limit(2);
    expect(failedRead.error).toBeNull();
    expect(failedRead.data).toEqual([]);
    expect(gate.pushRequests).toEqual([]);
    gate.setTaskInsertFailure(null);
    await assignmentDialog.getByLabel('عنوان المهمة').fill(UI_RESTORED_TASK_TITLE);
    await assignmentDialog.getByRole('button', { name: 'اعمل المهمة' }).click();
    await expect(assignmentDialog).toHaveCount(0);
    const restoredRead = await owner.from('tasks').select('id').eq('title', UI_RESTORED_TASK_TITLE).limit(2);
    expect(restoredRead.error).toBeNull();
    expect(restoredRead.data).toHaveLength(1);

    await page.getByRole('button', { name: 'اعمل مهمة جديدة' }).click();
    assignmentDialog = page.getByRole('dialog', { name: 'تكليف مهمة جديدة' });
    await expect(assignmentDialog).toBeVisible();
    await assignmentDialog.getByLabel('عنوان المهمة').fill(UI_ALL_TASK_TITLE);
    await assignmentDialog.getByText('كل الفريق', { exact: true }).click();
    await assignmentDialog.getByRole('button', { name: 'اعمل المهمة' }).click();
    await expect(assignmentDialog).toHaveCount(0);
    await expect(page.getByText(UI_ALL_TASK_TITLE, { exact: true })).toBeVisible();
    const allCard = page.locator('article').filter({ hasText: UI_ALL_TASK_TITLE }).first();
    await expect(allCard).toContainText('Disposable member one');
    await expect(allCard).toContainText('Disposable member two');
    const allRead = await owner.from('tasks').select('id,title,assigned_to,tracking').eq('title', UI_ALL_TASK_TITLE).limit(2);
    expect(allRead.error).toBeNull();
    expect(allRead.data).toHaveLength(1);
    expect(allRead.data?.[0]?.assigned_to).toBe('ALL');
    expect(new Set(Object.keys((allRead.data?.[0]?.tracking ?? {}) as Record<string, unknown>))).toEqual(new Set([String(firstMember?.id), String(secondMember?.id)]));
    for (const memberId of [firstMember?.id, secondMember?.id]) {
      expect(allRead.data?.[0]?.tracking).toMatchObject({ [String(memberId)]: { status: 'pending', note: '', submission_url: '', updated_at: expect.any(String) } });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(UI_SPECIFIC_TASK_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(UI_ALL_TASK_TITLE, { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, `dashboard-task-all-persisted-${vapidMode}.png`), fullPage: true });
    expect(gate.pushRequests).toEqual([]);
    await assertCorePage(page, '/admin/notes', /سجل الملاحظات/);
    await expect(page.getByText('Disposable local dashboard note').first()).toBeVisible();
    await assertCorePage(page, '/admin/ranking', /ترتيب الفريق/);
    await expect(page.getByText('Disposable member one').first()).toBeVisible();

    // A genuinely empty authorized database is distinct from any failed query.
    const fixtureNotesDelete = await owner.from('notes').delete().in('text', ['Disposable local dashboard note [B:+12]', 'Disposable local dashboard general note']);
    expect(fixtureNotesDelete.error).toBeNull();
    const approvalNotesDelete = await owner.from('notes').delete().eq('source_task_id', approvedRead.data?.[0]?.id);
    expect(approvalNotesDelete.error).toBeNull();
    const fixtureTasksDelete = await owner.from('tasks').delete().in('title', ['Disposable local dashboard task', UI_SPECIFIC_TASK_TITLE, UI_ALL_TASK_TITLE, UI_RESTORED_TASK_TITLE]);
    expect(fixtureTasksDelete.error).toBeNull();
    const tasksAfterCleanup = await owner.from('tasks').select('id').in('title', ['Disposable local dashboard task', UI_SPECIFIC_TASK_TITLE, UI_ALL_TASK_TITLE, UI_RESTORED_TASK_TITLE]).limit(5);
    expect(tasksAfterCleanup.error).toBeNull();
    expect(tasksAfterCleanup.data).toEqual([]);
    const fixtureMembersDelete = await owner.from('members').delete().in('email', memberEmails);
    expect(fixtureMembersDelete.error).toBeNull();
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-metrics').getByText(new Intl.NumberFormat('ar-EG').format(0), { exact: true }).first()).toBeVisible();
    await expect(page.getByText('لا توجد تكليفات مسندة حتى الآن.')).toBeVisible();
    await expect(page.getByText('سيظهر الاتجاه بعد تسجيل نقاط فعلية.')).toBeVisible();
    // Deleting current tasks/members must not silently erase historical approvals.
    await expect(page.getByTestId('dashboard-contributions').locator('.dashboard-contribution-number')).toHaveText(new Intl.NumberFormat('ar-EG').format(1));

    const injectedTaskErrors = requestEvidence.filter((r) => r.status === 400 && r.method === 'POST' && r.endpoint === '/rest/v1/tasks');
    const unexpectedErrorResponses = requestEvidence.filter((r) => r.status === 401 || (r.status >= 400 && !(r.status === 403 && ['/rest/v1/members', '/rest/v1/tasks', '/rest/v1/notes'].includes(r.endpoint)) && !injectedTaskErrors.includes(r)));
    const specificTask = specificRead.data?.[0];
    const allTask = allRead.data?.[0];
    const specificTracking = Object.keys((specificTask?.tracking ?? {}) as Record<string, unknown>);
    const allTracking = Object.keys((allTask?.tracking ?? {}) as Record<string, unknown>);
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, `dashboard-contract-${vapidMode}.json`), JSON.stringify({
      schema: 'phantoms-dashboard-disposable-evidence/v3',
      runtime: { apiHost: '127.0.0.1', apiPort: Number(new URL(API_ORIGIN).port) },
      vapidMode,
      fixtures: { members: 2, tasks: 4, notes: 2, customFields: 1, pendingInvites: 1 },
      workflows: { seededApprovalPersisted: true, failedTaskInsertVisibleAndNotPersisted: true, restoredUiCreationPersisted: true },
      assignments: {
        specificPersisted: specificRead.data?.length === 1,
        specificAssignedMembers: Array.isArray(specificTask?.assigned_to) ? specificTask.assigned_to.length : 0,
        specificTrackingMembers: specificTracking.length,
        allPersisted: allRead.data?.length === 1,
        allAssignedMembers: allTracking.length,
        allTrackingMembers: allTracking.length,
        visibleAfterReload: true,
        exactTestTasksRemainingAfterCleanup: tasksAfterCleanup.data?.length ?? -1,
      },
      screenshots: screenshots.map(({ theme, viewport }) => ({ theme, viewport })),
      security: { protectedColumnsDenied: true, anonDenied: true, outsiderRows: 0, blockedRemoteRequests: gate.blocked.length, pushRequestsWhileVapidDeferred: gate.pushRequests.length },
      recovery: { controlled403Observed: (['members', 'tasks', 'notes'] as const).every((resource) => gate.getResource403Count(resource) > 0), recoveredWithLiveData: true },
      genuineEmptyStateVerified: true,
      pageErrorCount: pageErrors.length,
      requests: {
        total: requestEvidence.length,
        successfulMemberSelects: requestEvidence.filter((r) => r.endpoint === '/rest/v1/members' && r.status === 200 && r.columns === SAFE_MEMBER_COLUMNS).length,
        injectedTaskInsertFailures: injectedTaskErrors.length,
        unexpectedErrorResponses: unexpectedErrorResponses.length,
      },
      mobileUI: {
        cases: mobileCoverage,
        longArabicNamePersistedFromDatabase: true,
        longArabicNameWrapped: mobileCoverage.length === 4,
        noHorizontalOverflow: true,
      },
    }, null, 2) + '\n', { encoding: 'utf8' });
    expect(gate.blocked).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(injectedTaskErrors).toHaveLength(1);
    expect(unexpectedErrorResponses).toEqual([]);
    await owner.auth.signOut();
  });
});
