import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContributionCalendar,
  buildMonthlyApprovalTrend,
  calculateContributionStreaks,
  contributionCoverageDate,
  getCairoDate,
  isIsoDate,
  parseTaskContributions,
  requestTaskContributions,
  type ContributionsRpcClient,
} from '../src/features/dashboard/taskContributions.ts';

function payload(year = 2024) {
  return {
    timezone: 'Africa/Cairo',
    tracking_started_at: `${year}-02-01T12:00:00Z`,
    today: `${year}-03-01`,
    year,
    history_complete_since: `${year}-02-01`,
    days: [
      { date: `${year}-02-28`, count: 2 },
      { date: `${year}-02-29`, count: 1 },
    ],
    total_approvals: 3,
  };
}

test('ISO date parser accepts leap dates and rejects impossible calendar dates', () => {
  assert.equal(isIsoDate('2024-02-29'), true);
  assert.equal(isIsoDate('2000-02-29'), true);
  assert.equal(isIsoDate('1900-02-29'), false);
  assert.equal(isIsoDate('2023-02-29'), false);
  assert.equal(isIsoDate('2024-13-01'), false);
  assert.equal(isIsoDate('2024-04-31'), false);
  assert.equal(isIsoDate('2024-4-01'), false);
  assert.equal(isIsoDate(new Date()), false);
});

test('Cairo-local today is independent of the browser zone and rolls over at Cairo midnight', () => {
  assert.equal(getCairoDate(new Date('2024-01-01T21:59:59.000Z')), '2024-01-01');
  assert.equal(getCairoDate(new Date('2024-01-01T22:00:00.000Z')), '2024-01-02');
});

test('calendar pads complete years to Sunday-first 52/53 week columns and preserves leap day', () => {
  for (let year = 1990; year <= 2035; year += 1) {
    const calendar = buildContributionCalendar(year, []);
    assert.ok(calendar, `calendar for ${year} should be valid`);
    assert.ok(calendar.weeks.length === 52 || calendar.weeks.length === 53, `${year} has 52 or 53 weeks`);
    assert.ok(calendar.weeks.every((week) => week.length === 7));
    const first = calendar.weeks[0]?.[0];
    const last = calendar.weeks.at(-1)?.at(-1);
    assert.ok(first && new Date(`${first.date}T00:00:00Z`).getUTCDay() === calendar.weekStart);
    assert.ok(last && new Date(`${last.date}T00:00:00Z`).getUTCDay() === (calendar.weekStart + 6) % 7);
    assert.equal(calendar.monthLabels.length, 12);
  }

  assert.equal(buildContributionCalendar(2000, [])?.weekStart, 1);
  const leap = buildContributionCalendar(2024, [{ date: '2024-02-29', count: 4 }]);
  assert.ok(leap);
  const days = leap.weeks.flat();
  assert.equal(days.filter((day) => day.inSelectedYear).length, 366);
  assert.deepEqual(days.find((day) => day.date === '2024-02-29'), {
    date: '2024-02-29', count: 4, level: 3, inSelectedYear: true, isFuture: false, isUntracked: false,
  });
  assert.equal(days[0]?.inSelectedYear, false);
  assert.equal(days.at(-1)?.inSelectedYear, false);
});

test('unelapsed days are blank in the current year rather than shown as missed zero-activity dates', () => {
  const calendar = buildContributionCalendar(2024, [
    { date: '2024-02-14', count: 1 },
    { date: '2024-02-15', count: 2 },
  ], '2024-02-15');
  assert.ok(calendar);
  const days = calendar.weeks.flat();
  assert.deepEqual(days.find((day) => day.date === '2024-02-14'), {
    date: '2024-02-14', count: 1, level: 1, inSelectedYear: true, isFuture: false, isUntracked: false,
  });
  assert.deepEqual(days.find((day) => day.date === '2024-02-15'), {
    date: '2024-02-15', count: 2, level: 2, inSelectedYear: true, isFuture: false, isUntracked: false,
  });
  assert.deepEqual(days.find((day) => day.date === '2024-02-16'), {
    date: '2024-02-16', count: 0, level: 0, inSelectedYear: true, isFuture: true, isUntracked: false,
  });
});

test('calendar rejects invalid counts, duplicate dates, and dates outside the selected year', () => {
  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(buildContributionCalendar(2024, [{ date: '2024-01-01', count }]), null);
  }
  assert.equal(buildContributionCalendar(2024, [
    { date: '2024-01-01', count: 0 },
    { date: '2024-01-01', count: 0 },
  ]), null);
  assert.equal(buildContributionCalendar(2024, [{ date: '2023-12-31', count: 1 }]), null);
  assert.equal(buildContributionCalendar(2024, [{ date: '2024-02-30', count: 1 }]), null);
});

test('current streak includes an active today or yesterday and best streak spans consecutive active days', () => {
  assert.deepEqual(calculateContributionStreaks([
    { date: '2024-02-26', count: 1 },
    { date: '2024-02-27', count: 2 },
    { date: '2024-02-28', count: 1 },
    { date: '2024-02-29', count: 0 },
  ], '2024-02-28'), { current: 3, best: 3 });
  assert.deepEqual(calculateContributionStreaks([
    { date: '2024-02-27', count: 1 },
    { date: '2024-02-28', count: 2 },
    { date: '2024-02-29', count: 0 },
  ], '2024-02-29'), { current: 2, best: 2 });
  assert.deepEqual(calculateContributionStreaks([
    { date: '2024-02-28', count: 1 },
  ], '2024-02-29'), { current: 1, best: 1 });
  assert.deepEqual(calculateContributionStreaks([
    { date: '2024-02-28', count: 1 },
  ], '2024-03-01'), { current: 0, best: 1 });
});

test('future approvals do not extend the current streak or inflate the best streak', () => {
  assert.deepEqual(calculateContributionStreaks([
    { date: '2024-02-28', count: 1 },
    { date: '2024-02-29', count: 0 },
    { date: '2024-03-02', count: 8 },
    { date: '2024-03-03', count: 8 },
  ], '2024-02-29'), { current: 1, best: 1 });
});

test('streak helper rejects bad dates, duplicate dates, and invalid counts instead of coercing them', () => {
  assert.equal(calculateContributionStreaks([{ date: '2024-02-28', count: -1 }], '2024-02-28'), null);
  assert.equal(calculateContributionStreaks([{ date: '2024-02-28', count: 1.1 }], '2024-02-28'), null);
  assert.equal(calculateContributionStreaks([
    { date: '2024-02-28', count: 1 },
    { date: '2024-02-28', count: 0 },
  ], '2024-02-28'), null);
  assert.equal(calculateContributionStreaks([], '2024-02-30'), null);
});

test('RPC response validation requires the exact contract, safe counts, matching year, and no identity fields', () => {
  assert.deepEqual(parseTaskContributions(payload(), 2024), payload());
  for (const mutate of [
    (value: ReturnType<typeof payload>) => { value.timezone = 'UTC'; },
    (value: ReturnType<typeof payload>) => { value.year = 2023; },
    (value: ReturnType<typeof payload>) => { value.today = '2024-02-30'; },
    (value: ReturnType<typeof payload>) => { value.tracking_started_at = 'not a timestamp'; },
    (value: ReturnType<typeof payload>) => { value.history_complete_since = '2024-02-30'; },
    (value: ReturnType<typeof payload>) => { value.days[0]!.count = -1; },
    (value: ReturnType<typeof payload>) => { value.days[0]!.count = 1.25; },
    (value: ReturnType<typeof payload>) => { value.total_approvals = 100; },
    (value: ReturnType<typeof payload>) => { value.days[1]!.date = value.days[0]!.date; },
    (value: ReturnType<typeof payload>) => { value.days.push({ date: '2024-03-02', count: 1 }); value.total_approvals += 1; },
    (value: ReturnType<typeof payload>) => { (value as unknown as Record<string, unknown>).member_name = 'should never be returned'; },
    (value: ReturnType<typeof payload>) => { (value.days[0] as unknown as Record<string, unknown>).member_id = 7; },
  ]) {
    const malformed = structuredClone(payload());
    mutate(malformed);
    assert.equal(parseTaskContributions(malformed, 2024), null);
  }
  assert.equal(parseTaskContributions(payload(), 2023), null);
  assert.equal(parseTaskContributions(null, 2024), null);
});

test('RPC adapter sends the agreed year/member arguments and returns only validated data', async () => {
  const expected = payload();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: ContributionsRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: expected, error: null };
    },
  };
  const data = await requestTaskContributions(client, 2024, 7);
  assert.deepEqual(calls, [{ name: 'get_task_contributions', args: { p_year: 2024, p_member_id: 7 } }]);
  assert.deepEqual(data, expected);

  const teamClient: ContributionsRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: expected, error: null };
    },
  };
  await requestTaskContributions(teamClient, 2024, null);
  assert.deepEqual(calls.at(-1), { name: 'get_task_contributions', args: { p_year: 2024, p_member_id: null } });
});

test('missing RPC, database errors, and malformed RPC payloads fail closed without fallback', async () => {
  const missingRpc: ContributionsRpcClient = { rpc: async () => { throw new Error('function missing'); } };
  const rpcError: ContributionsRpcClient = { rpc: async () => ({ data: payload(), error: { message: 'denied' } }) };
  const malformed: ContributionsRpcClient = { rpc: async () => ({ data: { ...payload(), total_approvals: 0 }, error: null }) };
  await assert.rejects(requestTaskContributions(missingRpc, 2024), /could not be loaded/i);
  await assert.rejects(requestTaskContributions(rpcError, 2024), /could not be loaded/i);
  await assert.rejects(requestTaskContributions(malformed, 2024), /invalid response/i);
});

test('monthly approval trend aggregates only valid year-scoped event days', () => {
  const trend = buildMonthlyApprovalTrend(2024, [
    { date: '2024-01-02', count: 2 },
    { date: '2024-01-31', count: 1 },
    { date: '2024-02-01', count: 5 },
    { date: '2023-12-31', count: 90 },
    { date: '2024-03-01', count: -2 },
  ]);
  assert.equal(trend.length, 12);
  assert.equal(trend[0]?.approvals, 3);
  assert.equal(trend[1]?.approvals, 5);
  assert.equal(trend[2]?.approvals, 0);

  const elapsed = buildMonthlyApprovalTrend(2024, [
    { date: '2024-01-02', count: 2 },
    { date: '2024-02-15', count: 1 },
  ], '2024-02-15');
  assert.equal(elapsed.length, 2, 'future months should not look like zero-approval months');
  assert.equal(elapsed[1]?.approvals, 1);
});

test('SQL timestamp metadata is accepted and complete Cairo days do not claim launch-day coverage', () => {
  const actual = { ...payload(), history_complete_since: '2024-02-01T12:00:00.123456+00:00' };
  assert.deepEqual(parseTaskContributions(actual, 2024), actual);
  assert.equal(contributionCoverageDate(actual.history_complete_since), '2024-02-02');
  assert.equal(contributionCoverageDate('2024-01-01T22:00:00Z'), '2024-01-02');
  assert.equal(contributionCoverageDate('2024-01-01T22:00:01Z'), '2024-01-03');
  assert.equal(contributionCoverageDate('2024-02-01'), '2024-02-01');
  assert.equal(contributionCoverageDate(null), null);
});

test('uncovered past dates are unknown, while observed legacy approvals remain visible', () => {
  const calendar = buildContributionCalendar(2024, [{ date: '2024-01-05', count: 2 }], '2024-03-01', '2024-02-02');
  assert.ok(calendar);
  assert.equal(calendar.weeks.flat().find((d) => d.date === '2024-01-04')?.isUntracked, true);
  assert.deepEqual(calendar.weeks.flat().find((d) => d.date === '2024-01-05'), { date: '2024-01-05', count: 2, level: 2, inSelectedYear: true, isFuture: false, isUntracked: true });
  assert.equal(calendar.weeks.flat().find((d) => d.date === '2024-02-02')?.isUntracked, false);
});

test('partial monthly coverage uses null gaps and retains known approvals without shifted array indexing', () => {
  const trend = buildMonthlyApprovalTrend(2024, [{ date: '2024-01-05', count: 2 }, { date: '2024-02-15', count: 1 }], '2024-03-01', '2024-02-02');
  assert.deepEqual(trend, [{ month: 0, approvals: 2, partial: true }, { month: 1, approvals: 1, partial: true }, { month: 2, approvals: 0, partial: false }]);
  assert.equal(buildMonthlyApprovalTrend(2023, [], '2024-03-01', '2024-02-02')[0]?.approvals, null);
  assert.equal(buildMonthlyApprovalTrend(2024, [{ date: '2024-03-03', count: 9 }], '2024-03-01', '2024-02-02')[2]?.approvals, 0);
});
