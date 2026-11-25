import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const workspace = read('src/styles/workspace.css');
const tokens = read('src/styles/tokens.css');

const phoneBlock = workspace.slice(workspace.indexOf('@media (max-width: 599px) {\n    .workspace-header'), workspace.indexOf('@media (max-width: 599px) {\n    .workspace-header') + 600);
const tabletBlock = workspace.slice(workspace.indexOf('@media (max-width: 900px) {\n    .workspace-header'), workspace.indexOf('@media (max-width: 900px) {\n    .workspace-header') + 600);

test('the floating header keeps clear space above it on phones', () => {
  assert.match(phoneBlock, /margin: calc\(22px \+ env\(safe-area-inset-top\)\) 8px 0;/);
  assert.match(phoneBlock, /top: 20px;/);
  assert.match(phoneBlock, /min-height: 54px;/);
});

test('tablets get extra breathing room too', () => {
  assert.match(tabletBlock, /top: 16px;/);
  assert.match(tabletBlock, /margin-top: calc\(20px \+ env\(safe-area-inset-top\)\);/);
});

test('the header-height token follows the new offsets so sticky content stays clear', () => {
  assert.match(tokens, /@media \(max-width: 900px\) \{\s*:root \{ --header-h: 78px; \}/);
  assert.match(tokens, /@media \(max-width: 599px\) \{\s*:root \{ --header-h: 74px; \}/);
  // القيمة الأساسية للديسكتوب ما اتغيرتش.
  assert.match(tokens, /--header-h: 64px;/);
});
