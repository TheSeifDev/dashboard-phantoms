import assert from 'node:assert/strict';
import test from 'node:test';
import type { Member, Note, Task } from '../src/types/db.ts';
import {
  resolveDashboardQueryState,
  type DashboardQueryInputs,
  type DashboardQuerySnapshot,
} from '../src/features/dashboard/dashboardqueryState.ts';
import { getDashboardMetrics } from '../src/features/dashboard/metrics.ts';

function success<T>(data: T): DashboardQuerySnapshot<T> {
  return { data, isError: false, isLoading: false, isSuccess: true };
}

function staleError<T>(data: T): DashboardQuerySnapshot<T> {
  return { data, isError: true, isLoading: false, isSuccess: false };
}

function pending<T>(data?: T): DashboardQuerySnapshot<T> {
  return { data, isError: false, isLoading: true, isSuccess: false };
}

function readyInputs(): DashboardQueryInputs {
  return {
    members: success([]),
    tasks: success([]),
    notes: success([]),
  };
}

test('every required query error blocks analytics, including when stale data remains', () => {
  const staleMembers: Member[] = [];
  const staleTasks: Task[] = [];
  const staleNotes: Note[] = [];
  const queries = [
    ['members', { members: staleError(staleMembers) }],
    ['tasks', { tasks: staleError(staleTasks) }],
    ['notes', { notes: staleError(staleNotes) }],
  ] as const;

  for (const [name, failed] of queries) {
    const state = resolveDashboardQueryState({
      ...readyInputs(),
      ...failed,
    });
    assert.equal(state.status, 'error', `${name} error must not render analytics`);
    assert.equal(state.reason, 'query-error');
    assert.deepEqual(state.failedQueries, [name]);
    assert.equal('data' in state, false);
  }
});

test('pending required data remains a distinct loading state and does not render analytics', () => {
  const state = resolveDashboardQueryState({
    members: pending([{ id: 1 } as Member]),
    tasks: success([]),
    notes: success([]),
  });

  assert.deepEqual(state, { status: 'loading' });
});

test('successful empty query results are ready and produce genuine zero/empty metrics', () => {
  const state = resolveDashboardQueryState(readyInputs());

  assert.equal(state.status, 'ready');
  if (state.status !== 'ready') return;

  const metrics = getDashboardMetrics(state.data.members, state.data.tasks, state.data.notes);
  assert.equal(metrics.totalMembers, 0);
  assert.equal(metrics.laptopCount, 0);
  assert.equal(metrics.alexCount, 0);
  assert.equal(metrics.approvedTasks, 0);
  assert.equal(metrics.underReview, 0);
  assert.equal(metrics.inProgress, 0);
  assert.equal(metrics.overdue, 0);
  assert.equal(metrics.notStarted, 0);
  assert.deepEqual(metrics.topMembers, []);
  assert.deepEqual(metrics.lowestMembers, []);
  assert.deepEqual(metrics.lateMembers, []);
  assert.deepEqual(metrics.recentActivity, []);
  assert.deepEqual(metrics.timelineData, [{ date: 'النهارده', bonus: 0 }]);
});

test('successful query state with missing data is blocked instead of becoming zeros', () => {
  const state = resolveDashboardQueryState({
    members: { data: undefined, isError: false, isLoading: false, isSuccess: true },
    tasks: success([]),
    notes: success([]),
  });

  assert.deepEqual(state, {
    status: 'error',
    reason: 'missing-data',
    failedQueries: ['members'],
  });
});

test('null or malformed successful payloads never become zero-valued analytics', () => {
  for (const name of ['members', 'tasks', 'notes'] as const) {
    for (const data of [null, {}]) {
      const inputs = readyInputs();
      inputs[name] = { data, isError: false, isLoading: false, isSuccess: true } as never;
      const state = resolveDashboardQueryState(inputs);
      assert.deepEqual(state, { status: 'error', reason: 'missing-data', failedQueries: [name] });
      assert.equal('data' in state, false);
    }
  }
});

test('real metrics are calculated without mutating the query results', () => {
  const members: Member[] = [{
    id: 7,
    created_at: '2026-01-01T00:00:00Z',
    email: 'member@example.com',
    full_name: 'عضو تجريبي',
    completion_rank: 12,
    team_notes: null,
    residence: 'القاهرة',
    work_conditions: null,
    bio: null,
    phone: null,
    device: 'laptop',
    gender: null,
    meeting_attendance: null,
    work_status: 'active',
    can_go_alexandria: true,
    bonus_infinite: false,
  }];
  const tasks: Task[] = [{
    id: 11,
    created_at: '2026-01-02T00:00:00Z',
    title: 'مهمة تجريبية',
    description: null,
    has_deadline: false,
    deadline_date: null,
    assigned_to: [7],
    tracking: { '7': { status: 'under_review' } },
  }];
  const notes: Note[] = [{
    id: 21,
    created_at: '2026-01-03T00:00:00Z',
    text: '[B:+12] إنجاز جيد',
    author: 'الإدارة',
    author_role: 'admin',
    date: '2026-01-03',
    target_member_id: 7,
    target_name: 'عضو تجريبي',
  }];
  const before = structuredClone({ members, tasks, notes });

  const metrics = getDashboardMetrics(members, tasks, notes);

  assert.equal(metrics.totalMembers, 1);
  assert.equal(metrics.laptopCount, 1);
  assert.equal(metrics.alexCount, 1);
  assert.equal(metrics.underReview, 1);
  assert.equal(metrics.topMembers[0]?.totalBonus, 12);
  assert.deepEqual({ members, tasks, notes }, before);
});
