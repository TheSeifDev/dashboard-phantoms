import { expect, test, type Page, type Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADMIN_MEMBER_COLUMNS } from '../src/features/members/memberColumns';
import { formatSigned } from '../src/lib/arabic';

const apiPort = process.env.PHANTOMS_LOCAL_API_PORT ?? '54321';
const previewPort = process.env.PHANTOMS_LOCAL_PREVIEW_PORT ?? '4173';
if (![apiPort, previewPort].every((port) => /^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535)) throw new Error('Invalid disposable loopback ports.');
const API_ORIGIN = `http://127.0.0.1:${apiPort}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${previewPort}`;
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
  await expect(page.getByText('مركز عمليات PHANTOMS')).toBeVisible();
}

function requestIsAllowed(url: URL): boolean {
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (url.origin === PREVIEW_ORIGIN) return true;
  if (url.origin === API_ORIGIN) return true;
  // The app already declares these font assets; they are the only remote assets permitted.
  return url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
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

    const [tasksRead, notesRead, customFieldsRead, invitesRead] = await Promise.all([
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
    expect(invitesRead.error).toBeNull();
    expect(invitesRead.data?.length).toBeGreaterThanOrEqual(1);

    const { data: invalidInvite, error: invalidInviteError } = await anon.rpc('get_member_invite_context', { p_token: 'not-a-real-reserved-domain-invite-token-000000' });
    expect(invalidInviteError).toBeNull();
    expect(invalidInvite).toMatchObject({ valid: false });

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
    await expect(page.getByTestId('dashboard-metrics').getByText('2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Disposable local dashboard task').first()).toBeVisible();
    await expect(page.getByText('Disposable owner ضاف ملاحظة لـ Disposable member one').first()).toBeVisible();
    await expect(page.getByText(formatSigned(12), { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets').locator('li').filter({ hasText: 'تحت المراجعة' }).first()).toBeVisible();
    await expect(page.getByTestId('dashboard-widgets').locator('li').filter({ hasText: 'متأخر' }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    for (const table of ['members', 'tasks', 'notes']) {
      expect(requestEvidence.some((r) => r.endpoint === `/rest/v1/${table}` && r.status === 200)).toBe(true);
    }
    expect(requestEvidence.some((r) => r.endpoint === '/rest/v1/members' && r.columns === SAFE_MEMBER_COLUMNS && r.status === 200)).toBe(true);

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
      await expect(page.getByTestId('dashboard-metrics').getByText('2', { exact: true }).first()).toBeVisible();
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

    await assertCorePage(page, '/admin/members', /دليل الأعضاء/);
    await expect(page.getByText('Disposable member one')).toBeVisible();
    await page.getByRole('button', { name: 'Disposable member one', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Projection verification');
    await page.keyboard.press('Escape');
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
    await expect(page.getByTestId('dashboard-metrics').getByText('0', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('مفيش تكليفات لسه')).toBeVisible();
    await expect(page.getByText('لسه مفيش بونص متسجل')).toBeVisible();

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, `dashboard-contract-${vapidMode}.json`), JSON.stringify({
      schema: 'phantoms-dashboard-disposable-evidence/v2',
      localApi: API_ORIGIN,
      vapidMode,
      fixtures: { members: 2, tasks: 4, notes: 2, customFields: 1, pendingInvites: 1 },
      workflows: { seededApprovalPersisted: true, failedTaskInsertVisibleAndNotPersisted: true, restoredUiCreationPersisted: true },
      assignments: { specific: specificRead.data?.[0], all: allRead.data?.[0], visibleAfterReload: true, exactTestTasksRemainingAfterCleanup: tasksAfterCleanup.data?.length },
      screenshots: screenshots.map(({ theme, viewport, path: screenshotPath }) => ({ theme, viewport, path: screenshotPath })),
      security: { protectedColumnsDenied: true, anonDenied: true, outsiderRows: 0, blockedRemoteRequests: gate.blocked.length, pushRequestsWhileVapidDeferred: gate.pushRequests.length },
      recovery: { controlled403Observed: (['members', 'tasks', 'notes'] as const).every((resource) => gate.getResource403Count(resource) > 0), recoveredWithLiveData: true },
      genuineEmptyStateVerified: true,
      pageErrorCount: pageErrors.length,
      requests: requestEvidence,
    }, null, 2) + '\n', { encoding: 'utf8' });
    expect(gate.blocked).toEqual([]);
    expect(pageErrors).toEqual([]);
    const injectedTaskErrors = requestEvidence.filter((r) => r.status === 400 && r.method === 'POST' && r.endpoint === '/rest/v1/tasks');
    expect(injectedTaskErrors).toHaveLength(1);
    expect(requestEvidence.filter((r) => r.status === 401 || r.status >= 400 && !(r.status === 403 && ['/rest/v1/members', '/rest/v1/tasks', '/rest/v1/notes'].includes(r.endpoint)) && !injectedTaskErrors.includes(r))).toEqual([]);
    await owner.auth.signOut();
  });
});
