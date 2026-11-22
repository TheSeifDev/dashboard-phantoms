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
const tooling = process.env.PHANTOMS_AUTH_TEST_TOOLING ? createRequire(join(process.env.PHANTOMS_AUTH_TEST_TOOLING, 'package.json')) : require;
const { JSDOM } = tooling('jsdom');
const { act } = React;
const { createRoot } = require('react-dom/client');
const sourceFile = resolve(frontend, 'src/features/app-download/AppDownloadPage.tsx');
const sourceText = readFileSync(sourceFile, 'utf8');

const toastEvents = [];
const mocks = {
  'components/brand/BrandLockup.tsx': { BrandLockup: () => null },
  'components/motion/useReducedMotion.ts': { useReducedMotion: () => false },
  'i18n/useLocale.ts': { useLocale: () => ({ dir: 'ltr', t: (_arabic, english) => english }) },
  'lib/capacitor.ts': { isRunningInNativeApk: () => false },
  'store/toast.ts': {
    toast: {
      loading: (message, options) => { toastEvents.push({ method: 'loading', message, options }); return 7; },
      update: (id, options) => toastEvents.push({ method: 'update', id, options }),
      dismiss: (id) => toastEvents.push({ method: 'dismiss', id }),
      info: (message) => toastEvents.push({ method: 'info', message }),
    },
  },
  'lib/capacitor': { isRunningInNativeApk: () => false },
};
const iconModule = new Proxy({}, { get: (_target, property) => property === '__esModule' ? true : function Icon() { return null; } });
const modules = new Map();

function sourcePath(path) {
  return [path, `${path}.ts`, `${path}.tsx`].find(existsSync) ?? path;
}
function load(path) {
  const file = sourcePath(resolve(frontend, 'src', path));
  const key = relative(resolve(frontend, 'src'), file);
  if (mocks[key]) return mocks[key];
  if (modules.has(file)) return modules.get(file).exports;
  const module = new Module(file);
  modules.set(file, module);
  module.filename = file;
  module.require = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.')) return load(resolve(dirname(file), specifier));
    if (specifier === '@capacitor/core') return { Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false } };
    if (specifier === '@gsap/react') return { useGSAP: () => undefined };
    if (specifier === 'gsap') return { __esModule: true, default: { registerPlugin: () => undefined, from: () => undefined } };
    if (specifier === 'lucide-react') return iconModule;
    if (specifier === 'react-router-dom') return { Link: ({ children, ...props }) => React.createElement('a', props, children) };
    return require(specifier);
  };
  const source = readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  module._compile(output, file);
  return module.exports;
}

const feature = load('features/app-download/AppDownloadPage.tsx');
const {
  APK_DOWNLOAD_URL,
  APK_MEMORY_CAP_BYTES,
  isAndroidBrowser,
  isAppDownloadBannerEligible,
  isBannerDismissedWithinCooldown,
  readAppDownloadBannerDismissal,
  dismissAppDownloadBanner,
  calculateDownloadProgress,
  parseContentLength,
  APP_DOWNLOAD_BANNER_DISMISSAL_KEY,
} = feature;

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

function installDom(url = 'https://local.test/download') {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'DOMException', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function installDownloadDomMocks(dom) {
  const anchorClicks = [];
  const originalAnchorClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    anchorClicks.push({ href: this.href, download: this.download });
  };
  const objectUrls = [];
  const revokedUrls = [];
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
  globalThis.URL.createObjectURL = (blob) => {
    const objectUrl = `blob:local-test-${objectUrls.length + 1}`;
    objectUrls.push({ objectUrl, blob });
    return objectUrl;
  };
  globalThis.URL.revokeObjectURL = (objectUrl) => revokedUrls.push(objectUrl);
  return {
    anchorClicks,
    objectUrls,
    revokedUrls,
    restore() {
      dom.window.HTMLAnchorElement.prototype.click = originalAnchorClick;
      if (originalCreateObjectURL) globalThis.URL.createObjectURL = originalCreateObjectURL;
      else delete globalThis.URL.createObjectURL;
      if (originalRevokeObjectURL) globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      else delete globalThis.URL.revokeObjectURL;
    },
  };
}

function downloadButton() {
  return document.querySelector('[data-testid="download-apk"]');
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function cleanupMounted(dom, root, mocks) {
  if (root) await act(async () => root.unmount());
  mocks?.restore();
  dom.window.close();
}

beforeEach(() => {
  toastEvents.length = 0;
});

test('Android browser detection excludes native Capacitor and standalone PWA surfaces', () => {
  const androidUa = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
  assert.equal(isAndroidBrowser({ userAgent: androidUa, native: false, standalone: false }), true);
  assert.equal(isAndroidBrowser({ userAgent: androidUa, native: true, standalone: false }), false);
  assert.equal(isAndroidBrowser({ userAgent: androidUa, native: false, standalone: true }), false);
  assert.equal(isAndroidBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', native: false, standalone: false }), false);
});

test('banner eligibility blocks download, auth-sensitive paths, and callback query/hash material', () => {
  const android = { userAgent: 'Android', native: false, standalone: false };
  assert.equal(isAppDownloadBannerEligible('/portal', android), true);
  assert.equal(isAppDownloadBannerEligible('/login', android), true);
  assert.equal(isAppDownloadBannerEligible('/admin/login', android), true);
  assert.equal(isAppDownloadBannerEligible('/admin/recovery/callback', android), false);
  assert.equal(isAppDownloadBannerEligible('/download', android), false);
  assert.equal(isAppDownloadBannerEligible('/join/invite-token', android), false);
  assert.equal(isAppDownloadBannerEligible('/reset-password', android), false);
  assert.equal(isAppDownloadBannerEligible('/portal', { ...android, search: '?code=callback' }), false);
  assert.equal(isAppDownloadBannerEligible('/', { ...android, hash: '#access_token=secret' }), false);
});

test('dismissal survives only inside the seven-day cooldown and tolerates blocked storage', () => {
  const now = 2_000_000;
  const storage = new MemoryStorage();
  assert.equal(readAppDownloadBannerDismissal(storage, now), false);
  assert.equal(dismissAppDownloadBanner(storage, now), true);
  assert.equal(storage.getItem(APP_DOWNLOAD_BANNER_DISMISSAL_KEY), String(now));
  assert.equal(readAppDownloadBannerDismissal(storage, now + 1), true);
  assert.equal(isBannerDismissedWithinCooldown(String(now), now + 7 * 24 * 60 * 60 * 1000), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readAppDownloadBannerDismissal(blocked, now), false);
  assert.equal(dismissAppDownloadBanner(blocked, now), false);
});

test('progress is determinate only with a valid Content-Length and never reaches 100 before reader done', () => {
  assert.equal(parseContentLength('7898684'), 7_898_684);
  assert.equal(parseContentLength(null), null);
  assert.equal(parseContentLength('chunked'), null);
  assert.equal(calculateDownloadProgress(7_898_683, 7_898_684, false), 99);
  assert.equal(calculateDownloadProgress(7_898_684, 7_898_684, false), 99);
  assert.equal(calculateDownloadProgress(7_898_684, 7_898_684, true), 100);
  assert.equal(calculateDownloadProgress(1024, null, false), null);
  assert.equal(APK_MEMORY_CAP_BYTES, 50 * 1024 * 1024);
});

test('source contract keeps direct handoff indeterminate and resets loading state after fallback', () => {
  assert.match(sourceText, /download progress and installation cannot be measured here/);
  assert.match(sourceText, /setNeedsDirectDownload\(true\)/);
  assert.match(sourceText, /kind: 'loading'/);
  assert.match(sourceText, /triggerDirectBrowserDownload\(\)/);
  assert.match(sourceText, /setProgress\(null\);/);
  assert.match(sourceText, /toastIdRef\.current = null/);
});

test('unmount aborts an in-flight stream and does not emit a false success', async () => {
  const dom = installDom();
  const originalFetch = globalThis.fetch;
  let rejectFetch;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    rejectFetch = reject;
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(feature.default)));
  const button = document.querySelector('[data-testid="download-apk"]');
  assert.ok(button);
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.equal(toastEvents.some((event) => event.method === 'loading'), true);
  await act(async () => root.unmount());
  assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);
  assert.equal(toastEvents.some((event) => event.method === 'dismiss'), true);
  rejectFetch?.(new DOMException('aborted', 'AbortError'));
  globalThis.fetch = originalFetch;
  dom.window.close();
});

test('mounted known-length streaming stays loading and capped at 99 until complete blob handoff', async () => {
  const dom = installDom();
  const downloadMocks = installDownloadDomMocks(dom);
  const originalFetch = globalThis.fetch;
  let resolveChunk;
  let resolveDone;
  let cancelCalls = 0;
  const reader = {
    read: (() => {
      let readCount = 0;
      return () => {
        readCount += 1;
        if (readCount === 1) return Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) });
        if (readCount === 2) return new Promise((resolve) => { resolveChunk = resolve; });
        return new Promise((resolve) => { resolveDone = resolve; });
      };
    })(),
    cancel: async () => { cancelCalls += 1; },
    releaseLock: () => undefined,
  };
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (name) => name === 'content-length' ? '4' : null },
    body: { getReader: () => reader },
  });
  let root;
  try {
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(feature.default)));
    await act(async () => {
      downloadButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
    });
    const progressbar = document.querySelector('[role="progressbar"]');
    assert.equal(downloadButton().getAttribute('aria-busy'), 'true');
    assert.equal(progressbar?.getAttribute('aria-valuenow'), '75');
    assert.equal(progressbar?.getAttribute('aria-valuetext'), '75%');
    assert.equal(downloadMocks.anchorClicks.length, 0);
    assert.equal(downloadMocks.objectUrls.length, 0);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.progress === 75), true);

    await act(async () => {
      resolveChunk({ done: false, value: new Uint8Array([4]) });
      await nextTick();
    });
    assert.equal(progressbar?.getAttribute('aria-valuenow'), '99');
    assert.equal(downloadMocks.anchorClicks.length, 0);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);

    await act(async () => {
      resolveDone({ done: true, value: undefined });
      await nextTick();
      await nextTick();
    });
    assert.equal(downloadMocks.objectUrls.length, 1);
    assert.deepEqual(downloadMocks.anchorClicks, [{ href: 'blob:local-test-1', download: 'phantoms-app.apk' }]);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success' && event.options.progress === 100), true);
    assert.equal(downloadButton().getAttribute('aria-busy'), null);
    assert.equal(cancelCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupMounted(dom, root, downloadMocks);
  }
});

test('mounted fetch/CORS failure exposes direct download without anchor or success until explicit click', async () => {
  const dom = installDom();
  const downloadMocks = installDownloadDomMocks(dom);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let root;
  try {
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(feature.default)));
    await act(async () => {
      downloadButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
      await nextTick();
    });
    assert.equal(downloadButton().textContent.includes('Direct download'), true);
    assert.equal(downloadButton().getAttribute('aria-busy'), null);
    assert.equal(downloadMocks.anchorClicks.length, 0);
    assert.equal(downloadMocks.objectUrls.length, 0);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'warning'), true);

    await act(async () => {
      downloadButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
    });
    assert.deepEqual(downloadMocks.anchorClicks, [{ href: APK_DOWNLOAD_URL, download: 'phantoms-app.apk' }]);
    assert.equal(toastEvents.some((event) => event.method === 'info' && event.message.includes('download progress and installation cannot be measured')), true);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupMounted(dom, root, downloadMocks);
  }
});

test('mounted cancellation clears the attempt and permits a fresh successful download', async () => {
  const dom = installDom();
  const downloadMocks = installDownloadDomMocks(dom);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let rejectFirstRead;
  const firstReader = {
    read: () => new Promise((_resolve, reject) => { rejectFirstRead = reject; }),
    cancel: async () => undefined,
    releaseLock: () => undefined,
  };
  const secondReader = {
    read: (() => {
      let readCount = 0;
      return () => {
        readCount += 1;
        return readCount === 1
          ? Promise.resolve({ done: false, value: new Uint8Array([7, 8]) })
          : Promise.resolve({ done: true, value: undefined });
      };
    })(),
    cancel: async () => undefined,
    releaseLock: () => undefined,
  };
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      init.signal.addEventListener('abort', () => rejectFirstRead?.(new DOMException('aborted', 'AbortError')), { once: true });
      return { ok: true, headers: { get: () => '2' }, body: { getReader: () => firstReader } };
    }
    return { ok: true, headers: { get: () => '2' }, body: { getReader: () => secondReader } };
  };
  let root;
  try {
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(feature.default)));
    await act(async () => {
      downloadButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
    });
    const cancelButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Cancel'));
    assert.ok(cancelButton);
    await act(async () => {
      cancelButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
      await nextTick();
    });
    assert.equal(downloadButton().textContent.includes('Download APK'), true);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), false);
    assert.equal(downloadMocks.anchorClicks.length, 0);

    await act(async () => {
      downloadButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();
      await nextTick();
    });
    assert.equal(fetchCount, 2);
    assert.equal(downloadMocks.anchorClicks.length, 1);
    assert.equal(downloadMocks.objectUrls.length, 1);
    assert.equal(toastEvents.some((event) => event.method === 'update' && event.options.kind === 'success'), true);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupMounted(dom, root, downloadMocks);
  }
});
