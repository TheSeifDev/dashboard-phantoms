import { Eye, RotateCcw, Trash2 } from 'lucide-react';
import type { Member, Task, TaskTrackingEntry } from '../../types/db';
import { BonusChip, DeadlineChip, STATUS_META, TaskProgress, summarizeTask, taskBonus } from './taskMeta';

import { useLocale } from '../../i18n/useLocale';
type ReviewItem = { task: Task; memberId: number; entry: TaskTrackingEntry };

export function TaskTable({ tasks, members, onReview, onDelete }: { tasks: Task[]; members: Member[]; onReview: (item: ReviewItem) => void; onDelete: (task: Task) => void }) {
  const { t, number } = useLocale();
  return (
    <div className="overflow-x-clip rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <table className="data-table w-full text-start text-sm">
        <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
          <tr>{[t('عنوان المهمة', 'Task'), t('الموعد والبونص', 'Deadline and bonus'), t('المسند لهم', 'Assignees'), t('الإنجاز', 'Progress'), t('الإجراءات', 'Actions')].map((label) => <th className="p-3" key={label} scope="col">{label}</th>)}</tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const summary = summarizeTask(task);
            const waitingEntries = summary.entries.filter(([, entry]) => entry.status === 'under_review');
            return (
              <tr key={task.id}>
                <td data-label={t('عنوان المهمة', 'Task')}>
                  <span className="grid gap-1">
                    <span className="font-bold">{task.title}</span>
                    {summary.awaitingReview > 0 && (
                      <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_META.under_review.tone}`}>
                        <Eye size={13} aria-hidden="true" />{number(summary.awaitingReview)} {t('للمراجعة', 'awaiting review')}
                      </span>
                    )}
                  </span>
                </td>
                <td data-label={t('الموعد والبونص', 'Deadline and bonus')}><span className="flex flex-wrap items-center gap-1.5"><DeadlineChip task={task} summary={summary} /><BonusChip points={taskBonus(task)} /></span></td>
                <td data-label={t('المسند لهم', 'Assignees')}>{task.assigned_to === 'ALL' ? `${t('كل الفريق', 'Entire team')} (${number(summary.total)})` : number(summary.total)}</td>
                <td data-label={t('الإنجاز', 'Progress')}>
                  <span className="grid min-w-28 gap-1">
                    <span className="text-xs font-bold tabular-nums">{number(summary.approved)}/{number(summary.total)} {t('اتعتمد', 'approved')} · {number(summary.percent)}%</span>
                    <TaskProgress summary={summary} compact />
                  </span>
                </td>
                <td data-label={t('الإجراءات', 'Actions')}>
                  <div className="flex flex-wrap items-start gap-2">
                    {waitingEntries.length > 0 && (
                      <div className="grid min-w-0 gap-1.5 rounded-lg border border-[var(--border)] p-2">
                        <p className="text-xs font-bold text-[var(--text-muted)]">{t('تسليمات للمراجعة', 'Submissions to review')} · {number(waitingEntries.length)}</p>
                        <ul className="grid max-h-32 min-w-0 gap-1 overflow-y-auto overscroll-contain" aria-label={t(`تسليمات ${task.title} للمراجعة`, `Submissions for ${task.title} to review`)}>
                          {waitingEntries.map(([id, entry]) => {
                            const memberId = Number(id);
                            const name = members.find((member) => member.id === memberId)?.full_name ?? t(`عضو #${id}`, `Member #${id}`);
                            return (
                              <li key={id} className="min-w-0">
                                <button type="button" onClick={() => onReview({ task, memberId, entry })} className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md bg-[var(--primary-soft)] px-2 text-start text-xs font-bold text-[var(--link)] hover:bg-[var(--primary)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" aria-label={t(`مراجعة تسليم ${name}`, `Review ${name}’s submission`)}>
                                  <Eye size={14} className="shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate">{name}</span>
                                  <span className="shrink-0">{t('مراجعة', 'Review')}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)] dark:hover:bg-[var(--danger-soft)]" aria-label={t(`امسح مهمة ${task.title}`, `Delete task ${task.title}`)} onClick={() => onDelete(task)}>
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                    {summary.approved > 0 && <details className="relative">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg border border-[var(--danger-border)] px-2 text-xs font-bold text-[var(--danger-text)] hover:bg-[var(--danger-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] dark:border-[var(--danger-border)] dark:text-[var(--danger-text)] dark:hover:bg-[var(--danger-soft)]"><RotateCcw size={14} aria-hidden="true" />{t('الاعتمادات', 'Approvals')} ({number(summary.approved)})</summary>
                      <ul className="absolute end-0 top-full z-10 mt-1 grid max-h-60 min-w-52 gap-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-md)]">
                        {summary.entries.filter(([, entry]) => entry.status === 'approved').map(([id, entry]) => {
                          const memberId = Number(id);
                          const name = members.find((member) => member.id === memberId)?.full_name ?? t(`عضو #${id}`, `Member #${id}`);
                          return <li key={id}><button type="button" onClick={() => onReview({ task, memberId, entry })} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-start text-xs font-bold hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"><RotateCcw size={13} className="shrink-0 text-[var(--danger-text)]" aria-hidden="true" /><span className="truncate">{t(`إلغاء اعتماد ${name}`, `Revoke approval for ${name}`)}</span></button></li>;
                        })}
                      </ul>
                    </details>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
