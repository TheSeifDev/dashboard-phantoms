import test from 'node:test';
import assert from 'node:assert/strict';
import { trackedProgress, milestoneProgress, memberWorkload, isOverdue, projectAttention } from '../src/features/web-projects/domain';
import type { WebTask, WebDeliverable, WebProject, WebMilestone, WebUpdate } from '../src/features/web-projects/types';
const task = (id: string, status: WebTask['status'], extra: Partial<WebTask> = {}) => ({ id, status, project_id: 'project-a', due_date: null, milestone_id: null, ...extra }) as WebTask;

test('task progress excludes cancelled work and never fabricates completion for empty work', () => {
  assert.deepEqual(trackedProgress([]), { done: 0, total: 0 });
  assert.deepEqual(trackedProgress([task('1', 'done'), task('2', 'cancelled'), task('3', 'in_review')]), { done: 1, total: 2 });
});
test('milestone completion comes from linked tasks and accepted deliverables only', () => {
  const tasks = [task('1', 'done', { milestone_id: 'm1' }), task('2', 'in_review', { milestone_id: 'm1' }), task('3', 'done', { milestone_id: 'other' })];
  const deliverables = [{ milestone_id: 'm1', status: 'accepted' }, { milestone_id: 'm1', status: 'submitted' }, { milestone_id: 'm1', status: 'rejected' }] as WebDeliverable[];
  assert.deepEqual(milestoneProgress('m1', tasks, deliverables), { done: 2, total: 4 });
});
test('deadlines distinguish unfinished overdue work from finished work and today', () => {
  assert.equal(isOverdue('2026-11-19', false, '2026-11-20'), true);
  assert.equal(isOverdue('2026-11-20', false, '2026-11-20'), false);
  assert.equal(isOverdue('2026-11-19', true, '2026-11-20'), false);
  assert.equal(isOverdue(null, false, '2026-11-20'), false);
});
test('member workload includes only explicit task assignments and own evidence, without quality scores', () => {
  const tasks = [task('one', 'done'), task('two', 'in_progress', { milestone_id: 'm1', due_date: '2026-11-19' }), task('other', 'blocked')];
  const result = memberWorkload(7, tasks, [{ project_id: 'project-a', task_id: 'one', member_id: 7, is_primary: true }, { project_id: 'project-a', task_id: 'two', member_id: 7, is_primary: true }, { project_id: 'project-a', task_id: 'other', member_id: 8, is_primary: true }], [{ submitted_by_member_id: 7, status: 'submitted' }, { submitted_by_member_id: 8, status: 'accepted' }] as WebDeliverable[], [], [], '2026-11-20');
  assert.equal(result.assigned.length, 2);
  assert.equal(result.completed, 1); assert.equal(result.inProgress, 1); assert.equal(result.overdue, 1);
  assert.equal(result.milestones, 1); assert.equal(result.submitted, 1); assert.equal(result.pendingReviews, 1);
  assert.equal('score' in result, false);
});
test('project attention never borrows blockers from an unrelated project', () => {
  const project = { id: 'project-a', status: 'active', expected_delivery_date: null } as WebProject;
  assert.equal(projectAttention(project, [], [], [{ project_id: 'project-b', update_type: 'blocker', blocker_status: 'open' }] as WebUpdate[], '2026-11-20'), false);
  assert.equal(projectAttention(project, [task('one', 'blocked')], [] as WebMilestone[], [], '2026-11-20'), true);
});
