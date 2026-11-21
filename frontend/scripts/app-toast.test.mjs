#!/usr/bin/env node
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
const ts = require('typescript');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const el = React.createElement;

const dom = new JSDOM('<html lang="en" dir="ltr"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/app',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { useToastStore, toast } = await import('../src/store/toast.ts');

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function clearStore() {
  for (const item of useToastStore.getState().toasts) useToastStore.getState().dismiss(item.id);
}

const componentModules = new Map();
function sourcePath(path) {
  return [path, path + '.ts', path + '.tsx'].find((candidate) => existsSync(candidate)) ?? path;
}
function loadComponentSource(relativePath) {
  const file = sourcePath(resolve(frontend, 'src', relativePath));
  if (componentModules.has(file)) return componentModules.get(file).exports;
  const module = new Module(file);
  componentModules.set(file, module);
  module.filename = file;
  module.require = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.')) return loadComponentSource(relative(resolve(frontend, 'src'), resolve(dirname(file), specifier)));
    return require(specifier);
  };
  const source = readFileSync(file, 'utf8');
  module._compile(ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText, file);
  return module.exports;
}

let root;
const mountedStore = loadComponentSource('store/toast.ts');
const { ToastViewport } = loadComponentSource('components/ui/Toast.tsx');
const mountedLocale = loadComponentSource('i18n/useLocale.ts');

async function mountViewport() {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(el(ToastViewport)));
}

async function unmountViewport() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  document.getElementById('root').replaceChildren();
}

afterEach(async () => {
  await unmountViewport();
  clearStore();
  for (const item of mountedStore.useToastStore.getState().toasts) mountedStore.useToastStore.getState().dismiss(item.id);
});

after(() => dom.window.close());

test('loading is persistent, progress is honest, and completion starts a safe timer', async () => {
  const id = toast.loading('Downloading archive', { task: 'download', progress: null });
  assert.equal(typeof id, 'number');
  assert.deepEqual(useToastStore.getState().toasts[0], {
    id,
    kind: 'loading',
    message: 'Downloading archive',
    durationMs: 0,
    task: 'download',
    progress: null,
    action: undefined,
    title: undefined,
    detail: undefined,
  });

  await wait(35);
  assert.equal(useToastStore.getState().toasts.length, 1, 'loading must not auto-dismiss');

  toast.update(id, { kind: 'loading', progress: 142, message: 'Almost done' });
  assert.equal(useToastStore.getState().toasts[0].progress, 100);
  toast.update(id, { kind: 'success', progress: 100, message: 'Download complete', durationMs: 25 });
  assert.equal(useToastStore.getState().toasts[0].kind, 'success');
  await wait(45);
  assert.equal(useToastStore.getState().toasts.length, 0, 'completed toast should use its new duration');
});

test('updating a toast replaces its timer so stale callbacks cannot dismiss it', async () => {
  const id = toast.info('First message', { durationMs: 30 });
  await wait(10);
  toast.update(id, { message: 'Updated message', durationMs: 110 });
  await wait(35);
  assert.equal(useToastStore.getState().toasts[0]?.message, 'Updated message');
  await wait(95);
  assert.equal(useToastStore.getState().toasts.length, 0);
});

test('zero duration is persistent, old action callbacks remain supported, and dismiss cleans up', () => {
  let actionCalls = 0;
  const id = toast.success('Saved', {
    durationMs: 0,
    action: { label: 'Undo', onClick: () => { actionCalls += 1; } },
    title: 'Changes saved',
    detail: 'The previous value is available.',
  });
  const item = useToastStore.getState().toasts.find((toastItem) => toastItem.id === id);
  assert.ok(item?.action);
  item.action.onClick();
  assert.equal(actionCalls, 1);
  useToastStore.getState().dismiss(id);
  assert.equal(useToastStore.getState().toasts.some((toastItem) => toastItem.id === id), false);
});

test('mounted viewport uses actual locale direction, semantic progress, and accessible actions', async () => {
  mountedLocale.useLocaleStore.getState().setLocale('en');
  const id = mountedStore.toast.loading('Saving workspace', { task: 'save', progress: 42, title: 'Workspace update' });
  await mountViewport();

  const viewport = document.querySelector('.toast-viewport');
  assert.equal(viewport?.getAttribute('dir'), 'ltr');
  assert.equal(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '42');
  assert.equal(document.querySelector('.toast-card')?.getAttribute('data-task'), 'save');
  assert.equal(document.querySelector('.toast-card')?.getAttribute('aria-busy'), 'true');
  assert.equal(document.querySelector('.toast-close')?.getAttribute('aria-label'), 'Dismiss notification');

  await act(async () => mountedLocale.useLocaleStore.getState().setLocale('ar'));
  assert.equal(document.querySelector('.toast-viewport')?.getAttribute('dir'), 'rtl');
  assert.equal(document.querySelector('.toast-close')?.getAttribute('aria-label'), 'إغلاق التنبيه');

  await act(async () => document.querySelector('.toast-close').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(mountedStore.useToastStore.getState().toasts.some((toastItem) => toastItem.id === id), false);
});

test('mounted viewport dismisses an action after invoking the legacy callback', async () => {
  let actionCalls = 0;
  const id = mountedStore.toast.success('Saved', {
    durationMs: 0,
    action: { label: 'Undo', onClick: () => { actionCalls += 1; } },
  });
  await mountViewport();
  const action = document.querySelector('.toast-action');
  assert.equal(action?.textContent, 'Undo');
  await act(async () => action.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(actionCalls, 1);
  assert.equal(mountedStore.useToastStore.getState().toasts.some((toastItem) => toastItem.id === id), false);
});
