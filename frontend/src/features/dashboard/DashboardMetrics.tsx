import { ChevronLeft, Clock3, Laptop, MapPinned, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DashboardMetrics } from './metrics';

type Card = {
  key: string;
  title: string;
  icon: typeof Users;
  color: string;
  to: string;
  value: (m: DashboardMetrics) => string | number;
  detail: (m: DashboardMetrics) => string;
  alert?: (m: DashboardMetrics) => boolean;
};

const cards: Card[] = [
  { key: 'totalMembers', title: 'أعضاء الفريق', icon: Users, color: 'text-[var(--link)]', to: '/admin/members', value: (m) => m.totalMembers, detail: () => 'إجمالي الأعضاء المسجلين' },
  { key: 'laptopPercentage', title: 'جاهزية الأجهزة', icon: Laptop, color: 'text-cyan-700 dark:text-cyan-300', to: '/admin/members', value: (m) => `${m.laptopPercentage}%`, detail: (m) => `عندهم لابتوب: ${m.laptopCount} من ${m.totalMembers}` },
  { key: 'alexPercentage', title: 'جاهزية الميدان', icon: MapPinned, color: 'text-emerald-700 dark:text-emerald-300', to: '/admin/members', value: (m) => `${m.alexPercentage}%`, detail: (m) => `يقدروا ينزلوا: ${m.alexCount} من ${m.totalMembers}` },
  { key: 'underReview', title: 'تسليمات للمراجعة', icon: Clock3, color: 'text-amber-700 dark:text-amber-300', to: '/admin/tasks', value: (m) => m.underReview, detail: (m) => m.overdue ? `متأخر عن الموعد: ${m.overdue}` : 'مفيش تكليفات متأخرة', alert: (m) => m.overdue > 0 },
];

export function DashboardMetricsGrid({ metrics }: { metrics: DashboardMetrics }) {
  const navigate = useNavigate();
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="مؤشرات الفريق">
      {cards.map(({ key, title, icon: Icon, color, to, value, detail, alert }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(to)}
          aria-label={`${title}: ${value(metrics)} — ${detail(metrics)}. عرض التفاصيل`}
          className="group flex min-w-0 flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-start shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:bg-[var(--surface-2)] focus-visible:outline-2 sm:p-5"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="text-sm font-bold text-[var(--text-2)]">{title}</span>
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] ${color}`} aria-hidden="true"><Icon size={18} /></span>
          </span>
          <span className={`mt-3 text-2xl font-black tabular-nums sm:text-3xl ${color}`}>{value(metrics)}</span>
          <span className="mt-1 flex items-center justify-between gap-2 text-xs leading-5">
            <span className={alert?.(metrics) ? 'font-bold text-red-700 dark:text-red-300' : 'text-[var(--text-muted)]'}>{detail(metrics)}</span>
            <ChevronLeft size={15} className="shrink-0 text-[var(--text-muted)] transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
          </span>
        </button>
      ))}
    </section>
  );
}
