#!/usr/bin/env node
/** Mounted real React pages + real profile/recovery parsers; mocked transport only.
 * No server, Auth account, outbound request or persistent recovery session exists.
 */
import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(frontend, 'package.json'));
const tooling = process.env.PHANTOMS_AUTH_TEST_TOOLING ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json')) : require;
const { JSDOM } = tooling('jsdom');
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/member/recovery', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { MemoryRouter, Routes, Route, useLocation } = require('react-router-dom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const ts = require('typescript');
const el = React.createElement;
const EMAIL = 'member@mounted-fixture.phantoms.dev';
const PASSWORD = 'CorrectHorseRecovery9';
const callbackCode = 'PkceCode_' + 'a'.repeat(15);
const callbackUrl = '/member/recovery?code=' + callbackCode;
const VERIFIER_KEY = 'phantoms-member-recovery-pkce-v1';
const listeners = new Set();
let control;
const store = {
  useAuthStore(selector) {
    return selector(React.useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => control.state, () => control.state));
  },
  getDeviceToken: () => control.device,
};
store.useAuthStore.getState = () => control.state;
function setMember(member) { control.state = { ...control.state, currentMember: member }; for (const listener of listeners) listener(); }
function reset() {
  window.history.replaceState({}, '', '/member/recovery');
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('admin-session-sentinel', 'unchanged-admin-session');
  sessionStorage.setItem('member-session-sentinel', 'unchanged-member-session');
  control = { lang: 'en', device: 'mounted-device', state: { currentMember: { id: 42, email: EMAIL, full_name: 'Member', auth_user_id: 'fixture-user' }, user: { id: 'admin-sentinel' }, setMember }, rpcCalls: [], invokes: [], clients: [], fetchCalls: [], recoveryRpcCalls: [], signsOut: 0, mediaReverts: 0 };
  control.profileRpc = async (name) => (name === 'get_member_password_access'
    ? { data: { member_id: 42, email: EMAIL, auth_user_id: 'fixture-user', active: true, password_ready: true, must_change_password: false }, error: null }
    : { data: snapshot(), error: null });
  control.invoke = async () => ({ data: { ok: true, membership: 'active' }, error: null });
  control.recoveryRpc = async () => ({ data: true, error: null });
  control.recoveryAuth = async () => ({ data: { session: { user: { id: 'recovery-user' } } }, error: null });
  control.getUser = async () => ({ data: { user: { id: 'recovery-user', email: EMAIL } }, error: null });
  control.fetchResponse = () => new Response(JSON.stringify({ access_token: 'access-fixture', refresh_token: 'refresh-fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
globalThis.fetch = async (input, init = {}) => {
  control.fetchCalls.push({
    url: String(input), method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: init.body,
  });
  return control.fetchResponse();
};
function snapshot(complete = false, extra = {}) {
  return { member_id: 42, email: EMAIL, full_name: 'Member', phone: '+201112223333', academic_number: complete ? '00123' : null, academic_group: complete ? 'G-1' : null, specialization: complete ? 'software' : null, university_email: complete ? '00123@batechu.com' : null, linkedin_url: complete ? 'https://www.linkedin.com/in/member' : null, portfolio_url: complete ? 'https://github.com/member' : null, residence: complete ? 'Cairo' : null, work_conditions: complete ? 'Remote' : null, bio: complete ? 'Frontend member' : null, device: complete ? 'لابتوب' : null, gender: complete ? 'ذكر' : null, profile_complete: complete, missing_fields: complete ? [] : ['academicNumber', 'academicGroup', 'specialization', 'residence', 'workConditions', 'bio', 'device', 'gender', 'linkedinUrl', 'portfolioUrl'], ...extra };
}
function deferred() { let resolvePromise; const promise = new Promise((r) => { resolvePromise = r; }); return { promise, resolve: resolvePromise }; }
const memberClient = { rpc: async (name, args) => { control.rpcCalls.push({ name, args }); return control.profileRpc(name, args); }, functions: { invoke: async (name, args) => { control.invokes.push({ name, ...args }); return control.invoke(name, args); } } };
function ephemeralClient(url, key, options) {
  const client = { auth: {
    verifyOtp: async (args) => { control.clients.at(-1).verifies.push(args); return control.recoveryAuth(args); },
    setSession: async (args) => { control.clients.at(-1).sets.push(args); return control.recoveryAuth(args); },
    getUser: async () => { control.clients.at(-1).getUsers = (control.clients.at(-1).getUsers ?? 0) + 1; return control.getUser(); },
    signOut: async (args) => { assert.deepEqual(args, { scope: 'local' }); control.signsOut++; return { error: null }; },
  }, rpc: async (name) => { assert.equal(name, 'member_password_self_recovery_access'); control.recoveryRpcCalls.push(name); return control.recoveryRpc(); }, functions: memberClient.functions };
  control.clients.push({ options, verifies: [], sets: [], getUsers: 0, client }); return client;
}
const mocks = {
  'store/auth.ts': store,
  'lib/supabase/member-client.ts': { memberSupabase: memberClient },
  'features/auth/auth-flow.ts': { normalizeAuthEmail: (email) => String(email ?? '').trim().toLowerCase() },
  'lib/validators.ts': { isValidEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) },
  'i18n/useLocale.ts': { useLocale: () => ({ t: (ar, en) => control.lang === 'ar' ? ar : en, dir: control.lang === 'ar' ? 'rtl' : 'ltr' }) },
  'components/layout/AuthShell.tsx': { AuthShell: ({ title, description, children, footer }) => el('section', null, el('h1', null, title), el('p', null, description), children, footer) },
  'components/motion/PhantomLoader.tsx': { PhantomLoader: ({ message }) => el('div', { role: 'status' }, message) },
  'components/ui/ErrorState.tsx': { ErrorState: ({ message, onRetry }) => el('div', { role: 'alert' }, message, el('button', { onClick: onRetry }, 'Retry')) },
  'components/ui/Button.tsx': { Button: ({ isLoading, loadingText, icon: _icon, children, ...props }) => el('button', props, isLoading ? loadingText : children) },
  'features/portal/PortalHeader.tsx': { PortalHeader: ({ onLogout }) => el('header', null, el('button', { onClick: onLogout }, 'Sign out')) },
  'features/auth/MemberAccessGuard.tsx': { cleanupMemberState: async () => setMember(null) },
};
const actual = new Set(['features/members/profile-fields.ts', 'features/members/MemberProfileFields.tsx', 'features/members/MissingProfileFields.tsx', 'features/members/profile-api.ts', 'features/members/MemberSettingsPage.tsx', 'features/members/MemberPasswordCard.tsx', 'features/auth/member-password-access.ts', 'features/auth/member-password-change-api.ts', 'features/members/MemberProfileCompletionGuard.tsx', 'features/auth/member-password.ts', 'features/auth/member-recovery.ts', 'features/auth/member-recovery-api.ts', 'features/auth/MemberRecoveryPage.tsx', 'features/auth/MemberForgotPasswordPage.tsx']);
const modules = new Map();
function sourcePath(path) { return [path, path + '.ts', path + '.tsx'].find(existsSync) ?? path; }
function load(path) {
  const file = sourcePath(resolve(frontend, 'src', path));
  const key = relative(join(frontend, 'src'), file);
  if (mocks[key]) return mocks[key];
  if (modules.has(file)) return modules.get(file).exports;
  assert.ok(actual.has(key), 'Unexpected module: ' + key);
  const module = new Module(file); modules.set(file, module); module.filename = file;
  module.require = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.')) return load(resolve(dirname(file), specifier));
    if (specifier === '@supabase/supabase-js') return { createClient: ephemeralClient };
    if (specifier === 'gsap') return { gsap: { matchMedia: () => ({ add: (_, callback) => callback({ conditions: { reduced: true } }), revert: () => control.mediaReverts++ }), from: () => {} } };
    return require(specifier);
  };
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
  module._compile(ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
  return module.exports;
}
reset();
const Settings = load('features/members/MemberSettingsPage.tsx').default;
const { MemberProfileCompletionGuard: Guard } = load('features/members/MemberProfileCompletionGuard.tsx');
const Recovery = load('features/auth/MemberRecoveryPage.tsx').default;
const Forgot = load('features/auth/MemberForgotPasswordPage.tsx').default;
const profileApi = load('features/members/profile-api.ts');
const recoveryApi = load('features/auth/member-recovery-api.ts');
const { parseMemberRecoveryLocation: parseCallback } = load('features/auth/member-recovery.ts');
let root, cache;
async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); }
async function mount(component, path = '/portal/settings', beforeMount) {
  reset(); if (beforeMount) beforeMount();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(el(QueryClientProvider, { client: cache }, el(MemoryRouter, { initialEntries: [path] }, component))));
  await settle();
}
async function unmount() { if (root) await act(async () => root.unmount()); root = null; cache?.clear(); await settle(); }
const text = () => document.body.textContent;
const query = (id) => document.getElementById(id);
async function change(id, value) {
  const node = query(id); assert.ok(node, id);
  const prototype = node.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function submitTwice() { await act(async () => { const form = document.querySelector('form'); assert.ok(form); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); }
async function fillRequired() {
  await change('settings-academic-number', '٠٠۱۲۳');
  await change('settings-academic-group', 'G-1');
  await change('settings-specialization', 'software');
  await change('settings-residence', 'Cairo');
  await change('settings-device', 'لابتوب');
  await change('settings-gender', 'ذكر');
  await change('settings-work-conditions', 'Remote, evenings');
  await change('settings-bio', 'Frontend member');
  await change('settings-linkedin-url', 'https://www.linkedin.com/in/member');
  await change('settings-portfolio-url', 'https://github.com/member');
}
function assertStorage() { assert.equal(localStorage.getItem('admin-session-sentinel'), 'unchanged-admin-session'); assert.equal(sessionStorage.getItem('member-session-sentinel'), 'unchanged-member-session'); assert.equal(localStorage.length, 1); assert.equal(sessionStorage.length, 1); }
function seedVerifier(verifier = '0123456789abcdef'.repeat(4), createdAt = Date.now()) { localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, createdAt })); }
function assertStorageWithRecoveryVerifier() { assert.equal(localStorage.getItem('admin-session-sentinel'), 'unchanged-admin-session'); assert.equal(sessionStorage.getItem('member-session-sentinel'), 'unchanged-member-session'); assert.equal(localStorage.getItem(VERIFIER_KEY) !== null, true); assert.equal(localStorage.length, 2); assert.equal(sessionStorage.length, 1); }
async function challengeFor(verifier) { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); return Buffer.from(digest).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function Location() { const location = useLocation(); return el('output', null, location.pathname); }
after(async () => { await unmount(); dom.window.close(); });
afterEach(unmount);

test('old incomplete member redirects to Settings without rendering workspace', async () => {
  await mount(el(Routes, null, el(Route, { path: '/portal', element: el(Guard, null, el('div', null, 'SECRET WORKSPACE')) }), el(Route, { path: '/portal/settings', element: el(Location) })), '/portal');
  assert.ok(text().includes('/portal/settings')); assert.ok(!text().includes('SECRET WORKSPACE')); await unmount();
});
test('authoritative completed member passes completion guard', async () => {
  await mount(el(Guard, null, el('div', null, 'WORKSPACE')), '/portal', () => { control.profileRpc = async () => ({ data: snapshot(true), error: null }); });
  assert.ok(text().includes('WORKSPACE')); await unmount();
});
test('cached complete state never bypasses a fresh guard query on mount', async () => {
  reset(); const pending = deferred(); control.profileRpc = () => pending.promise;
  cache = new QueryClient(); cache.setQueryData(profileApi.memberProfileKey(42, EMAIL), snapshot(true));
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(el(QueryClientProvider, { client: cache }, el(MemoryRouter, { initialEntries: ['/portal'] }, el(Routes, null, el(Route, { path: '/portal', element: el(Guard, null, el('div', null, 'SECRET WORKSPACE')) }), el(Route, { path: '/portal/settings', element: el(Location) }))))));
  assert.ok(!text().includes('SECRET WORKSPACE'));
  pending.resolve({ data: snapshot(), error: null }); await settle(); assert.ok(text().includes('/portal/settings')); await unmount();
});
test('Settings remains open for old members and marks every profile field as required', async () => {
  await mount(el(Settings)); assert.ok(text().includes('Every profile field is required now'));
  for (const id of ['full-name', 'phone', 'academic-number', 'academic-group', 'specialization', 'residence', 'device', 'gender', 'work-conditions', 'bio', 'linkedin-url', 'portfolio-url']) assert.equal(query('settings-' + id).required, true, id);
  assert.equal(query('settings-email').readOnly, true); assert.equal(query('settings-email').value, EMAIL); assert.equal(query('settings-university-email').readOnly, true);
  assert.ok(text().includes('Residence')); assertStorage(); await unmount();
});
test('Arabic Settings localizes specialization while submitted values stay unchanged', async () => {
  await mount(el(Settings), '/portal/settings', () => { control.lang = 'ar'; }); assert.equal(document.querySelector('.member-settings-page').dir, 'rtl');
  assert.equal(query('settings-specialization').querySelector('[value="software"]').textContent, 'برمجيات'); assert.equal(query('settings-specialization').querySelector('[value="ai"]').textContent, 'ذكاء اصطناعي'); await unmount();
});
test('Settings required validation blocks transport and focuses invalid field', async () => {
  await mount(el(Settings)); await submitTwice(); assert.equal(control.rpcCalls.filter((call) => call.name === 'member_update_profile_settings').length, 0);
  assert.equal(query('settings-residence').getAttribute('aria-invalid'), 'true'); assert.equal(document.activeElement.id, 'settings-residence'); await unmount();
});
test('Settings normalized derived email, single-flight save and success only after server confirmation', async () => {
  const pending = deferred(); await mount(el(Settings), '/portal/settings', () => { control.profileRpc = (name) => name === 'member_update_profile_settings' ? pending.promise : Promise.resolve({ data: snapshot(), error: null }); });
  await fillRequired(); assert.equal(query('settings-university-email').value, '00123@batechu.com'); await submitTwice();
  const saves = control.rpcCalls.filter((call) => call.name === 'member_update_profile_settings'); assert.equal(saves.length, 1); assert.equal(Object.keys(saves[0].args.p_profile).length, 12); assert.equal(saves[0].args.p_profile.academicNumber, '00123');
  assert.ok(!text().includes('Your information was saved')); pending.resolve({ data: snapshot(true), error: null }); await settle(); assert.ok(text().includes('Your information was saved')); assert.ok(text().includes('Open workspace')); assert.equal(control.state.currentMember.auth_user_id, 'fixture-user'); assertStorage(); await unmount();
});
test('Settings duplicate academic number preserves typed fields and shows no false success', async () => {
  await mount(el(Settings), '/portal/settings', () => { control.profileRpc = async (name) => name === 'member_update_profile_settings' ? { data: null, error: { code: '23505', message: 'private DB detail' } } : { data: snapshot(), error: null }; });
  await fillRequired(); await submitTwice(); await settle(); assert.ok(text().includes('already registered')); assert.equal(query('settings-academic-group').value, 'G-1'); assert.ok(!text().includes('Your information was saved')); assert.ok(!text().includes('private DB detail')); await unmount();
});
test('Settings load failure blocks form and explicit retry recovers', async () => {
  await mount(el(Settings), '/portal/settings', () => { control.profileRpc = async () => ({ data: null, error: { message: 'private-error' } }); }); assert.equal(document.querySelector('form'), null); assert.ok(!text().includes('private-error'));
  control.profileRpc = async () => ({ data: snapshot(), error: null }); await act(async () => document.querySelector('.member-settings-main button').click()); await settle(); assert.ok(document.querySelector('form')); await unmount();
});
test('profile parser ignores accidental secret columns, derives email, and keeps legacy rows editable', () => {
  const parsed = profileApi.parseMemberProfile(snapshot(false, { device: 'legacy device', gender: 'legacy gender', session_token: 'secret-sentinel' }), 42, EMAIL);
  assert.equal(parsed.device, 'legacy device'); assert.equal(parsed.profile_complete, false); assert.equal('session_token' in parsed, false);
  assert.throws(() => profileApi.parseMemberProfile(snapshot(true, { residence: null }), 42, EMAIL), /SERVER_UNAVAILABLE/);
  assert.throws(() => profileApi.parseMemberProfile(snapshot(true, { university_email: '00123@wrong.invalid' }), 42, EMAIL), /SERVER_UNAVAILABLE/);
});
test('legacy select values stay visible and cannot be cleared once the field is mandatory', async () => {
  await mount(el(Settings), '/portal/settings', () => { control.profileRpc = async () => ({ data: snapshot(false, { device: 'legacy device', gender: 'legacy gender' }), error: null }); });
  assert.equal(query('settings-device').value, 'legacy device'); assert.equal(query('settings-gender').value, 'legacy gender');
  await fillRequired();
  await change('settings-device', '');
  await submitTwice(); await settle();
  assert.equal(control.rpcCalls.filter((call) => call.name === 'member_update_profile_settings').length, 0);
  assert.equal(query('settings-device').getAttribute('aria-invalid'), 'true');
  await change('settings-device', 'هاتف محمول'); await change('settings-gender', 'أنثى');
  await submitTwice(); await settle();
  const save = control.rpcCalls.find((call) => call.name === 'member_update_profile_settings');
  assert.equal(save.args.p_profile.device, 'هاتف محمول'); assert.equal(save.args.p_profile.gender, 'أنثى'); assertStorage(); await unmount();
});
test('profile API rejects owner or device change during a delayed response', async () => {
  for (const changeOwner of [true, false]) {
    reset(); const pending = deferred(); control.profileRpc = () => pending.promise;
    const result = profileApi.fetchMemberProfile(42, EMAIL, control.device);
    if (changeOwner) setMember({ id: 43, email: 'other@mounted-fixture.phantoms.dev' }); else control.device = 'new-device';
    pending.resolve({ data: snapshot(true), error: null }); await assert.rejects(result, /MEMBER_SESSION_REQUIRED/);
  }
});
test('strict recovery parser accepts only an exact PKCE code callback and rejects smuggled or admin callbacks', () => {
  const parse = (url) => { const parsed = new URL(url, 'https://local.test'); return parseCallback(parsed); };
  assert.deepEqual(parse(callbackUrl), { kind: 'code', code: callbackCode });
  for (const url of [
    '/member/recovery?code=short',
    '/member/recovery?code=' + 'a'.repeat(257),
    '/member/recovery?code=' + callbackCode + '&code=smuggled_code',
    '/member/recovery?code=' + callbackCode + '&next=https%3A%2F%2Fevil.example',
    '/member/recovery?token_hash=' + 'a'.repeat(64) + '&type=recovery',
    '/member/recovery#access_token=aaa.bbb.ccc&refresh_token=fixture-refresh&type=recovery',
    callbackUrl + '#access_token=a.b.c',
    callbackUrl.replace('/member/recovery', '/admin/recovery/callback'),
  ]) assert.deepEqual(parse(url), { kind: 'invalid' });
});

test('recovery client is PKCE memory-only, URL detection disabled, and main/admin storage remains untouched', () => {
  reset(); recoveryApi.createMemberRecoveryClient(); const options = control.clients[0].options.auth;
  assert.equal(options.persistSession, false); assert.equal(options.autoRefreshToken, false); assert.equal(options.detectSessionInUrl, false); assert.equal(options.flowType, 'pkce'); assertStorage();
});

test('PKCE recovery exchange consumes verifier before POST, uses anonymous tokens, and performs live SQL proof', async () => {
  reset(); const verifier = '0123456789abcdef'.repeat(4); seedVerifier(verifier);
  const client = recoveryApi.createMemberRecoveryClient();
  assert.equal(await recoveryApi.verifyMemberRecovery(client, { kind: 'code', code: callbackCode }), EMAIL);
  assert.equal(localStorage.getItem(VERIFIER_KEY), null);
  assert.equal(control.fetchCalls.length, 1);
  assert.equal(control.fetchCalls[0].url, 'https://placeholder.supabase.co/auth/v1/token?grant_type=pkce');
  assert.equal(control.fetchCalls[0].method, 'POST');
  assert.equal(control.fetchCalls[0].headers.apikey, 'placeholder-anon-key');
  assert.equal('authorization' in control.fetchCalls[0].headers, false);
  assert.deepEqual(JSON.parse(control.fetchCalls[0].body), { auth_code: callbackCode, code_verifier: verifier });
  assert.equal(control.clients[0].verifies.length, 0);
  assert.deepEqual(control.clients[0].sets, [{ access_token: 'access-fixture', refresh_token: 'refresh-fixture' }]);
  assert.equal(control.clients[0].getUsers, 1); assert.deepEqual(control.recoveryRpcCalls, ['member_password_self_recovery_access']); assertStorage();
});

test('missing, expired, future, or malformed verifier is consumed and rejected before fetch', async () => {
  const cases = [
    () => undefined,
    () => seedVerifier(undefined, Date.now() - 30 * 60 * 1000 - 1),
    () => seedVerifier('0123456789abcdef'.repeat(4), Date.now() + 60000),
    () => seedVerifier('not-a-64-hex-verifier'),
  ];
  for (const prepare of cases) {
    reset(); prepare(); const client = recoveryApi.createMemberRecoveryClient();
    await assert.rejects(recoveryApi.verifyMemberRecovery(client, { kind: 'code', code: callbackCode }), /INVALID_TOKEN/);
    assert.equal(control.fetchCalls.length, 0); assert.equal(localStorage.getItem(VERIFIER_KEY), null); assertStorage();
  }
});

test('StrictMode recovery redeems once, scrubs URL immediately, clears verifier, and only displays form after live SQL proof', async () => {
  const pending = deferred(); await mount(el(React.StrictMode, null, el(Recovery)), callbackUrl, () => { control.recoveryRpc = () => pending.promise; window.history.replaceState({}, '', callbackUrl); seedVerifier(); });
  assert.equal(window.location.search, ''); assert.equal(window.location.hash, ''); assert.equal(control.fetchCalls.length, 1); assert.equal(control.clients.reduce((sum, client) => sum + client.verifies.length, 0), 0); assert.equal(document.querySelector('form'), null); assert.equal(localStorage.getItem(VERIFIER_KEY), null); assertStorage();
  pending.resolve({ data: true, error: null }); await settle(); assert.ok(query('member-recovery-password')); assert.equal(control.signsOut, 0); await unmount(); assert.equal(control.signsOut, 1);
});

test('password/admin/consumed recovery proof denial never enables password form', async () => {
  await mount(el(Recovery), callbackUrl, () => { control.recoveryRpc = async () => ({ data: false, error: null }); seedVerifier(); }); assert.equal(document.querySelector('form'), null); assert.ok(text().includes('Link unavailable')); assert.equal(control.invokes.length, 0); assert.equal(localStorage.getItem(VERIFIER_KEY), null); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
});

test('recovery weak or mismatched passwords never call completion transport', async () => {
  await mount(el(Recovery), callbackUrl, () => seedVerifier()); await change('member-recovery-password', 'short'); await change('member-recovery-confirm', 'different'); await submitTwice(); assert.equal(control.invokes.length, 0); assert.ok(text().includes('do not match')); await unmount();
});

test('recovery single-flight completion clears credentials and ends only isolated session', async () => {
  const pending = deferred(); await mount(el(Recovery), callbackUrl, () => { control.invoke = () => pending.promise; seedVerifier(); }); await change('member-recovery-password', PASSWORD); await change('member-recovery-confirm', PASSWORD); await submitTwice();
  assert.equal(control.invokes.length, 1); assert.deepEqual(Object.keys(control.invokes[0].body).sort(), ['action', 'confirmPassword', 'password']); assert.equal(control.invokes[0].body.action, 'complete_recovery'); assert.ok(!text().includes('Password updated'));
  pending.resolve({ data: { ok: true, membership: 'active' }, error: null }); await settle(); assert.ok(text().includes('Password updated')); assert.equal(query('member-recovery-password'), null); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
});
test('recovery completion does not show success for ok-only or non-active membership responses', async () => {
  for (const data of [{ ok: true }, { ok: true, membership: 'pending_review' }]) {
    await mount(el(Recovery), callbackUrl, () => { control.invoke = async () => ({ data, error: null }); seedVerifier(); }); await change('member-recovery-password', PASSWORD); await change('member-recovery-confirm', PASSWORD); await submitTwice(); await settle();
    assert.equal(query('member-recovery-password'), null); assert.equal(text().includes('Password updated'), false); assert.ok(text().includes('administrator review')); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
  }
});
test('uncertain recovery requires administrator review with no second save offered', async () => {
  await mount(el(Recovery), callbackUrl, () => { control.invoke = async () => ({ data: { code: 'REVIEW_REQUIRED' }, error: null }); seedVerifier(); }); await change('member-recovery-password', PASSWORD); await change('member-recovery-confirm', PASSWORD); await submitTwice(); await settle(); assert.equal(document.querySelector('form'), null); assert.ok(text().includes('administrator review')); assert.equal(control.invokes.length, 1); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
});

test('forgot-password has generic success, single-flight request and cooldown without session takeover', async () => {
  const pending = deferred(); await mount(el(Forgot), '/forgot-password', () => { control.invoke = () => pending.promise; }); await change('member-forgot-email', ' MEMBER@MOUNTED-FIXTURE.PHANTOMS.DEV '); await submitTwice(); await settle(); assert.equal(control.invokes.length, 1); const body = control.invokes[0].body; assert.deepEqual(Object.keys(body).sort(), ['action', 'codeChallenge', 'email']); assert.equal(body.action, 'request_recovery'); assert.equal(body.email, EMAIL); assert.match(body.codeChallenge, /^[A-Za-z0-9_-]{43}$/); const record = JSON.parse(localStorage.getItem(VERIFIER_KEY)); assert.match(record.verifier, /^[0-9a-f]{64}$/); assert.equal(await challengeFor(record.verifier), body.codeChallenge); assertStorageWithRecoveryVerifier();
  pending.resolve({ data: { ok: true }, error: null }); await settle(); assert.ok(text().includes('does not confirm whether an account exists')); assert.ok(document.querySelector('button[type="submit"]').disabled); assertStorageWithRecoveryVerifier(); assert.equal(control.clients.length, 0); await unmount();
});

test('forgot-password reports a generic failure and never invokes transport when dedicated verifier storage is denied', async () => {
  await mount(el(Forgot), '/forgot-password');
  const storagePrototype = Object.getPrototypeOf(localStorage);
  const originalSetItem = storagePrototype.setItem;
  Object.defineProperty(storagePrototype, 'setItem', { configurable: true, value: function (key, value) { if (this === localStorage && key === VERIFIER_KEY) throw new Error('storage denied'); return originalSetItem.call(this, key, value); } });
  try {
    await change('member-forgot-email', ' MEMBER@MOUNTED-FIXTURE.PHANTOMS.DEV '); await submitTwice(); await settle();
    assert.equal(control.invokes.length, 0); assert.ok(text().includes('recovery service could not be reached')); assert.equal(localStorage.getItem(VERIFIER_KEY), null); assertStorage();
  } finally { Object.defineProperty(storagePrototype, 'setItem', { configurable: true, value: originalSetItem }); }
  await unmount();
});

test('terminal completion denial cleans only the ephemeral session immediately and exactly once', async () => {
  for (const code of ['UNAUTHORIZED', 'INVALID_TOKEN', 'MEMBER_SESSION_REQUIRED']) {
    await mount(el(React.StrictMode, null, el(Recovery)), callbackUrl, () => { seedVerifier(); control.invoke = async () => ({ data: { code }, error: null }); });
    await change('member-recovery-password', PASSWORD); await change('member-recovery-confirm', PASSWORD); await submitTwice(); await settle();
    assert.equal(document.querySelector('form'), null); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
  }
});

test('ambiguous completion transport failure requires review and never offers another save', async () => {
  await mount(el(Recovery), callbackUrl, () => { seedVerifier(); control.invoke = async () => ({ data: null, error: { message: 'private transport error' } }); });
  await change('member-recovery-password', PASSWORD); await change('member-recovery-confirm', PASSWORD); await submitTwice(); await settle();
  assert.equal(document.querySelector('form'), null); assert.ok(text().includes('administrator review')); assert.equal(text().includes('private transport error'), false); assert.equal(control.signsOut, 1); assertStorage(); await unmount(); assert.equal(control.signsOut, 1);
});

function withPasswordAccess(mustChange) {
  const base = control.profileRpc;
  control.profileRpc = async (name, args) => (name === 'get_member_password_access'
    ? { data: { member_id: 42, email: EMAIL, auth_user_id: 'fixture-user', active: true, password_ready: true, must_change_password: mustChange }, error: null }
    : base(name, args));
}
test('settings exposes self-service password change and flags a temporary password', async () => {
  await mount(el(Settings), '/portal/settings', () => withPasswordAccess(true));
  assert.ok(text().includes('Account security and password'));
  assert.ok(text().includes('signed in with a temporary password'));
  for (const id of ['member-password-current', 'member-password-new', 'member-password-confirm']) assert.ok(query(id), id);
  assertStorage(); await unmount();
});
test('settings password change refuses a mismatch before any transport call', async () => {
  await mount(el(Settings), '/portal/settings', () => withPasswordAccess(false));
  await change('member-password-current', 'Temporary123456');
  await change('member-password-new', 'PersonalPassword1');
  await change('member-password-confirm', 'PersonalPassword2');
  await act(async () => { document.getElementById('member-password-current').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  assert.equal(control.invokes.length, 0);
  assert.ok(text().includes('do not match'));
  await unmount();
});
test('settings password change posts the confirmed password and confirms success', async () => {
  await mount(el(Settings), '/portal/settings', () => withPasswordAccess(true));
  await change('member-password-current', '123456789');
  await change('member-password-new', 'PersonalPassword1');
  await change('member-password-confirm', 'PersonalPassword1');
  await act(async () => { document.getElementById('member-password-current').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  assert.equal(control.invokes.length, 1);
  assert.equal(control.invokes[0].name, 'member-password-enrollment');
  assert.deepEqual(control.invokes[0].body, { action: 'change_password', currentPassword: '123456789', newPassword: 'PersonalPassword1', confirmPassword: 'PersonalPassword1' });
  assert.ok(text().includes('Password changed'));
  assert.equal(query('member-password-current').value, '');
  await unmount();
});
test('settings password change reports an incorrect current password without leaking the endpoint payload', async () => {
  await mount(el(Settings), '/portal/settings', () => { withPasswordAccess(false); control.invoke = async () => ({ data: { ok: false, code: 'INVALID_CREDENTIALS' }, error: null }); });
  await change('member-password-current', 'wrong-password');
  await change('member-password-new', 'PersonalPassword1');
  await change('member-password-confirm', 'PersonalPassword1');
  await act(async () => { document.getElementById('member-password-current').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  assert.ok(text().includes('current password is incorrect'));
  assert.equal(text().includes('wrong-password'), false);
  await unmount();
});
