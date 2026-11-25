import type { ReactNode } from 'react';
import type {
  MemberEvaluationGrade, TeamConsoleTaskState, TeamGoalStatus,
} from '../../../types/db';

export const TASK_STATE_COPY: Record<TeamConsoleTaskState, { ar: string; en: string; tone: 'muted' | 'accent' | 'warning' | 'primary' }> = {
  open: { ar: 'مفتوحة', en: 'Open', tone: 'muted' },
  review: { ar: 'تحت المراجعة', en: 'In review', tone: 'accent' },
  revision: { ar: 'محتاجة تعديل', en: 'Needs revision', tone: 'warning' },
  approved: { ar: 'معتمدة', en: 'Approved', tone: 'primary' },
};

export const GRADE_COPY: Record<MemberEvaluationGrade, { ar: string; en: string; stars: number }> = {
  excellent: { ar: 'ممتاز', en: 'Excellent', stars: 5 },
  very_good: { ar: 'جيد جدًا', en: 'Very good', stars: 4 },
  good: { ar: 'جيد', en: 'Good', stars: 3 },
  needs_improvement: { ar: 'محتاج تحسين', en: 'Needs improvement', stars: 2 },
  warning: { ar: 'تحذير', en: 'Warning', stars: 1 },
};

export const GOAL_STATUS_COPY: Record<TeamGoalStatus, { ar: string; en: string }> = {
  active: { ar: 'شغال', en: 'Active' },
  done: { ar: 'خلص', en: 'Done' },
  paused: { ar: 'متوقف', en: 'Paused' },
};

/** رأس قسم موحد لكل بانلات لوحة الفريق. */
export function PanelShell({
  kicker, title, hint, actions, children, id,
}: {
  kicker: ReactNode;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="tmc-panel" aria-labelledby={id} data-tmc-anim>
      <header className="tmc-panel-head">
        <div>
          <span className="tmc-kicker">{kicker}</span>
          <h2 id={id}>{title}</h2>
        </div>
        {actions ? <div className="tmc-panel-actions">{actions}</div> : null}
      </header>
      {hint ? <p className="tmc-panel-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** شريحة حالة صغيرة (chip) بألوان التوكنز. */
export function StateChip({ tone, children }: { tone: 'muted' | 'accent' | 'warning' | 'primary'; children: ReactNode }) {
  return <span className={`tmc-chip is-${tone}`}>{children}</span>;
}

/** عدّاد أرقام بسيط للبطاقات. */
export function MiniMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="tmc-metric" data-tmc-anim>
      <strong dir="ltr">{value}</strong>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

/** يحوّل تاريخ ISO إلى مفتاح يوم محلي YYYY-MM-DD. */
export function dayKey(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
}

/** آخر N يوم كقائمة مفاتيح تصاعدية. */
export function lastDays(count: number) {
  const days: string[] = [];
  const today = new Date();
  for (let index = count - 1; index >= 0; index -= 1) {
    const cursor = new Date(today.getTime() - index * 86_400_000);
    const month = `${cursor.getMonth() + 1}`.padStart(2, '0');
    const day = `${cursor.getDate()}`.padStart(2, '0');
    days.push(`${cursor.getFullYear()}-${month}-${day}`);
  }
  return days;
}
