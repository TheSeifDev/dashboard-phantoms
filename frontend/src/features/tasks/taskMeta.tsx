import { AlertCircle, CalendarCheck2, CalendarClock, CalendarX2, CheckCircle2, Gift } from 'lucide-react';
import type { Task, TaskStatus, TaskTrackingEntry } from '../../types/db';
import { daysRemaining, formatDeadline, formatDeadlineTime, hoursRemaining, isOverdue } from '../../lib/dateUtils';
import { arDaysPhrase, arDurationPhrase, formatSigned } from '../../lib/arabic';

/** تسميات وألوان الحالات — مصدر واحد للبطاقة والجدول والقائمة المنسدلة */
export const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  pending: {
    label: 'لسه مبدأش',
    tone: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]',
  },
  in_progress: {
    label: 'تحت التنفيذ',
    tone: 'border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200',
  },
  under_review: {
    label: 'تحت المراجعة',
    tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  },
  revision_requested: {
    label: 'محتاجة تعديل',
    tone: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  },
  approved: {
    label: 'اتعتمدت',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
};

/** الحالات التي يضبطها المسؤول يدوياً — الاعتماد يمر فقط عبر نافذة المراجعة (يمنح نقاطاً) */
export const ADMIN_SETTABLE_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'under_review', 'revision_requested'];

export interface TaskSummary {
  entries: Array<[string, TaskTrackingEntry]>;
  total: number;
  approved: number;
  awaitingReview: number;
  percent: number;
  isComplete: boolean;
  overdue: boolean;
  daysLeft: number | null;
}

export function summarizeTask(task: Task): TaskSummary {
  const entries = Object.entries(task.tracking ?? {});
  const total = entries.length;
  const approved = entries.filter(([, entry]) => entry.status === 'approved').length;
  const awaitingReview = entries.filter(([, entry]) => entry.status === 'under_review').length;
  const isComplete = total > 0 && approved === total;
  const deadline = task.has_deadline ? task.deadline_date : null;
  return {
    entries,
    total,
    approved,
    awaitingReview,
    percent: total ? Math.round((approved / total) * 100) : 0,
    isComplete,
    overdue: !isComplete && isOverdue(deadline),
    daysLeft: daysRemaining(deadline),
  };
}

/** بونص المهمة كعدد صحيح آمن (0 إن لم تُطبَّق migration 0012 بعد) */
export function taskBonus(task: Pick<Task, 'bonus_points'>): number {
  const value = Number(task.bonus_points ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** شارة البونص: "+10 بونص" — earned = تم منحه فعلاً */
export function BonusChip({ points, earned = false, className = '' }: { points: number; earned?: boolean; className?: string }) {
  if (points <= 0) return null;
  const tone = earned
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-black tabular-nums ${tone} ${className}`}>
      <Gift size={14} aria-hidden="true" />
      {earned ? 'خدت ' : ''}{formatSigned(points)} بونص
    </span>
  );
}

/** شارة الموعد: بدون موعد / متأخرة / اليوم / قريباً / عادية / مكتملة */
export function DeadlineChip({ task, summary }: { task: Task; summary?: TaskSummary }) {
  const s = summary ?? summarizeTask(task);
  const base = 'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold';
  if (!task.has_deadline || !task.deadline_date) {
    return <span className={`${base} border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]`}><CalendarX2 size={14} aria-hidden="true" />بدون موعد</span>;
  }
  const date = formatDeadline(task.deadline_date);
  if (s.isComplete) {
    return <span className={`${base} ${STATUS_META.approved.tone}`}><CheckCircle2 size={14} aria-hidden="true" />اكتملت · {date}</span>;
  }
  if (s.overdue) {
    const late = s.daysLeft !== null ? Math.abs(s.daysLeft) : 0;
    const lateHours = Math.abs(hoursRemaining(task.deadline_date) ?? 0);
    const since = late ? `بقالها ${arDaysPhrase(late)}` : lateHours > 0 ? `بقالها ${arDurationPhrase(lateHours)}` : '';
    return <span className={`${base} ${STATUS_META.revision_requested.tone}`}><AlertCircle size={14} aria-hidden="true" />متأخرة {since} · {date}</span>;
  }
  const time = formatDeadlineTime(task.deadline_date);
  const hoursLeft = hoursRemaining(task.deadline_date);
  if (time && hoursLeft !== null && hoursLeft <= 12) {
    return <span className={`${base} ${STATUS_META.revision_requested.tone}`}><CalendarClock size={14} aria-hidden="true" />خلال {arDurationPhrase(hoursLeft)} · {time}</span>;
  }
  if (s.daysLeft === 0) {
    return <span className={`${base} ${STATUS_META.under_review.tone}`}><CalendarClock size={14} aria-hidden="true" />ميعادها النهارده{time ? ` · ${time}` : ''}</span>;
  }
  if (s.daysLeft !== null && s.daysLeft <= 3) {
    const label = s.daysLeft === 1 ? 'بكرة' : `بعد ${arDaysPhrase(s.daysLeft)}`;
    return <span className={`${base} ${STATUS_META.under_review.tone}`}><CalendarClock size={14} aria-hidden="true" />{label} · {date}</span>;
  }
  return <span className={`${base} border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]`}><CalendarCheck2 size={14} aria-hidden="true" />{date}</span>;
}

/** شريط تقدم الاعتماد */
export function TaskProgress({ summary, compact = false }: { summary: TaskSummary; compact?: boolean }) {
  const { approved, total, percent } = summary;
  return (
    <div className="grid gap-1.5">
      {!compact && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-bold text-[var(--text-2)]">الإنجاز</span>
          <span className="font-bold tabular-nums text-[var(--text-muted)]">{approved} من {total} اتعتمد · {percent}%</span>
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`نسبة الإنجاز ${percent}%`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${percent === 100 ? 'bg-emerald-600' : 'bg-[var(--primary)]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
