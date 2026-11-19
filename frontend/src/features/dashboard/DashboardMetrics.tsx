import { ClipboardList, Clock3, CircleCheck, Users } from 'lucide-react';
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import type { DashboardMetrics as DashboardMetricValues } from './metrics';
import { useLocale } from '../../i18n/useLocale';

gsap.registerPlugin(useGSAP);

interface MetricCardProps {
  title: string;
  value: number;
  detail: string;
  icon: typeof Users;
  tone: 'blue' | 'cyan' | 'green' | 'red';
}

function MetricCard({ title, value, detail, icon: Icon, tone }: MetricCardProps) {
  const { number, locale } = useLocale();
  const visual = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    if (!visual.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const count = { value: 0 };
    gsap.to(count, { value, duration: 0.65, ease: 'power2.out', onUpdate: () => { if (visual.current) visual.current.textContent = number(Math.round(count.value)); } });
    return () => { if (visual.current) visual.current.textContent = number(value); };
  }, { scope: visual, dependencies: [value, locale], revertOnUpdate: true });
  return (
    <article className={`dashboard-metric-card dashboard-metric-${tone}`}>
      <div className="dashboard-metric-top">
        <span className="dashboard-metric-title">{title}</span>
        <span className="dashboard-metric-icon" aria-hidden="true"><Icon size={18} /></span>
      </div>
      <strong className="dashboard-metric-value"><span ref={visual} aria-hidden="true">{number(value)}</span><span className="sr-only">{number(value)}</span></strong>
      <span className="dashboard-metric-detail">{detail}</span>
    </article>
  );
}

export function DashboardMetricsGrid({ metrics, taskCount }: { metrics: DashboardMetricValues; taskCount: number }) {
  const { t } = useLocale();
  return (
    <section data-testid="dashboard-metrics" className="dashboard-metrics" aria-label={t('مؤشرات الفريق', 'Team metrics')}>
      <MetricCard
        title={t('أعضاء الفريق', 'Team members')}
        value={metrics.totalMembers}
        detail={t('الأعضاء الظاهرون ضمن صلاحيتك', 'Members available to your dashboard access')}
        icon={Users}
        tone="blue"
      />
      <MetricCard
        title={t('إجمالي المهام', 'Tasks')}
        value={taskCount}
        detail={t('تكليفات محمّلة من النظام', 'Assignments returned by the task query')}
        icon={ClipboardList}
        tone="cyan"
      />
      <MetricCard
        title={t('اعتمادات حالية', 'Approved now')}
        value={metrics.approvedTasks}
        detail={t('الحالات الحالية فقط، وليست سجل الأحداث', 'Current task states, not approval history')}
        icon={CircleCheck}
        tone="green"
      />
      <MetricCard
        title={t('تحت المراجعة', 'Under review')}
        value={metrics.underReview}
        detail={t('تسليمات تنتظر قرار الإدارة', 'Submissions awaiting an admin decision')}
        icon={Clock3}
        tone={metrics.underReview > 0 ? 'red' : 'blue'}
      />
    </section>
  );
}
