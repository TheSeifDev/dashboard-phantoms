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
const SAFE_MEMBER_COLUMNS = ADMIN_MEMBER_COLUMNS;
const ownerEmail = process.env.PHANTOMS_DASHBOARD_OWNER_EMAIL ?? '';
const ownerPassword = process.env.PHANTOMS_DASHBOARD_OWNER_PASSWORD ?? '';
const outsiderEmail = process.env.PHANTOMS_DASHBOARD_OUTSIDER_EMAIL ?? '';
const outsiderPassword = process.env.PHANTOMS_DASHBOARD_OUTSIDER_PASSWORD ?? '';
const memberEmails = [
  process.env.PHANTOMS_DASHBOARD_MEMBER_ONE_EMAIL ?? '',
  process.env.PHANTOMS_DASHBOARD_MEMBER_TWO_EMAIL ?? '',
];
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const evidenceDir = path.resolve('test-results');

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

async function installRequestGate(page: Page): Promise<{ blocked: string[]; setResource403: (resource: 'members' | 'tasks' | 'notes', value: boolean) => void; getResource403Count: (resource: 'members' | 'tasks' | 'notes') => number }> {
  const blocked: string[] = [];
  const failures = { members: false, tasks: false, notes: false };
  const failureCounts = { members: 0, tasks: 0, notes: 0 };
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (!requestIsAllowed(url)) {
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
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
    setResource403: (resource, value) => { failures[resource] = value; },
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
    await expect(page.getByText('+12', { exact: true }).first()).toBeVisible();
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
        const screenshotPath = path.join(evidenceDir, `dashboard-${theme}-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshots.push({ theme, viewport: viewport.name, path: screenshotPath });
      }
    }

    await assertCorePage(page, '/admin/members', /دليل الأعضاء/);
    await expect(page.getByText('Disposable member one')).toBeVisible();
    await page.getByRole('button', { name: 'Disposable member one' }).click();
    await expect(page.getByRole('dialog')).toContainText('Projection verification');
    await page.keyboard.press('Escape');
    await assertCorePage(page, '/admin/tasks', /إدارة وتكليف المهام/);
    await expect(page.getByText('Disposable local dashboard task').first()).toBeVisible();
    await assertCorePage(page, '/admin/notes', /سجل الملاحظات/);
    await expect(page.getByText('Disposable local dashboard note').first()).toBeVisible();
    await assertCorePage(page, '/admin/ranking', /ترتيب الفريق/);
    await expect(page.getByText('Disposable member one').first()).toBeVisible();

    // A genuinely empty authorized database is distinct from any failed query.
    const fixtureNotesDelete = await owner.from('notes').delete().in('text', ['Disposable local dashboard note [B:+12]', 'Disposable local dashboard general note']);
    expect(fixtureNotesDelete.error).toBeNull();
    const fixtureTasksDelete = await owner.from('tasks').delete().eq('title', 'Disposable local dashboard task');
    expect(fixtureTasksDelete.error).toBeNull();
    const fixtureMembersDelete = await owner.from('members').delete().in('email', memberEmails);
    expect(fixtureMembersDelete.error).toBeNull();
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-metrics').getByText('0', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('مفيش تكليفات لسه')).toBeVisible();
    await expect(page.getByText('لسه مفيش بونص متسجل')).toBeVisible();

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, 'dashboard-contract.json'), JSON.stringify({
      schema: 'phantoms-dashboard-disposable-evidence/v1',
      localApi: API_ORIGIN,
      fixtures: { members: 2, tasks: 1, notes: 2, customFields: 1, pendingInvites: 1 },
      screenshots: screenshots.map(({ theme, viewport }) => ({ theme, viewport })),
      security: { protectedColumnsDenied: true, anonDenied: true, outsiderRows: 0, blockedRemoteRequests: gate.blocked.length },
      recovery: { controlled403Observed: (['members', 'tasks', 'notes'] as const).every((resource) => gate.getResource403Count(resource) > 0), recoveredWithLiveData: true },
      genuineEmptyStateVerified: true,
      pageErrorCount: pageErrors.length,
      requests: requestEvidence,
    }, null, 2) + '\n', { encoding: 'utf8' });
    expect(gate.blocked).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(requestEvidence.filter((r) => r.status === 401 || r.status >= 400 && !(r.status === 403 && ['/rest/v1/members', '/rest/v1/tasks', '/rest/v1/notes'].includes(r.endpoint)))).toEqual([]);
    await owner.auth.signOut();
  });
});
