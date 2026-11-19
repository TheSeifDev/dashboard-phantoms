import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFrontend = createRequire(join(frontend, 'package.json'));
const { JSDOM } = requireFrontend('jsdom');
const ts = requireFrontend('typescript');
const React = requireFrontend('react');
const { createRoot } = requireFrontend('react-dom/client');
const { MemoryRouter, useLocation } = requireFrontend('react-router-dom');
const { act } = React;
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true };

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'phantoms-sidebar-test-'));
  const sources = [
    'components/layout/AppSidebar.tsx', 'components/ui/Drawer.tsx', 'i18n/useLocale.ts',
    'components/brand/PhantomsLogo.tsx', 'components/brand/BrandLockup.tsx',
    'components/brand/BrandMark.tsx', 'components/brand/BrandWordmark.tsx',
  ];
  await symlink(join(frontend, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), '{"type":"commonjs"}\n');
  for (const source of sources) {
    const destination = join(root, 'src', source.replace(/\.tsx?$/, '.js'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, ts.transpileModule(await readFile(join(frontend, 'src', source), 'utf8'), { compilerOptions: options, fileName: source }).outputText);
  }
  for (const [path, text] of [
    ['store/auth.js', 'exports.useAuthStore = (selector) => selector({ clear: () => globalThis.__sidebarCalls.push("clear") });\n'],
    ['lib/supabase/client.js', 'exports.supabase = { auth: { signOut: async () => { globalThis.__sidebarCalls.push("signOut"); if (globalThis.__sidebarFailure === "throw") throw new Error("private error detail"); return { error: globalThis.__sidebarFailure === "error" ? new Error("private error detail") : null }; } } };\n'],
    ['store/toast.js', 'exports.toast = { error: (message) => { globalThis.__sidebarCalls.push("logoutError"); globalThis.__sidebarErrorMessage = message; } };\n'],
    ['features/auth/auth-flow.js', 'exports.clearAdminSetupIntent = () => globalThis.__sidebarCalls.push("clearSetupIntent");\n'],
  ]) {
    const destination = join(root, 'src', path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, text);
  }
  return { root, require: createRequire(join(root, 'package.json')) };
}

function installDom({ compact = false, preference, blocked = false, signOutFailure = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="before">Before</button><div id="root"></div></body></html>', { url: 'http://127.0.0.1:23907/' });
  const memory = new Map([['auth-untouched', 'unchanged']]);
  if (preference !== undefined) memory.set('phantoms_sidebar_collapsed', preference);
  const writes = [];
  const storage = { getItem(key) { if (blocked) throw new Error('blocked'); return memory.get(key) ?? null; }, setItem(key, value) { if (blocked) throw new Error('blocked'); writes.push([key, value]); memory.set(key, value); } };
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, value: storage });
  dom.window.matchMedia = (query) => ({ matches: compact && query === '(max-width: 1279px)', addEventListener() {}, removeEventListener() {} });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: storage, HTMLElement: dom.window.HTMLElement, KeyboardEvent: dom.window.KeyboardEvent, Event: dom.window.Event, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  globalThis.__sidebarCalls = [];
  globalThis.__sidebarFailure = signOutFailure;
  return { dom, memory, writes, dispose() { dom.window.close(); for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } delete globalThis.__sidebarCalls; delete globalThis.__sidebarFailure; delete globalThis.__sidebarErrorMessage; } };
}

function Location() { return React.createElement('output', { id: 'location' }, useLocation().pathname); }

const bundle = await harness();
try {
  const initial = installDom();
  const { AppSidebar, readSidebarCollapsed } = bundle.require('./src/components/layout/AppSidebar.js');
  const { useLocaleStore } = bundle.require('./src/i18n/useLocale.js');
  initial.dispose();

  async function scenario(config, run) {
    const environment = installDom(config);
    useLocaleStore.setState({ locale: 'ar' });
    const root = createRoot(document.getElementById('root'));
    let closeCalls = 0;
    const props = { userName: 'QA', isOwner: true, permissions: {}, drawerOpen: false, onCloseDrawer: () => { closeCalls++; } };
    const render = async (overrides = {}) => {
      Object.assign(props, overrides);
      await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/dashboard'] }, React.createElement(AppSidebar, props), React.createElement(Location))));
    };
    const click = async (element) => { assert.ok(element); await act(async () => { element.click(); }); };
    try { await render(); await run({ ...environment, render, click, closeCalls: () => closeCalls }); }
    finally { await act(async () => root.unmount()); environment.dispose(); }
  }

  await test('desktop collapse is a UI-only persisted preference and survives remount', async () => {
    await scenario({}, async ({ click, memory, writes, render }) => {
      const aside = document.querySelector('aside');
      assert.equal(aside.dataset.collapsed, 'false');
      const button = aside.querySelector('.app-sidebar-collapse');
      assert.equal(button.getAttribute('aria-expanded'), 'true');
      assert.equal(button.getAttribute('aria-controls'), 'desktop-sidebar-navigation');
      await click(button);
      assert.equal(aside.dataset.collapsed, 'true');
      assert.equal(button.getAttribute('aria-expanded'), 'false');
      assert.equal(memory.get('phantoms_sidebar_collapsed'), 'true');
      assert.equal(memory.get('auth-untouched'), 'unchanged');
      assert.deepEqual(writes, [['phantoms_sidebar_collapsed', 'true']]);
      assert.equal(readSidebarCollapsed(), true);
      await render();
      assert.equal(aside.dataset.collapsed, 'true');
      await click(button);
      assert.equal(readSidebarCollapsed(), false);
      assert.deepEqual(globalThis.__sidebarCalls, []);
    });
  });

  await test('compact default, explicit preferences, and blocked storage remain safe', async () => {
    for (const [config, expected] of [[{ compact: true }, true], [{ compact: true, preference: 'false' }, false], [{ preference: 'true' }, true], [{ preference: 'garbage' }, false], [{ blocked: true }, false]]) {
      await scenario(config, async ({ click }) => {
        assert.equal(readSidebarCollapsed(), expected);
        await click(document.querySelector('.app-sidebar-collapse'));
        assert.equal(document.querySelector('aside').dataset.collapsed, String(!expected));
      });
    }
  });

  await test('permission filtering is identical in desktop and mobile navigation', async () => {
    await scenario({}, async ({ render }) => {
      await render({ isOwner: false, permissions: { tasks: true }, drawerOpen: true });
      for (const nav of [document.querySelector('#desktop-sidebar-navigation'), document.querySelector('[role="dialog"] nav')]) {
        const links = [...nav.querySelectorAll('a')].map((element) => element.getAttribute('href'));
        assert.deepEqual(links, ['/admin/tasks', '/portal']);
        assert.equal(nav.querySelector('a[href="/admin/admins"]'), null);
      }
      await render({ permissions: {}, drawerOpen: false });
      assert.deepEqual([...document.querySelectorAll('#desktop-sidebar-navigation a')].map((a) => a.getAttribute('href')), ['/portal']);
    });
  });

  await test('dashboard stays visible as a standalone active row in the expanded sidebar', async () => {
    await scenario({}, async () => {
      const nav = document.querySelector('#desktop-sidebar-navigation');
      const dashboard = nav.querySelector('a[href="/admin/dashboard"]');
      assert.ok(dashboard);
      assert.equal(dashboard.closest('ul').hidden, false);
      assert.equal(dashboard.getAttribute('aria-current'), 'page');
      const operations = [...nav.querySelectorAll('.app-sidebar-section-toggle')]
        .find((button) => button.textContent.includes('العمليات'));
      assert.equal(operations.getAttribute('aria-expanded'), 'true');
    });
  });

  await test('navigation groups use accessible chevrons and reopen around the active route', async () => {
    await scenario({}, async ({ click }) => {
      const nav = document.querySelector('#desktop-sidebar-navigation');
      const operations = [...nav.querySelectorAll('.app-sidebar-section-toggle')]
        .find((button) => button.textContent.includes('العمليات'));
      assert.ok(operations);
      assert.equal(operations.getAttribute('aria-controls') !== null, true);
      assert.equal(operations.getAttribute('aria-expanded'), 'true');
      assert.ok(operations.querySelector('.lucide-chevron-down'));
      const group = document.getElementById(operations.getAttribute('aria-controls'));
      assert.equal(group.hidden, false);

      await click(operations);
      assert.equal(operations.getAttribute('aria-expanded'), 'false');
      assert.equal(group.hidden, true);

      await click(nav.querySelector('a[href="/admin/tasks"]'));
      assert.equal(document.getElementById('location').textContent, '/admin/tasks');
      assert.equal(operations.getAttribute('aria-expanded'), 'true');
      assert.equal(group.hidden, false);
      assert.equal(nav.querySelector('a[href="/admin/tasks"]').getAttribute('aria-current'), 'page');
    });
  });

  await test('locale changes labels, collapse direction and active navigation without resetting preference', async () => {
    await scenario({ preference: 'true' }, async ({ click }) => {
      assert.equal(document.querySelector('.app-sidebar-collapse').getAttribute('aria-label'), 'وسّع الشريط الجانبي');
      assert.ok(document.querySelector('.app-sidebar-collapse .lucide-chevron-left'));
      await act(async () => useLocaleStore.getState().setLocale('en'));
      assert.equal(document.documentElement.dir, 'ltr');
      assert.equal(document.querySelector('.app-sidebar-collapse').getAttribute('aria-label'), 'Expand sidebar');
      assert.ok(document.querySelector('.app-sidebar-collapse .lucide-chevron-right'));
      const tasks = document.querySelector('#desktop-sidebar-navigation a[href="/admin/tasks"]');
      assert.equal(tasks.getAttribute('aria-label'), 'Tasks');
      await click(tasks);
      assert.equal(document.getElementById('location').textContent, '/admin/tasks');
      assert.equal(tasks.getAttribute('aria-current'), 'page');
      assert.equal(document.querySelector('aside').dataset.collapsed, 'true');
      assert.deepEqual(globalThis.__sidebarCalls, []);
    });
  });

  await test('charcoal mobile drawer retains focus loop, Escape and exact scroll restoration', async () => {
    await scenario({}, async ({ render, closeCalls }) => {
      const previous = document.getElementById('before'); previous.focus();
      document.body.style.overflow = 'clip';
      await render({ drawerOpen: true });
      const panel = document.querySelector('[role="dialog"]');
      assert.ok(panel.classList.contains('app-sidebar-drawer'));
      assert.equal(panel.getAttribute('aria-modal'), 'true');
      assert.equal(document.body.style.overflow, 'hidden');
      const controls = [...panel.querySelectorAll('a[href],button')];
      assert.equal(document.activeElement, controls[0]);
      controls.at(-1).focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      assert.equal(document.activeElement, controls[0]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      assert.equal(document.activeElement, controls.at(-1));
      const before = closeCalls();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(closeCalls(), before + 1);
      await render({ drawerOpen: false });
      assert.equal(document.body.style.overflow, 'clip');
      assert.equal(document.activeElement, previous);
    });
  });

  await test('sign out retains the existing auth/setup cleanup and login navigation contract', async () => {
    await scenario({}, async ({ click }) => {
      await click(document.querySelector('.app-sidebar-footer button'));
      assert.deepEqual(globalThis.__sidebarCalls, ['signOut', 'clear', 'clearSetupIntent']);
      assert.equal(document.getElementById('location').textContent, '/admin/login');
    });
  });
  await test('sign-out errors never clear local auth or announce completed logout', async () => {
    for (const signOutFailure of ['error', 'throw']) {
      await scenario({ signOutFailure }, async ({ click, memory }) => {
        await click(document.querySelector('.app-sidebar-footer button'));
        assert.deepEqual(globalThis.__sidebarCalls, ['signOut', 'logoutError']);
        assert.equal(document.getElementById('location').textContent, '/admin/dashboard');
        assert.equal(memory.get('auth-untouched'), 'unchanged');
        assert.equal(globalThis.__sidebarErrorMessage, 'تعذّر تسجيل الخروج. جرّب تاني.');
        assert.equal(document.querySelector('.app-sidebar-footer button').disabled, false);
      });
    }
  });
  await test('collapsed navigation exposes a keyboard focus tooltip outside the scrolling rail', async () => {
    await scenario({ preference: 'true' }, async () => {
      const link = document.querySelector('#desktop-sidebar-navigation a[href="/admin/tasks"]');
      await act(async () => link.focus());
      const tooltip = document.querySelector('[role="tooltip"]');
      assert.equal(tooltip.textContent, 'المهام');
      assert.equal(tooltip.parentElement, document.body);
      assert.equal(link.getAttribute('aria-describedby'), tooltip.id);
      await act(async () => document.querySelector('.app-sidebar-collapse').focus());
      assert.equal(document.querySelector('[role="tooltip"]'), null);
    });
  });
} finally {
  await rm(bundle.root, { recursive: true, force: true });
}
