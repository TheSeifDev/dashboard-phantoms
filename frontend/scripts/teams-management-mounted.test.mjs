// Mounted regression coverage for the real TeamsManagementPage component.
// Run from the repository root with:
//   node frontend/scripts/teams-management-mounted.test.mjs
// The harness compiles the actual page and permission constants into a temporary
// directory outside the repository. All data hooks, auth/access, locale, and UI
// primitives are deterministic local mocks; no database or network is used.
// If JSDOM is held outside frontend/node_modules, set PHANTOMS_TEST_DEPS_ROOT
// to that dependency directory (containing package.json and node_modules).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const requireTestDependency = (name) => {
  try { return frontendRequire(name); } catch (frontendError) {
    if (process.env.PHANTOMS_TEST_DEPS_ROOT) {
      return createRequire(join(resolve(process.env.PHANTOMS_TEST_DEPS_ROOT), 'package.json'))(name);
    }
    throw frontendError;
  }
};
const { JSDOM } = requireTestDependency('jsdom');
const ts = frontendRequire('typescript');
const React = frontendRequire('react');
let createRoot;
const { act } = React;
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};

const OWNER_ID = 'fixture-owner';
const TEAM_ALPHA = 'fixture-team-alpha';
const TEAM_BETA = 'fixture-team-beta';
const TEAM_GAMMA = 'fixture-team-gamma';
const PERMISSION_KEYS = [
  'dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant',
];
const EMPTY_PERMISSIONS = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false]));

const teamFixtures = [
  {
    team_id: TEAM_ALPHA,
    slug: 'alpha-studio',
    name: 'Alpha Studio',
    is_active: true,
    member_count: 4,
    assignments: [
      {
        id: 'assignment-alpha-head', team_id: TEAM_ALPHA, user_id: 'head-alpha',
        email: 'head.alpha@example.test', role: 'head',
        permissions: { dashboard: true, members: false, tasks: true, ranking: false, notes: true, announcements: false, whatsapp: false, ai_assistant: false },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    team_id: TEAM_BETA,
    slug: 'beta-ops',
    name: 'Beta Operations',
    is_active: false,
    member_count: 1,
    assignments: [
      {
        id: 'assignment-beta-monitor', team_id: TEAM_BETA, user_id: 'monitor-beta',
        email: 'manager.beta@example.test', role: 'monitor', permissions: { ...EMPTY_PERMISSIONS, dashboard: true },
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ],
  },
  {
    team_id: TEAM_GAMMA,
    slug: 'gamma-labs',
    name: 'Gamma Labs',
    is_active: true,
    member_count: 2,
    assignments: [],
  },
];

const adminCandidates = [
  { user_id: 'head-alpha', email: 'head.alpha@example.test', member_id: null, member_name: null, global_role: null },
  { user_id: 'new-head', email: 'new.head@example.test', member_id: null, member_name: null, global_role: null },
  { user_id: 'global-admin', email: 'global@example.test', member_id: null, member_name: null, global_role: 'admin' },
];

const alphaMembers = [
  { member_id: 101, full_name: 'Avery Active', email: 'avery@example.test', phone: null, work_status: 'active', membership_status: 'active', created_at: '2026-01-03T00:00:00.000Z' },
  { member_id: 102, full_name: 'Parker Pending', email: 'parker@example.test', phone: null, work_status: 'active', membership_status: 'pending', created_at: '2026-01-04T00:00:00.000Z' },
  { member_id: 103, full_name: 'Riley Suspended', email: 'riley@example.test', phone: null, work_status: 'active', membership_status: 'suspended', created_at: '2026-01-05T00:00:00.000Z' },
  { member_id: 104, full_name: 'Casey Removed', email: 'casey@example.test', phone: null, work_status: 'active', membership_status: 'removed', created_at: '2026-01-06T00:00:00.000Z' },
];

const alphaMemberCandidates = [
  { member_id: 101, full_name: 'Avery Active', email: 'avery@example.test', phone: null, work_status: 'active', membership_status: 'active' },
  { member_id: 102, full_name: 'Parker Pending', email: 'parker@example.test', phone: null, work_status: 'active', membership_status: 'pending' },
  { member_id: 103, full_name: 'Riley Suspended', email: 'riley@example.test', phone: null, work_status: 'active', membership_status: 'suspended' },
  { member_id: 104, full_name: 'Casey Removed', email: 'casey@example.test', phone: null, work_status: 'active', membership_status: 'removed' },
  { member_id: 201, full_name: 'Taylor Addable', email: 'taylor@example.test', phone: null, work_status: 'active', membership_status: null },
];

function queryState(data) {
  return { data, isPending: false, isFetching: false, isError: false, refetch: async () => {} };
}

function defaultFixture(overrides = {}) {
  return {
    mutations: [],
    hookEnabled: [],
    teams: queryState(teamFixtures),
    candidates: queryState(adminCandidates),
    members: { [TEAM_ALPHA]: queryState(alphaMembers) },
    memberCandidates: { [TEAM_ALPHA]: queryState(alphaMemberCandidates) },
    ...overrides,
  };
}

function compileCommonJs(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}

async function writeHarnessFiles(harnessRoot) {
  await writeFile(join(harnessRoot, 'package.json'), '{"type":"commonjs"}\n');
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');

  const pagePath = join(frontendRoot, 'src/features/teams/TeamsManagementPage.tsx');
  const permissionsPath = join(frontendRoot, 'src/features/admin/access/permissions.ts');
  const pageOutput = join(harnessRoot, 'src/features/teams/TeamsManagementPage.js');
  const permissionsOutput = join(harnessRoot, 'src/features/admin/access/permissions.js');
  await mkdir(dirname(pageOutput), { recursive: true });
  await mkdir(dirname(permissionsOutput), { recursive: true });
  await writeFile(pageOutput, compileCommonJs(await readFile(pagePath, 'utf8'), pagePath));
  await writeFile(permissionsOutput, compileCommonJs(await readFile(permissionsPath, 'utf8'), permissionsPath));
  // The real page may import its page-scoped stylesheet. The mounted tests assert
  // behavior and semantics rather than computed CSS, so a temporary empty module
  // keeps TSX compilation and import resolution independent of Vite.
  await writeFile(join(dirname(pageOutput), 'teams-management.css'), '');

  const stubs = new Map([
    ['src/components/ui/Badge.js', `
const React = require('react');
exports.Badge = function Badge({ children, variant, ...props }) {
  return React.createElement('span', { ...props, 'data-variant': variant }, children);
};
`],
    ['src/components/ui/Button.js', `
const React = require('react');
exports.Button = function Button({ children, icon, variant, isLoading, loadingText, fullOnMobile, ...props }) {
  return React.createElement('button', { ...props, 'aria-busy': Boolean(isLoading) || undefined }, icon, children);
};
`],
    ['src/components/ui/Card.js', `
const React = require('react');
exports.Card = function Card({ children, className, ...props }) {
  return React.createElement('section', { ...props, className }, children);
};
`],
    ['src/components/ui/ConfirmDialog.js', `
const React = require('react');
exports.ConfirmDialog = function ConfirmDialog({ isOpen, onClose, onConfirm, title, description, confirmLabel, pendingLabel }) {
  if (!isOpen) return null;
  return React.createElement('div', { role: 'alertdialog', 'aria-label': title },
    React.createElement('h2', null, title),
    React.createElement('p', null, description),
    React.createElement('button', { type: 'button', onClick: onClose }, 'Cancel'),
    React.createElement('button', { type: 'button', onClick: onConfirm }, confirmLabel || pendingLabel || 'Confirm'));
};
`],
    ['src/components/ui/EmptyState.js', `
const React = require('react');
exports.EmptyState = function EmptyState({ title, description }) {
  return React.createElement('section', { 'data-empty-state': 'true' }, React.createElement('h2', null, title), React.createElement('p', null, description));
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
exports.PageHeader = function PageHeader({ title, description, icon, actions }) {
  return React.createElement('header', null, icon, React.createElement('h1', null, title), description && React.createElement('p', null, description), actions);
};
`],
    ['src/components/ui/Skeleton.js', `
const React = require('react');
exports.CardSkeletons = function CardSkeletons({ count }) {
  return React.createElement('div', { role: 'status', 'data-skeleton': String(count || 1) }, 'Loading');
};
`],
    ['src/store/auth.js', `
const React = require('react');
let state = { user: { id: 'fixture-owner' } };
const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = () => listeners.forEach((listener) => listener());
exports.useAuthStore = (selector) => selector(React.useSyncExternalStore(subscribe, () => state, () => state));
exports.__set = (next) => { state = next; emit(); };
`],
    ['src/store/toast.js', `
const record = (kind) => (message) => globalThis.__TM_TOASTS.push({ kind, message });
exports.toast = { success: record('success'), error: record('error'), warning: record('warning') };
`],
    ['src/lib/supabase/errors.js', `
exports.toAppError = (error, fallback) => error instanceof Error ? error : new Error(fallback);
`],
    ['src/i18n/useLocale.js', `
const React = require('react');
let locale = 'en';
const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = () => listeners.forEach((listener) => listener());
exports.__set = (next) => { locale = next; emit(); };
exports.useLocale = () => {
  const current = React.useSyncExternalStore(subscribe, () => locale, () => locale);
  return {
    locale: current,
    dir: current === 'ar' ? 'rtl' : 'ltr',
    t: (arabic, english) => current === 'ar' ? arabic : english,
    number: (value) => new Intl.NumberFormat(current === 'ar' ? 'ar-EG' : 'en-GB').format(value),
    date: (value, options) => new Intl.DateTimeFormat(current === 'ar' ? 'ar-EG' : 'en-GB', options).format(new Date(value)),
  };
};
`],
    ['src/features/admin/access/api.js', `
const React = require('react');
let access = { isPending: false, isFetching: false, isError: false, data: { is_owner: true }, refetch: async () => {} };
const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = () => listeners.forEach((listener) => listener());
exports.useAdminAccess = (userId) => {
  globalThis.__TM_ACCESS_USERS.push(userId);
  return React.useSyncExternalStore(subscribe, () => access, () => access);
};
exports.__set = (next) => { access = next; emit(); };
`],
    ['src/features/teams/api.js', `
const state = () => globalThis.__TM_FIXTURE;
const query = (value) => value || { data: [], isPending: false, isFetching: false, isError: false, refetch: async () => {} };
const mutation = (kind) => () => ({ isPending: false, mutateAsync: async (input) => {
  state().mutations.push({ kind, input: structuredClone(input) });
  if (kind === 'addMember' || kind === 'reviewMember') return 'active';
  return true;
} });
exports.useOwnerTeams = (enabled = true) => { state().hookEnabled.push({ hook: 'teams', enabled }); return query(state().teams); };
exports.useTeamAdminCandidates = (enabled = true) => { state().hookEnabled.push({ hook: 'adminCandidates', enabled }); return query(state().candidates); };
exports.useOwnerTeamMembers = (teamId) => query(state().members[teamId]);
exports.useOwnerTeamMemberCandidates = (teamId) => query(state().memberCandidates[teamId]);
exports.useCreateTeam = mutation('createTeam');
exports.useUpdateTeamDetails = mutation('updateTeamDetails');
exports.useSetTeamActive = mutation('setTeamActive');
exports.useSetTeamAdminSeat = mutation('setTeamAdminSeat');
exports.useAddTeamMember = mutation('addMember');
exports.useReviewTeamMember = mutation('reviewMember');
`],
    ['src/node_modules/react-router-dom/index.js', `
const React = require('react');
exports.Link = function Link({ to, children, ...props }) { return React.createElement('a', { ...props, href: to }, children); };
`],
    ['src/node_modules/lucide-react/index.js', `
const React = require('react');
module.exports = new Proxy({}, { get(_target, name) {
  if (name === '__esModule') return false;
  return function Icon(props) { return React.createElement('span', { ...props, 'aria-hidden': 'true', 'data-icon': String(name) }); };
} });
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
    url: 'http://localhost/owner/teams',
    pretendToBeVisual: true,
  });
  const names = [
    'window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver',
    'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'IS_REACT_ACT_ENVIRONMENT',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  const previous = new Map();
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
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
  const priorCssLoader = frontendRequire.extensions['.css'];
  frontendRequire.extensions['.css'] = (module) => { module.exports = {}; };
  return {
    dom,
    restore() {
      dom.window.close();
      if (priorCssLoader) frontendRequire.extensions['.css'] = priorCssLoader;
      else delete frontendRequire.extensions['.css'];
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function reactProps(element) {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
  return key ? element[key] : {};
}

function settle(turns = 4) {
  return (async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }
  })();
}

async function click(element) {
  assert.ok(element, 'Expected the requested mounted control to exist');
  await act(async () => { element.click(); await settle(); });
}

async function changeControl(element, value) {
  assert.ok(element, 'Expected the requested mounted form control to exist');
  await act(async () => {
    const view = element.ownerDocument.defaultView;
    const prototype = element.tagName === 'SELECT' ? view.HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype
        : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    const onChange = reactProps(element).onChange;
    if (typeof onChange === 'function') onChange({ target: element, currentTarget: element });
    if (element.tagName !== 'SELECT') element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  });
}

function findLabelControl(text, selector = 'input', root = document) {
  const label = [...root.querySelectorAll('label')].find((candidate) => candidate.textContent?.includes(text) && candidate.querySelector(selector));
  assert.ok(label, `Expected a label containing ${JSON.stringify(text)} with a ${selector} control`);
  return label.querySelector(selector);
}

function labelForControl(control) {
  if (control.id) {
    const associated = [...document.querySelectorAll('label[for]')].find((label) => label.htmlFor === control.id);
    if (associated) return associated;
  }
  return control.closest('label');
}

function buttonsContaining(text, root = document) {
  return [...root.querySelectorAll('button')].filter((button) => button.textContent?.includes(text));
}

function buttonContaining(text, root = document) {
  const button = buttonsContaining(text, root)[0];
  assert.ok(button, `Expected a button containing ${JSON.stringify(text)}`);
  return button;
}

function teamHeadings() {
  return [...document.querySelectorAll('h2')]
    .map((heading) => heading.textContent?.trim() || '')
    .filter((text) => ['Alpha Studio', 'Beta Operations', 'Gamma Labs'].includes(text));
}

function openDetailsContaining(text, root = document) {
  const details = [...root.querySelectorAll('details')].find((candidate) => candidate.querySelector('summary')?.textContent?.includes(text));
  assert.ok(details, `Expected a native details summary containing ${JSON.stringify(text)}`);
  return details;
}

async function mountPage(bundle, { fixture = defaultFixture(), access = { isPending: false, isFetching: false, isError: false, data: { is_owner: true }, refetch: async () => {} }, locale = 'en' } = {}) {
  globalThis.__TM_FIXTURE = fixture;
  globalThis.__TM_TOASTS = [];
  globalThis.__TM_ACCESS_USERS = [];
  bundle.auth.__set({ user: { id: OWNER_ID } });
  bundle.access.__set(access);
  bundle.locale.__set(locale);

  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(bundle.TeamsManagementPage)); await settle(); });
  return {
    fixture,
    async unmount() {
      await act(async () => { root.unmount(); await settle(); });
      document.getElementById('root').replaceChildren();
      delete globalThis.__TM_FIXTURE;
      delete globalThis.__TM_TOASTS;
      delete globalThis.__TM_ACCESS_USERS;
    },
  };
}

const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-teams-management-mounted-'));
let environment;
try {
  await writeHarnessFiles(harnessRoot);
  environment = installDom();
  ({ createRoot } = frontendRequire('react-dom/client'));
  const harnessRequire = createRequire(join(harnessRoot, 'package.json'));
  const bundle = {
    TeamsManagementPage: harnessRequire('./src/features/teams/TeamsManagementPage.js').default,
    auth: harnessRequire('./src/store/auth.js'),
    access: harnessRequire('./src/features/admin/access/api.js'),
    locale: harnessRequire('./src/i18n/useLocale.js'),
  };

  await test('mounted teams management page', async (t) => {
    await t.test('non-Owners are denied and owner-only queries remain disabled', async () => {
      const mounted = await mountPage(bundle, { access: { isPending: false, isFetching: false, isError: false, data: { is_owner: false }, refetch: async () => {} } });
      try {
        assert.ok(document.querySelector('[data-empty-state="true"]'), 'A non-Owner should receive the access-denied state');
        assert.equal(document.querySelector('form'), null, 'A non-Owner must not receive create or management forms');
        assert.deepEqual(mounted.fixture.hookEnabled, [
          { hook: 'teams', enabled: false },
          { hook: 'adminCandidates', enabled: false },
        ], 'Owner-only team and candidate queries must remain disabled');
        assert.equal(mounted.fixture.mutations.length, 0, 'A non-Owner must not be able to mutate team data');
      } finally { await mounted.unmount(); }
    });

    await t.test('search by team name, slug, and manager email combines with status filters and resets', async () => {
      const mounted = await mountPage(bundle);
      try {
        assert.ok([...document.querySelectorAll('h1')].some((heading) => heading.textContent?.includes('Internal teams')), 'The management heading should be present');
        const search = document.querySelector('input[type="search"]');
        assert.ok(search, 'Find-a-team search should be rendered');
        assert.ok(labelForControl(search)?.textContent?.includes('Find a team'), 'The team search should keep its accessible label');
        const alphaCard = document.querySelector('[aria-label="Alpha Studio"]');
        assert.ok(alphaCard?.textContent?.includes('4'), 'The Alpha card should surface its member_count metric');
        assert.deepEqual(teamHeadings().sort(), ['Alpha Studio', 'Beta Operations', 'Gamma Labs']);

        const all = buttonContaining('All teams');
        const active = buttonContaining('Active');
        const disabled = buttonContaining('Disabled');
        assert.ok(all.textContent?.includes('3'), 'All-teams filter should expose its count');
        assert.ok(active.textContent?.includes('2'), 'Active filter should expose its count');
        assert.ok(disabled.textContent?.includes('1'), 'Disabled filter should expose its count');

        await changeControl(search, 'Alpha Studio');
        assert.deepEqual(teamHeadings(), ['Alpha Studio'], 'Name search should narrow the team list');
        await changeControl(search, 'gamma-labs');
        assert.deepEqual(teamHeadings(), ['Gamma Labs'], 'Slug search should narrow the team list');
        await changeControl(search, 'manager.beta@example.test');
        assert.deepEqual(teamHeadings(), ['Beta Operations'], 'Assigned manager email should be searchable');

        await changeControl(search, 'Alpha');
        await click(disabled);
        assert.deepEqual(teamHeadings(), [], 'A combined name and Disabled filter should show no teams when they do not overlap');
        assert.ok(document.querySelector('[role="status"]'), 'The no-results state should be announced');
        await click(all);
        assert.deepEqual(teamHeadings(), ['Alpha Studio'], 'Resetting status to All teams should preserve the active text query');
        await changeControl(search, 'no-such-team');
        assert.deepEqual(teamHeadings(), [], 'An unmatched query should show no teams');
        await changeControl(search, '');
        assert.deepEqual(teamHeadings().sort(), ['Alpha Studio', 'Beta Operations', 'Gamma Labs'], 'Clearing search should reset the list');
      } finally { await mounted.unmount(); }
    });

    await t.test('New team control opens the named create disclosure and focuses the team-name field', async () => {
      const mounted = await mountPage(bundle);
      try {
        const trigger = buttonContaining('New team');
        await click(trigger);
        const createDetails = document.querySelector('#teams-create');
        assert.ok(createDetails?.open, 'The New team header action should open the native create disclosure');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'The disclosure trigger should expose its expanded state');
        assert.equal(document.activeElement, findLabelControl('Team name', 'input', createDetails), 'Opening New team should focus the team-name input');
        assert.equal(trigger.getAttribute('aria-controls'), createDetails.id, 'The trigger must identify its disclosure');
        assert.ok(createDetails.querySelector('summary')?.textContent?.includes('Create team'), 'The native disclosure summary should identify the creation action');
        assert.ok(createDetails.querySelector('form'), 'The expanded disclosure should contain the creation form');
      } finally { await mounted.unmount(); }
    });

    await t.test('create details form trims the name, normalizes the slug, and remains open after success', async () => {
      const mounted = await mountPage(bundle);
      try {
        await click(buttonContaining('New team'));
        const createDetails = document.querySelector('#teams-create');
        assert.ok(createDetails?.open, 'New team should open the create form');
        const name = findLabelControl('Team name', 'input', createDetails);
        const slug = findLabelControl('URL slug', 'input', createDetails);
        await changeControl(name, '  New QA Team  ');
        await changeControl(slug, '  QA-OPS  ');
        const form = createDetails.querySelector('form');
        assert.ok(form, 'New team details should contain a form');
        await act(async () => {
          const submit = reactProps(form).onSubmit;
          assert.equal(typeof submit, 'function', 'The real page should own the create form submit handler');
          submit({ preventDefault() {}, target: form, currentTarget: form });
          await settle();
        });
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'createTeam').map(({ input }) => input), [
          { name: 'New QA Team', slug: 'qa-ops' },
        ], 'Creation must trim user text and lowercase the slug before saving');
        assert.equal(createDetails.open, true, 'A successful create should leave the form open');
        assert.equal(name.value, '', 'A successful create should clear the team-name field');
        assert.equal(slug.value, '', 'A successful create should clear the slug field');
      } finally { await mounted.unmount(); }
    });

    await t.test('team details edit trims the name and lowercases the URL slug', async () => {
      const mounted = await mountPage(bundle);
      try {
        const alphaCard = document.querySelector('[aria-label="Alpha Studio"]');
        await click(buttonContaining('Edit details', alphaCard));
        const name = findLabelControl('Team name', 'input', alphaCard);
        const slug = findLabelControl('URL slug', 'input', alphaCard);
        await changeControl(name, '  Alpha Studio Updated  ');
        await changeControl(slug, '  ALPHA-UPDATED  ');
        const form = alphaCard.querySelector('form');
        await act(async () => {
          const submit = reactProps(form).onSubmit;
          assert.equal(typeof submit, 'function', 'The real details form should own its submit handler');
          submit({ preventDefault() {}, target: form, currentTarget: form });
          await settle();
        });
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'updateTeamDetails').map(({ input }) => input), [
          { teamId: TEAM_ALPHA, name: 'Alpha Studio Updated', slug: 'alpha-updated' },
        ], 'Editing should target this team and normalize both submitted fields');
      } finally { await mounted.unmount(); }
    });

    await t.test('Head seat saves the selected account with the exact team-scoped permission set', async () => {
      const mounted = await mountPage(bundle);
      try {
        const seatDetails = openDetailsContaining('Team Head');
        await click(seatDetails.querySelector('summary'));
        const account = findLabelControl('Existing Auth account', 'select', seatDetails);
        await changeControl(account, 'new-head');
        const membersCheckbox = [...seatDetails.querySelectorAll('label')]
          .find((label) => label.querySelector('input[type="checkbox"]') && label.textContent?.includes('Members'))
          ?.querySelector('input[type="checkbox"]');
        const tasksCheckbox = [...seatDetails.querySelectorAll('label')]
          .find((label) => label.querySelector('input[type="checkbox"]') && label.textContent?.includes('Tasks'))
          ?.querySelector('input[type="checkbox"]');
        assert.ok(membersCheckbox && tasksCheckbox, 'The seat should expose independently editable permissions');
        await click(membersCheckbox);
        await click(tasksCheckbox);
        await click(buttonContaining('Save seat', seatDetails));
        const saved = mounted.fixture.mutations.find(({ kind }) => kind === 'setTeamAdminSeat');
        assert.ok(saved, 'Saving the seat should call the mocked mutation');
        assert.equal(saved.input.teamId, TEAM_ALPHA);
        assert.equal(saved.input.role, 'head');
        assert.equal(saved.input.userId, 'new-head');
        assert.deepEqual(Object.keys(saved.input.permissions).sort(), [...PERMISSION_KEYS].sort(), 'The saved permission object should have exactly the supported permission keys');
        assert.deepEqual(saved.input.permissions, {
          dashboard: true, members: true, tasks: false, ranking: false, notes: true,
          announcements: false, whatsapp: false, ai_assistant: false,
        }, 'Only the changed team-scoped permission values should be saved');
      } finally { await mounted.unmount(); }
    });

    await t.test('membership details preserve add, approve, suspend, remove, and status controls', async () => {
      const mounted = await mountPage(bundle);
      try {
        const membershipDetails = openDetailsContaining('Team member memberships');
        await click(membershipDetails.querySelector('summary'));
        const addSelect = findLabelControl('Add an existing member to this team', 'select', membershipDetails);
        await changeControl(addSelect, '201');
        await click(buttonContaining('Add to team', membershipDetails));
        assert.ok(mounted.fixture.mutations.some(({ kind, input }) => kind === 'addMember' && input.teamId === TEAM_ALPHA && input.memberId === 201), 'Adding a selected member should be team-scoped');

        const pendingRow = [...membershipDetails.querySelectorAll('article')].find((row) => row.textContent?.includes('Parker Pending'));
        const activeRow = [...membershipDetails.querySelectorAll('article')].find((row) => row.textContent?.includes('Avery Active'));
        const suspendedRow = [...membershipDetails.querySelectorAll('article')].find((row) => row.textContent?.includes('Riley Suspended'));
        assert.ok(pendingRow && activeRow && suspendedRow, 'Fixtures for pending, active, and suspended membership states should render');
        await click(buttonContaining('Approve', pendingRow));
        await click(buttonContaining('Suspend here', activeRow));
        await click(buttonContaining('Remove here', suspendedRow));
        const decisions = mounted.fixture.mutations.filter(({ kind }) => kind === 'reviewMember').map(({ input }) => input);
        assert.deepEqual(decisions, [
          { teamId: TEAM_ALPHA, memberId: 102, decision: 'approve' },
          { teamId: TEAM_ALPHA, memberId: 101, decision: 'suspend' },
          { teamId: TEAM_ALPHA, memberId: 103, decision: 'remove' },
        ], 'Membership decisions should target only the selected team and member');
        assert.ok(membershipDetails.textContent?.includes('Active in team'), 'Active membership status should remain visible');
        assert.ok(membershipDetails.textContent?.includes('Pending review'), 'Pending membership status should remain visible');
        assert.ok(membershipDetails.textContent?.includes('Suspended in team'), 'Suspended membership status should remain visible');
        assert.ok(membershipDetails.textContent?.includes('Removed from team'), 'Removed membership status should remain visible');
      } finally { await mounted.unmount(); }
    });

    await t.test('disabling an active team requires confirmation and does not delete it', async () => {
      const mounted = await mountPage(bundle);
      try {
        const disableButton = buttonContaining('Disable team');
        await click(disableButton);
        assert.equal(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamActive').length, 0, 'Opening the confirmation must not change status');
        const dialog = document.querySelector('[role="alertdialog"]');
        assert.ok(dialog, 'Disabling an active team should open a confirmation dialog');
        await click(buttonContaining('Disable team', dialog));
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamActive').map(({ input }) => input), [
          { teamId: TEAM_ALPHA, active: false },
        ], 'Confirming should disable the selected team without removing it');
      } finally { await mounted.unmount(); }
    });

    await t.test('disabled teams cannot add memberships or save a seat, but can remove an existing assignment', async () => {
      const mounted = await mountPage(bundle);
      try {
        const betaCard = document.querySelector('[aria-label="Beta Operations"]');
        assert.ok(betaCard, 'The disabled team card should remain visible');
        assert.ok(![...betaCard.querySelectorAll('summary')].some((summary) => summary.textContent?.includes('Team member memberships')), 'Disabled teams should not expose an openable membership manager');
        assert.ok(![...betaCard.querySelectorAll('button')].some((button) => button.textContent?.includes('Add to team')), 'Disabled teams should not show member-add controls');

        const monitorDetails = openDetailsContaining('Team Monitor', betaCard);
        await click(monitorDetails.querySelector('summary'));
        const account = findLabelControl('Existing Auth account', 'select', monitorDetails);
        assert.equal(account.disabled, true, 'A disabled team should not allow changing its seat account');
        assert.equal(monitorDetails.querySelector('fieldset')?.disabled, true, 'A disabled team should not allow changing its seat permissions');
        const saveButton = buttonContaining('Save seat', monitorDetails);
        assert.equal(saveButton.disabled, true, 'A disabled team should not allow saving its seat');
        await click(saveButton);
        assert.equal(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamAdminSeat').length, 0, 'Clicking a disabled save control must not call the seat mutation');

        const removeButton = buttonContaining('Remove assignment only', monitorDetails);
        assert.equal(removeButton.disabled, false, 'An existing assignment remains removable while its team is disabled');
        await click(removeButton);
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamAdminSeat').map(({ input }) => input), [
          { teamId: TEAM_BETA, role: 'monitor', userId: null, permissions: null },
        ], 'Removing a disabled-team assignment should remain team-scoped');
      } finally { await mounted.unmount(); }
    });

    await t.test('Arabic locale sets RTL direction and renders Arabic labels', async () => {
      const mounted = await mountPage(bundle, { locale: 'ar' });
      try {
        assert.equal(document.querySelector('[dir="rtl"]') !== null, true, 'The teams page should set RTL direction for Arabic');
        const search = document.querySelector('input[type="search"]');
        const label = search && labelForControl(search);
        assert.ok(label, 'The team search should retain an accessible label');
        assert.match(label.textContent || '', /[\u0600-\u06ff]/, 'Search labels should be translated into Arabic');
        assert.match(document.body.textContent || '', /[\u0600-\u06ff]/, 'The mounted Arabic page should render Arabic UI copy');
      } finally { await mounted.unmount(); }
    });

    await t.test('access and team loading/error states fail closed', async () => {
      const loadingAccess = await mountPage(bundle, {
        access: { isPending: true, isFetching: true, isError: false, data: undefined, refetch: async () => {} },
      });
      try {
        assert.ok(document.querySelector('[data-skeleton]'), 'Access loading should render skeletons instead of management controls');
        assert.equal(document.querySelector('form'), null, 'Create controls must stay hidden until Owner access is verified');
      } finally { await loadingAccess.unmount(); }

      const loadingTeams = await mountPage(bundle, {
        fixture: defaultFixture({ teams: { data: undefined, isPending: true, isFetching: true, isError: false, refetch: async () => {} } }),
      });
      try {
        assert.ok(document.querySelector('[data-skeleton]'), 'Team loading should render skeletons');
        assert.equal(teamHeadings().length, 0, 'No stale team data should render while the team query is pending');
      } finally { await loadingTeams.unmount(); }

      const errorTeams = await mountPage(bundle, {
        fixture: defaultFixture({ teams: { data: undefined, isPending: false, isFetching: false, isError: true, refetch: async () => {} } }),
      });
      try {
        assert.ok(document.querySelector('[role="alert"]'), 'Team query failure should render an accessible error');
        assert.equal(teamHeadings().length, 0, 'Team query errors should not expose stale or fabricated team cards');
      } finally { await errorTeams.unmount(); }
    });
  });
} finally {
  delete globalThis.__TM_FIXTURE;
  delete globalThis.__TM_TOASTS;
  delete globalThis.__TM_ACCESS_USERS;
  environment?.restore();
  await rm(harnessRoot, { recursive: true, force: true });
}
