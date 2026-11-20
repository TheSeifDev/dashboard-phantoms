#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(frontend, '..');
const workdir = process.env.PHANTOMS_LOCAL_WORKDIR;
const projectId = process.env.PHANTOMS_LOCAL_PROJECT_ID;
const networkId = process.env.PHANTOMS_LOCAL_NETWORK_ID;
const forbidden = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'SUPABASE_JWT_SECRET', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
if (process.env.PHANTOMS_DISPOSABLE_E2E !== '1' || !workdir?.startsWith('/tmp/phantoms-web-projects-local.') || !/^phantoms-disposable-\d+$/.test(projectId ?? '') || !networkId) throw new Error('Refusing non-owned, non-disposable target.');
for (const name of forbidden) if (process.env[name]) throw new Error(`Refusing credential variable ${name}.`);
if (existsSync(path.join(frontend, '.env.local')) || existsSync(path.join(workdir, 'supabase/.temp/project-ref'))) throw new Error('Refusing configured/linked target.');
const config = readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8');
assert.ok(config.includes(`project_id = "${projectId}"`));
const parsed = {};
const raw = execFileSync('supabase', ['status', '--workdir', workdir, '--network-id', networkId, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
for (const line of raw.split('\n')) { const match = line.match(/^([A-Z_]+)="(.*)"$/); if (match) parsed[match[1]] = match[2]; }
const api = parsed.API_URL;
const db = parsed.DB_URL;
const anon = parsed.ANON_KEY;
const service = parsed.SERVICE_ROLE_KEY;
for (const [url, port, protocol] of [[api, process.env.PHANTOMS_LOCAL_API_PORT, 'http:'], [db, process.env.PHANTOMS_LOCAL_DB_PORT, 'postgresql:']]) {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, port);
  assert.ok(target.protocol === protocol || (protocol === 'postgresql:' && target.protocol === 'postgres:'));
}
assert.ok(anon && service);
const inspect = JSON.parse(execFileSync('docker', ['inspect', `supabase_db_${projectId}`], { encoding: 'utf8' }))[0];
assert.equal(inspect.Config.Image, 'public.ecr.aws/supabase/postgres:17.11.0.018');
for (const binds of Object.values(inspect.NetworkSettings.Ports ?? {})) for (const bind of binds ?? []) assert.ok(['127.0.0.1', '::1'].includes(bind.HostIp));
const password = `Wp-Local-${randomBytes(16).toString('hex')}!`;
const secrets = [anon, service, password];
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const operator = createClient(api, service, options);
const checks = [];
const output = path.join(root, 'web-projects-evidence');
mkdirSync(output, { recursive: true });
let vite;
let browser;
function redact(message) { let text = String(message); for (const value of secrets) if (value) text = text.replaceAll(value, '[redacted]'); return text.replace(/eyJ[\w.-]{20,}/g, '[redacted-token]'); }
async function ok(request) { const result = await request; if (result.error) throw new Error(redact(result.error.message)); return result.data; }
async function denied(request) { const result = await request; assert.ok(result.error, 'unauthorized/invalid operation must be rejected'); }
async function check(name, fn) { await fn(); checks.push({ name, passed: true }); console.log(`PASS: ${name}`); }
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) { return execFileSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
async function actor(name, owner = false) {
  const email = `${name}-${randomBytes(4).toString('hex')}@phantoms-test.example`;
  const created = await ok(operator.auth.admin.createUser({ email, password, email_confirm: true }));
  const uid = created.user.id;
  const id = Number(sql(`INSERT INTO public.members(email,full_name,work_status,completion_rank) VALUES (${quote(email)},${quote(`WP Test ${name}`)},'active',0) RETURNING id;`));
  sql(`INSERT INTO public.member_auth_bindings(member_id,auth_user_id,normalized_email,password_ready) VALUES (${id},${quote(uid)}::uuid,${quote(email)},true);`);
  if (owner) sql(`INSERT INTO public.admin_accounts(user_id,role,permissions) VALUES (${quote(uid)}::uuid,'owner','{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb);`);
  const client = createClient(api, anon, options);
  await ok(client.auth.signInWithPassword({ email, password }));
  return { id, uid, email, client };
}
try {
  const owner = await actor('owner', true);
  const lead = await actor('lead');
  const contributor = await actor('contributor');
  const outsider = await actor('outsider');
  const viewer = await actor('viewer');
  let ideaId; let webProjectId; let milestoneId; let taskId; let sprintId; let reportId;
  await check('Real Auth identities resolve to canonical PHANTOMS members', async () => {
    const access = await ok(owner.client.rpc('get_admin_access')); assert.equal(access.is_owner, true); assert.equal(access.permissions.web_projects, true);
  });
  await check('Idea review/conversion preserves source and is idempotent', async () => {
    const idea = await ok(lead.client.from('web_ideas').insert({ title: 'Live Project Acceptance', short_description: 'A persisted local product', problem_statement: 'Verify product execution', proposed_solution: 'A real module', submitted_by_member_id: lead.id }).select('id').single());
    ideaId = idea.id;
    await ok(owner.client.rpc('web_review_idea', { p_idea_id: ideaId, p_decision: 'under_review', p_notes: 'Initial review' }));
    await ok(owner.client.rpc('web_review_idea', { p_idea_id: ideaId, p_decision: 'approved', p_notes: 'Approved with recorded ownership terms' }));
    webProjectId = await ok(owner.client.rpc('web_convert_idea_to_project', { p_idea_id: ideaId, p_project_slug: `live-acceptance-${randomBytes(4).toString('hex')}`, p_lead_member_id: lead.id }));
    const repeated = await ok(owner.client.rpc('web_convert_idea_to_project', { p_idea_id: ideaId, p_project_slug: 'duplicate-must-not-create', p_lead_member_id: lead.id }));
    assert.equal(repeated, webProjectId);
    const project = await ok(owner.client.from('web_projects').select('source_idea_id,origin_submitter_member_id,description').eq('id', webProjectId).single()); assert.equal(project.source_idea_id, ideaId); assert.equal(project.origin_submitter_member_id, lead.id);
  });
  await check('Versioned agreement gates work access and keeps opt-in rights off', async () => {
    const version = await ok(owner.client.rpc('web_amend_project_agreement', { p_project_id: webProjectId, p_ownership_model: 'creator_owned', p_ownership_notes: 'Contributors retain their original rights.', p_license_name: 'MIT', p_attribution_notes: 'Credit all contributors', p_terms: { technical_support: 'Mentorship, not ownership' } }));
    await ok(lead.client.rpc('web_accept_project_agreement', { p_project_id: webProjectId, p_version: version }));
    await ok(lead.client.rpc('web_add_project_member', { p_project_id: webProjectId, p_member_id: contributor.id, p_role: 'contributor', p_responsibility: 'Frontend implementation' }));
    assert.deepEqual(await ok(contributor.client.from('web_project_tasks').select('id').eq('project_id', webProjectId)), []);
    const invites = await ok(contributor.client.rpc('web_list_my_project_invitations')); assert.equal(invites[0].project_id, webProjectId);
    await ok(contributor.client.rpc('web_accept_project_agreement', { p_project_id: webProjectId, p_version: version }));
    await ok(lead.client.rpc('web_add_project_member', { p_project_id: webProjectId, p_member_id: viewer.id, p_role: 'viewer', p_responsibility: 'Read-only review' }));
    await ok(viewer.client.rpc('web_accept_project_agreement', { p_project_id: webProjectId, p_version: version }));
    await ok(lead.client.rpc('web_set_project_status', { p_project_id: webProjectId, p_status: 'active' }));
    const project = await ok(lead.client.from('web_projects').select('phantoms_brand_permission,public_showcase_permission').eq('id', webProjectId).single()); assert.equal(project.phantoms_brand_permission, false); assert.equal(project.public_showcase_permission, false);
  });
  await check('Leader creates real milestones, sprint and assigned project work', async () => {
    const milestone = await ok(lead.client.from('web_project_milestones').insert({ project_id: webProjectId, title: 'Engineering milestone', phase: 'Build', start_date: '2026-11-01', due_date: '2026-11-30', created_by_auth_user_id: lead.uid }).select('id').single()); milestoneId = milestone.id;
    const second = await ok(lead.client.from('web_project_milestones').insert({ project_id: webProjectId, title: 'Product release', phase: 'Release', start_date: '2026-12-01', due_date: '2026-12-15', created_by_auth_user_id: lead.uid }).select('id').single());
    await ok(lead.client.from('web_project_milestone_dependencies').insert({ project_id: webProjectId, milestone_id: second.id, depends_on_milestone_id: milestoneId, created_by_auth_user_id: lead.uid }));
    await denied(lead.client.from('web_project_milestone_dependencies').insert({ project_id: webProjectId, milestone_id: milestoneId, depends_on_milestone_id: second.id, created_by_auth_user_id: lead.uid }));
    const sprint = await ok(lead.client.from('web_project_sprints').insert({ project_id: webProjectId, name: 'Sprint 01', goal: 'Ship the independent workspace', starts_on: '2026-11-16', ends_on: '2026-11-30', created_by_auth_user_id: lead.uid }).select('id').single()); sprintId = sprint.id;
    const task = await ok(lead.client.from('web_project_tasks').insert({ project_id: webProjectId, title: 'Implement real project workflow', description: 'Persisted task used by live acceptance', reporter_member_id: lead.id, milestone_id: milestoneId, sprint_id: sprintId, due_date: '2026-11-30', created_by_auth_user_id: lead.uid }).select('id').single()); taskId = task.id;
    await ok(lead.client.from('web_project_task_assignees').insert({ project_id: webProjectId, task_id: taskId, member_id: contributor.id, is_primary: true, assigned_by_auth_user_id: lead.uid }));
    await ok(lead.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'todo' }));
  });
  await check('Assigned contributor transitions, comments and evidence are persisted', async () => {
    await ok(contributor.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'in_progress', p_comment: 'Started engineering work' }));
    await ok(contributor.client.from('web_project_task_comments').insert({ project_id: webProjectId, task_id: taskId, author_member_id: contributor.id, author_auth_user_id: contributor.uid, body: 'Implementation is ready for review.' }));
    await ok(contributor.client.from('web_project_task_attachments').insert({ project_id: webProjectId, task_id: taskId, uploaded_by_member_id: contributor.id, title: 'Engineering reference', external_url: 'https://example.com/evidence' }));
    await ok(contributor.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'in_review' }));
    await ok(lead.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'done', p_comment: 'Verified by the project lead' }));
    const task = await ok(contributor.client.from('web_project_tasks').select('status').eq('id', taskId).single()); assert.equal(task.status, 'done');
  });
  await check('Weekly report and verified deliverable review use actual records', async () => {
    reportId = await ok(contributor.client.rpc('web_submit_member_report', { p_project_id: webProjectId, p_period_start: '2026-11-16', p_period_end: '2026-11-22', p_completed_this_week: 'Completed product workflow', p_working_on: 'Review feedback', p_next_week_plan: 'Prepare release', p_deliverables_complete: true, p_blockers: 'None', p_support_needed: false }));
    await ok(lead.client.rpc('web_review_member_report', { p_report_id: reportId, p_status: 'reviewed', p_review_notes: 'Evidence verified', p_blocker_escalated: false }));
    const item = await ok(contributor.client.from('web_project_deliverables').insert({ project_id: webProjectId, milestone_id: milestoneId, task_id: taskId, submitted_by_member_id: contributor.id, title: 'Verified implementation', evidence: ['https://example.com/deliverable'], status: 'submitted', submitted_at: new Date().toISOString() }).select('id').single());
    await ok(lead.client.from('web_project_deliverables').update({ status: 'accepted', reviewed_by_auth_user_id: lead.uid, reviewed_at: new Date().toISOString(), review_notes: 'Accepted after review' }).eq('id', item.id));
    assert.equal((await ok(contributor.client.from('web_project_member_reports').select('status').eq('id', reportId).single())).status, 'reviewed');
  });
  await check('Outsiders, viewers and project roles cannot acquire unrelated/Team admin access', async () => {
    assert.deepEqual(await ok(outsider.client.from('web_projects').select('id').eq('id', webProjectId)), []);
    assert.deepEqual(await ok(outsider.client.from('web_project_tasks').select('id').eq('id', taskId)), []);
    await denied(outsider.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'in_progress' }));
    await denied(viewer.client.rpc('web_transition_project_task', { p_task_id: taskId, p_to_status: 'in_progress' }));
    assert.deepEqual(await ok(viewer.client.from('web_project_member_reports').select('id').eq('project_id', webProjectId)), []);
    const access = await ok(lead.client.rpc('get_admin_access')); assert.equal(access.is_admin, false); assert.equal(access.is_team_admin, false);
  });
  const previewPort = Number(process.env.PHANTOMS_LOCAL_PREVIEW_PORT);
  assert.ok(previewPort >= 1024 && previewPort <= 65535);
  const origin = `http://127.0.0.1:${previewPort}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', VITE_SUPABASE_URL: api, VITE_SUPABASE_ANON_KEY: anon, VITE_PUBLIC_WEB_URL: origin, VITE_VAPID_PUBLIC_KEY: 'local-disabled' };
  vite = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], { cwd: frontend, env, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt += 1) { if (vite.exitCode !== null) throw new Error('Owned Vite exited before readiness.'); try { const response = await fetch(`${origin}/manus-routes.json`); if (response.ok && (await response.json()).routes) break; } catch {} if (attempt === 99) throw new Error('Owned Vite did not become ready.'); await new Promise((resolve) => setTimeout(resolve, 300)); }
  browser = await chromium.launch({ headless: true });
  await check('Actual admin browser opens all workspace tabs without runtime errors', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(() => { localStorage.setItem('phantoms_locale', 'en'); localStorage.setItem('phantoms_theme', 'dark'); });
    const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(redact(error.message)));
    await page.goto(`${origin}/admin/login`); await page.locator('#admin-email').fill(owner.email); await page.locator('#admin-password').fill(password); await page.getByRole('button', { name: 'Open administrator workspace', exact: true }).click(); await page.waitForURL(/\/admin\/(?!login)/);
    await page.goto(`${origin}/admin/web-projects`); await page.getByRole('heading', { name: 'Web Projects', exact: true }).waitFor(); await page.getByText('Live Project Acceptance', { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(output, 'overview-en-desktop.png'), fullPage: true });
    for (const tab of ['overview', 'timeline', 'agile', 'tasks', 'team', 'reports', 'resources', 'settings']) { await page.goto(`${origin}/admin/web-projects/projects/${webProjectId}?tab=${tab}`); await page.getByRole('heading', { name: 'Live Project Acceptance', exact: true }).waitFor(); await page.waitForTimeout(300); }
    assert.deepEqual(errors, []);
    await page.goto(`${origin}/admin/web-projects/projects/${webProjectId}?tab=timeline`); await page.getByText('Engineering milestone', { exact: true }).first().waitFor(); await page.screenshot({ path: path.join(output, 'timeline-en-desktop.png'), fullPage: true });
    await page.goto(`${origin}/admin/web-projects/projects/${webProjectId}?tab=agile`); await page.getByText('Implement real project workflow', { exact: true }).first().waitFor(); await page.screenshot({ path: path.join(output, 'agile-en-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${origin}/admin/web-projects`); await page.getByText('Live Project Acceptance', { exact: true }).first().waitFor(); await page.screenshot({ path: path.join(output, 'overview-en-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile document must not overflow');
    await page.evaluate(() => { localStorage.setItem('phantoms_locale', 'ar'); localStorage.setItem('phantoms_theme', 'light'); }); await page.reload(); await page.getByRole('heading', { name: 'مشروعات الويب', exact: true }).waitFor(); assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); await page.screenshot({ path: path.join(output, 'overview-ar-mobile.png'), fullPage: true });
    await context.close();
  });
  await check('Actual member browser reuses existing member login and assigned project workload', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.setItem('phantoms_locale', 'en'));
    const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(redact(error.message)));
    await page.goto(`${origin}/login`); await page.locator('#member-email').fill(contributor.email); await page.locator('input[type="password"]').fill(password); await page.getByRole('button', { name: 'Sign in to the member portal', exact: true }).click(); await page.waitForURL(/\/portal/);
    await page.goto(`${origin}/portal/projects`); await page.getByRole('heading', { name: 'My projects & contributions', exact: true }).waitFor(); await page.getByRole('heading', { name: 'Live Project Acceptance', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'member-en-mobile.png'), fullPage: true });
    await page.goto(`${origin}/portal/projects/${webProjectId}?tab=tasks`); await page.getByText('Implement real project workflow', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await context.close();
  });
  writeFileSync(path.join(output, 'live-results.json'), `${JSON.stringify({ schema: 'phantoms-web-projects-local/v1', boundary: 'disposable-loopback-only', pg17: true, passed: true, checks, fixtureCleanup: 'enclosing-owned-stack-destruction-required' }, null, 2)}\n`);
} catch (error) {
  writeFileSync(path.join(output, 'live-results.json'), `${JSON.stringify({ schema: 'phantoms-web-projects-local/v1', boundary: 'disposable-loopback-only', passed: false, checks, failure: redact(error instanceof Error ? error.message : error), fixtureCleanup: 'enclosing-owned-stack-destruction-required' }, null, 2)}\n`);
  console.error(redact(error instanceof Error ? error.message : error)); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (vite && vite.exitCode === null) { vite.kill('SIGTERM'); await new Promise((resolve) => { const timer = setTimeout(() => { vite.kill('SIGKILL'); resolve(); }, 5000); vite.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
}
