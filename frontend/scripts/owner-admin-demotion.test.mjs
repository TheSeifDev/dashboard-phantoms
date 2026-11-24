// Focused mounted/API regression for the owner-only global Admin demotion flow.
// Run from the repository root with:
//   node frontend/scripts/owner-admin-demotion.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const toolingRequire = process.env.PHANTOMS_AUTH_TEST_TOOLING ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json')) : frontendRequire;
const { JSDOM } = toolingRequire('jsdom');
const ts = frontendRequire('typescript');
const React = frontendRequire('react');
const { createRoot } = frontendRequire('react-dom/client');
const { act } = React;
const OWNER = 'owner-fixture-uuid';
const TARGET = 'target-fixture-uuid';
const ACCOUNT = {
  user_id: TARGET,
  email: 'target@phantoms-test.example',
  role: 'admin',
  created_at: '2026-11-21T00:00:00.000Z',
  created_by: OWNER,
  permissions: {
    dashboard: true,
    members: true,
    tasks: true,
    ranking: true,
    notes: true,
    announcements: true,
    whatsapp: true,
    ai_assistant: true,
    web_projects: false,
  },
};

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};

function compileCommonJs(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}

async function writeHarnessFiles(harnessRoot) {
  await writeFile(join(harnessRoot, 'package.json'), '{"type":"commonjs"}\n');
  await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');
  const actualSources = [
    'features/admin/access/AdminAccountsPage.tsx',
    'features/admin/access/api.ts',
    'features/admin/access/permissions.ts',
  ];
  for (const source of actualSources) {
    const sourcePath = join(frontendRoot, 'src', source);
    const outputPath = join(harnessRoot, 'src', source.replace(/\.tsx?$/, '.js'));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, compileCommonJs(await readFile(sourcePath, 'utf8'), sourcePath));
  }

  const stubs = new Map([
    ['src/components/ui/Badge.js', `
const React = require('react');
exports.Badge = function Badge({ children }) { return React.createElement('span', null, children); };
`],
    ['src/components/ui/Button.js', `
const React = require('react');
exports.Button = function Button({ children, icon, isLoading, loadingText, disabled, fullOnMobile, ...props }) {
  return React.createElement('button', { ...props, disabled: disabled || isLoading, 'aria-busy': isLoading || undefined }, icon, isLoading && loadingText ? loadingText : children);
};
`],
    ['src/components/ui/Card.js', `
const React = require('react');
exports.Card = function Card({ children }) { return React.createElement('section', null, children); };
`],
    ['src/components/ui/ConfirmDialog.js', `
const React = require('react');
exports.ConfirmDialog = function ConfirmDialog({ isOpen, onClose, onConfirm, title, itemName, description, confirmLabel, isPending, pendingLabel }) {
  if (!isOpen) return null;
  return React.createElement('div', { role: 'dialog', 'data-confirm-dialog': 'true' },
    React.createElement('h2', null, title),
    React.createElement('p', null, itemName),
    React.createElement('p', null, description),
    React.createElement('button', { type: 'button', onClick: onClose }, 'Cancel'),
    React.createElement('button', { type: 'button', onClick: onConfirm, disabled: isPending, 'aria-busy': isPending || undefined }, isPending ? pendingLabel : confirmLabel));
};
`],
    ['src/components/ui/EmptyState.js', `
const React = require('react');
exports.EmptyState = function EmptyState({ title, description }) { return React.createElement('div', null, React.createElement('h2', null, title), React.createElement('p', null, description)); };
`],
    ['src/components/ui/ErrorState.js', `
const React = require('react');
exports.ErrorState = function ErrorState({ message }) { return React.createElement('div', { role: 'alert' }, message); };
`],
    ['src/components/ui/PageHeader.js', `
const React = require('react');
exports.PageHeader = function PageHeader({ title, description }) { return React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description)); };
`],
    ['src/components/ui/Skeleton.js', `
const React = require('react');
exports.CardSkeletons = function CardSkeletons() { return React.createElement('div', { role: 'status' }, 'Loading'); };
`],
    ['src/components/ui/Modal.js', `
const React = require('react');
exports.Modal = function Modal({ isOpen, title, children, footer }) { return isOpen ? React.createElement('div', { role: 'dialog' }, React.createElement('h2', null, title), children, footer) : null; };
`],
    ['src/i18n/useLocale.js', `
exports.useLocale = function useLocale() { return { dir: 'ltr', number: (value) => String(value), t: (_ar, en) => en }; };
`],
    ['src/lib/supabase/client.js', `
exports.supabase = {
  rpc(name, args) { return Promise.resolve().then(() => globalThis.__ODM_RPC(name, args)); },
  functions: { invoke(name, args) { return Promise.resolve().then(() => globalThis.__ODM_FUNCTION(name, args)); } },
};
`],
    ['src/lib/supabase/errors.js', `
exports.toAppError = function toAppError(error, fallback) { return error instanceof Error ? error : new Error(fallback); };
`],
    ['src/store/auth.js', `
exports.useAuthStore = function useAuthStore(selector) { return selector({ user: { id: '${OWNER}' } }); };
`],
    ['src/store/toast.js', `
exports.toast = { success(message) { globalThis.__ODM_TOASTS.push({ type: 'success', message }); }, error(message) { globalThis.__ODM_TOASTS.push({ type: 'error', message }); } };
`],
    ['src/features/admin/access/CapabilityGate.js', `
const React = require('react');
exports.CapabilityGate = function CapabilityGate({ children }) { return React.createElement(React.Fragment, null, children); };
exports.CapabilityBadge = function CapabilityBadge() { return null; };
`],
    ['src/features/admin/access/OwnerCapabilityPanel.js', `
exports.OwnerCapabilityPanel = function OwnerCapabilityPanel() { return null; };
`],
    ['src/features/admin/access/AdminCapabilityMatrix.js', `
exports.AdminCapabilityMatrix = function AdminCapabilityMatrix() { return null; };
`],
    ['src/features/admin/access/AdminPasswordResetModal.js', `
exports.AdminPasswordResetModal = function AdminPasswordResetModal() { return null; };
`],
    ['src/features/admin/access/capabilities.js', `
exports.CAPABILITY_OPTIONS = [];
exports.CAPABILITY_BY_KEY = {};
exports.CAPABILITY_DURATIONS = [];
exports.capabilityOf = function capabilityOf() { return null; };
exports.formatRemaining = function formatRemaining() { return ''; };
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
    url: 'http://localhost/admin/access',
    pretendToBeVisual: true,
  });
  dom.window.setInterval = () => 0;
  dom.window.clearInterval = () => {};
  const previous = new Map();
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
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

const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-owner-demotion-mounted-'));
let environment;
try {
  await writeHarnessFiles(harnessRoot);
  environment = installDom();
  const harnessRequire = createRequire(join(harnessRoot, 'package.json'));
  const { QueryClient, QueryClientProvider } = harnessRequire('@tanstack/react-query');
  const pageBundle = harnessRequire('./src/features/admin/access/AdminAccountsPage.js');

  await test('mounted owner admin demotion is distinct, owner-protected, and truthful', async () => {
    globalThis.__ODM_CALLS = [];
    globalThis.__ODM_FUNCTION_CALLS = [];
    globalThis.__ODM_INVALIDATIONS = [];
    globalThis.__ODM_TOASTS = [];
    globalThis.__ODM_RPC = async (name, args) => {
      globalThis.__ODM_CALLS.push({ name, args });
      if (name === 'get_admin_access') return { data: { is_admin: true, is_owner: true, is_team_admin: false, role: 'owner', email: 'owner@phantoms-test.example', permissions: {}, teams: [] }, error: null };
      if (name === 'admin_capability_state') return { data: { is_owner: true, capabilities: {}, pending_count: 0 }, error: null };
      if (name === 'admin_capability_inbox') return { data: { requests: [], grants: [] }, error: null };
      if (name === 'admin_list_accounts') return { data: [{ ...ACCOUNT }, { user_id: OWNER, email: 'owner@phantoms-test.example', role: 'owner', created_at: ACCOUNT.created_at, created_by: null, permissions: ACCOUNT.permissions }], error: null };
      if (name === 'admin_demote_account') {
        if (globalThis.__ODM_DEMOTION_GATE) return globalThis.__ODM_DEMOTION_GATE;
        return { data: { target_uuid: args.p_user_id, demoted: true, member_linked: true }, error: null };
      }
      return { data: true, error: null };
    };
    globalThis.__ODM_FUNCTION = async (...args) => {
      globalThis.__ODM_FUNCTION_CALLS.push(args);
      return { data: { deleted: true }, error: null };
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
    const invalidateQueries = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = async (options) => {
      globalThis.__ODM_INVALIDATIONS.push(options.queryKey);
      return invalidateQueries(options);
    };
    const root = createRoot(document.getElementById('root'));
    let resolveDemotion;
    try {
      await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(pageBundle.default)));
        await settle();
      });
      await act(async () => { await settle(8); });
      assert.ok(document.body.textContent?.includes('Remove global admin'), 'non-owner admins expose the dedicated demotion action');
      assert.ok(document.body.textContent?.includes('Delete account'), 'the destructive Auth-delete action remains separately visible');
      const ownerRow = [...document.querySelectorAll('article')].find((row) => row.textContent?.includes('Primary owner'));
      assert.ok(ownerRow, 'the owner row is rendered');
      assert.equal(ownerRow.querySelectorAll('button').length, 0, 'the owner row has no demotion or delete controls');

      const demoteButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Remove global admin'));
      assert.ok(demoteButton, 'the demotion action is mounted as a button');
      await act(async () => { demoteButton.click(); await settle(); });
      assert.ok(document.querySelector('[data-confirm-dialog="true"]'), 'demotion opens its own confirmation dialog');
      assert.ok(document.body.textContent?.includes('preserves the Auth account'), 'confirmation explains preservation rather than Auth deletion');
      assert.ok(document.body.textContent?.includes('unbound identity is not automatically made a Member'), 'confirmation distinguishes unbound identities from eligible Member bindings');

      globalThis.__ODM_DEMOTION_GATE = new Promise((resolve) => { resolveDemotion = resolve; });
      const confirmButton = [...document.querySelectorAll('[data-confirm-dialog="true"] button')].find((button) => button.textContent?.includes('Remove global admin'));
      const cancelButton = [...document.querySelectorAll('[data-confirm-dialog="true"] button')].find((button) => button.textContent === 'Cancel');
      assert.ok(confirmButton && cancelButton, 'confirmation has separate confirm and cancel controls');
      await act(async () => { confirmButton.click(); await settle(2); });
      assert.equal(confirmButton.disabled, true, 'the confirm control reports the pending mutation');
      assert.ok(document.body.textContent?.includes('Removing global admin'), 'pending state uses truthful demotion copy');
      await act(async () => { cancelButton.click(); await settle(); });
      assert.ok(document.querySelector('[data-confirm-dialog="true"]'), 'pending demotion cannot be dismissed as if it succeeded');

      resolveDemotion({ data: { target_uuid: TARGET, demoted: true, member_linked: true }, error: null });
      await act(async () => { await settle(8); });
      assert.equal(document.querySelector('[data-confirm-dialog="true"]'), null, 'dialog closes only after a successful demotion response');
      assert.deepEqual(globalThis.__ODM_CALLS.find((call) => call.name === 'admin_demote_account'), { name: 'admin_demote_account', args: { p_user_id: TARGET } }, 'the API calls only the owner demotion RPC with the target UUID');
      assert.equal(globalThis.__ODM_FUNCTION_CALLS.length, 0, 'demotion never invokes destructive Auth deletion');
      assert.ok(globalThis.__ODM_INVALIDATIONS.some((key) => JSON.stringify(key) === JSON.stringify(['admin-accounts'])), 'admin account list cache is invalidated');
      assert.ok(globalThis.__ODM_INVALIDATIONS.some((key) => JSON.stringify(key) === JSON.stringify(['admin-access'])), 'admin access cache is invalidated');
      assert.ok(globalThis.__ODM_TOASTS.some((toast) => toast.type === 'success' && toast.message.includes('exact Member/Auth binding')), 'success copy reports the exact binding without promising unconditional Member login');
    } finally {
      resolveDemotion?.({ data: { target_uuid: TARGET, demoted: true, member_linked: true }, error: null });
      await act(async () => { root.unmount(); await settle(); });
      queryClient.clear();
      document.getElementById('root').replaceChildren();
    }
  });
} finally {
  delete globalThis.__ODM_CALLS;
  delete globalThis.__ODM_FUNCTION_CALLS;
  delete globalThis.__ODM_INVALIDATIONS;
  delete globalThis.__ODM_TOASTS;
  delete globalThis.__ODM_RPC;
  delete globalThis.__ODM_FUNCTION;
  delete globalThis.__ODM_DEMOTION_GATE;
  environment?.restore();
  await rm(harnessRoot, { recursive: true, force: true });
}
