import { AlertCircle, CalendarCheck2, CalendarClock, CalendarX2, CheckCircle2, Gift } from 'lucide-react';
import type { Task, TaskStatus, TaskTrackingEntry } from '../../types/db';
import { daysRemaining, formatDeadline, formatDeadlineTime, hoursRemaining, isOverdue, parseDeadline } from '../../lib/dateUtils';
import { arDaysPhrase, arDurationPhrase, formatSigned } from '../../lib/arabic';
import { useLocale } from '../../i18n/useLocale';

/** Labels and tones for task statuses; keep the Arabic defaults stable for existing consumers. */
export const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  pending: {
    label: 'لسه مبدأش',
    tone: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]',
  },
  in_progress: {
    label: 'تحت التنفيذ',
    tone: 'border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info-text)] dark:border-[var(--info-border)] dark:bg-[var(--info-soft)] dark:text-[var(--info-text)]',
  },
  under_review: {
    label: 'تحت المراجعة',
    tone: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  },
  revision_requested: {
    label: 'محتاجة تعديل',
    tone: 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]',
  },
  approved: {
    label: 'اتعتمدت',
    tone: 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:border-[var(--success-border)] dark:bg-[var(--success-soft)] dark:text-[var(--success-text)]',
  },
};

const ENGLISH_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  under_review: 'Under review',
  revision_requested: 'Revision requested',
  approved: 'Approved',
};

export function taskStatusLabel(status: TaskStatus, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? STATUS_META[status].label : ENGLISH_STATUS_LABELS[status];
}

/** Statuses an administrator can set manually; approval remains in review flow. */
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

/** Task bonus as a safe whole number (0 if the bonus migration is unavailable). */
export function taskBonus(task: Pick<Task, 'bonus_points'>): number {
  const value = Number(task.bonus_points ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function signedBonus(points: number, locale: 'ar' | 'en'): string {
  return locale === 'ar'
    ? formatSigned(points)
    : new Intl.NumberFormat('en-GB', { signDisplay: 'always', maximumFractionDigits: 0 }).format(points);
}

/** Bonus chip: planned points or points already awarded. */
export function BonusChip({ points, earned = false, className = '' }: { points: number; earned?: boolean; className?: string }) {
  const { locale, t } = useLocale();
  if (points <= 0) return null;
  const tone = earned
    ? 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:border-[var(--success-border)] dark:bg-[var(--success-soft)] dark:text-[var(--success-text)]'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-black tabular-nums ${tone} ${className}`}>
      <Gift size={14} aria-hidden="true" />
      {earned ? t('خدت ', 'Awarded ') : ''}{signedBonus(points, locale)} {t('بونص', 'bonus')}
    </span>
  );
}

function localizedDeadlineDate(
  deadline: string,
  locale: 'ar' | 'en',
  date: ReturnType<typeof useLocale>['date'],
  weekday = false,
): string {
  if (locale === 'ar') return formatDeadline(deadline, { weekday });
  const parsed = parseDeadline(deadline);
  const showYear = Boolean(parsed && parsed.getFullYear() !== new Date().getFullYear());
  return date(deadline, {
    ...(weekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    ...(showYear ? { year: 'numeric' as const } : {}),
  });
}

/** Due-date badge with locale-aware relative labels. */
export function DeadlineChip({ task, summary }: { task: Task; summary?: TaskSummary }) {
  const { locale, t, number, date } = useLocale();
  const s = summary ?? summarizeTask(task);
  const base = 'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold';
  if (!task.has_deadline || !task.deadline_date) {
    return <span className={`${base} border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]`}><CalendarX2 size={14} aria-hidden="true" />{t('بدون موعد', 'No deadline')}</span>;
  }
  const deadline = task.deadline_date;
  const dueDate = localizedDeadlineDate(deadline, locale, date);
  const time = locale === 'ar'
    ? formatDeadlineTime(deadline)
    : parseDeadline(deadline) && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)
      ? date(deadline, { hour: 'numeric', minute: '2-digit' })
      : null;
  if (s.isComplete) {
    return <span className={`${base} ${STATUS_META.approved.tone}`}><CheckCircle2 size={14} aria-hidden="true" />{t('اكتملت', 'Complete')} · {dueDate}</span>;
  }
  if (s.overdue) {
    const late = s.daysLeft !== null ? Math.abs(s.daysLeft) : 0;
    const lateHours = Math.abs(hoursRemaining(deadline) ?? 0);
    const since = locale === 'ar'
      ? late ? `بقالها ${arDaysPhrase(late)}` : lateHours > 0 ? `بقالها ${arDurationPhrase(lateHours)}` : ''
      : late ? t(`${number(late)} أيام تأخير`, `${number(late)} day${late === 1 ? '' : 's'} overdue`) : lateHours > 0 ? t(`${number(Math.ceil(lateHours))} ساعة تأخير`, `${number(Math.ceil(lateHours))} hour${Math.ceil(lateHours) === 1 ? '' : 's'} overdue`) : '';
    return <span className={`${base} ${STATUS_META.revision_requested.tone}`}><AlertCircle size={14} aria-hidden="true" />{t('متأخرة', 'Overdue')} {since} · {dueDate}</span>;
  }
  const hoursLeft = hoursRemaining(deadline);
  if (time && hoursLeft !== null && hoursLeft <= 12) {
    const duration = locale === 'ar'
      ? arDurationPhrase(hoursLeft)
      : `${number(Math.max(1, Math.ceil(hoursLeft)))} ${Math.ceil(hoursLeft) < 2 ? 'hour' : 'hours'}`;
    return <span className={`${base} ${STATUS_META.revision_requested.tone}`}><CalendarClock size={14} aria-hidden="true" />{t(`خلال ${duration}`, `Due in ${duration}`)} · {time}</span>;
  }
  if (s.daysLeft === 0) {
    return <span className={`${base} ${STATUS_META.under_review.tone}`}><CalendarClock size={14} aria-hidden="true" />{locale === 'ar' ? `ميعادها النهارده${time ? ` · ${time}` : ''}` : `Due today${time ? ` · ${time}` : ''}`}</span>;
  }
  if (s.daysLeft !== null && s.daysLeft <= 3) {
    const label = locale === 'ar'
      ? s.daysLeft === 1 ? 'بكرة' : `بعد ${arDaysPhrase(s.daysLeft)}`
      : s.daysLeft === 1 ? 'Tomorrow' : `In ${number(s.daysLeft)} days`;
    return <span className={`${base} ${STATUS_META.under_review.tone}`}><CalendarClock size={14} aria-hidden="true" />{label} · {dueDate}</span>;
  }
  return <span className={`${base} border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]`}><CalendarCheck2 size={14} aria-hidden="true" />{dueDate}</span>;
}

/** Approval progress bar. */
export function TaskProgress({ summary, compact = false }: { summary: TaskSummary; compact?: boolean }) {
  const { t, number } = useLocale();
  const { approved, total, percent } = summary;
  return (
    <div className="grid gap-1.5">
      {!compact && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-bold text-[var(--text-2)]">{t('الإنجاز', 'Progress')}</span>
          <span className="font-bold tabular-nums text-[var(--text-muted)]">{number(approved)} {t('من', 'of')} {number(total)} {t('اتعتمد', 'approved')} · {number(percent)}%</span>
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t(`نسبة الإنجاز ${percent}%`, `${percent}% complete`)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${percent === 100 ? 'bg-[var(--success)]' : 'bg-[var(--primary)]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
