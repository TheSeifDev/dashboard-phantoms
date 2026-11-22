// =====================================================
// Round 12 — تقييم البونص بالنجوم ومجموعات الإسناد الجديدة.
// =====================================================
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POINTS_PER_STAR,
  STAR_MAX,
  audienceCount,
  resolveAudienceIds,
  starsLabel,
  starsToBonusPoints,
} from '../src/features/tasks/taskAudience';

const source = { memberIds: [1, 2, 3, 4], leadIds: [2, 99], headIds: [3, 4] };

test('النجوم بتتحول لنقاط بحد أقصى 25 نقطة', () => {
  assert.equal(STAR_MAX, 5);
  assert.equal(POINTS_PER_STAR, 5);
  assert.equal(starsToBonusPoints(0), 0);
  assert.equal(starsToBonusPoints(1), 5);
  assert.equal(starsToBonusPoints(3), 15);
  assert.equal(starsToBonusPoints(5), 25);
});

test('قيم النجوم الشاذة بتتظبط بدل ما تبعت بونص غلط', () => {
  assert.equal(starsToBonusPoints(6), 25);
  assert.equal(starsToBonusPoints(-3), 0);
  assert.equal(starsToBonusPoints(2.9), 10);
  assert.equal(starsToBonusPoints(Number.NaN), 0);
  assert.equal(starsToBonusPoints(Number.POSITIVE_INFINITY), 0);
});

test('نص النجوم بالعربي والإنجليزي', () => {
  assert.equal(starsLabel(0, 'ar'), 'بدون بونص');
  assert.equal(starsLabel(4, 'ar'), '4 من 5 نجوم');
  assert.equal(starsLabel(0, 'en'), 'No bonus');
  assert.equal(starsLabel(2, 'en'), '2 of 5 stars');
  assert.equal(starsLabel(9, 'en'), '5 of 5 stars');
});

test('وضع "كل الفريق" بيتخزن كـ ALL', () => {
  assert.equal(resolveAudienceIds('all', source), 'ALL');
  assert.equal(audienceCount('all', source), 4);
});

test('مجموعة قادة مشاريع الويب بتستبعد أي عضو مش في الفريق', () => {
  assert.deepEqual(resolveAudienceIds('leads', source), ['2']);
  assert.equal(audienceCount('leads', source), 1);
});

test('مجموعة رؤساء ومراقبي التيمات بترجع كل الأعضاء المطابقين', () => {
  assert.deepEqual(resolveAudienceIds('heads', source), ['3', '4']);
  assert.equal(audienceCount('heads', source), 2);
});

test('الأعضاء المحددين يدويًا بيتفلتروا على أعضاء الفريق الحاليين', () => {
  assert.deepEqual(resolveAudienceIds('specific', source, ['1', '9', '1', '3']), ['1', '3']);
  assert.deepEqual(resolveAudienceIds('specific', source, []), []);
  assert.equal(audienceCount('specific', source, ['2']), 1);
});

test('مجموعة فاضية من غير أعضاء مطابقين', () => {
  const empty = { memberIds: [], leadIds: [], headIds: [] };
  assert.deepEqual(resolveAudienceIds('leads', empty), []);
  assert.deepEqual(resolveAudienceIds('heads', empty), []);
  assert.equal(audienceCount('heads', empty), 0);
});