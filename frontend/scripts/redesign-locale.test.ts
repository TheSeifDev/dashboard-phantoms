import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLocale, useLocaleStore } from '../src/i18n/useLocale.ts';

test('Arabic is the safe default and only the explicit English preference enables English', () => {
  for (const value of [null, undefined, 'rtl', 'EN', 'en-US', '<script>', {}, 42]) assert.equal(parseLocale(value), 'ar');
  assert.equal(parseLocale('ar'), 'ar');
  assert.equal(parseLocale('en'), 'en');
});

test('locale selection persists exactly the locale and updates document lang/dir', () => {
  const storage = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const root = { lang: '', dir: '' };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key: string, value: string) => storage.set(key, value) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  try {
    useLocaleStore.getState().setLocale('en');
    assert.equal(useLocaleStore.getState().locale, 'en');
    assert.deepEqual(root, { lang: 'en', dir: 'ltr' });
    assert.equal(storage.get('phantoms_locale'), 'en');
    useLocaleStore.getState().setLocale('ar');
    assert.deepEqual(root, { lang: 'ar', dir: 'rtl' });
    assert.equal(storage.get('phantoms_locale'), 'ar');
    assert.equal(storage.size, 1, 'no auth or member storage is touched');
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as Record<string, unknown>).localStorage;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete (globalThis as Record<string, unknown>).document;
    useLocaleStore.setState({ locale: 'ar' });
  }
});

test('blocked storage cannot prevent language selection in memory', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('blocked'); } } });
  try { useLocaleStore.getState().setLocale('en'); assert.equal(useLocaleStore.getState().locale, 'en'); }
  finally { if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete (globalThis as Record<string, unknown>).localStorage; useLocaleStore.setState({ locale: 'ar' }); }
});

function luminance(hex: string) {
  let raw = hex.slice(1); if (raw.length === 3) raw = [...raw].map((c) => c + c).join('');
  const values = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

test('body, secondary, muted and link text maintain AA contrast in both palettes', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const [light, dark] = css.split('[data-theme="dark"]');
  assert.ok(dark);
  for (const [label, block] of [['light', light], ['dark', dark]]) {
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6});/g)].map((match) => [match[1], match[2]]));
    for (const foreground of ['text', 'text-2', 'text-secondary', 'text-muted', 'link']) {
      for (const background of ['bg', 'surface']) {
        const [low, high] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => a - b);
        assert.ok((high + 0.05) / (low + 0.05) >= 4.5, `${label} ${foreground}/${background} contrast must be >= 4.5`);
      }
    }
  }
});
