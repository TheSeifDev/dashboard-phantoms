import { useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowUpLeft,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Clock3,
  Crown,
  History,
  Laptop,
  PieChart as PieChartIcon,
  Radar,
  Trophy,
  TrendingDown,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Task } from '../../types/db';
import type { DashboardMetrics } from './metrics';
import type { TaskContributions } from './taskContributions';
import { buildMonthlyApprovalTrend, contributionCoverageDate } from './taskContributions';
import type { TeamActivity } from './teamActivity';
import type { PersonInfo } from './TaskStreakHeatmap';
import { useLocale } from '../../i18n/useLocale';
import { useReducedMotion } from '../../components/motion/useReducedMotion';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import { GithubMark } from './GithubMark';
import { PersonAvatar } from './PersonAvatar';

interface DashboardWidgetPermissions {
  tasks: boolean;
  members: boolean;
  ranking: boolean;
}

interface DashboardWidgetsProps {
  metrics: DashboardMetrics;
  tasks: Task[];
  contributions: TaskContributions;
  activity: TeamActivity;
  people: ReadonlyMap<number, PersonInfo>;
  permissions: DashboardWidgetPermissions;
  onOpenDay: (date: string) => void;
  /** Phones: fewer animated nodes and no chart/hex entrance animations. */
  compact?: boolean;
}

const chartTooltipStyle = {
  border: '1px solid var(--glass-border)',
  borderRadius: '14px',
  background: 'var(--glass-bg-strong)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-lg)',
  backdropFilter: 'blur(16px)',
  padding: '8px 12px',
};

export function Panel({
  title,
  subtitle,
  icon,
  action,
  className = '',
  tone = 'accent',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
  tone?: 'accent' | 'blue' | 'cyan' | 'amber' | 'red' | 'violet';
  children: ReactNode;
}) {
  const { dir } = useLocale();
  const Arrow = dir === 'rtl' ? ArrowUpLeft : ArrowUpRight;
  return (
    <section className={`dashboard-panel glass-card ${className}`} data-reveal>
      <header className="dashboard-panel-header">
        <div className="dashboard-panel-heading">
          <span className="dashboard-panel-icon" data-tone={tone} aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <h2 className="dashboard-panel-title">{title}</h2>
            {subtitle && <p className="dashboard-panel-subtitle">{subtitle}</p>}
          </div>
        </div>
        {action && (
          <button type="button" onClick={action.onClick} className="dashboard-panel-action" data-magnetic="0.2">
            <span>{action.label}</span><Arrow size={15} aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

export function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="dashboard-empty"><span className="dashboard-empty-orb" aria-hidden="true">{icon}</span><span>{text}</span></div>;
}

function statusTitle(key: string, t: (arabic: string, english: string) => string): string {
  const labels: Record<string, [string, string]> = {
    approved: ['معتمدة حاليًا', 'Approved now'],
    inProgress: ['قيد التنفيذ', 'In progress'],
    underReview: ['تحت المراجعة', 'Under review'],
    overdue: ['متأخرة', 'Overdue'],
    notStarted: ['لم تبدأ', 'Not started'],
  };
  const label = labels[key];
  return label ? t(label[0], label[1]) : key;
}

/** Honeycomb of the most active people this year; the centre cell is the top contributor. */
export function CrewPulse({ activity, people, onOpenDay, compact }: { activity: TeamActivity; people: ReadonlyMap<number, PersonInfo>; onOpenDay: (date: string) => void; compact: boolean }) {
  const { t, number, date } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const ranked = activity.members.filter((member) => member.score > 0).slice(0, compact ? 4 : 7);
  const maxScore = Math.max(1, ...ranked.map((member) => member.score));
  const peak = activity.totals.peak;
  useEffect(() => {
    const element = root.current;
    if (!element || compact || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      gsap.fromTo('.crew-hex', { scale: 0, rotate: -30, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: 'back.out(1.8)', stagger: { each: 0.08, from: 'center' }, clearProps: 'transform,opacity' });
      gsap.to('.crew-hex[data-rank="0"] .crew-hex-ring', { scale: 1.12, opacity: 0.25, duration: 1.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.fromTo('.crew-bar-fill', { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'power3.out', stagger: 0.08, delay: 0.3 });
    }, element);
    return () => context.revert();
  }, [ranked.length, activity.year, compact]);
  if (!ranked.length) {
    return <Empty icon={<Radar size={24} />} text={t('النبض هيظهر أول ما الفريق يسلّم مهام أو يربط حسابات GitHub.', 'The pulse appears once the team delivers tasks or links GitHub accounts.')} />;
  }
  return (
    <div ref={root} className="crew-pulse">
      <div className="crew-cluster" aria-hidden="true">
        {ranked.map((member, index) => {
          const person = people.get(member.memberId);
          return (
            <span key={member.memberId} className="crew-hex" data-rank={index} style={{ ['--heat' as string]: String(member.score / maxScore) }}>
              <span className="crew-hex-ring" />
              <span className="crew-hex-face">
                <PersonAvatar id={member.memberId} name={person?.name ?? member.name} handle={person?.handle ?? member.handle} size={index === 0 ? 58 : 44} />
              </span>
              {index === 0 && <Crown size={14} className="crew-crown" />}
            </span>
          );
        })}
      </div>
      <ol className="crew-list">
        {ranked.slice(0, 5).map((member, index) => (
          <li key={member.memberId}>
            <span className="crew-rank">{number(index + 1)}</span>
            <span className="crew-copy">
              <span className="dashboard-person-name">{people.get(member.memberId)?.name ?? member.name}</span>
              <span className="crew-bar" aria-hidden="true"><span className="crew-bar-fill" style={{ width: `${Math.max(6, (member.score / maxScore) * 100)}%` }} /></span>
            </span>
            <span className="crew-stats">
              {member.approved + member.submitted > 0 && <span data-kind="task" title={t('تسليمات', 'Deliveries')}>{number(member.approved + member.submitted)}</span>}
              {member.github > 0 && <span data-kind="github"><GithubMark size={12} />{number(member.github)}</span>}
            </span>
          </li>
        ))}
      </ol>
      {peak && (
        <button type="button" className="crew-peak" onClick={() => onOpenDay(peak.date)}>
          <span className="crew-peak-hex" data-crew={peak.crew} aria-hidden="true" />
          <span>
            <small>{t('أنشط يوم في السنة', 'Busiest day this year')}</small>
            <strong>{date(new Date(`${peak.date}T12:00:00Z`), { day: 'numeric', month: 'long' })} · {t(`${number(peak.total)} مساهمة`, `${number(peak.total)} contributions`)}</strong>
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Monthly approvals (+ GitHub when linked) for a year. Shared by the admin
 * dashboard and the member portal so both render the exact same panel.
 */
export function ContributionTrendPanel({
  contributions,
  activity,
  compact = false,
}: {
  contributions: TaskContributions;
  activity: TeamActivity;
  compact?: boolean;
}) {
  const { t, number, locale } = useLocale();
  const reducedMotion = useReducedMotion();
  const monthlyApprovals = useMemo(
    () => buildMonthlyApprovalTrend(contributions.year, contributions.days, contributions.today, contributionCoverageDate(contributions.history_complete_since)).map((item) => {
      let github = 0;
      for (const [day, entry] of activity.byDate) {
        if (Number(day.slice(5, 7)) - 1 === item.month) github += entry.github;
      }
      return {
        ...item,
        github,
        label: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' })
          .format(new Date(Date.UTC(contributions.year, item.month, 1, 12))),
      };
    }),
    [contributions.year, contributions.days, contributions.today, contributions.history_complete_since, activity.byDate, locale],
  );
  const total = monthlyApprovals.reduce((sum, item) => sum + (item.approvals ?? 0) + item.github, 0);
  const hasGithubTrend = monthlyApprovals.some((item) => item.github > 0);
  return (
    <Panel
      className="bento-trend"
      title={t('اتجاه المساهمات', 'Contribution trend')}
      subtitle={t('اعتمادات المهام وGitHub شهريًا · الفراغات تاريخ غير مكتمل', 'Monthly task approvals and GitHub · gaps mean incomplete history')}
      icon={<BarChart3 size={18} />}
      tone="blue"
    >
      {total > 0 ? (
        <div className="dashboard-chart dashboard-trend-chart" dir="ltr" aria-label={t('المساهمات كل شهر', 'Contributions per month')}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyApprovals} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="approvalTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--crew-1)" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="var(--crew-1)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="githubTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--crew-3)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--crew-3)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--glass-hairline)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} dy={8} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: 'var(--text)', fontWeight: 700 }}
                formatter={(value, name) => [number(Number(value)), name === 'github' ? 'GitHub' : t('اعتماد', 'approvals')]}
              />
              <Area isAnimationActive={!reducedMotion && !compact} animationDuration={1400} type="monotone" dataKey="approvals" stroke="var(--crew-1)" strokeWidth={2.5} fill="url(#approvalTrendFill)" activeDot={{ r: 5, strokeWidth: 0 }} />
              {hasGithubTrend && <Area isAnimationActive={!reducedMotion && !compact} animationDuration={1600} type="monotone" dataKey="github" stroke="var(--crew-3)" strokeWidth={2} fill="url(#githubTrendFill)" activeDot={{ r: 4, strokeWidth: 0 }} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty icon={<BarChart3 size={24} />} text={t('لا توجد اعتمادات مرصودة لهذا النطاق. التاريخ قبل بدء السجل قد يكون غير مكتمل.', 'No approvals observed for this scope. History before tracking began may be incomplete.')} />
      )}
    </Panel>
  );
}

export function DashboardWidgets({ metrics, tasks, contributions, activity, people, permissions, onOpenDay, compact = false }: DashboardWidgetsProps) {
  const navigate = useNavigate();
  const { t, number, date } = useLocale();
  const reducedMotion = useReducedMotion();
  const taskSlices = [
    { key: 'approved', value: metrics.approvedTasks, color: 'var(--success)' },
    { key: 'inProgress', value: metrics.inProgress, color: 'var(--chart-blue)' },
    { key: 'underReview', value: metrics.underReview, color: 'var(--warning)' },
    { key: 'overdue', value: metrics.overdue, color: 'var(--danger)' },
    { key: 'notStarted', value: metrics.notStarted, color: 'var(--chart-slate)' },
  ];
  const nonEmptySlices = taskSlices.filter((slice) => slice.value > 0);
  const totalAssignments = taskSlices.reduce((sum, slice) => sum + slice.value, 0);
  const activity6 = metrics.recentActivity.slice(0, 6);
  const deviceData = [
    { name: t('لابتوب', 'Laptop'), count: metrics.laptopCount, fill: 'var(--crew-1)' },
    { name: t('كمبيوتر', 'Desktop'), count: metrics.pcCount, fill: 'var(--crew-2)' },
    {
      name: t('جهاز لوحي/هاتف', 'Tablet / phone'),
      count: Math.max(0, metrics.totalMembers - metrics.laptopCount - metrics.pcCount),
      fill: 'var(--crew-3)',
    },
  ];
  const hasBonusTimeline = metrics.timelineData.some((point) => Number(point.bonus) !== 0);
  const eventTitle = (item: DashboardMetrics['recentActivity'][number]) => {
    if (item.type === 'note') {
      return t(`${item.actor || 'الإدارة'} أضاف ملاحظة لـ ${item.subject || 'عضو'}`, `${item.actor || 'Admin'} added a note for ${item.subject || 'a member'}`);
    }
    if (item.type === 'task') return t(`تم إنشاء تكليف: ${item.subject}`, `Task created: ${item.subject}`);
    return t(`انضم عضو: ${item.subject}`, `Member joined: ${item.subject}`);
  };

  return (
    <div data-testid="dashboard-widgets" className="dashboard-bento">
      <Panel
        className="bento-pulse"
        title={t('نبض الفريق', 'Team pulse')}
        subtitle={t('الأكثر نشاطًا هذا العام: تسليمات + GitHub', 'Most active this year: deliveries + GitHub')}
        icon={<Radar size={18} />}
        tone="violet"
      >
        <CrewPulse activity={activity} people={people} onOpenDay={onOpenDay} compact={compact} />
      </Panel>

      <ContributionTrendPanel contributions={contributions} activity={activity} compact={compact} />

      <Panel
        className="bento-status"
        title={t('حالة التكليفات', 'Task status')}
        subtitle={t(`الحالة الحالية عبر ${number(tasks.length)} تكليفات محمّلة`, `${number(tasks.length)} task records · current states`)}
        icon={<PieChartIcon size={18} />}
        tone="violet"
        action={permissions.tasks ? { label: t('إدارة المهام', 'Manage tasks'), onClick: () => navigate('/admin/tasks') } : undefined}
      >
        {nonEmptySlices.length > 0 ? (
          <div className="dashboard-status-layout">
            <div className="dashboard-status-ring" aria-label={t('توزيع حالات التكليفات الحالية', 'Distribution of current task assignment statuses')}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie isAnimationActive={!reducedMotion && !compact} animationDuration={1200} data={nonEmptySlices} dataKey="value" nameKey="key" innerRadius="72%" outerRadius="96%" paddingAngle={4} cornerRadius={8} stroke="none">
                    {nonEmptySlices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(value, name) => [number(Number(value)), statusTitle(String(name), t)]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="dashboard-ring-center" aria-hidden="true">
                <strong>{number(totalAssignments)}</strong>
                <span>{t('تسليم', 'submissions')}</span>
              </div>
            </div>
            <ul className="dashboard-status-legend">
              {nonEmptySlices.map((slice) => (
                <li key={slice.key}>
                  <span className="dashboard-legend-dot" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                  <span>{statusTitle(slice.key, t)}</span>
                  <strong>{number(slice.value)}</strong>
                  <span className="dashboard-legend-bar" aria-hidden="true"><span style={{ width: `${Math.round((slice.value / Math.max(1, totalAssignments)) * 100)}%`, backgroundColor: slice.color }} /></span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Empty icon={<PieChartIcon size={24} />} text={t('لا توجد تكليفات مسندة حتى الآن.', 'There are no assigned tasks yet.')} />
        )}
      </Panel>

      <Panel
        className="bento-devices"
        title={t('الأجهزة المتاحة', 'Team devices')}
        subtitle={t('توزيع مبني على حقول ملفات الأعضاء', 'Distribution from existing member profile fields')}
        icon={<Laptop size={18} />}
        tone="cyan"
        action={permissions.members ? { label: t('عرض الأعضاء', 'View members'), onClick: () => navigate('/admin/members') } : undefined}
      >
        {metrics.totalMembers > 0 ? (
          <div className="dashboard-chart dashboard-device-chart" dir="ltr" aria-label={t('أنواع الأجهزة المسجلة للأعضاء', 'Devices recorded for team members')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deviceData} margin={{ top: 12, right: 8, left: -23, bottom: 0 }}>
                <CartesianGrid stroke="var(--glass-hairline)" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} dy={8} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip cursor={{ fill: 'var(--glass-bg-soft)' }} contentStyle={chartTooltipStyle} formatter={(value) => [number(Number(value)), t('أعضاء', 'members')]} />
                <Bar isAnimationActive={!reducedMotion && !compact} animationDuration={1100} dataKey="count" radius={[10, 10, 4, 4]} barSize={34}>
                  {deviceData.map((item) => <Cell key={item.name} fill={item.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty icon={<Laptop size={24} />} text={t('لا توجد بيانات أعضاء لعرضها.', 'There are no member records to display.')} />
        )}
      </Panel>

      <Panel
        className="bento-points"
        title={t('ترتيب النقاط', 'Team points')}
        subtitle={t('المحفوظ في ملاحظات الإدارة', 'Based on recorded admin notes')}
        icon={<Trophy size={18} />}
        tone="amber"
        action={permissions.ranking ? { label: t('عرض الترتيب', 'View ranking'), onClick: () => navigate('/admin/ranking') } : undefined}
      >
        {(metrics.topMembers.length || metrics.lowestMembers.length) ? (
          <div className="dashboard-leaderboard-grid">
            <div>
              <h3 className="dashboard-list-kicker">{t('الأعلى نقاطًا', 'Highest scores')}</h3>
              {metrics.topMembers.length ? (
                <ol className="dashboard-person-list">
                  {metrics.topMembers.map((member, index) => (
                    <li key={member.id}>
                      <span className={`dashboard-rank-number dashboard-rank-${index + 1}`}>{number(index + 1)}</span>
                      <PersonAvatar id={member.id} name={member.full_name} handle={people.get(member.id)?.handle} size={30} />
                      <span className="dashboard-person-name">{member.full_name}</span>
                      <strong>{member.bonus_infinite ? '∞' : number(member.totalBonus)}</strong>
                    </li>
                  ))}
                </ol>
              ) : <p className="dashboard-small-empty">{t('لا توجد نقاط موجبة مسجلة.', 'No positive score records.')}</p>}
            </div>
            <div>
              <h3 className="dashboard-list-kicker">{t('بحاجة إلى متابعة', 'Needs follow-up')}</h3>
              {metrics.lowestMembers.length ? (
                <ul className="dashboard-person-list dashboard-risk-list">
                  {metrics.lowestMembers.map((member) => (
                    <li key={member.id}>
                      <PersonAvatar id={member.id} name={member.full_name} handle={people.get(member.id)?.handle} size={30} />
                      <span className="dashboard-person-name">{member.full_name}</span>
                      <strong>{number(member.totalBonus)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="dashboard-small-empty">{t('لا توجد نقاط سالبة مسجلة.', 'No negative score records.')}</p>}
            </div>
          </div>
        ) : (
          <Empty icon={<Trophy size={24} />} text={t('لا توجد نقاط مسجلة حتى الآن.', 'No points have been recorded yet.')} />
        )}
      </Panel>

      <Panel
        className="bento-late"
        title={t('المهام المتأخرة', 'Late assignments')}
        subtitle={t('وفق مواعيد التسليم والحالة الحالية', 'Based on deadlines and current task state')}
        icon={<CalendarClock size={18} />}
        tone="red"
        action={permissions.tasks ? { label: t('عرض المهام', 'View tasks'), onClick: () => navigate('/admin/tasks') } : undefined}
      >
        {metrics.lateMembers.length > 0 ? (
          <ul className="dashboard-late-list">
            {metrics.lateMembers.slice(0, 6).map((item, index) => (
              <li key={`${item.member.id}-${index}`}>
                <PersonAvatar id={item.member.id} name={item.member.full_name} handle={people.get(item.member.id)?.handle} size={30} />
                <span className="dashboard-late-copy">
                  <span className="dashboard-late-person">{item.member.full_name}</span>
                  <span className="dashboard-late-task">{item.taskTitle}</span>
                </span>
                <span className="dashboard-late-badge">{t('متأخرة', 'Overdue')}</span>
              </li>
            ))}
            {metrics.lateMembers.length > 6 && <li className="dashboard-overflow-note">{t(`و ${number(metrics.lateMembers.length - 6)} آخرين`, `and ${number(metrics.lateMembers.length - 6)} more`)}</li>}
          </ul>
        ) : (
          <Empty icon={<Clock3 size={24} />} text={t('لا توجد مهام متأخرة حاليًا.', 'No late assignments right now.')} />
        )}
      </Panel>

      <Panel
        className="bento-activity"
        title={t('أحدث نشاط', 'Recent activity')}
        subtitle={t('إنشاء مهام وأعضاء وملاحظات', 'Task, member, and note records')}
        icon={<History size={18} />}
        tone="blue"
      >
        {activity6.length > 0 ? (
          <ol className="dashboard-activity-list">
            {activity6.map((item) => (
              <li key={item.id}>
                <span className={`dashboard-activity-icon dashboard-activity-${item.type}`} aria-hidden="true">
                  {item.type === 'note' ? <Activity size={15} /> : item.type === 'task' ? <Clock3 size={15} /> : <Users size={15} />}
                </span>
                <div className="dashboard-activity-copy">
                  <p>{eventTitle(item)}</p>
                  <time dateTime={item.date.toISOString()}>{date(item.date, { year: 'numeric', month: 'short', day: 'numeric' })}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon={<History size={24} />} text={t('لا توجد سجلات نشاط صالحة للعرض.', 'No valid activity records to display.')} />
        )}
      </Panel>

      <Panel
        className="bento-bonus"
        title={t('النقاط عبر الوقت', 'Points over time')}
        subtitle={t('من الملاحظات المسجلة فقط', 'From recorded admin notes only')}
        icon={<TrendingDown size={18} />}
        tone="cyan"
      >
        {hasBonusTimeline ? (
          <div className="dashboard-chart dashboard-bonus-chart" dir="ltr" aria-label={t('صافي النقاط المضافة أو المخصومة بمرور الوقت', 'Net points added or deducted over time')}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.timelineData} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="bonusTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-cyan)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--chart-cyan)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--glass-hairline)" strokeDasharray="3 6" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
                    ? date(new Date(`${value}T12:00:00Z`), { month: 'short', day: 'numeric' })
                    : String(value)}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  dy={8}
                />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [number(Number(value)), t('نقاط', 'points')]} />
                <Area isAnimationActive={!reducedMotion && !compact} animationDuration={1300} type="monotone" dataKey="bonus" stroke="var(--chart-cyan)" strokeWidth={2.4} fill="url(#bonusTrendFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty icon={<TrendingDown size={24} />} text={t('سيظهر الاتجاه بعد تسجيل نقاط فعلية.', 'The trend will appear after points are recorded.')} />
        )}
      </Panel>
    </div>
  );
}
