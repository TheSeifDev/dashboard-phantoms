// Mounted regression coverage for the real TeamsManagementPage and TeamPage.
// Run from the repository root with:
//   node frontend/scripts/teams-management-mounted.test.mjs
// The harness compiles the actual pages, the extracted seat/member panels, and the
// permission constants into a temporary directory outside the repository. All data
// hooks, auth/access, locale, routing, and UI primitives are deterministic local
// mocks; no database or network is used.
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

const defaultProfile = {
  tagline: 'Fixture tagline for Alpha Studio.',
  accent: 'violet',
  focus_areas: ['Backend', 'Research'],
  updated_at: '2026-01-07T00:00:00.000Z',
};

function defaultFixture(overrides = {}) {
  return {
    mutations: [],
    hookEnabled: [],
    teams: queryState(teamFixtures),
    candidates: queryState(adminCandidates),
    members: { [TEAM_ALPHA]: queryState(alphaMembers), [TEAM_BETA]: queryState([]) },
    memberCandidates: { [TEAM_ALPHA]: queryState(alphaMemberCandidates), [TEAM_BETA]: queryState([]) },
    profiles: { [TEAM_ALPHA]: queryState({ team_id: TEAM_ALPHA, slug: 'alpha-studio', name: 'Alpha Studio', is_active: true, ...defaultProfile }), [TEAM_BETA]: queryState({ team_id: TEAM_BETA, slug: 'beta-ops', name: 'Beta Operations', is_active: false, tagline: '', accent: 'primary', focus_areas: [], updated_at: null }) },
    ...overrides,
  };
}

function compileCommonJs(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}

const compiledSources = [
  ['src/features/teams/TeamsManagementPage.tsx', 'src/features/teams/TeamsManagementPage.js'],
  ['src/features/teams/TeamPage.tsx', 'src/features/teams/TeamPage.js'],
  ['src/features/teams/components/SeatCard.tsx', 'src/features/teams/components/SeatCard.js'],
  ['src/features/teams/components/MemberRoster.tsx', 'src/features/teams/components/MemberRoster.js'],
  ['src/features/teams/components/teamCopy.ts', 'src/features/teams/components/teamCopy.js'],
  ['src/features/admin/access/permissions.ts', 'src/features/admin/access/permissions.js'],
];

async function writeHarnessFiles(harnessRoot) {
  await writeFile(join(harnessRoot, 'package.json'), '{"type":"commonjs"}\n');
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');

  for (const [source, output] of compiledSources) {
    const sourcePath = join(frontendRoot, source);
    const outputPath = join(harnessRoot, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, compileCommonJs(await readFile(sourcePath, 'utf8'), sourcePath));
  }
  // The real pages may import their page-scoped stylesheet. The mounted tests assert
  // behavior and semantics rather than computed CSS, so a temporary empty module
  // keeps TSX compilation and import resolution independent of Vite.
  await writeFile(join(harnessRoot, 'src/features/teams/teams-management.css'), '');

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
exports.EmptyState = function EmptyState({ title, description, action }) {
  return React.createElement('section', { 'data-empty-state': 'true' }, React.createElement('h2', null, title), React.createElement('p', null, description), action);
};
`],
    ['src/components/ui/ErrorState.js', `
const React = require('react');
exports.ErrorState = function ErrorState({ message, onRetry }) {
  return React.createElement('div', { role: 'alert' }, React.createElement('p', null, message), onRetry && React.createElement('button', { type: 'button', onClick: onRetry }, 'Retry'));
};
`],
    ['src/components/ui/Modal.js', `
const React = require('react');
exports.Modal = function Modal({ isOpen, onClose, title, subtitle, children, footer }) {
  if (!isOpen) return null;
  return React.createElement('div', { role: 'dialog', 'aria-label': title },
    React.createElement('h2', null, title),
    subtitle ? React.createElement('p', null, subtitle) : null,
    children,
    footer ? React.createElement('footer', null, footer) : null);
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
let access = { isPending: false, isFetching: false, isError: false, data: { is_owner: true, owner_authority: true }, refetch: async () => {} };
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
    ['src/features/teams/profileApi.js', `
const state = () => globalThis.__TM_FIXTURE;
const query = (value) => value || { data: undefined, isPending: false, isFetching: false, isError: false, refetch: async () => {} };
exports.useTeamProfile = (teamId) => query(state().profiles[teamId]);
exports.useSaveTeamProfile = () => ({ isPending: false, mutateAsync: async (input) => {
  state().mutations.push({ kind: 'saveTeamProfile', input: structuredClone(input) });
  return { team_id: input.teamId, tagline: input.tagline, accent: input.accent, focus_areas: input.focusAreas, updated_at: null };
} });
`],
    ['src/node_modules/gsap/index.js', `
const timeline = () => ({ fromTo: () => timeline(), kill() {}, to: () => timeline() });
const gsap = { timeline, fromTo: () => ({ kill() {} }), to: () => ({ kill() {} }) };
exports.default = gsap;
exports.gsap = gsap;
`],
    ['src/node_modules/react-router-dom/index.js', `
const React = require('react');
let params = { teamId: '' };
exports.__setParams = (next) => { params = next; };
exports.useParams = () => params;
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
    url: 'http://localhost/admin/teams',
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

function buttonsContaining(text, root = document) {
  return [...root.querySelectorAll('button')].filter((button) => button.textContent?.includes(text));
}

function buttonContaining(text, root = document) {
  const button = buttonsContaining(text, root)[0];
  assert.ok(button, `Expected a button containing ${JSON.stringify(text)}`);
  return button;
}

/* ---------------- list page helpers ---------------- */
function teamCards() {
  return [...document.querySelectorAll('.tms-card')];
}

function cardNames() {
  return teamCards().map((card) => card.querySelector('.tms-card-identity strong')?.textContent?.trim() || '').filter(Boolean);
}

function card(name) {
  const found = teamCards().find((candidate) => candidate.querySelector('.tms-card-identity strong')?.textContent?.trim() === name);
  assert.ok(found, `Expected a team card for ${JSON.stringify(name)}`);
  return found;
}

/* ---------------- team page helpers ---------------- */
function hero() {
  const node = document.querySelector('.tms-hero');
  assert.ok(node, 'Expected the team page hero');
  return node;
}

function openTab(label) {
  const tabs = [...document.querySelectorAll('.tms-tabs button')];
  const tab = tabs.find((candidate) => candidate.textContent?.includes(label));
  assert.ok(tab, `Expected the ${JSON.stringify(label)} tab`);
  return click(tab);
}

function seatCard(role, root = document) {
  const seat = [...root.querySelectorAll('.tms-seat')]
    .find((candidate) => candidate.querySelector('.tms-seat-tag')?.textContent?.includes(role));
  assert.ok(seat, `Expected the ${role} seat card`);
  return seat;
}

async function openSeatEditor(role, root = document) {
  const seat = seatCard(role, root);
  const trigger = [...seat.querySelectorAll('button')]
    .find((button) => ['Edit seat', 'Assign Team Head', 'Assign Team Monitor', 'Open editor'].some((label) => button.textContent?.includes(label)));
  assert.ok(trigger, `Expected an editor trigger inside the ${role} seat`);
  await click(trigger);
  return seatCard(role, root);
}

function membersSection() {
  const section = document.querySelector('.tms-members');
  assert.ok(section, 'Expected the member enrollment section');
  return section;
}

function memberRow(name, root = membersSection()) {
  const row = [...root.querySelectorAll('.tms-member')].find((candidate) => candidate.textContent?.includes(name));
  assert.ok(row, `Expected a member row for ${JSON.stringify(name)}`);
  return row;
}

async function mount(bundle, { page = 'list', teamId = TEAM_ALPHA, fixture = defaultFixture(), access = { isPending: false, isFetching: false, isError: false, data: { is_owner: true, owner_authority: true }, refetch: async () => {} }, locale = 'en' } = {}) {
  globalThis.__TM_FIXTURE = fixture;
  globalThis.__TM_TOASTS = [];
  globalThis.__TM_ACCESS_USERS = [];
  bundle.auth.__set({ user: { id: OWNER_ID } });
  bundle.access.__set(access);
  bundle.locale.__set(locale);
  bundle.router.__setParams({ teamId });

  const root = createRoot(document.getElementById('root'));
  const Component = page === 'team' ? bundle.TeamPage : bundle.TeamsManagementPage;
  await act(async () => { root.render(React.createElement(Component)); await settle(); });
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
    TeamPage: harnessRequire('./src/features/teams/TeamPage.js').default,
    auth: harnessRequire('./src/store/auth.js'),
    access: harnessRequire('./src/features/admin/access/api.js'),
    locale: harnessRequire('./src/i18n/useLocale.js'),
    router: harnessRequire('./src/node_modules/react-router-dom/index.js'),
  };

  await test('mounted teams management pages', async (t) => {
    await t.test('non-Owners are denied and owner-only queries remain disabled', async () => {
      const mounted = await mount(bundle, { access: { isPending: false, isFetching: false, isError: false, data: { is_owner: false, owner_authority: false }, refetch: async () => {} } });
      try {
        assert.ok(document.querySelector('[data-empty-state="true"]'), 'A non-Owner should receive the access-denied state');
        assert.equal(document.querySelector('form'), null, 'A non-Owner must not receive create or management forms');
        assert.deepEqual(mounted.fixture.hookEnabled, [
          { hook: 'teams', enabled: false },
        ], 'The Owner-only team query must remain disabled');
        assert.equal(mounted.fixture.mutations.length, 0, 'A non-Owner must not be able to mutate team data');
      } finally { await mounted.unmount(); }
    });

    await t.test('the team list renders one card per team and links to its own page', async () => {
      const mounted = await mount(bundle);
      try {
        assert.ok([...document.querySelectorAll('h1')].some((heading) => heading.textContent?.includes('Internal teams')), 'The management heading should be present');
        assert.deepEqual(cardNames().sort(), ['Alpha Studio', 'Beta Operations', 'Gamma Labs'], 'Every team should appear as a card');
        assert.equal(card('Alpha Studio').getAttribute('href'), `/admin/teams/${TEAM_ALPHA}`, 'Each card must link to its dedicated team page');
        assert.match(card('Alpha Studio').textContent || '', /4/, 'The Alpha card should surface its member count');
        assert.match(card('Alpha Studio').textContent || '', /head\.alpha/, 'The Alpha card should surface its Head account');
        assert.match(card('Beta Operations').textContent || '', /Seat open/, 'A team without a Head should show an open seat');
        assert.match(card('Beta Operations').textContent || '', /Disabled/, 'A disabled team should be labelled');
        assert.match(heroless(), /^$/, 'The list page must not render an inline team detail panel');
      } finally { await mounted.unmount(); }
    });

    await t.test('search by team name, slug, and manager email combines with status filters and resets', async () => {
      const mounted = await mount(bundle);
      try {
        const search = document.querySelector('input[type="search"]');
        assert.ok(search, 'Find-a-team search should be rendered');
        assert.match(search.getAttribute('aria-label') || '', /Find a team/, 'The team search should keep its accessible label');

        const all = buttonContaining('All');
        const active = buttonContaining('Active');
        const disabled = buttonContaining('Disabled');
        assert.ok(all.textContent?.includes('3'), 'All-teams filter should expose its count');
        assert.ok(active.textContent?.includes('2'), 'Active filter should expose its count');
        assert.ok(disabled.textContent?.includes('1'), 'Disabled filter should expose its count');

        await changeControl(search, 'Alpha Studio');
        assert.deepEqual(cardNames(), ['Alpha Studio'], 'Name search should narrow the grid');
        await changeControl(search, 'gamma-labs');
        assert.deepEqual(cardNames(), ['Gamma Labs'], 'Slug search should narrow the grid');
        await changeControl(search, 'manager.beta@example.test');
        assert.deepEqual(cardNames(), ['Beta Operations'], 'Assigned manager email should be searchable');

        await changeControl(search, 'Alpha');
        await click(disabled);
        assert.deepEqual(cardNames(), [], 'A combined name and Disabled filter should show no teams when they do not overlap');
        assert.ok(document.querySelector('[data-empty-state="true"]'), 'The no-results state should be announced');
        await click(all);
        assert.deepEqual(cardNames(), ['Alpha Studio'], 'Resetting status to All should preserve the active text query');
        await changeControl(search, 'no-such-team');
        assert.deepEqual(cardNames(), [], 'An unmatched query should show no teams');
        await changeControl(search, '');
        assert.deepEqual(cardNames().sort(), ['Alpha Studio', 'Beta Operations', 'Gamma Labs'], 'Clearing search should reset the grid');
      } finally { await mounted.unmount(); }
    });

    await t.test('New team opens a modal, focuses the name field, and normalizes the submitted values', async () => {
      const mounted = await mount(bundle);
      try {
        await click(buttonContaining('New team'));
        const dialog = document.querySelector('[role="dialog"]');
        assert.ok(dialog, 'The New team action should open a modal dialog');
        const name = findLabelControl('Team name', 'input', dialog);
        const slug = findLabelControl('URL slug', 'input', dialog);
        assert.equal(document.activeElement, name, 'Opening the dialog should focus the team-name input');

        await changeControl(name, '  New QA Team  ');
        await changeControl(slug, '  QA-OPS  ');
        const form = dialog.querySelector('form');
        assert.ok(form, 'The dialog should contain the creation form');
        await act(async () => {
          const submit = reactProps(form).onSubmit;
          assert.equal(typeof submit, 'function', 'The real page should own the create form submit handler');
          submit({ preventDefault() {}, target: form, currentTarget: form });
          await settle();
        });
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'createTeam').map(({ input }) => input), [
          { name: 'New QA Team', slug: 'qa-ops' },
        ], 'Creation must trim user text and lowercase the slug before saving');
        assert.equal(document.querySelector('[role="dialog"]'), null, 'A successful create should close the dialog');
      } finally { await mounted.unmount(); }
    });

    await t.test('the team page renders its own hero, customization, and sections', async () => {
      const mounted = await mount(bundle, { page: 'team' });
      try {
        assert.match(hero().textContent || '', /Alpha Studio/, 'The hero should identify the team');
        assert.match(hero().textContent || '', /alpha-studio/, 'The hero should show the team slug');
        assert.match(hero().textContent || '', /Fixture tagline for Alpha Studio/, 'The saved team tagline should render in the hero');
        assert.match(hero().textContent || '', /Backend/, 'Saved focus areas should render in the hero');
        assert.equal(document.querySelector('.teams-management')?.getAttribute('data-accent'), 'violet', 'The saved accent should drive the page accent');
        const tabs = [...document.querySelectorAll('.tms-tabs button')].map((tab) => tab.textContent || '');
        assert.equal(tabs.length, 5, 'The team page should expose five sections');
        for (const label of ['Overview', 'Leadership', 'Members', 'Customize', 'Settings']) {
          assert.ok(tabs.some((tab) => tab.includes(label)), `Missing the ${label} section`);
        }
        assert.ok(document.querySelector('.tms-stat-grid'), 'The overview should show real team stats');
      } finally { await mounted.unmount(); }
    });

    await t.test('an unknown team id fails closed with a way back to the list', async () => {
      const mounted = await mount(bundle, { page: 'team', teamId: 'missing-team' });
      try {
        assert.ok(document.querySelector('[data-empty-state="true"]'), 'An unknown team should render an empty state');
        assert.equal(document.querySelector('.tms-hero'), null, 'No hero should render for a team that does not exist');
        assert.equal(document.querySelector('a.tms-back-link')?.getAttribute('href'), '/admin/teams', 'The empty state should link back to the team list');
      } finally { await mounted.unmount(); }
    });

    await t.test('Head seat saves the selected account with the exact team-scoped permission set', async () => {
      const mounted = await mount(bundle, { page: 'team' });
      try {
        await openTab('Leadership');
        const seat = await openSeatEditor('Head');
        const account = findLabelControl('Existing Auth account', 'select', seat);
        await changeControl(account, 'new-head');
        const membersCheckbox = [...seat.querySelectorAll('label')]
          .find((label) => label.querySelector('input[type="checkbox"]') && label.textContent?.includes('Members'))
          ?.querySelector('input[type="checkbox"]');
        const tasksCheckbox = [...seat.querySelectorAll('label')]
          .find((label) => label.querySelector('input[type="checkbox"]') && label.textContent?.includes('Tasks'))
          ?.querySelector('input[type="checkbox"]');
        assert.ok(membersCheckbox && tasksCheckbox, 'The seat should expose independently editable permissions');
        await click(membersCheckbox);
        await click(tasksCheckbox);
        await click(buttonContaining('Save seat', seat));
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
      const mounted = await mount(bundle, { page: 'team' });
      try {
        await openTab('Members');
        const section = membersSection();
        const addSelect = findLabelControl('Add an existing member to this team', 'select', section);
        await changeControl(addSelect, '201');
        await click(buttonContaining('Add', section));
        assert.ok(mounted.fixture.mutations.some(({ kind, input }) => kind === 'addMember' && input.teamId === TEAM_ALPHA && input.memberId === 201), 'Adding a selected member should be team-scoped');

        await click(buttonContaining('Approve', memberRow('Parker Pending')));
        await click(buttonContaining('Suspend', memberRow('Avery Active')));
        await click(buttonContaining('Remove', memberRow('Riley Suspended')));
        const decisions = mounted.fixture.mutations.filter(({ kind }) => kind === 'reviewMember').map(({ input }) => input);
        assert.deepEqual(decisions, [
          { teamId: TEAM_ALPHA, memberId: 102, decision: 'approve' },
          { teamId: TEAM_ALPHA, memberId: 101, decision: 'suspend' },
          { teamId: TEAM_ALPHA, memberId: 103, decision: 'remove' },
        ], 'Membership decisions should target only the selected team and member');
        assert.ok(section.textContent?.includes('Active'), 'Active membership status should remain visible');
        assert.ok(section.textContent?.includes('Pending review'), 'Pending membership status should remain visible');
        assert.ok(section.textContent?.includes('Suspended'), 'Suspended membership status should remain visible');
        assert.ok(section.textContent?.includes('Removed'), 'Removed membership status should remain visible');
        const totals = section.querySelector('.tms-member-totals')?.textContent || '';
        assert.match(totals, /1\s*active/, 'The enrollment header should expose the active total');
        assert.match(totals, /1\s*pending/, 'The enrollment header should expose the pending total');
      } finally { await mounted.unmount(); }
    });

    await t.test('customization saves the tagline, accent, and focus areas for this team only', async () => {
      const mounted = await mount(bundle, { page: 'team' });
      try {
        await openTab('Customize');
        const tagline = findLabelControl('Short team tagline', 'textarea');
        await changeControl(tagline, '  Building the core platform.  ');
        await click(buttonContaining('Violet', document.querySelector('.tms-accent-options')));
        await click(buttonContaining('Amber', document.querySelector('.tms-accent-options')));
        const focusInput = document.querySelector('.tms-focus-add input');
        await changeControl(focusInput, 'Platform');
        await click(buttonContaining('Add', document.querySelector('.tms-focus-add')));
        await click(buttonContaining('Save customization'));
        const saved = mounted.fixture.mutations.find(({ kind }) => kind === 'saveTeamProfile');
        assert.ok(saved, 'Saving the customization should call the mocked mutation');
        assert.equal(saved.input.teamId, TEAM_ALPHA, 'Customization must stay scoped to this team');
        assert.equal(saved.input.tagline, 'Building the core platform.', 'The tagline should be trimmed before saving');
        assert.equal(saved.input.accent, 'amber', 'The last chosen accent should be saved');
        assert.deepEqual(saved.input.focusAreas, ['Backend', 'Research', 'Platform'], 'Focus areas should keep the saved entries and append the new one');
      } finally { await mounted.unmount(); }
    });

    await t.test('settings edit trims the name and lowercases the URL slug', async () => {
      const mounted = await mount(bundle, { page: 'team' });
      try {
        await openTab('Settings');
        await click(buttonContaining('Edit details'));
        const form = document.querySelector('.tms-edit-form');
        assert.ok(form, 'Editing should reveal the inline details form');
        const name = findLabelControl('Team name', 'input', form);
        const slug = findLabelControl('URL slug', 'input', form);
        await changeControl(name, '  Alpha Studio Updated  ');
        await changeControl(slug, '  ALPHA-UPDATED  ');
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

    await t.test('disabling an active team requires confirmation and does not delete it', async () => {
      const mounted = await mount(bundle, { page: 'team' });
      try {
        await click(buttonContaining('Disable', hero()));
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
      const mounted = await mount(bundle, { page: 'team', teamId: TEAM_BETA });
      try {
        assert.match(hero().textContent || '', /Beta Operations/, 'The disabled team page should still render');

        await openTab('Members');
        assert.equal(document.querySelector('.tms-members'), null, 'Disabled teams should not expose the membership manager');
        assert.ok(document.querySelector('.tms-disabled'), 'Disabled teams should explain why membership management is paused');

        await openTab('Leadership');
        const seat = await openSeatEditor('Monitor');
        const account = findLabelControl('Existing Auth account', 'select', seat);
        assert.equal(account.disabled, true, 'A disabled team should not allow changing its seat account');
        const permissionInputs = [...seat.querySelectorAll('input[type="checkbox"]')];
        assert.ok(permissionInputs.length > 0, 'The seat editor should expose permission toggles');
        assert.ok(permissionInputs.every((input) => input.disabled), 'A disabled team should not allow changing its seat permissions');
        const saveButton = buttonContaining('Save seat', seat);
        assert.equal(saveButton.disabled, true, 'A disabled team should not allow saving its seat');
        await click(saveButton);
        assert.equal(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamAdminSeat').length, 0, 'Clicking a disabled save control must not call the seat mutation');

        const removeButton = buttonContaining('Remove', seat);
        assert.equal(removeButton.disabled, false, 'An existing assignment remains removable while its team is disabled');
        await click(removeButton);
        assert.deepEqual(mounted.fixture.mutations.filter(({ kind }) => kind === 'setTeamAdminSeat').map(({ input }) => input), [
          { teamId: TEAM_BETA, role: 'monitor', userId: null, permissions: null },
        ], 'Removing a disabled-team assignment should remain team-scoped');
      } finally { await mounted.unmount(); }
    });

    await t.test('Arabic locale sets RTL direction and renders Arabic labels', async () => {
      const mounted = await mount(bundle, { locale: 'ar' });
      try {
        assert.equal(document.querySelector('[dir="rtl"]') !== null, true, 'The teams page should set RTL direction for Arabic');
        const search = document.querySelector('input[type="search"]');
        assert.ok(search, 'The team search should render in Arabic too');
        assert.match(search.getAttribute('aria-label') || '', /[\u0600-\u06ff]/, 'Search labels should be translated into Arabic');
        assert.match(document.body.textContent || '', /[\u0600-\u06ff]/, 'The mounted Arabic page should render Arabic UI copy');
      } finally { await mounted.unmount(); }

      const arabicTeam = await mount(bundle, { page: 'team', locale: 'ar' });
      try {
        assert.equal(document.querySelector('[dir="rtl"]') !== null, true, 'The team page should set RTL direction for Arabic');
        assert.match(document.body.textContent || '', /[\u0600-\u06ff]/, 'The mounted Arabic team page should render Arabic UI copy');
      } finally { await arabicTeam.unmount(); }
    });

    await t.test('access and team loading/error states fail closed', async () => {
      const loadingAccess = await mount(bundle, {
        access: { isPending: true, isFetching: true, isError: false, data: undefined, refetch: async () => {} },
      });
      try {
        assert.ok(document.querySelector('[data-skeleton]'), 'Access loading should render skeletons instead of management controls');
        assert.equal(document.querySelector('form'), null, 'Create controls must stay hidden until Owner access is verified');
      } finally { await loadingAccess.unmount(); }

      const loadingTeams = await mount(bundle, {
        fixture: defaultFixture({ teams: { data: undefined, isPending: true, isFetching: true, isError: false, refetch: async () => {} } }),
      });
      try {
        assert.ok(document.querySelector('[data-skeleton]'), 'Team loading should render skeletons');
        assert.equal(cardNames().length, 0, 'No stale team data should render while the team query is pending');
      } finally { await loadingTeams.unmount(); }

      const errorTeams = await mount(bundle, {
        fixture: defaultFixture({ teams: { data: undefined, isPending: false, isFetching: false, isError: true, refetch: async () => {} } }),
      });
      try {
        assert.ok(document.querySelector('[role="alert"]'), 'Team query failure should render an accessible error');
        assert.equal(cardNames().length, 0, 'Team query errors should not expose stale or fabricated team cards');
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

// The list page must never render an inline detail panel again.
function heroless() {
  return document.querySelector('.tms-detail')?.textContent ?? '';
}
