import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPDATE_BANNER_COPY,
  formatBuiltAt,
  isNewerBuild,
  parseRemoteBuildInfo,
} from '../src/features/app-update/app-version';

test('parseRemoteBuildInfo: بيقرأ version.json الصح', () => {
  const info = parseRemoteBuildInfo({
    buildId: '19e388b0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0',
    builtAt: '2026-11-22T12:41:00.000Z',
  });
  assert.deepEqual(info, {
    buildId: '19e388b0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0',
    builtAt: '2026-11-22T12:41:00.000Z',
  });
});

test('parseRemoteBuildInfo: بيرفض الردود الغلط أو HTML', () => {
  assert.equal(parseRemoteBuildInfo(null), null);
  assert.equal(parseRemoteBuildInfo('<!doctype html>'), null);
  assert.equal(parseRemoteBuildInfo({}), null);
  assert.equal(parseRemoteBuildInfo({ buildId: '   ' }), null);
  assert.equal(parseRemoteBuildInfo({ buildId: 42 }), null);
});

test('parseRemoteBuildInfo: بيشتغل من غير builtAt', () => {
  assert.deepEqual(parseRemoteBuildInfo({ buildId: 'abc123' }), {
    buildId: 'abc123',
    builtAt: '',
  });
});

test('isNewerBuild: بيكتشف النسخة الجديدة وبيتجاهل نفس النسخة', () => {
  assert.equal(isNewerBuild('aaa', 'bbb'), true);
  assert.equal(isNewerBuild('aaa', 'aaa'), false);
  assert.equal(isNewerBuild('aaa', ''), false);
  assert.equal(isNewerBuild('aaa', '   '), false);
});

test('isNewerBuild: نسخ التطوير مايطلعش عليها بانر', () => {
  assert.equal(isNewerBuild('dev', 'aaa'), false);
  assert.equal(isNewerBuild('local-1732270000000', 'aaa'), false);
  assert.equal(isNewerBuild('', 'aaa'), false);
});

test('formatBuiltAt: بيطلع تاريخ عربي مقروء أو سلسلة فاضية', () => {
  const formatted = formatBuiltAt('2026-11-22T12:41:00.000Z');
  assert.ok(formatted.length > 0);
  assert.match(formatted, /\d/);
  assert.equal(formatBuiltAt(''), '');
  assert.equal(formatBuiltAt('not-a-date'), '');
});

test('UPDATE_BANNER_COPY: الرسالة عربية وواضحة', () => {
  assert.match(UPDATE_BANNER_COPY.title, /نسخة جديدة/);
  assert.match(UPDATE_BANNER_COPY.action, /تحديث/);
  assert.ok(UPDATE_BANNER_COPY.body.length > 10);
});
