import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { createRequire, Module } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(frontend, 'package.json'));
const tooling = process.env.PHANTOMS_AUTH_TEST_TOOLING ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json')) : require;
const { JSDOM } = tooling('jsdom');
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/portal', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const ts = require('typescript');
const el = React.createElement;
let root, native = false, platform = 'web', state, device, rpcCalls = [], handles = [], language = 'en';
let ownerResponse = { data: [], error: null }, recordResponse = { data: {}, error: null };
let metadata = async () => ({ id: 'com.phantoms.app', version: '1.1.0', build: '2' });
const modules = new Map();
const auth = (selector) => selector(state);
auth.getState = () => state;
const mocks = {
  'store/auth.ts': { useAuthStore: auth, getDeviceToken: () => device },
  'lib/supabase/client.ts': { supabase: { rpc: async (...args) => { rpcCalls.push(['owner', ...args]); return ownerResponse; } } },
  'lib/supabase/member-client.ts': { memberSupabase: { rpc: async (...args) => { rpcCalls.push(['member', ...args]); return recordResponse; } } },
  'i18n/useLocale.ts': { useLocale: () => ({ t: (ar, en) => language === 'ar' ? ar : en, date: (value) => new Date(value).toISOString() }) },
};
function load(path) {
  const base = resolve(frontend, 'src', path);
  const file = [base, base + '.ts', base + '.tsx'].find(existsSync) ?? base;
  const key = relative(join(frontend, 'src'), file);
  if (mocks[key]) return mocks[key];
  if (modules.has(file)) return modules.get(file).exports;
  assert.ok(key.startsWith('features/app-usage/'), key);
  const m = new Module(file); modules.set(file, m); m.filename = file;
  m.require = (name) => {
    if (name.startsWith('.')) return load(resolve(dirname(file), name));
    if (name === '@tanstack/react-query') return { useQuery: (options) => options };
    if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform } };
    if (name === '@capacitor/app') return { App: { getInfo: () => metadata(), addListener: async (_name, callback) => { const h = { callback, removed: false, remove: async () => { h.removed = true; } }; handles.push(h); return h; } } };
    return require(name);
  };
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const usage = { member_id: 42, first_used_at: '2026-11-21T08:00:00Z', last_used_at: '2026-11-21T08:01:00Z', last_app_version: '1.1.0', last_app_build: '2' };
function reset() {
  native = false; platform = 'web'; device = 'mock-device-token'; state = { currentMember: { id: 42, email: 'demo@example.com' } }; rpcCalls = []; handles = []; language = 'en'; modules.clear();
  ownerResponse = { data: [usage], error: null }; recordResponse = { data: {}, error: null };
  metadata = async () => ({ id: 'com.phantoms.app', version: '1.1.0', build: '2' });
}
async function mount(node) { root = createRoot(document.getElementById('root')); await act(async () => { root.render(node); await Promise.resolve(); }); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => dom.window.close());
test('Owner read key is actor-bound, disabled for non-Owner and bounded to actual IDs', async () => {
  reset(); const api = load('features/app-usage/api.ts');
  const disabled = api.useOwnerAppUsage('admin', false, [42]); assert.equal(disabled.enabled, false); assert.equal(rpcCalls.length, 0);
  assert.equal(api.useOwnerAppUsage(null, true, [42]).enabled, false);
  const enabled = api.useOwnerAppUsage('owner', true, [42, 42, -1, 3]); assert.deepEqual(enabled.queryKey, ['owner-app-usage', 'owner', [3, 42]]);
  await enabled.queryFn(); assert.deepEqual(rpcCalls[0], ['owner', 'owner_member_app_usage', { p_member_ids: [3, 42] }]);
  await assert.rejects(api.fetchOwnerAppUsage(Array.from({ length: 101 }, (_, i) => i + 1)), /TOO_LARGE/);
});
test('malformed, unrelated, duplicate and reverse-time evidence fails closed', () => {
  reset(); const api = load('features/app-usage/api.ts');
  for (const value of [null, {}, [{ ...usage, member_id: 43 }], [usage, usage], [{ ...usage, first_used_at: 'invalid' }], [{ ...usage, last_used_at: '2025-01-01' }], [{ ...usage, last_app_build: '<script>' }]]) assert.throws(() => api.parseAppUsageRows(value, [42]), /UNAVAILABLE/);
  assert.deepEqual(api.parseAppUsageRows([], [42]), []);
});
test('schema/network errors never become empty no-use evidence', async () => {
  reset(); const api = load('features/app-usage/api.ts'); ownerResponse = { data: null, error: { code: 'PGRST202' } };
  await assert.rejects(api.fetchOwnerAppUsage([42]), /UNAVAILABLE/);
});
test('record uses isolated Member client and sends no member ID/time or Auth mutation', async () => {
  reset(); await load('features/app-usage/api.ts').recordMemberAppUsage(device, '1.1.0', '2');
  assert.deepEqual(rpcCalls, [['member', 'member_record_app_usage', { p_device_token: device, p_app_version: '1.1.0', p_app_build: '2' }]]);
});
test('browser and native iOS produce no usage writes', async () => {
  reset(); let Tracker = load('features/app-usage/MemberAppUsageTracker.tsx').MemberAppUsageTracker;
  await mount(el(Tracker)); assert.equal(rpcCalls.length, 0); await act(async () => root.unmount()); root = null;
  native = true; platform = 'ios'; await mount(el(Tracker)); assert.equal(rpcCalls.length, 0);
});
test('Android StrictMode first mount records once and cleans late/listener handles', async () => {
  reset(); native = true; platform = 'android'; const Tracker = load('features/app-usage/MemberAppUsageTracker.tsx').MemberAppUsageTracker;
  await mount(el(React.StrictMode, null, el(Tracker)));
  assert.equal(rpcCalls.length, 1); assert.equal(rpcCalls[0][0], 'member');
  await act(async () => { for (const h of handles) if (!h.removed) h.callback({ isActive: true }); }); assert.equal(rpcCalls.length, 1);
  await act(async () => root.unmount()); root = null; assert.ok(handles.every((h) => h.removed));
});
test('pending metadata after unmount or changed identity cannot write usage', async () => {
  reset(); native = true; platform = 'android'; let resolveInfo; metadata = () => new Promise((r) => { resolveInfo = r; });
  const Tracker = load('features/app-usage/MemberAppUsageTracker.tsx').MemberAppUsageTracker; await mount(el(Tracker));
  state.currentMember = { id: 43, email: 'other@example.com' }; await act(async () => { resolveInfo({ id: 'com.phantoms.app', version: '1', build: '1' }); }); assert.equal(rpcCalls.length, 0);
  await act(async () => root.unmount()); root = null;
});
test('missing device, wrong package and reporting failures never change identity', async () => {
  reset(); native = true; platform = 'android'; device = null; let Tracker = load('features/app-usage/MemberAppUsageTracker.tsx').MemberAppUsageTracker; await mount(el(Tracker)); assert.equal(rpcCalls.length, 0);
  await act(async () => root.unmount()); root = null; device = 'mock-device-token'; metadata = async () => ({ id: 'wrong.package', version: '1', build: '1' }); await mount(el(Tracker)); assert.equal(rpcCalls.length, 0); assert.equal(state.currentMember.id, 42);
});
test('usage display distinguishes unavailable/checking/absence, never current installation', async () => {
  reset(); const Details = load('features/app-usage/MemberAppUsageDetails.tsx').MemberAppUsageDetails;
  await mount(el(Details, { display: { status: 'unavailable', usage } })); assert.match(document.body.textContent, /Usage unavailable/); assert.doesNotMatch(document.body.textContent, /Used the app/);
  await act(async () => root.render(el(Details, { display: { status: 'ready' } }))); assert.match(document.body.textContent, /No app use recorded/);
  await act(async () => root.render(el(Details, { display: { status: 'ready', usage } }))); assert.match(document.body.textContent, /Used the app/); assert.match(document.body.textContent, /Not proof of current installation/); assert.match(document.body.textContent, /1.1.0/);
  language = 'ar'; await act(async () => root.render(el(Details, { display: { status: 'ready', usage } }))); assert.match(document.body.textContent, /استخدم التطبيق/);
});
