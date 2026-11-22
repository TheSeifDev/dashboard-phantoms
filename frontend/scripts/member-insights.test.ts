import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemberTeamActivity,
  parseMemberTeamInsights,
  requestMemberTeamInsights,
  type MemberTeamInsights,
} from '../src/features/portal/memberInsights';

const YEAR = 2026;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    timezone: 'Africa/Cairo',
    tracking_started_at: '2026-01-01T00:00:00+00:00',
    today: '2026-03-10',
    year: YEAR,
    history_complete_since: '2026-01-01T00:00:00+00:00',
    days: [
      { date: '2026-03-04', count: 2, crew: 2 },
      { date: '2026-03-08', count: 1, crew: 1 },
    ],
    total_approvals: 3,
    members: [
      { member_id: 7, full_name: 'سيف', approved: 2, active_days: 2, last_approved_on: '2026-03-08' },
      { member_id: 9, full_name: 'نور', approved: 1, active_days: 1, last_approved_on: '2026-03-04' },
    ],
    roster_size: 12,
    ...overrides,
  };
}

test('accepts the documented member insight payload', () => {
  const parsed = parseMemberTeamInsights(payload(), YEAR);
  assert.ok(parsed);
  assert.equal(parsed.contributions.total_approvals, 3);
  assert.deepEqual(parsed.contributions.days, [
    { date: '2026-03-04', count: 2 },
    { date: '2026-03-08', count: 1 },
  ]);
  assert.equal(parsed.rosterSize, 12);
  assert.equal(parsed.people.length, 2);
  assert.equal(parsed.days[0]?.crew, 2);
});

test('rejects payloads that break the contract', () => {
  assert.equal(parseMemberTeamInsights(payload({ extra: true }), YEAR), null);
  assert.equal(parseMemberTeamInsights(payload({ year: 2025 }), YEAR), null);
  assert.equal(parseMemberTeamInsights(payload({ total_approvals: 4 }), YEAR), null);
  assert.equal(parseMemberTeamInsights(payload({ days: [{ date: '2026-03-04', count: 2, crew: 5 }] }), YEAR), null);
  assert.equal(parseMemberTeamInsights(payload({ days: [{ date: '2026-03-04', count: 2 }] }), YEAR), null);
  assert.equal(
    parseMemberTeamInsights(payload({ days: [{ date: '2026-04-01', count: 3, crew: 1 }], total_approvals: 3 }), YEAR),
    null,
    'future activity is rejected',
  );
  assert.equal(
    parseMemberTeamInsights(payload({ days: [{ date: '2026-03-04', count: 3, crew: 2 }, { date: '2026-03-04', count: 0, crew: 0 }] }), YEAR),
    null,
    'duplicate days are rejected',
  );
  assert.equal(
    parseMemberTeamInsights(payload({ members: [{ member_id: 7, full_name: '', approved: 3, active_days: 2, last_approved_on: null }] }), YEAR),
    null,
    'a nameless member is rejected',
  );
  assert.equal(
    parseMemberTeamInsights(payload({ members: [{ member_id: 7, full_name: 'سيف', approved: 1, active_days: 1, last_approved_on: null }] }), YEAR),
    null,
    'member approvals must add up to the total',
  );
});

test('builds the shared TeamActivity model from member data', () => {
  const parsed = parseMemberTeamInsights(payload(), YEAR) as MemberTeamInsights;
  const activity = buildMemberTeamActivity(parsed);
  assert.equal(activity.year, YEAR);
  assert.equal(activity.totals.approvals, 3);
  assert.equal(activity.totals.total, 3);
  assert.equal(activity.totals.github, 0);
  assert.equal(activity.totals.activeDays, 2);
  assert.equal(activity.totals.crewDays, 1);
  assert.equal(activity.totals.peak?.date, '2026-03-04');
  assert.equal(activity.byDate.get('2026-03-04')?.crewSize, 2);
  assert.equal(activity.byDate.get('2026-03-04')?.total, 2);
  assert.deepEqual(activity.members.map((member) => [member.memberId, member.score]), [[7, 10], [9, 5]]);
  assert.deepEqual(activity.mergedDays, [
    { date: '2026-03-04', count: 2 },
    { date: '2026-03-08', count: 1 },
  ]);
});

test('requests the member RPC and surfaces failures', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ok = await requestMemberTeamInsights(
    {
      rpc: (name, args) => {
        calls.push({ name, args });
        return Promise.resolve({ data: payload(), error: null });
      },
    },
    YEAR,
  );
  assert.equal(ok.contributions.year, YEAR);
  assert.deepEqual(calls, [{ name: 'get_member_team_insights', args: { p_year: YEAR } }]);

  await assert.rejects(
    requestMemberTeamInsights({ rpc: () => Promise.resolve({ data: null, error: { message: 'denied' } }) }, YEAR),
    /could not be loaded/,
  );
  await assert.rejects(
    requestMemberTeamInsights({ rpc: () => Promise.reject(new Error('offline')) }, YEAR),
    /could not be loaded/,
  );
  await assert.rejects(
    requestMemberTeamInsights({ rpc: () => Promise.resolve({ data: payload({ total_approvals: 99 }), error: null }) }, YEAR),
    /invalid response/,
  );
});