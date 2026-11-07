import { Eye, RotateCcw, Trash2 } from 'lucide-react';
import type { Member, Task, TaskTrackingEntry } from '../../types/db';
import { AR, arCount } from '../../lib/arabic';
import { BonusChip, DeadlineChip, STATUS_META, TaskProgress, summarizeTask, taskBonus } from './taskMeta';

type ReviewItem = { task: Task; memberId: number; entry: TaskTrackingEntry };

export function TaskTable({ tasks, members, onReview, onDelete }: { tasks: Task[]; members: Member[]; onReview: (item: ReviewItem) => void; onDelete: (task: Task) => void }) {
  return (
    <div className="overflow-x-clip rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <table className="data-table w-full text-start text-sm">
        <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
          <tr>{['عنوان المهمة', 'الموعد والبونص', 'المسند لهم', 'الإنجاز', 'الإجراءات'].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const summary = summarizeTask(task);
            return (
              <tr key={task.id}>
                <td data-label="عنوان المهمة">
                  <span className="grid gap-1">
                    <span className="font-bold">{task.title}</span>
                    {summary.awaitingReview > 0 && (
                      <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_META.under_review.tone}`}>
                        <Eye size={13} aria-hidden="true" />{arCount(summary.awaitingReview, AR.submission)} للمراجعة
                      </span>
                    )}
                  </span>
                </td>
                <td data-label="الموعد والبونص"><span className="flex flex-wrap items-center gap-1.5"><DeadlineChip task={task} summary={summary} /><BonusChip points={taskBonus(task)} /></span></td>
                <td data-label="المسند لهم">{task.assigned_to === 'ALL' ? `كل الفريق (${summary.total})` : arCount(summary.total, AR.member)}</td>
                <td data-label="الإنجاز">
                  <span className="grid min-w-28 gap-1">
                    <span className="text-xs font-bold tabular-nums">{summary.approved}/{summary.total} اتعتمد · {summary.percent}%</span>
                    <TaskProgress summary={summary} compact />
                  </span>
                </td>
                <td data-label="الإجراءات">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="grid size-11 place-items-center rounded-lg border border-[var(--border)] text-[var(--danger)] transition-colors hover:bg-red-50 dark:hover:bg-red-950/40" aria-label={`امسح مهمة ${task.title}`} onClick={() => onDelete(task)}>
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                    {summary.approved > 0 && <details className="relative">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg border border-red-200 px-2 text-xs font-bold text-red-800 hover:bg-red-50 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950/40"><RotateCcw size={14} aria-hidden="true" />الاعتمادات ({summary.approved})</summary>
                      <ul className="absolute end-0 top-full z-10 mt-1 grid max-h-60 min-w-52 gap-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-md)]">
                        {summary.entries.filter(([, entry]) => entry.status === 'approved').map(([id, entry]) => {
                          const memberId = Number(id);
                          const name = members.find((member) => member.id === memberId)?.full_name ?? `عضو #${id}`;
                          return <li key={id}><button type="button" onClick={() => onReview({ task, memberId, entry })} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-start text-xs font-bold hover:bg-[var(--surface-2)]"><RotateCcw size={13} className="shrink-0 text-red-700" aria-hidden="true" /><span className="truncate">إلغاء اعتماد {name}</span></button></li>;
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
