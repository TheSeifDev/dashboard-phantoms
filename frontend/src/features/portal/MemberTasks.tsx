import { CheckCircle2 } from 'lucide-react';
import type { Task } from '../../types/db';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { MemberTaskCard } from './MemberTaskCard';
import { isOverdue, daysRemaining } from '../../lib/dateUtils';

interface MemberTasksProps {
  tasks: Task[];
  memberId: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onStart: (task: Task) => void;
  onSubmit: (task: Task) => void;
}

export function MemberTasks({ tasks, memberId, isLoading, isError, onRetry, onStart, onSubmit }: MemberTasksProps) {
  const statusOf = (task: Task) => task.tracking?.[memberId]?.status ?? 'pending';
  // "مطلوب تعديل" يحتاج تحرك العضو نفسه — ليس "قيد المراجعة"
  const actionable = (s: string) => s === 'pending' || s === 'in_progress' || s === 'revision_requested';
  const deadlineOf = (t: Task) => (t.has_deadline ? t.deadline_date : null);
  const urgent = tasks.filter((t) => { const s = statusOf(t); return s === 'revision_requested' || (actionable(s) && (isOverdue(deadlineOf(t)) || (daysRemaining(deadlineOf(t)) ?? 99) <= 3)); });
  const ongoing = tasks.filter((t) => actionable(statusOf(t)) && !urgent.includes(t));
  const review = tasks.filter((t) => statusOf(t) === 'under_review');
  const done = tasks.filter((t) => statusOf(t) === 'approved');

  const summary = [
    { label: 'محتاجة تحرك', value: urgent.length, tone: urgent.length ? 'text-red-700 dark:text-red-300' : 'text-[var(--text)]' },
    { label: 'حالية', value: ongoing.length, tone: 'text-[var(--link)]' },
    { label: 'مستنية المراجعة', value: review.length, tone: 'text-amber-700 dark:text-amber-300' },
    { label: 'اتعتمدت', value: done.length, tone: 'text-emerald-700 dark:text-emerald-300' },
  ];

  const group = (title: string, hint: string, items: Task[]) => items.length ? (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-sm font-black text-[var(--text)]">{title} <span className="tabular-nums text-[var(--text-muted)]">({items.length})</span></h3>
        <p className="text-xs text-[var(--text-muted)]">{hint}</p>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
        {items.map((task) => <MemberTaskCard key={task.id} task={task} memberId={memberId} onStart={onStart} onSubmit={onSubmit} />)}
      </div>
    </div>
  ) : null;

  return (
    <section className="grid gap-5" aria-labelledby="member-tasks-title">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]"><CheckCircle2 size={20} aria-hidden="true" /></span>
        <h2 id="member-tasks-title" className="text-lg font-black">مهامي <span className="text-sm tabular-nums text-[var(--text-muted)]">({tasks.length})</span></h2>
      </div>
      {isLoading ? <CardSkeletons count={2} />
        : isError ? <ErrorState message="معرفناش نحمّل مهامك." onRetry={onRetry} />
          : tasks.length === 0 ? <EmptyState title="مفيش مهام متسندة ليك" description="هتظهر هنا المهام الجديدة أول ما تتسند ليك." />
            : <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summary.map((item) => (
                    <div key={item.label} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                      <dt className="text-xs font-semibold text-[var(--text-muted)]">{item.label}</dt>
                      <dd className={`text-xl font-black tabular-nums ${item.tone}`}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                {group('محتاجة تحرك دلوقتي', 'تعديل مطلوب أو موعد قريب', urgent)}
                {group('مهام حالية', 'ابدأ الشغل وبعدها سلّم الرابط', ongoing)}
                {group('مستنية مراجعة الإدارة', 'مش مطلوب منك تعمل حاجة دلوقتي', review)}
                {group('مكتملة واتعتمدت', 'برافو!', done)}
              </>}
    </section>
  );
}
