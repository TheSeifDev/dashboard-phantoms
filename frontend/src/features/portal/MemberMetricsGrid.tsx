import { useMemo } from 'react';
import { CheckCircle2, ClipboardList, Clock3, Quote, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MemberEvaluation, Task } from '../../types/db';
import { useLocale } from '../../i18n/useLocale';
import { AnimatedNumber } from '../../components/motion/AnimatedNumber';
import { Sparkline, type Tone } from '../dashboard/DashboardMetrics';
import { cairoDayOf, bucketSeries } from '../dashboard/teamActivity';
import { getCairoDate } from '../dashboard/taskContributions';
import './portal-home.css';

const ACTIONABLE = new Set(['pending', 'in_progress', 'revision_requested']);

interface MetricCardProps {
  title: string;
  value: number | null;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
  series: number[];
  /** رسالة التقييم المكتوب بتظهر تحت شريط التقدم جوه الكارت. */
  note?: { text: string; title: string; onOpen: () => void } | null;
}

function MetricCard({ title, value, detail, icon: Icon, tone, series, note }: MetricCardProps) {
  const { t, number } = useLocale();
  return (
    <article className="kpi-card glass-card" data-tone={tone} data-tilt="4" data-reveal>
      <div className="kpi-head">
        <span className="kpi-icon" aria-hidden="true"><Icon size={18} /></span>
        <span className="kpi-title">{title}</span>
      </div>
      <div className="kpi-body">
        <div className="kpi-value-row">
          <strong className="kpi-value">
            {value === null ? '—' : <AnimatedNumber value={value} format={number} />}
          </strong>
        </div>
        <Sparkline values={series} tone={tone} />
      </div>
      {note ? (
        <button type="button" className="kpi-note" onClick={note.onOpen}>
          <Quote size={13} aria-hidden="true" />
          <span className="kpi-note-copy" dir="auto">
            <span className="kpi-note-title">{note.title}</span>
            {note.text}
          </span>
          <span className="kpi-note-link">{t('كل التقييمات', 'All evaluations')}</span>
        </button>
      ) : null}
      <span className="kpi-detail">{detail}</span>
    </article>
  );
}

/**
 * نفس كروت مؤشرات لوحة الإدارة (شريط التقدم + التفاصيل) بس بنطاق العضو:
 * مهامه واعتماداته ونقاطه. لو فيه تقييم مكتوب، آخر ملاحظة بتظهر كـ message
 * تحت شريط التقدم جوه كارت الاعتمادات.
 */
export function MemberMetricsGrid({
  tasks,
  memberId,
  evaluations,
  teamSize,
  bonus,
  onOpenEvaluations,
}: {
  tasks: Task[];
  memberId: number;
  evaluations: MemberEvaluation[];
  teamSize: number | null;
  bonus: number | null;
  onOpenEvaluations: () => void;
}) {
  const { t, number } = useLocale();
  const today = getCairoDate();

  const metrics = useMemo(() => {
    const statusOf = (task: Task) => task.tracking?.[String(memberId)]?.status ?? 'pending';
    const updatedOn = (task: Task) => cairoDayOf(task.tracking?.[String(memberId)]?.updated_at ?? null);
    const underReviewDates: string[] = [];
    const approvedDates: string[] = [];
    const createdDates: string[] = [];
    let underReview = 0;
    let approved = 0;
    for (const task of tasks) {
      const status = statusOf(task);
      if (status === 'under_review') {
        underReview += 1;
        const day = updatedOn(task);
        if (day) underReviewDates.push(day);
      }
      if (status === 'approved') {
        approved += 1;
        const day = updatedOn(task);
        if (day) approvedDates.push(day);
      }
      const created = cairoDayOf(task.created_at);
      if (created) createdDates.push(created);
    }
    const actionable = tasks.filter((task) => ACTIONABLE.has(statusOf(task))).length;
    return {
      underReview,
      approved,
      total: tasks.length,
      actionable,
      underReviewSeries: bucketSeries(underReviewDates, today),
      approvedSeries: bucketSeries(approvedDates, today),
      totalSeries: bucketSeries(createdDates, today),
      teamSeries: [teamSize ?? 0],
    };
  }, [tasks, memberId, teamSize, today]);

  const latestWritten = useMemo(() => {
    const written = evaluations
      .filter((item) => item.kind !== 'strike' && typeof item.feedback === 'string' && item.feedback.trim().length > 0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return written[0] ?? null;
  }, [evaluations]);

  return (
    <section className="kpi-grid" data-testid="member-metrics" aria-label={t('مؤشراتك', 'Your metrics')}>
      <MetricCard
        title={t('تحت المراجعة', 'Under review')}
        value={metrics.underReview}
        detail={t('تسليمات تنتظر قرار الإدارة', 'Submissions awaiting an admin decision')}
        icon={Clock3}
        tone="amber"
        series={metrics.underReviewSeries}
      />
      <MetricCard
        title={t('اعتمادات حالية', 'Approved now')}
        value={metrics.approved}
        detail={t('الحالات المعتمدة فقط وليست سجل الإنجاز', 'Currently approved states, not your full delivery record')}
        icon={CheckCircle2}
        tone="green"
        series={metrics.approvedSeries}
        note={
          latestWritten
            ? {
              title: latestWritten.title,
              text: latestWritten.feedback.trim(),
              onOpen: onOpenEvaluations,
            }
            : null
        }
      />
      <MetricCard
        title={t('إجمالي المهام', 'Total tasks')}
        value={metrics.total}
        detail={t('تكليفات مسندة لك على النظام', 'Assignments assigned to you')}
        icon={ClipboardList}
        tone="violet"
        series={metrics.totalSeries}
      />
      <MetricCard
        title={t('أعضاء الفريق', 'Team members')}
        value={teamSize}
        detail={
          bonus === null
            ? t('الأعضاء الظاهرون ضمن صلاحيتك', 'Members visible within your access')
            : t(`نقاطي ${number(bonus)} · الأعضاء ضمن صلاحيتك`, `${number(bonus)} points · members within your access`)
        }
        icon={Users}
        tone="blue"
        series={metrics.teamSeries}
      />
    </section>
  );
}