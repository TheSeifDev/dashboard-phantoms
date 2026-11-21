#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { createRequire, Module } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(frontend, 'package.json'));
const ts = require('typescript');
const React = require('react');
const tooling = process.env.PHANTOMS_AUTH_TEST_TOOLING
  ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json'))
  : require;
const { JSDOM } = tooling('jsdom');
const { act } = React;
const { createRoot } = require('react-dom/client');

const modules = new Map();
let native = false;
let notificationPushes = 0;

const iconModule = new Proxy({}, {
  get: (_target, property) => property === '__esModule' ? true : function Icon() { return null; },
});

const mocks = {
  'hooks/usePWA.ts': {
    usePWA: () => ({
      isSubscribed: false,
      subscribeToPush: () => undefined,
      sendTestNotification: () => undefined,
    }),
  },
  'i18n/useLocale.ts': { useLocale: () => ({ dir: 'ltr', t: (_arabic, english) => english }) },
  'lib/arabic.ts': { formatSigned: (value) => String(value) },
  'lib/capacitor.ts': { isRunningInNativeApk: () => native },
  'types/db.ts': {},
  'lib/supabase/client.ts': { supabase: { rpc: async () => ({ error: null }) } },
  'store/auth.ts': { getDeviceToken: () => null },
  'store/toast.ts': { toast: { warning: () => undefined, success: () => undefined, error: () => undefined } },
  'lib/notifications.ts': {
    checkUnifiedNotificationPermission: async () => false,
    ensureAndroidNotificationChannel: async () => undefined,
    playWhatsAppNotificationSound: () => undefined,
    requestUnifiedNotificationPermission: async () => true,
    urlBase64ToUint8Array: () => new Uint8Array(),
    useNotificationStore: { getState: () => ({ pushNotification: () => { notificationPushes += 1; } }) },
  },
  'components/ui/Toast.tsx': {},
};

function sourcePath(path) {
  return [path, `${path}.ts`, `${path}.tsx`].find(existsSync) ?? path;
}

function load(path) {
  const file = sourcePath(resolve(frontend, 'src', path));
  const key = relative(resolve(frontend, 'src'), file);
  if (mocks[key]) return mocks[key];
  if (modules.has(file)) return modules.get(file).exports;
  const compileFile = file.endsWith('.ts') ? `${file}.cjs` : file;
  const module = new Module(compileFile);
  modules.set(file, module);
  module.filename = compileFile;
  module.require = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.')) return load(resolve(dirname(file), specifier));
    if (specifier === 'lucide-react') return iconModule;
    if (specifier === 'react-router-dom') return {
      Link: ({ children, to, ...props }) => React.createElement('a', { ...props, href: typeof to === 'string' ? to : to?.pathname }, children),
    };
    if (specifier === '@capacitor/core') return { Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false } };
    return require(specifier);
  };
  const source = readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText.replace(/import\.meta\.env/g, 'process.env');
  module._compile(output, compileFile);
  return module.exports;
}

const pwaInstall = load('lib/pwa-install.ts');
const memberHero = load('features/portal/MemberHero.tsx');
delete mocks['hooks/usePWA.ts'];
const usePwa = load('hooks/usePWA.ts');

function installDom() {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'https://local.test/portal',
    pretendToBeVisual: true,
  });
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'DOMException', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'denied' } });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

async function unmount(dom, root) {
  if (root) await act(async () => root.unmount());
  dom.window.close();
}

beforeEach(() => {
  native = false;
  notificationPushes = 0;
});

test('mounted global guard prevents the browser beforeinstallprompt and never exposes prompt()', () => {
  const dom = installDom();
  try {
    pwaInstall.installBrowserInstallPromptGuard(dom.window);
    const event = new dom.window.Event('beforeinstallprompt', { bubbles: true, cancelable: true });
    event.prompt = () => { throw new Error('browser prompt must not be called'); };
    assert.equal(dom.window.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
    assert.doesNotMatch(readFileSync(resolve(frontend, 'src/hooks/usePWA.ts'), 'utf8'), /deferredPrompt|\.prompt\(\)/);
  } finally {
    dom.window.close();
  }
});

test('mounted member hero presents the APK route CTA and hides it in the native APK', async () => {
  const dom = installDom();
  let root;
  const member = {
    id: 7,
    full_name: 'Test Member',
    email: 'member@example.test',
    bio: '',
    device: '',
    can_go_alexandria: false,
  };
  try {
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(memberHero.MemberHero, {
      member,
      onToggleField: () => undefined,
      isUpdating: false,
    })));
    const apkLink = [...document.querySelectorAll('a')].find((link) => link.textContent.includes('Download Android APK'));
    assert.ok(apkLink);
    assert.equal(apkLink.getAttribute('href'), '/download');
    assert.equal(document.body.textContent.includes('Install app'), false);

    native = true;
    await act(async () => root.render(React.createElement(memberHero.MemberHero, {
      member,
      onToggleField: () => undefined,
      isUpdating: false,
    })));
    assert.equal([...document.querySelectorAll('a')].some((link) => link.textContent.includes('Download Android APK')), false);
  } finally {
    await unmount(dom, root);
  }
});

test('mounted desktop usePWA still enables notification delivery without an install action', async () => {
  const dom = installDom();
  let root;
  try {
    function Harness() {
      const { isSubscribed, subscribeToPush } = usePwa.usePWA({ memberId: 7, memberEmail: 'member@example.test' });
      return React.createElement('button', { type: 'button', onClick: () => void subscribeToPush() }, isSubscribed ? 'enabled' : 'enable');
    }
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(Harness)));
    const button = document.querySelector('button');
    assert.equal(button.textContent, 'enable');
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(notificationPushes, 1);
    assert.equal(button.textContent, 'enabled');
    assert.equal(document.body.textContent.includes('Install app'), false);
  } finally {
    await unmount(dom, root);
  }
});
