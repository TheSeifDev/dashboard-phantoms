import { useMemo } from 'react';
import {
  Activity, ArrowUpRight, ClipboardList, Gauge, Sparkles, Target, UsersRound,
} from 'lucide-react';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole } from '../../../types/db';
import { BarsChart, DonutChart, ProgressRing, TrendChart } from './charts';
import { GRADE_COPY, MiniMetric, PanelShell, StateChip, TASK_STATE_COPY, dayKey, lastDays } from './shared';

export function OverviewPanel({
  data, onNavigate,
}: {
  data: TeamConsole;
  onNavigate: (tab: string) => void;
}) {
  const { t, locale, number, date } = useLocale();
  const { members, tasks, evaluations, goals } = data;

  const summary = useMemo(() => {
    const stateCounts = { open: 0, review: 0, revision: 0, approved: 0 };
    for (const task of tasks) stateCounts[task.state] += 1;
    const recentCutoff = Date.now() - 30 * 86_400_000;
    const recentEvaluations = evaluations.filter((item) => new Date(item.created_at).getTime() >= recentCutoff);
    const teamBonus = members.reduce((sum, member) => sum + member.team_bonus, 0);
    const mainBonus = members.reduce((sum, member) => sum + member.main_bonus, 0);
    const planRatio = goals.length === 0
      ? 0
      : goals.reduce((sum, goal) => sum + Math.min(1, goal.target_value > 0 ? goal.current_value / goal.target_value : 0), 0) / goals.length;
    const overdue = tasks.filter((task) => task.has_deadline && task.deadline_date
      && task.state !== 'approved' && new Date(task.deadline_date).getTime() < Date.now()).length;
    return { stateCounts, recentEvaluations, teamBonus, mainBonus, planRatio, overdue };
  }, [members, tasks, evaluations, goals]);

  const trend = useMemo(() => {
    const days = lastDays(14);
    const buckets = new Map(days.map((day) => [day, 0]));
    for (const task of tasks) {
      const key = dayKey(task.created_at);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    for (const item of evaluations) {
      const key = dayKey(item.created_at);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return days.map((day) => ({ label: day.slice(5), value: buckets.get(day) ?? 0 }));
  }, [tasks, evaluations]);

  const bonusBars = useMemo(() => members
    .slice()
    .sort((a, b) => b.main_bonus - a.main_bonus)
    .slice(0, 8)
    .map((member) => ({
      id: member.member_id,
      label: member.full_name,
      value: member.main_bonus,
      hint: `${t('فريق', 'team')} ${member.team_bonus >= 0 ? '+' : ''}${member.team_bonus}`,
      tone: 'primary' as const,
    })), [members, t]);

  const donutSegments = [
    { id: 'open', label: t('مفتوحة', 'Open'), value: summary.stateCounts.open, tone: 'muted' as const },
    { id: 'review', label: t('تحت المراجعة', 'In review'), value: summary.stateCounts.review, tone: 'accent' as const },
    { id: 'revision', label: t('تعديل', 'Revision'), value: summary.stateCounts.revision, tone: 'warning' as const },
    { id: 'approved', label: t('معتمدة', 'Approved'), value: summary.stateCounts.approved, tone: 'primary' as const },
  ];

  const recentEvents = useMemo(() => {
    const events = [
      ...tasks.map((task) => ({ id: `t-${task.id}`, at: task.created_at, label: task.title, kind: 'task' as const })),
      ...evaluations.map((item) => ({ id: `e-${item.id}`, at: item.created_at, label: `${item.member_name} — ${item.title}`, kind: 'evaluation' as const })),
    ];
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
  }, [tasks, evaluations]);

  return (
    <>
      <div className="tmc-metrics">
        <MiniMetric label={t('أعضاء نشطين', 'active members')} value={number(members.length)} hint={t('عضويات معتمدة', 'approved memberships')} />
        <MiniMetric
          label={t('مهام مفتوحة', 'open tasks')}
          value={number(summary.stateCounts.open + summary.stateCounts.revision)}
          hint={summary.overdue > 0 ? `${number(summary.overdue)} ${t('متأخرة', 'overdue')}` : t('مفيش متأخر', 'nothing overdue')}
        />
        <MiniMetric
          label={t('تقييمات 30 يوم', 'evaluations · 30d')}
          value={number(summary.recentEvaluations.length)}
          hint={`${number(evaluations.length)} ${t('إجمالي', 'total')}`}
        />
        <MiniMetric
          label={t('بونص الفريق', 'team bonus')}
          value={`${summary.teamBonus >= 0 ? '+' : ''}${number(summary.teamBonus)}`}
          hint={`${t('الإجمالي الأساسي', 'main total')} ${summary.mainBonus >= 0 ? '+' : ''}${number(summary.mainBonus)}`}
        />
      </div>

      <div className="tmc-chart-grid">
        <PanelShell
          id="tmc-overview-bonus"
          kicker={<><Sparkles size={14} aria-hidden="true" />{t('البونص', 'Bonus')}</>}
          title={t('بونص الأعضاء', 'Member bonus')}
          hint={t('العمود هو الإجمالي الأساسي، والرقم الصغير هو نصيب الفريق من التقييمات.', 'The bar is the main total; the small value is the team-evaluation share.')}
        >
          <BarsChart
            data={bonusBars}
            format={(value) => `${value >= 0 ? '+' : ''}${number(value)}`}
            emptyLabel={t('لسه مفيش بونص مسجل لأعضاء الفريق.', 'No bonus recorded for this team yet.')}
            ariaLabel={t('بونص كل عضو', 'Bonus per member')}
          />
        </PanelShell>

        <PanelShell
          id="tmc-overview-tasks"
          kicker={<><ClipboardList size={14} aria-hidden="true" />{t('المهام', 'Tasks')}</>}
          title={t('حالة المهام', 'Task states')}
          hint={t('كل مهمة بتتحسب حسب حالة تسليمات أعضاء الفريق.', 'Each task counts by its team submissions state.')}
        >
          <div className="tmc-donut-wrap">
            <DonutChart
              segments={donutSegments}
              centerValue={number(tasks.length)}
              centerLabel={t('مهمة', 'tasks')}
            />
            <ul className="tmc-legend">
              {donutSegments.map((segment) => (
                <li key={segment.id}>
                  <span className={`tmc-legend-dot is-${segment.tone}`} aria-hidden="true" />
                  <span>{segment.label}</span>
                  <b dir="ltr">{number(segment.value)}</b>
                </li>
              ))}
            </ul>
          </div>
        </PanelShell>

        <PanelShell
          id="tmc-overview-trend"
          kicker={<><Activity size={14} aria-hidden="true" />{t('النشاط', 'Activity')}</>}
          title={t('نشاط آخر 14 يوم', 'Last 14 days')}
          hint={t('مهام وتقييمات اتسجلت فعليًا كل يوم.', 'Tasks and evaluations actually recorded per day.')}
        >
          <TrendChart points={trend} ariaLabel={t('لسه مفيش نشاط في الفترة دي.', 'No activity in this window yet.')} />
          <div className="tmc-trend-axis" aria-hidden="true">
            <span>{trend[0]?.label}</span>
            <span>{trend[Math.floor(trend.length / 2)]?.label}</span>
            <span>{trend[trend.length - 1]?.label}</span>
          </div>
        </PanelShell>

        <PanelShell
          id="tmc-overview-plan"
          kicker={<><Target size={14} aria-hidden="true" />{t('خطة الأداء', 'Performance plan')}</>}
          title={t('إنجاز الخطة', 'Plan progress')}
          hint={t('متوسط إنجاز أهداف الفريق الحقيقية.', 'Average progress across the team’s real goals.')}
          actions={(
            <button type="button" className="tmc-link" onClick={() => onNavigate('plan')}>
              {t('الخطة', 'Plan')}<ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        >
          {goals.length === 0
            ? <p className="tmc-chart-empty">{t('لسه مفيش أهداف. ابدأ خطة أداء الفريق من تاب الخطة.', 'No goals yet. Start the team plan from the Plan tab.')}</p>
            : (
              <>
                <div className="tmc-rings">
                  {goals.slice(0, 3).map((goal) => (
                    <ProgressRing
                      key={goal.id}
                      value={goal.current_value}
                      max={goal.target_value}
                      label={goal.title}
                      sublabel={goal.metric || t('هدف', 'goal')}
                      tone={goal.status === 'done' ? 'primary' : goal.status === 'paused' ? 'muted' : 'accent'}
                    />
                  ))}
                </div>
                <p className="tmc-panel-foot">
                  {t('متوسط الإنجاز', 'Average progress')} <b dir="ltr">{Math.round(summary.planRatio * 100)}%</b>
                </p>
              </>
            )}
        </PanelShell>
      </div>

      <div className="tmc-chart-grid">
        <PanelShell
          id="tmc-overview-recent"
          kicker={<><Gauge size={14} aria-hidden="true" />{t('آخر الحركة', 'Latest')}</>}
          title={t('آخر نشاط على الفريق', 'Recent team activity')}
          actions={(
            <button type="button" className="tmc-link" onClick={() => onNavigate('timeline')}>
              {t('المخطط الزمني', 'Timeline')}<ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        >
          {recentEvents.length === 0
            ? <p className="tmc-chart-empty">{t('مفيش نشاط مسجل لحد الآن.', 'Nothing recorded yet.')}</p>
            : (
              <ul className="tmc-feed">
                {recentEvents.map((event) => (
                  <li key={event.id}>
                    <span className={`tmc-feed-dot is-${event.kind === 'task' ? 'accent' : 'primary'}`} aria-hidden="true" />
                    <div>
                      <strong>{event.label}</strong>
                      <small>
                        {event.kind === 'task' ? t('مهمة جديدة', 'New task') : t('تقييم', 'Evaluation')}
                        {' · '}
                        {date(event.at)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </PanelShell>

        <PanelShell
          id="tmc-overview-members"
          kicker={<><UsersRound size={14} aria-hidden="true" />{t('الأعضاء', 'Members')}</>}
          title={t('أقوى الأعضاء في التقييم', 'Top evaluated members')}
          actions={(
            <button type="button" className="tmc-link" onClick={() => onNavigate('members')}>
              {t('كل الأعضاء', 'All members')}<ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        >
          {members.length === 0
            ? <p className="tmc-chart-empty">{t('مفيش عضويات نشطة في الفريق.', 'No active memberships in this team.')}</p>
            : (
              <ul className="tmc-rank-list">
                {members.slice().sort((a, b) => b.evaluation_count - a.evaluation_count).slice(0, 5).map((member) => (
                  <li key={member.member_id}>
                    <strong>{member.full_name}</strong>
                    <span className="tmc-rank-meta">
                      <StateChip tone="accent">{number(member.evaluation_count)} {t('تقييم', 'evals')}</StateChip>
                      <b dir="ltr">{member.main_bonus >= 0 ? '+' : ''}{number(member.main_bonus)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          {evaluations.length > 0 && (
            <p className="tmc-panel-foot">
              {t('آخر تقدير', 'Latest grade')}: <b>{GRADE_COPY[evaluations[0].grade][locale === 'ar' ? 'ar' : 'en']}</b>
              {' · '}
              <StateChip tone={evaluations[0].points >= 0 ? 'primary' : 'warning'}>
                {evaluations[0].points >= 0 ? '+' : ''}{number(evaluations[0].points)}
              </StateChip>
            </p>
          )}
        </PanelShell>
      </div>
      <p className="tmc-footnote">
        <StateChip tone="accent">{TASK_STATE_COPY.review[locale === 'ar' ? 'ar' : 'en']}</StateChip>
        {t(' تقييمات الفريق بتتسجل في الإجمالي الأساسي للعضو، وأي بونص أساسي بيظهر هنا في نفس الوقت.', ' Team evaluations land in the member’s main total, and any main bonus shows here at the same time.')}
      </p>
    </>
  );
}
