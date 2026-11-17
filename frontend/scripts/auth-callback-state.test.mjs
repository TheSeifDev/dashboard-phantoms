// Prerequisites: use the repository's installed frontend/node_modules and install jsdom@26
// outside the repo with `npm --prefix /tmp/phantoms-auth-test-tooling
// install --ignore-scripts jsdom@26`; run from the repo root with
// `PHANTOMS_AUTH_TEST_TOOLING=/tmp/phantoms-auth-test-tooling
// node frontend/scripts/auth-callback-state.test.mjs`.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontendRoot = join(repositoryRoot, 'frontend');
const frontendRequire = createRequire(join(frontendRoot, 'package.json'));
const toolingRoot = process.env.PHANTOMS_AUTH_TEST_TOOLING;
const toolingRequire = toolingRoot ? createRequire(join(toolingRoot, 'package.json')) : frontendRequire;
const { JSDOM } = toolingRequire('jsdom');
const typescript = frontendRequire('typescript');
const React = frontendRequire('react');
const ReactDOMClient = frontendRequire('react-dom/client');
const Router = frontendRequire('react-router-dom');
const { act } = React;
const { MemoryRouter, Route, Routes, useLocation, useNavigate } = Router;

const componentSourcePath = join(frontendRoot, 'src/features/auth/AdminSetPasswordPage.tsx');
const authFlowSourcePath = join(frontendRoot, 'src/features/auth/auth-flow.ts');
const compilerOptions = {
  target: typescript.ScriptTarget.ES2022,
  module: typescript.ModuleKind.CommonJS,
  jsx: typescript.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
};

function compileCommonJs(source, fileName) {
  return typescript.transpileModule(source, { compilerOptions, fileName }).outputText;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function sessionFor(userId) {
  return {
    user: { id: userId, email: `${userId}@example.test` },
    access_token: `access-${userId}`,
    refresh_token: `refresh-${userId}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
  };
}

async function writeHarnessFiles(harnessRoot) {
  const paths = [
    'src/features/auth',
    'src/components/layout',
    'src/components/ui',
    'src/store',
    'src/lib/supabase',
    'src/features/admin/access',
  ];
  await Promise.all(paths.map((path) => mkdir(join(harnessRoot, path), { recursive: true })));

  const [componentSource, authFlowSource] = await Promise.all([
    readFile(componentSourcePath, 'utf8'),
    readFile(authFlowSourcePath, 'utf8'),
  ]);
  await writeFile(join(harnessRoot, 'src/features/auth/AdminSetPasswordPage.js'), compileCommonJs(componentSource, componentSourcePath));
  await writeFile(join(harnessRoot, 'src/features/auth/auth-flow.js'), compileCommonJs(authFlowSource, authFlowSourcePath));

  await writeFile(join(harnessRoot, 'src/components/layout/AuthShell.js'), `
const React = require('react');
exports.AuthShell = function AuthShell({ title, description, children, footer }) {
  return React.createElement('section', { 'data-auth-shell': 'true' },
    React.createElement('h1', null, title),
    React.createElement('p', null, description),
    children,
    footer,
  );
};
`);
  await writeFile(join(harnessRoot, 'src/components/ui/Button.js'), `
const React = require('react');
exports.Button = function Button({ children, icon, isLoading, loadingText, fullOnMobile, ...props }) {
  return React.createElement('button', props, children);
};
`);
  await writeFile(join(harnessRoot, 'src/features/admin/access/api.js'), `
exports.useAdminAccess = function useAdminAccess() {
  return { isPending: false, isError: false, data: { is_admin: true } };
};
`);
  await writeFile(join(harnessRoot, 'src/store/auth.js'), `
const React = require('react');
let state = { ready: true, user: null };
const listeners = new Set();
function emit() { listeners.forEach((listener) => listener()); }
function useAuthStore(selector) {
  return selector(React.useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
    () => state,
  ));
}
useAuthStore.getState = () => ({
  ...state,
  setSession(session) { state = { ...state, user: session.user }; emit(); },
  clear() { state = { ...state, user: null }; emit(); },
});
exports.useAuthStore = useAuthStore;
exports.__reset = function reset() { state = { ready: true, user: null }; emit(); };
`);
  await writeFile(join(harnessRoot, 'src/lib/supabase/client.js'), `
exports.supabase = {
  auth: {
    exchangeCodeForSession(code) { return globalThis.__F007_AUTH.exchange(code).then((session) => ({ data: { session }, error: null })); },
    setSession(tokens) { return globalThis.__F007_AUTH.setSession(tokens); },
    signOut() { return Promise.resolve({ error: null }); },
    updateUser() { return Promise.resolve({ error: null }); },
  },
  rpc() { return Promise.resolve({ data: { is_admin: true }, error: null }); },
};
`);
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/admin/set-password',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'Event']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  await Promise.resolve();
}

async function main() {
  const harnessRoot = await mkdtemp(join(tmpdir(), 'phantoms-f007-component-'));
  const dom = installDom();
  try {
    await writeHarnessFiles(harnessRoot);
    await symlink(join(frontendRoot, 'node_modules'), join(harnessRoot, 'node_modules'), 'dir');

    const store = createRequire(join(harnessRoot, 'src/store/auth.js'))(join(harnessRoot, 'src/store/auth.js'));
    const componentModule = createRequire(join(harnessRoot, 'src/features/auth/AdminSetPasswordPage.js'))(join(harnessRoot, 'src/features/auth/AdminSetPasswordPage.js'));
    const { AdminRecoveryCallbackPage } = componentModule;
    const AdminSetPasswordPage = componentModule.default;
    const container = dom.window.document.getElementById('root');
    let root;
    let navigate;
    let currentPath = '';

    function Controller({ Page }) {
      navigate = useNavigate();
      const location = useLocation();
      currentPath = `${location.pathname}${location.search}${location.hash}`;
      return React.createElement(Routes, null,
        React.createElement(Route, { path: '*', element: React.createElement(Page) }),
      );
    }

    async function mount(Page, initialEntry) {
      root = ReactDOMClient.createRoot(container);
      await act(async () => {
        root.render(React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(Controller, { Page }),
          ),
        ));
        await settle();
      });
    }

    async function go(path) {
      await act(async () => {
        navigate(path);
        await settle();
      });
    }

    function hasPasswordForm() {
      return Boolean(container.querySelector('#invite-password'));
    }

    function hasCallbackAlert() {
      return Boolean(container.querySelector('[role="alert"]'));
    }

    function assertPending() {
      assert.equal(hasPasswordForm(), false, 'callback processing must not expose the password form');
      assert.match(container.textContent || '', /بنتأكد|بنتجهز/);
    }

    function resetPageState() {
      container.replaceChildren();
      window.sessionStorage.clear();
      store.__reset();
      globalThis.__F007_AUTH = null;
      navigate = undefined;
      currentPath = '';
    }

    const setA = deferred();
    const setB = deferred();
    const setC = deferred();
    const setCalls = [];
    globalThis.__F007_AUTH = {
      exchange(code) {
        setCalls.push(code);
        return code === 'set-a' ? setA.promise : code === 'set-b' ? setB.promise : setC.promise;
      },
      setSession() { return Promise.reject(new Error('unexpected legacy path')); },
    };
    await mount(AdminSetPasswordPage, '/admin/set-password?code=set-a');
    assertPending();
    assert.equal(setCalls.filter((code) => code === 'set-a').length, 1, 'StrictMode must not exchange the same callback twice');

    await go('/admin/set-password?error=access_denied');
    assert.equal(hasPasswordForm(), false, 'invalid current material must never retain the authorized form');
    assert.equal(hasCallbackAlert(), true);

    await go('/admin/set-password');
    assert.equal(hasPasswordForm(), false, 'no callback after invalid material must not retain authorization');
    assert.match(container.textContent || '', /افتح رابط/);

    await go('/admin/set-password?code=set-b');
    assertPending();
    assert.equal(setCalls.filter((code) => code === 'set-b').length, 1, 'a new callback must still be single-flight under StrictMode');

    await act(async () => {
      setA.resolve(sessionFor('stale-a'));
      await settle();
    });
    assertPending();
    assert.equal(hasPasswordForm(), false, 'a delayed earlier callback must not authorize the current callback URL');
    assert.equal(window.sessionStorage.getItem('phantoms_admin_setup_intent'), null, 'stale completion cannot write setup intent');

    await act(async () => {
      setB.resolve(sessionFor('current-b'));
      await settle();
    });
    assert.equal(hasPasswordForm(), true, 'the current valid callback should reveal setup after verification');
    assert.equal(setCalls.filter((code) => code === 'set-b').length, 1);
    await go('/admin/set-password?code=set-c');
    assertPending();
    await go('/admin/set-password?error=access_denied');
    assert.equal(hasPasswordForm(), false, 'invalid URL must hide an already-authorized setup form');
    await go('/admin/set-password');
    await act(async () => {
      setC.resolve(sessionFor('abandoned-c'));
      await settle();
    });
    assert.equal(hasPasswordForm(), false, 'completion abandoned at a no-callback URL cannot recreate setup authorization');
    assert.equal(window.sessionStorage.getItem('phantoms_admin_setup_intent'), null);
    assert.equal(setCalls.filter((code) => code === 'set-c').length, 1);
    await act(async () => {
      root.unmount();
      await settle();
    });

    resetPageState();
    const recoveryA = deferred();
    const recoveryB = deferred();
    const recoveryCalls = [];
    globalThis.__F007_AUTH = {
      exchange(code) {
        recoveryCalls.push(code);
        return code === 'recovery-a' ? recoveryA.promise : recoveryB.promise;
      },
      setSession() { return Promise.reject(new Error('unexpected legacy path')); },
    };
    await mount(AdminRecoveryCallbackPage, '/admin/recovery/callback?code=recovery-a');
    assertPending();
    assert.equal(recoveryCalls.filter((code) => code === 'recovery-a').length, 1, 'recovery StrictMode must not duplicate exchange');

    await go('/admin/recovery/callback?error=access_denied');
    assert.equal(hasPasswordForm(), false);
    assert.equal(hasCallbackAlert(), true);

    await go('/admin/recovery/callback');
    assert.equal(hasPasswordForm(), false);
    assert.match(container.textContent || '', /بيانات استعادة/);

    await go('/admin/recovery/callback?code=recovery-b');
    assertPending();
    assert.equal(recoveryCalls.filter((code) => code === 'recovery-b').length, 1);

    await act(async () => {
      recoveryA.resolve(sessionFor('stale-recovery'));
      await settle();
    });
    assertPending();
    assert.equal(currentPath, '/admin/recovery/callback?code=recovery-b', 'stale recovery completion must not navigate the current callback');
    assert.equal(window.sessionStorage.getItem('phantoms_admin_setup_intent'), null, 'stale recovery cannot write setup intent');

    await act(async () => {
      recoveryB.resolve(sessionFor('current-recovery'));
      await settle();
    });
    assert.equal(currentPath, '/admin/set-password', 'the current valid recovery callback should navigate after verification');
    assert.equal(hasPasswordForm(), false, 'recovery callback page must not render an unauthorized setup form itself');
    await act(async () => {
      root.unmount();
      await settle();
    });

    console.log('F-007 mounted callback-state regression: 2 component flows passed');
    console.log('  setup: valid -> invalid -> none -> delayed earlier completion -> valid; StrictMode single-flight asserted');
    console.log('  recovery: valid -> invalid -> none -> delayed earlier completion -> valid; StrictMode single-flight asserted');
  } finally {
    delete globalThis.__F007_AUTH;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
    await rm(harnessRoot, { recursive: true, force: true });
  }
}

await main();
