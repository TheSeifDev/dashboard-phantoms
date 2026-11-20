import type { WebAssignee, WebDeliverable, WebMilestone, WebProject, WebReport, WebTask, WebTaskStatus, WebUpdate } from './types';

export const WEB_TASK_STATUSES: WebTaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'];
export function trackedProgress(tasks: WebTask[]) {
  const tracked = tasks.filter((task) => task.status !== 'cancelled');
  return { done: tracked.filter((task) => task.status === 'done').length, total: tracked.length };
}
export function isOverdue(due: string | null, finished: boolean, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })) {
  return Boolean(due && !finished && due.slice(0, 10) < today);
}
export function milestoneProgress(milestoneId: string, tasks: WebTask[], deliverables: WebDeliverable[]) {
  const work = tasks.filter((task) => task.milestone_id === milestoneId && task.status !== 'cancelled');
  const evidence = deliverables.filter((item) => item.milestone_id === milestoneId && item.status !== 'rejected');
  return { done: work.filter((task) => task.status === 'done').length + evidence.filter((item) => item.status === 'accepted').length, total: work.length + evidence.length };
}
export function projectAttention(project: WebProject, tasks: WebTask[], milestones: WebMilestone[], updates: WebUpdate[], today?: string) {
  return project.status === 'on_hold'
    || isOverdue(project.expected_delivery_date, ['completed', 'archived', 'rejected'].includes(project.status), today)
    || tasks.some((task) => task.project_id === project.id && (task.status === 'blocked' || isOverdue(task.due_date, ['done', 'cancelled'].includes(task.status), today)))
    || milestones.some((item) => item.project_id === project.id && (item.status === 'blocked' || isOverdue(item.due_date, ['completed', 'cancelled'].includes(item.status), today)))
    || updates.some((item) => item.project_id === project.id && item.update_type === 'blocker' && item.blocker_status !== 'resolved');
}
export function memberWorkload(memberId: number, tasks: WebTask[], assignees: WebAssignee[], deliverables: WebDeliverable[], reports: WebReport[], updates: WebUpdate[], today?: string) {
  const assignedIds = new Set(assignees.filter((assignment) => assignment.member_id === memberId).map((assignment) => assignment.task_id));
  const assigned = tasks.filter((task) => assignedIds.has(task.id));
  const ownDeliverables = deliverables.filter((item) => item.submitted_by_member_id === memberId);
  return {
    assigned, completed: assigned.filter((task) => task.status === 'done').length,
    inProgress: assigned.filter((task) => task.status === 'in_progress').length,
    overdue: assigned.filter((task) => isOverdue(task.due_date, ['done', 'cancelled'].includes(task.status), today)).length,
    milestones: new Set(assigned.map((task) => task.milestone_id).filter(Boolean)).size,
    submitted: ownDeliverables.filter((item) => item.status !== 'draft').length,
    pendingReviews: ownDeliverables.filter((item) => ['submitted', 'under_review'].includes(item.status)).length + reports.filter((item) => item.member_id === memberId && item.status !== 'reviewed').length,
    blockers: updates.filter((item) => item.author_member_id === memberId && item.update_type === 'blocker' && item.blocker_status !== 'resolved').length,
  };
}
