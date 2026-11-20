import { CheckCircle2 } from 'lucide-react';
import type { Task } from '../../types/db';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { MemberTaskCard } from './MemberTaskCard';
import { isOverdue, daysRemaining } from '../../lib/dateUtils';
import { useLocale } from '../../i18n/useLocale';

interface MemberTasksProps {
  tasks: Task[];
  memberId: string;
  isLoading: boolean;
  isError: boolean;
  isUpdating: boolean;
  onRetry: () => void;
  onStart: (task: Task) => void;
  onSubmit: (task: Task) => void;
}

export function MemberTasks({ tasks, memberId, isLoading, isError, isUpdating, onRetry, onStart, onSubmit }: MemberTasksProps) {
  const { t, dir, number } = useLocale();
  const statusOf = (task: Task) => task.tracking?.[memberId]?.status ?? 'pending';
  // "مطلوب تعديل" يحتاج تحرك العضو نفسه — ليس "قيد المراجعة"
  const actionable = (s: string) => s === 'pending' || s === 'in_progress' || s === 'revision_requested';
  const deadlineOf = (t: Task) => (t.has_deadline ? t.deadline_date : null);
  const urgent = tasks.filter((t) => { const s = statusOf(t); return s === 'revision_requested' || (actionable(s) && (isOverdue(deadlineOf(t)) || (daysRemaining(deadlineOf(t)) ?? 99) <= 3)); });
  const ongoing = tasks.filter((t) => actionable(statusOf(t)) && !urgent.includes(t));
  const review = tasks.filter((t) => statusOf(t) === 'under_review');
  const done = tasks.filter((t) => statusOf(t) === 'approved');

  const summary = [
    { label: t('محتاجة تحرك', 'Needs action'), value: urgent.length, tone: urgent.length ? 'text-[var(--danger-text)] dark:text-[var(--danger-text)]' : 'text-[var(--text)]' },
    { label: t('حالية', 'In progress'), value: ongoing.length, tone: 'text-[var(--link)]' },
    { label: t('مستنية المراجعة', 'Awaiting review'), value: review.length, tone: 'text-amber-700 dark:text-amber-300' },
    { label: t('اتعتمدت', 'Approved'), value: done.length, tone: 'text-[var(--success-text)] dark:text-[var(--success-text)]' },
  ];

  const group = (title: string, hint: string, items: Task[]) => items.length ? (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-sm font-black text-[var(--text)]">{title} <span className="tabular-nums text-[var(--text-muted)]">({number(items.length)})</span></h3>
        <p className="text-xs text-[var(--text-muted)]">{hint}</p>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
        {items.map((task) => <MemberTaskCard key={task.id} task={task} memberId={memberId} isUpdating={isUpdating} onStart={onStart} onSubmit={onSubmit} />)}
      </div>
    </div>
  ) : null;

  return (
    <section dir={dir} className="grid gap-5" aria-labelledby="member-tasks-title" aria-busy={isLoading}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]"><CheckCircle2 size={20} aria-hidden="true" /></span>
        <h2 id="member-tasks-title" className="text-lg font-black">{t('مهامي', 'My tasks')} <span className="text-sm tabular-nums text-[var(--text-muted)]">({number(tasks.length)})</span></h2>
      </div>
      {isLoading ? <div role="status" aria-label={t('بنحمّل مهامك', 'Loading your tasks')}><CardSkeletons count={2} /></div>
        : isError ? <ErrorState message={t('معرفناش نحمّل مهامك.', 'We could not load your tasks.')} onRetry={onRetry} />
          : tasks.length === 0 ? <EmptyState title={t('مفيش مهام متسندة ليك', 'No tasks assigned to you')} description={t('هتظهر هنا المهام الجديدة أول ما تتسند ليك.', 'New tasks will appear here when they are assigned to you.')} />
            : <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summary.map((item) => (
                    <div key={item.label} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                      <dt className="text-xs font-semibold text-[var(--text-muted)]">{item.label}</dt>
                      <dd className={`text-xl font-black tabular-nums ${item.tone}`}>{number(item.value)}</dd>
                    </div>
                  ))}
                </dl>
                {group(t('محتاجة تحرك دلوقتي', 'Action needed now'), t('تعديل مطلوب أو موعد قريب', 'Revision requested or deadline approaching'), urgent)}
                {group(t('مهام حالية', 'Current tasks'), t('ابدأ الشغل وبعدها سلّم الرابط', 'Start working, then submit your link'), ongoing)}
                {group(t('مستنية مراجعة الإدارة', 'Awaiting admin review'), t('مش مطلوب منك تعمل حاجة دلوقتي', 'Nothing else is needed from you right now'), review)}
                {group(t('مكتملة واتعتمدت', 'Completed and approved'), t('برافو!', 'Well done!'), done)}
              </>}
    </section>
  );
}
