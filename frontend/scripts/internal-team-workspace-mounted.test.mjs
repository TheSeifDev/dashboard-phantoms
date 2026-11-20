// Mounted regression coverage for the real team workspace page and data layer.
// Run from the repository root with:
//   node frontend/scripts/internal-team-workspace-mounted.test.mjs
// The harness compiles the actual page/API/access/locale sources into a temporary
// directory outside the repository and removes it in finally.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const { JSDOM } = frontendRequire('jsdom');
const ts = frontendRequire('typescript');
const React = frontendRequire('react');
const { createRoot } = frontendRequire('react-dom/client');
const { act } = React;
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};

const USER_ONE = 'fixture-user-one';
const USER_TWO = 'fixture-user-two';
const SOFTWARE = 'fixture-team-software';
const HARDWARE = 'fixture-team-hardware';
const EMPTY = 'fixture-team-empty';
const GLOBAL = 'fixture-team-global-projection';
const HEAD_ONLY = 'fixture-team-head-only';
const SYNTHETIC_MEMBER_ID = 41017;

function compileCommonJs(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}

async function writeHarnessFiles(harnessRoot) {
  await writeFile(join(harnessRoot, 'package.json'), '{"type":"commonjs"}\n');
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');

  const actualSources = [
    'features/teams/workspace/TeamWorkspacePage.tsx',
    'features/teams/workspace/api.ts',
    'features/teams/access.ts',
    'i18n/useLocale.ts',
  ];
  for (const source of actualSources) {
    const sourcePath = join(frontendRoot, 'src', source);
    const outputPath = join(harnessRoot, 'src', source.replace(/\.tsx?$/, '.js'));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, compileCommonJs(await readFile(sourcePath, 'utf8'), sourcePath));
  }

  const stubs = new Map([
    ['src/components/ui/Button.js', `
const React = require('react');
exports.Button = function Button(props) {
  const { children, icon, variant, isLoading, loadingText, fullOnMobile, ...rest } = props;
  return React.createElement('button', rest, icon, children);
};
`],
    ['src/components/ui/Card.js', `
const React = require('react');
exports.Card = function Card({ children, className, ...props }) {
  return React.createElement('div', { ...props, className }, children);
};
`],
    ['src/components/ui/ConfirmDialog.js', `
exports.ConfirmDialog = function ConfirmDialog() { return null; };
`],
    ['src/components/ui/EmptyState.js', `
const React = require('react');
exports.EmptyState = function EmptyState({ title, description }) {
  return React.createElement('div', { 'data-empty-state': 'true' }, React.createElement('h2', null, title), React.createElement('p', null, description));
};
`],
    ['src/components/ui/ErrorState.js', `
const React = require('react');
exports.ErrorState = function ErrorState({ message, onRetry }) {
  return React.createElement('div', { role: 'alert' }, React.createElement('p', null, message), onRetry && React.createElement('button', { type: 'button', onClick: onRetry }, 'Retry'));
};
`],
    ['src/components/ui/PageHeader.js', `
const React = require('react');
exports.PageHeader = function PageHeader({ title, description }) {
  return React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description));
};
`],
    ['src/components/ui/Skeleton.js', `
const React = require('react');
exports.CardSkeletons = function CardSkeletons() { return React.createElement('div', { role: 'status', 'data-skeleton': 'true' }, 'Loading'); };
`],
    ['src/i18n/LanguageToggle.js', `
const React = require('react');
const { useLocale } = require('./useLocale');
exports.LanguageToggle = function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  return React.createElement('button', { type: 'button', 'aria-label': 'Toggle language', onClick: () => setLocale(locale === 'ar' ? 'en' : 'ar') }, locale === 'ar' ? 'English' : 'العربية');
};
`],
    ['src/lib/supabase/errors.js', `
exports.toAppError = function toAppError(error, fallback) {
  return error instanceof Error ? error : new Error(fallback);
};
`],
    ['src/lib/supabase/client.js', `
function abortable(signal, promise) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { if (signal) signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { if (signal) signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}
exports.supabase = {
  rpc(name, args) {
    const promise = Promise.resolve().then(() => globalThis.__TW_RPC(name, args));
    return { abortSignal(signal) { globalThis.__TW_SIGNALS.push({ name, args, signal }); return abortable(signal, promise); } };
  },
  auth: {
    signOut() { return Promise.resolve().then(() => globalThis.__TW_SIGN_OUT()); },
  },
};
`],
    ['src/store/auth.js', `
const React = require('react');
let state = { ready: true, user: null, clear };
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
function clear() { state = { ...state, user: null, clear }; emit(); }
function useAuthStore(selector) {
  return selector(React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state));
}
useAuthStore.getState = () => ({ ...state, clear, setUser(user) { state = { ...state, user }; emit(); } });
exports.useAuthStore = useAuthStore;
exports.__reset = () => { state = { ready: true, user: null, clear }; emit(); };
`],
    ['src/store/theme.js', `
exports.useThemeStore = () => ({ theme: 'light', toggle() {} });
`],
    ['src/store/toast.js', `
exports.toast = { success() {}, error() {}, warning() {} };
`],
    ['src/features/admin/access/api.js', `
const React = require('react');
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
exports.useAdminAccess = function useAdminAccess() {
  return React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => globalThis.__TW_ACCESS, () => globalThis.__TW_ACCESS);
};
exports.__set = (value) => { globalThis.__TW_ACCESS = value; emit(); };
`],
  ]);

  for (const [relativePath, contents] of stubs) {
    const destination = join(harnessRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/team',
    pretendToBeVisual: true,
  });
  const names = [
    'window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node',
    'MutationObserver', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent',
    'IS_REACT_ACT_ENVIRONMENT', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  const previous = new Map();
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  };
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  }
  return {
    dom,
    restore() {
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function settle(turns = 5) {
  return (async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }
  })();
}

function makeHeadAccess({ software = { tasks: true }, hardware = { members: true }, empty = {} } = {}) {
  return {
    isPending: false,
    isFetching: false,
    isError: false,
    data: {
      is_admin: false,
      is_team_admin: true,
      // A Head must not borrow broad/global permission flags.
      permissions: { tasks: true, members: true },
      teams: [
        { team_id: SOFTWARE, name: 'Software', slug: 'software', role: 'head', permissions: software },
        { team_id: HARDWARE, name: 'Hardware', slug: 'hardware', role: 'head', permissions: hardware },
        { team_id: EMPTY, name: 'Empty', slug: 'empty', role: 'monitor', permissions: empty },
      ],
    },
  };
}

function makeTask(title = 'Software-only synthetic task') {
  return {
    id: 7001,
    title,
    description: 'Synthetic mounted fixture',
    has_deadline: false,
    deadline_date: null,
    assigned_to: [String(SYNTHETIC_MEMBER_ID)],
    tracking: { [String(SYNTHETIC_MEMBER_ID)]: { status: 'under_review' } },
    bonus_points: 0,
  };
}

function makeRoster() {
  return [{ member_id: SYNTHETIC_MEMBER_ID, full_name: 'Synthetic QA member', membership_status: 'active', work_status: 'active' }];
}

function defaultRpc(name, args) {
  if (name === 'team_list_tasks') return { data: args.p_team_id === SOFTWARE ? [makeTask()] : [], error: null };
  if (name === 'team_list_roster') return { data: args.p_team_id === SOFTWARE ? makeRoster() : [], error: null };
  if (name === 'owner_list_team_members') {
    return {
      data: [{ member_id: 52031, full_name: 'Synthetic Hardware member', email: '', phone: null, work_status: 'active', membership_status: 'active', created_at: '2026-01-01T00:00:00.000Z' }],
      error: null,
    };
  }
  return { data: [], error: null };
}

function taskRpcCount(calls, teamId) {
  return calls.filter((call) => call.name === 'team_list_tasks' && call.args.p_team_id === teamId).length;
}

function textIsVisible(text) {
  return document.body.textContent?.includes(text) ?? false;
}

function byLabel(text, selector = 'input') {
  const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.includes(text));
  assert.ok(label, 'Expected a mounted form label to be present');
  const control = label.querySelector(selector);
  assert.ok(control, 'Expected a control inside the mounted form label');
  return control;
}

function setControlValue(element, value) {
  const view = element.ownerDocument.defaultView;
  const prototype = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype
    : element.tagName === 'SELECT' ? view.HTMLSelectElement.prototype
      : view.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
  const onChange = reactPropsKey && element[reactPropsKey]?.onChange;
  if (typeof onChange === 'function') onChange({ target: element, currentTarget: element });
  if (element.tagName !== 'SELECT') element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function click(element) {
  assert.ok(element, 'Expected a clickable mounted control');
  await act(async () => {
    element.click();
    await settle();
  });
}

async function changeControl(element, value) {
  await act(async () => {
    setControlValue(element, value);
    await settle();
  });
}

async function createMountedHarness(bundle, { userId = USER_ONE, entry = `/team/${SOFTWARE}`, access = makeHeadAccess(), rpc = defaultRpc, signOut = () => ({ error: null }) } = {}) {
  globalThis.__TW_CALLS = [];
  globalThis.__TW_SIGNALS = [];
  globalThis.__TW_RPC = async (name, args) => {
    globalThis.__TW_CALLS.push({ name, args });
    return rpc(name, args);
  };
  globalThis.__TW_SIGN_OUT = signOut;
  bundle.auth.__reset();
  bundle.auth.useAuthStore.getState().setUser({ id: userId });
  bundle.access.__set(access);
  bundle.localeStore.getState().setLocale('en');

  const queryClient = new bundle.QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let navigate;
  function Controller() {
    navigate = bundle.useNavigate();
    const location = bundle.useLocation();
    return React.createElement(React.Fragment, null,
      React.createElement(bundle.Routes, null,
        React.createElement(bundle.Route, { path: '/team/:teamId', element: React.createElement(bundle.TeamWorkspacePage) }),
        React.createElement(bundle.Route, { path: '/team', element: React.createElement(bundle.TeamWorkspacePage) }),
        React.createElement(bundle.Route, { path: '*', element: React.createElement(bundle.TeamWorkspacePage) }),
      ),
      React.createElement('output', { id: 'mounted-location' }, location.pathname),
    );
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(React.StrictMode, null,
      React.createElement(bundle.QueryClientProvider, { client: queryClient },
        React.createElement(bundle.MemoryRouter, { initialEntries: [entry] }, React.createElement(Controller)),
      ),
    ));
    await settle();
  });

  return {
    queryClient,
    calls: globalThis.__TW_CALLS,
    navigate: async (path) => act(async () => { navigate(path); await settle(); }),
    async unmount() {
      await act(async () => { root.unmount(); await settle(); });
      queryClient.clear();
      document.getElementById('root').replaceChildren();
      delete globalThis.__TW_CALLS;
      delete globalThis.__TW_RPC;
      delete globalThis.__TW_SIGN_OUT;
      delete globalThis.__TW_SIGNALS;
    },
  };
}

const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-team-workspace-mounted-'));
let environment;
try {
  await writeHarnessFiles(harnessRoot);
  environment = installDom();
  const harnessRequire = createRequire(join(harnessRoot, 'package.json'));
  const bundle = {
    TeamWorkspacePage: harnessRequire('./src/features/teams/workspace/TeamWorkspacePage.js').default,
    workspaceApi: harnessRequire('./src/features/teams/workspace/api.js'),
    workspaceAccess: harnessRequire('./src/features/teams/access.js'),
    auth: harnessRequire('./src/store/auth.js'),
    access: harnessRequire('./src/features/admin/access/api.js'),
    localeStore: harnessRequire('./src/i18n/useLocale.js').useLocaleStore,
    QueryClient: harnessRequire('@tanstack/react-query').QueryClient,
    QueryClientProvider: harnessRequire('@tanstack/react-query').QueryClientProvider,
    MemoryRouter: harnessRequire('react-router-dom').MemoryRouter,
    Routes: harnessRequire('react-router-dom').Routes,
    Route: harnessRequire('react-router-dom').Route,
    useNavigate: harnessRequire('react-router-dom').useNavigate,
    useLocation: harnessRequire('react-router-dom').useLocation,
  };

  await test('mounted internal team workspace regression', async (t) => {
    await t.test('team switch remounts task drafts, isolates tasks, and changes the real locale live', async () => {
      const mounted = await createMountedHarness(bundle);
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'The assigned Software task should render for the Head');
        assert.ok(document.querySelector('#team-workspace-picker'), 'The assigned-team picker should render');
        assert.ok(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Tasks'), 'Software task permission should expose its task section');
        assert.equal(taskRpcCount(mounted.calls, SOFTWARE) > 0, true, 'Software task RPC should load for its authorized Head');

        const taskTitle = byLabel('Task title');
        await changeControl(taskTitle, 'Unsaved synthetic title');
        const memberCheckbox = byLabel('Synthetic QA member', 'input[type="checkbox"]');
        await click(memberCheckbox);
        const reviewNote = byLabel('Member note for a revision request', 'textarea');
        await changeControl(reviewNote, 'Unsaved synthetic review note');
        assert.ok((taskTitle).value === 'Unsaved synthetic title', 'Unsaved title should be entered before switching');
        assert.ok((memberCheckbox).checked, 'Assignment selection should be entered before switching');
        assert.ok((reviewNote).value === 'Unsaved synthetic review note', 'Review note should be entered before switching');

        const unauthorizedCachedTask = makeTask('Cached unauthorized Hardware task');
        mounted.queryClient.setQueryData(['team-workspace', USER_ONE, HARDWARE, 'tasks'], [unauthorizedCachedTask]);
        await changeControl(document.querySelector('#team-workspace-picker'), HARDWARE);
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Hardware'), 'The Hardware team should become the selected workspace');
        assert.ok(!textIsVisible('Software-only synthetic task'), 'Software tasks must never render in Hardware');
        assert.ok(!textIsVisible('Cached unauthorized Hardware task'), 'Cached tasks without Hardware task permission must stay hidden');
        assert.equal(taskRpcCount(mounted.calls, HARDWARE), 0, 'The members-only Hardware assignment must never call the team-task RPC');
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, HARDWARE, 'tasks'] }).length, 0, 'Unpermitted cached Hardware task data should be removed');
        assert.ok(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Members'), 'Hardware should expose its own members permission, not a union of assignments');

        await changeControl(document.querySelector('#team-workspace-picker'), SOFTWARE);
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'Returning to Software should load only its own task list');
        assert.equal(byLabel('Task title').value, '', 'Switching teams should reset the unsaved task title');
        assert.equal(byLabel('Synthetic QA member', 'input[type="checkbox"]').checked, false, 'Switching teams should reset the selected assignee');
        assert.equal(byLabel('Member note for a revision request', 'textarea').value, '', 'Switching teams should reset the unsaved review note');

        await click(document.querySelector('[aria-label="Toggle language"]'));
        assert.equal(document.querySelector('[role="tabpanel"]').getAttribute('aria-label'), 'المهام', 'The actual locale hook should translate the mounted page to Arabic');
        assert.equal(document.querySelector('[role="tabpanel"]').parentElement.dir, 'rtl', 'The actual locale hook should update the mounted direction');
        await click(document.querySelector('[aria-label="Toggle language"]'));
        assert.equal(document.querySelector('[role="tabpanel"]').getAttribute('aria-label'), 'Tasks', 'The mounted page should switch back to English without a remount');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('team-scope cleanup cancels pending RPC work and removes the old user/team cache', async () => {
      const pendingResponses = [];
      const mounted = await createMountedHarness(bundle, {
        rpc(name, args) {
          if (name === 'team_list_tasks' && args.p_team_id === SOFTWARE) {
            return new Promise((resolvePromise) => pendingResponses.push(() => resolvePromise({ data: [makeTask()], error: null })));
          }
          return defaultRpc(name, args);
        },
      });
      try {
        await act(async () => { await settle(); });
        const pendingSignals = globalThis.__TW_SIGNALS
          .filter((entry) => entry.name === 'team_list_tasks' && entry.args.p_team_id === SOFTWARE)
          .map((entry) => entry.signal);
        assert.ok(pendingSignals.length > 0, 'The mounted task RPC should receive a React Query AbortSignal');
        assert.equal(mounted.queryClient.getQueryCache().find({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] })?.state.fetchStatus, 'fetching', 'The Software task query should remain pending before navigation');
        await mounted.navigate(`/team/${HARDWARE}`);
        await act(async () => { await settle(); });
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] }).length, 0, 'Changing teams should remove the old team query key');
        assert.ok(pendingSignals.every((signal) => signal.aborted), 'Changing teams should cancel the old in-flight RPC');
        assert.ok(!textIsVisible('Software-only synthetic task'), 'A late task response must not become visible after team navigation');
        pendingResponses.forEach((resolveResponse) => resolveResponse());
        await act(async () => { await settle(); });
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] }).length, 0, 'A late completion must not recreate the removed team query');
      } finally {
        pendingResponses.forEach((resolveResponse) => resolveResponse());
        await mounted.unmount();
      }
    });

    await t.test('permission revocation and access errors fail closed against cached data', async () => {
      const mounted = await createMountedHarness(bundle);
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'Authorized task data should load before revocation');
        const revoked = makeHeadAccess({ software: {}, hardware: { members: true }, empty: {} });
        await act(async () => { bundle.access.__set(revoked); await settle(); });
        assert.ok(textIsVisible('No sections are enabled for this team'), 'A team with revoked features should show the empty-permission state');
        assert.ok(!textIsVisible('Software-only synthetic task'), 'Revoked task data must not be rendered');
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] }).length, 0, 'Revocation should remove the cached task scope');
        assert.equal(taskRpcCount(mounted.calls, HARDWARE), 0, 'A different team permission must never authorize Hardware tasks');

        await act(async () => { bundle.access.__set(makeHeadAccess()); await settle(); });
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'The task can reload after the original assignment is restored');
        mounted.queryClient.setQueryData(['team-workspace', USER_ONE, SOFTWARE, 'tasks'], [makeTask('Cached task hidden by access error')]);
        await act(async () => {
          bundle.access.__set({ isPending: false, isFetching: false, isError: true, data: undefined });
          await settle();
        });
        assert.ok(document.querySelector('[role="alert"]'), 'An access verification error should replace the workspace');
        assert.ok(!textIsVisible('Cached task hidden by access error'), 'Access errors must hide all cached team data');
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE] }).length, 0, 'Access errors should remove every cached section for the selected team');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('empty-permission assignment keeps the picker available for an allowed team', async () => {
      const mounted = await createMountedHarness(bundle, { entry: `/team/${EMPTY}` });
      try {
        await act(async () => { await settle(); });
        const picker = document.querySelector('#team-workspace-picker');
        assert.ok(picker, 'The team picker must remain available for a team with no enabled features');
        assert.equal(picker.options.length, 3, 'All assigned teams should remain selectable');
        assert.ok(textIsVisible('No sections are enabled for this team'), 'The empty assignment should not be redirected away');
        assert.equal(taskRpcCount(mounted.calls, EMPTY), 0, 'An empty-permission team must not trigger a task RPC');
        await changeControl(picker, HARDWARE);
        await act(async () => { await settle(); });
        assert.ok(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Members'), 'The picker should reach another team with its own valid permission');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('cached workspace panels stay masked while access is being revalidated', async () => {
      const mounted = await createMountedHarness(bundle);
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'The task should be visible after initial access succeeds');
        const cachedScope = mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] });
        assert.ok(cachedScope.some((query) => query.state.data), 'A real task result should be cached before access polling');

        await act(async () => {
          bundle.access.__set({ ...makeHeadAccess(), isFetching: true });
          await settle();
        });
        assert.ok(document.querySelector('[data-skeleton="true"]'), 'The workspace should mask panels during access revalidation');
        assert.ok(!textIsVisible('Software-only synthetic task'), 'Cached task titles must not render while access is fetching');
        assert.ok(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE, SOFTWARE, 'tasks'] }).some((query) => query.state.data), 'The cache should remain present while the UI is masked');

        await act(async () => {
          bundle.access.__set(makeHeadAccess());
          await settle();
        });
        assert.ok(textIsVisible('Software-only synthetic task'), 'The panel may render again after fresh access verification succeeds');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('switching authenticated user scopes and clears old user data', async () => {
      let currentTitle = 'First synthetic user task';
      const mounted = await createMountedHarness(bundle, {
        rpc(name, args) {
          if (name === 'team_list_tasks' && args.p_team_id === SOFTWARE) return { data: [makeTask(currentTitle)], error: null };
          return defaultRpc(name, args);
        },
      });
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('First synthetic user task'), 'The initial user task should load');
        currentTitle = 'Second synthetic user task';
        await act(async () => {
          bundle.auth.useAuthStore.getState().setUser({ id: USER_TWO });
          await settle();
        });
        assert.ok(textIsVisible('Second synthetic user task'), 'The replacement user should see only its own query result');
        assert.ok(!textIsVisible('First synthetic user task'), 'A previous user’s data must not remain visible');
        assert.equal(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_ONE] }).length, 0, 'The old user’s team-workspace cache should be removed');
        assert.ok(mounted.queryClient.getQueryCache().findAll({ queryKey: ['team-workspace', USER_TWO, SOFTWARE, 'tasks'] }).length > 0, 'The new user’s query key should include that user and team');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('global Owner can explicitly open a role-null projection without borrowing a Head team', async () => {
      const ownerAccess = {
        isPending: false,
        isFetching: false,
        isError: false,
        data: {
          is_admin: true,
          is_team_admin: true,
          permissions: { tasks: true, members: true },
          teams: [
            { team_id: GLOBAL, name: 'Global projection', slug: 'global-projection', role: null, permissions: { tasks: true } },
            { team_id: HEAD_ONLY, name: 'Head-only assignment', slug: 'head-only', role: 'head', permissions: { members: true } },
          ],
        },
      };
      assert.equal(bundle.workspaceAccess.managerDestination(ownerAccess.data), '/admin', 'A global Owner’s original landing destination must remain unchanged');
      const mounted = await createMountedHarness(bundle, { entry: `/team/${GLOBAL}`, access: ownerAccess });
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Global projection'), 'A trusted role-null team projection should open by explicit route');
        assert.ok(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Tasks'), 'The Owner’s role-null projection should use its projected task permission');
        assert.equal(taskRpcCount(mounted.calls, GLOBAL) > 0, true, 'The explicitly opened global projection should load its authorized task list');
        assert.equal(taskRpcCount(mounted.calls, HEAD_ONLY), 0, 'The Owner must not borrow or query the separate Head assignment');
        const options = [...document.querySelector('#team-workspace-picker').options];
        assert.equal(options.length, 1, 'Only role-null trusted projections should appear for a global Owner');
        assert.ok(!options.some((option) => option.textContent?.includes('Head-only assignment')), 'A role-bearing Head assignment must not leak into the Owner projection picker');
        assert.ok(![...document.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent?.includes('Members')), 'The global projection must not inherit the Head team’s members permission');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('sign-out errors retain the session and successful sign-out clears it', async () => {
      let signOutFails = true;
      const mounted = await createMountedHarness(bundle, {
        signOut: () => signOutFails ? { error: new Error('synthetic sign-out failure') } : { error: null },
      });
      try {
        await act(async () => { await settle(); });
        await click([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Sign out')));
        assert.ok(bundle.auth.useAuthStore.getState().user, 'A sign-out error must retain the authenticated user');
        assert.ok(document.querySelector('#team-workspace-picker'), 'A sign-out error must leave the workspace mounted');
        signOutFails = false;
        await click([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Sign out')));
        assert.ok(bundle.auth.useAuthStore.getState().user === null, 'A successful sign-out must clear the local user');
        assert.ok(!document.querySelector('#team-workspace-picker'), 'Successful sign-out must no longer render protected workspace controls');
      } finally {
        await mounted.unmount();
      }
    });

    await t.test('actual workspace RPC validators accept valid rows and reject a wrong JSON shape', async () => {
      const mounted = await createMountedHarness(bundle);
      try {
        await act(async () => { await settle(); });
        assert.ok(textIsVisible('Software-only synthetic task'), 'The mounted page should consume a valid actual task RPC row');
        const result = await bundle.workspaceApi.listWorkspaceTasks(SOFTWARE, new AbortController().signal);
        assert.equal(Array.isArray(result), true, 'The actual task-list validator should accept its RPC row-array shape');
        globalThis.__TW_RPC = async () => ({ data: { unexpected: 'object instead of a task list' }, error: null });
        await assert.rejects(
          bundle.workspaceApi.listWorkspaceTasks(SOFTWARE, new AbortController().signal),
          /Could not load this team’s tasks\./,
          'A wrong task RPC JSON shape must fail closed',
        );
        assert.equal(typeof bundle.workspaceAccess.workspaceTeamEntries, 'function', 'The real access helper module should be part of the compiled harness');
      } finally {
        await mounted.unmount();
      }
    });
  });
} finally {
  delete globalThis.__TW_CALLS;
  delete globalThis.__TW_RPC;
  delete globalThis.__TW_SIGN_OUT;
  delete globalThis.__TW_SIGNALS;
  delete globalThis.__TW_ACCESS;
  environment?.restore();
  await rm(harnessRoot, { recursive: true, force: true });
}
