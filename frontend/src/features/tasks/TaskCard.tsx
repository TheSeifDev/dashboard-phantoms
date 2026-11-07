import { useState } from 'react';
import { CheckCircle2, Eye, Loader2, RotateCcw, Trash2, Users } from 'lucide-react';
import type { Member, Task, TaskStatus, TaskTrackingEntry } from '../../types/db';
import { formatDate } from '../../lib/dateUtils';
import { AR, arCount } from '../../lib/arabic';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { useUpdateTaskStatus } from './api';
import { ADMIN_SETTABLE_STATUSES, BonusChip, DeadlineChip, STATUS_META, TaskProgress, summarizeTask, taskBonus } from './taskMeta';

type ReviewItem = { task: Task; memberId: number; entry: TaskTrackingEntry };

/** ترتيب العرض: ما يحتاج تدخل الإدارة أولاً */
const STATUS_ORDER: Record<TaskStatus, number> = { under_review: 0, revision_requested: 1, in_progress: 2, pending: 3, approved: 4 };

export function TaskCard({ task, members, onReview, onDelete }: { task: Task; members: Member[]; onReview: (item: ReviewItem) => void; onDelete: (task: Task) => void }) {
  const updateStatus = useUpdateTaskStatus();
  const [busyMember, setBusyMember] = useState<number | null>(null);
  const summary = summarizeTask(task);
  const nameOf = (id: string) => members.find((candidate) => String(candidate.id) === id)?.full_name || `عضو #${id}`;
  const rows = [...summary.entries].sort(([idA, a], [idB, b]) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || nameOf(idA).localeCompare(nameOf(idB), 'ar'));

  const changeStatus = async (memberId: number, entry: TaskTrackingEntry, next: TaskStatus | 'approve') => {
    if (next === entry.status) return;
    // الاعتماد يمنح نقاطاً؛ الإلغاء كمان يمر من نافذة تأكيد لتسجيل السبب وعكس النقاط.
    if (next === 'approve') { onReview({ task, memberId, entry }); return; }
    setBusyMember(memberId);
    try {
      // نمرر ملاحظة العضو ورابط تسليمه كما هما: الخادم يستبدل الحقلين بما يصله
      await updateStatus.mutateAsync({
        taskId: task.id,
        memberId,
        status: next,
        note: entry.note ?? '',
        submissionUrl: entry.submission_url ?? '',
        currentTracking: task.tracking ?? {},
      });
      toast.success(`اتحدّثت حالة ${nameOf(String(memberId))} لـ «${STATUS_META[next].label}».`);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نحدّث الحالة — مفيش حاجة اتغيرت.');
    } finally {
      setBusyMember(null);
    }
  };

  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <header className="grid gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-base font-black leading-7">{task.title}</h3>
          <button
            type="button"
            className="grid size-10 min-h-0 min-w-0 shrink-0 place-items-center rounded-lg border border-transparent text-[var(--text-muted)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-[var(--danger)] dark:hover:border-red-900 dark:hover:bg-red-950/40"
            aria-label={`امسح مهمة ${task.title}`}
            title="امسح المهمة"
            onClick={() => onDelete(task)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DeadlineChip task={task} summary={summary} />
          <BonusChip points={taskBonus(task)} />
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-xs font-bold text-[var(--text-2)]">
            <Users size={14} aria-hidden="true" />
            {task.assigned_to === 'ALL' ? 'كل الفريق' : arCount(summary.total, AR.member)}
          </span>
          {summary.awaitingReview > 0 && (
            <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_META.under_review.tone}`}>
              <Eye size={14} aria-hidden="true" />
              {arCount(summary.awaitingReview, AR.submission)} للمراجعة
            </span>
          )}
        </div>
        {task.description && <p className="line-clamp-3 whitespace-pre-line text-sm leading-6 text-[var(--text-2)]" title={task.description}>{task.description}</p>}
      </header>

      <TaskProgress summary={summary} />

      <ul className="flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain border-t border-[var(--border)] pt-2 pe-1" aria-label={`حالة اللي اتكلفوا بمهمة ${task.title}`}>
        {rows.length === 0 && <li className="py-3 text-center text-sm text-[var(--text-muted)]">مفيش حد مكلف بالمهمة دي.</li>}
        {rows.map(([id, entry]) => {
          const memberId = Number(id);
          const name = nameOf(id);
          const meta = STATUS_META[entry.status] ?? STATUS_META.pending;
          const isBusy = busyMember === memberId;
          return (
            <li key={id} className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
              {entry.status === 'under_review' && (
                <button
                  type="button"
                  className="inline-flex h-9 min-h-0 shrink-0 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-bold text-white transition-colors hover:bg-[var(--primary-hover)]"
                  onClick={() => onReview({ task, memberId, entry })}
                  aria-label={`مراجعة تسليم ${name}`}
                >
                  <Eye size={14} aria-hidden="true" />
                  مراجعة
                </button>
              )}
              {entry.status === 'approved' ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-bold ${meta.tone}`}>
                    <CheckCircle2 size={14} aria-hidden="true" />{meta.label}
                  </span>
                  <button type="button" onClick={() => onReview({ task, memberId, entry })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 px-2 text-xs font-bold text-red-800 hover:bg-red-50 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950/40" aria-label={`إلغاء اعتماد مهمة ${name}`}>
                    <RotateCcw size={13} aria-hidden="true" />إلغاء
                  </button>
                </span>
              ) : (
                <span className="relative shrink-0">
                  <select
                    className={`h-9 min-h-0 w-[8.5rem] cursor-pointer appearance-none rounded-lg border ps-2.5 pe-7 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-soft)] disabled:cursor-wait disabled:opacity-70 ${meta.tone}`}
                    value={entry.status}
                    onChange={(event) => void changeStatus(memberId, entry, event.target.value as TaskStatus | 'approve')}
                    disabled={isBusy}
                    aria-label={`حالة ${name}`}
                  >
                    {ADMIN_SETTABLE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
                    <option value="approve">اعتمد…</option>
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 end-2 my-auto grid place-items-center" aria-hidden="true">
                    {isBusy ? <Loader2 size={13} className="animate-spin" /> : <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
        <span>اتسندت في {formatDate(task.created_at, 'd MMMM yyyy')}</span>
        {summary.isComplete && <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={14} aria-hidden="true" />مكتملة</span>}
      </footer>
    </article>
  );
}
