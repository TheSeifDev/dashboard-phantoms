import { useEffect, useId, useMemo, useRef } from 'react';
import { CircleCheck, ClipboardList, Clock3, TrendingDown, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '../../components/motion/AnimatedNumber';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import { useLocale } from '../../i18n/useLocale';
import type { DashboardMetrics as DashboardMetricValues } from './metrics';

export interface MetricSeries {
  members: number[];
  tasks: number[];
  approvals: number[];
  submissions: number[];
}

export type Tone = 'blue' | 'violet' | 'green' | 'amber';

export function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const gradient = useId().replace(/:/g, '');
  const line = useRef<SVGPathElement>(null);
  const area = useRef<SVGPathElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const width = 120;
  const height = 40;
  const { path, fill, last } = useMemo(() => {
    const series = values.length > 1 ? values : [0, ...values, 0].slice(0, 2);
    const max = Math.max(1, ...series);
    const min = Math.min(0, ...series);
    const step = width / (series.length - 1);
    const points = series.map((value, index) => [index * step, height - 4 - ((value - min) / (max - min || 1)) * (height - 10)] as const);
    let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let index = 1; index < points.length; index += 1) {
      const [x0, y0] = points[index - 1];
      const [x1, y1] = points[index];
      const cx = (x0 + x1) / 2;
      d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return { path: d, fill: `${d} L${width},${height} L0,${height} Z`, last: points[points.length - 1] };
  }, [values]);
  useEffect(() => {
    const stroke = line.current;
    if (!stroke || prefersReducedMotion()) return;
    const length = stroke.getTotalLength?.() ?? 200;
    const context = gsap.context(() => {
      gsap.fromTo(stroke, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', delay: 0.15, clearProps: 'strokeDasharray,strokeDashoffset' });
      if (area.current) gsap.fromTo(area.current, { opacity: 0 }, { opacity: 1, duration: 1.1, delay: 0.6, ease: 'power1.out' });
      if (dot.current) {
        gsap.fromTo(dot.current, { scale: 0 }, { scale: 1, duration: 0.5, delay: 1.35, ease: 'back.out(3)' });
      }
    });
    return () => context.revert();
  }, [path]);
  return (
    <span className="kpi-spark" data-tone={tone} aria-hidden="true">
      <svg className="kpi-spark-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path ref={area} d={fill} fill={`url(#${gradient})`} />
        <path ref={line} d={path} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* A DOM dot stays a perfect circle; an SVG circle inside a stretched viewBox turns into an oval. */}
      <span
        ref={dot}
        className="kpi-spark-dot"
        style={{ left: `${(last[0] / width) * 100}%`, top: `${(last[1] / height) * 100}%` }}
      />
    </span>
  );
}

interface MetricCardProps {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
  series: number[];
  deltaLabel: (delta: number) => string;
}

function MetricCard({ title, value, detail, icon: Icon, tone, series, deltaLabel }: MetricCardProps) {
  const { number } = useLocale();
  const current = series[series.length - 1] ?? 0;
  const previous = series[series.length - 2] ?? 0;
  const delta = current - previous;
  const Trend = delta < 0 ? TrendingDown : TrendingUp;
  return (
    <article className="kpi-card glass-card" data-tone={tone} data-tilt="4" data-reveal>
      <div className="kpi-head">
        <span className="kpi-icon" aria-hidden="true"><Icon size={18} /></span>
        <span className="kpi-title">{title}</span>
      </div>
      <div className="kpi-body">
        <div className="kpi-value-row">
          <strong className="kpi-value"><AnimatedNumber value={value} format={number} /></strong>
          <span className="kpi-delta" data-trend={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}>
            <Trend size={13} aria-hidden="true" />
            {deltaLabel(delta)}
          </span>
        </div>
        <Sparkline values={series} tone={tone} />
      </div>
      <span className="kpi-detail">{detail}</span>
    </article>
  );
}

export function DashboardMetricsGrid({ metrics, taskCount, series }: { metrics: DashboardMetricValues; taskCount: number; series: MetricSeries }) {
  const { t, number } = useLocale();
  const weekly = (delta: number) => (delta === 0
    ? t('ثابت', 'steady')
    : t(`${delta > 0 ? '+' : '−'}${number(Math.abs(delta))} الأسبوع ده`, `${delta > 0 ? '+' : '−'}${number(Math.abs(delta))} this week`));
  return (
    <section data-testid="dashboard-metrics" className="kpi-grid" aria-label={t('مؤشرات الفريق', 'Team metrics')}>
      <MetricCard
        title={t('أعضاء الفريق', 'Team members')}
        value={metrics.totalMembers}
        detail={t('الأعضاء الظاهرون ضمن صلاحيتك', 'Members available to your dashboard access')}
        icon={Users}
        tone="blue"
        series={series.members}
        deltaLabel={weekly}
      />
      <MetricCard
        title={t('إجمالي المهام', 'Tasks')}
        value={taskCount}
        detail={t('تكليفات محمّلة من النظام', 'Assignments returned by the task query')}
        icon={ClipboardList}
        tone="violet"
        series={series.tasks}
        deltaLabel={weekly}
      />
      <MetricCard
        title={t('اعتمادات حالية', 'Approved now')}
        value={metrics.approvedTasks}
        detail={t('الحالات الحالية فقط، وليست سجل الأحداث', 'Current task states, not approval history')}
        icon={CircleCheck}
        tone="green"
        series={series.approvals}
        deltaLabel={weekly}
      />
      <MetricCard
        title={t('تحت المراجعة', 'Under review')}
        value={metrics.underReview}
        detail={t('تسليمات تنتظر قرار الإدارة', 'Submissions awaiting an admin decision')}
        icon={Clock3}
        tone="amber"
        series={series.submissions}
        deltaLabel={weekly}
      />
    </section>
  );
}
