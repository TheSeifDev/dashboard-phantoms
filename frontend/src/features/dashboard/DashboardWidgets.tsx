import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowUpLeft,
  BarChart3,
  CalendarClock,
  Clock3,
  History,
  Laptop,
  PieChart as PieChartIcon,
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
import { useLocale } from '../../i18n/useLocale';
import { useReducedMotion } from '../../components/motion/useReducedMotion';

interface DashboardWidgetPermissions {
  tasks: boolean;
  members: boolean;
  ranking: boolean;
}

interface DashboardWidgetsProps {
  metrics: DashboardMetrics;
  tasks: Task[];
  contributions: TaskContributions;
  permissions: DashboardWidgetPermissions;
}

const chartTooltipStyle = {
  border: '1px solid var(--border)',
  borderRadius: '10px',
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-md)',
};

function Panel({
  title,
  subtitle,
  icon,
  action,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`dashboard-panel dashboard-reveal ${className}`}>
      <header className="dashboard-panel-header">
        <div className="dashboard-panel-heading">
          <span className="dashboard-panel-icon" aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <h2 className="dashboard-panel-title">{title}</h2>
            {subtitle && <p className="dashboard-panel-subtitle">{subtitle}</p>}
          </div>
        </div>
        {action && (
          <button type="button" onClick={action.onClick} className="dashboard-panel-action">
            <span>{action.label}</span><ArrowUpLeft size={15} aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="dashboard-empty"><span aria-hidden="true">{icon}</span><span>{text}</span></div>;
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

export function DashboardWidgets({ metrics, tasks, contributions, permissions }: DashboardWidgetsProps) {
  const navigate = useNavigate();
  const { locale, t, number, date } = useLocale();
  const reducedMotion = useReducedMotion();
  const monthlyApprovals = useMemo(
    () => buildMonthlyApprovalTrend(contributions.year, contributions.days, contributions.today, contributionCoverageDate(contributions.history_complete_since)).map((item) => ({
      ...item,
      label: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(contributions.year, item.month, 1, 12))),
    })),
    [contributions.year, contributions.days, contributions.today, contributions.history_complete_since, locale],
  );
  const totalMonthlyApprovals = monthlyApprovals.reduce((sum, item) => sum + (item.approvals ?? 0), 0);
  const taskSlices = [
    { key: 'approved', value: metrics.approvedTasks, color: 'var(--success)' },
    { key: 'inProgress', value: metrics.inProgress, color: 'var(--info)' },
    { key: 'underReview', value: metrics.underReview, color: 'var(--warning)' },
    { key: 'overdue', value: metrics.overdue, color: 'var(--danger)' },
    { key: 'notStarted', value: metrics.notStarted, color: 'var(--text-muted)' },
  ];
  const nonEmptySlices = taskSlices.filter((slice) => slice.value > 0);
  const totalAssignments = taskSlices.reduce((sum, slice) => sum + slice.value, 0);
  const activity = metrics.recentActivity.slice(0, 6);
  const deviceData = [
    { name: t('لابتوب', 'Laptop'), count: metrics.laptopCount, fill: 'var(--chart-blue)' },
    { name: t('كمبيوتر', 'Desktop'), count: metrics.pcCount, fill: 'var(--success)' },
    {
      name: t('جهاز لوحي/هاتف', 'Tablet / phone'),
      count: Math.max(0, metrics.totalMembers - metrics.laptopCount - metrics.pcCount),
      fill: 'var(--chart-slate)',
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
    <div data-testid="dashboard-widgets" className="dashboard-widget-stack">
      <div className="dashboard-chart-row">
        <Panel
          title={t('اتجاه الاعتمادات', 'Approval trend')}
          subtitle={t('حسب الشهر · الفراغات تاريخ غير مكتمل، وليست صفر نشاط', 'By month · gaps mean incomplete history, not zero activity')}
          icon={<BarChart3 size={18} />}
        >
          {totalMonthlyApprovals > 0 ? (
            <div className="dashboard-chart dashboard-trend-chart" dir="ltr" aria-label={t('اعتمادات كل شهر', 'Approvals per month')}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyApprovals} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="approvalTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.26} />
                      <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} dy={8} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: 'var(--text)' }}
                    formatter={(value) => [number(Number(value)), t('اعتماد', 'approvals')]}
                  />
                  <Area isAnimationActive={!reducedMotion} type="monotone" dataKey="approvals" stroke="var(--chart-blue)" strokeWidth={2.5} fill="url(#approvalTrendFill)" activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon={<BarChart3 size={24} />} text={t('لا توجد اعتمادات مرصودة لهذا النطاق. التاريخ قبل بدء السجل قد يكون غير مكتمل.', 'No approvals observed for this scope. History before tracking began may be incomplete.')} />
          )}
        </Panel>

        <Panel
          title={t('حالة التكليفات', 'Task status')}
          subtitle={t(`الحالة الحالية عبر ${number(tasks.length)} تكليفات محمّلة`, `${number(tasks.length)} task records · current states`)}
          icon={<PieChartIcon size={18} />}
          action={permissions.tasks ? { label: t('إدارة المهام', 'Manage tasks'), onClick: () => navigate('/admin/tasks') } : undefined}
        >
          {nonEmptySlices.length > 0 ? (
            <>
              <div className="dashboard-status-ring" aria-label={t('توزيع حالات التكليفات الحالية', 'Distribution of current task assignment statuses')}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={!reducedMotion} data={nonEmptySlices} dataKey="value" nameKey="key" innerRadius={66} outerRadius={91} paddingAngle={3} stroke="none">
                      {nonEmptySlices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value, name) => [number(Number(value)), statusTitle(String(name), t)]}
                    />
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
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty icon={<PieChartIcon size={24} />} text={t('لا توجد تكليفات مسندة حتى الآن.', 'There are no assigned tasks yet.')} />
          )}
        </Panel>
      </div>

      <div className="dashboard-support-grid">
        <Panel
          title={t('ترتيب النقاط', 'Team points')}
          subtitle={t('المحفوظ في ملاحظات الإدارة', 'Based on recorded admin notes')}
          icon={<Trophy size={18} />}
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
          title={t('الأجهزة المتاحة', 'Team devices')}
          subtitle={t('توزيع مبني على حقول ملفات الأعضاء', 'Distribution from existing member profile fields')}
          icon={<Laptop size={18} />}
          action={permissions.members ? { label: t('عرض الأعضاء', 'View members'), onClick: () => navigate('/admin/members') } : undefined}
        >
          {metrics.totalMembers > 0 ? (
            <div className="dashboard-chart dashboard-device-chart" dir="ltr" aria-label={t('أنواع الأجهزة المسجلة للأعضاء', 'Devices recorded for team members')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deviceData} margin={{ top: 12, right: 8, left: -23, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} dy={8} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [number(Number(value)), t('أعضاء', 'members')]} />
                  <Bar isAnimationActive={!reducedMotion} dataKey="count" radius={[5, 5, 0, 0]} barSize={36}>
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
          title={t('المهام المتأخرة', 'Late assignments')}
          subtitle={t('وفق مواعيد التسليم والحالة الحالية', 'Based on deadlines and current task state')}
          icon={<CalendarClock size={18} />}
          action={permissions.tasks ? { label: t('عرض المهام', 'View tasks'), onClick: () => navigate('/admin/tasks') } : undefined}
        >
          {metrics.lateMembers.length > 0 ? (
            <ul className="dashboard-late-list">
              {metrics.lateMembers.slice(0, 6).map((item, index) => (
                <li key={`${item.member.id}-${index}`}>
                  <span className="dashboard-late-person">{item.member.full_name}</span>
                  <span className="dashboard-late-task">{item.taskTitle}</span>
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
          title={t('أحدث نشاط', 'Recent activity')}
          subtitle={t('إنشاء مهام وأعضاء وملاحظات', 'Task, member, and note records')}
          icon={<History size={18} />}
        >
          {activity.length > 0 ? (
            <ol className="dashboard-activity-list">
              {activity.map((item) => (
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
          title={t('النقاط عبر الوقت', 'Points over time')}
          subtitle={t('من الملاحظات المسجلة فقط', 'From recorded admin notes only')}
          icon={<TrendingDown size={18} />}
        >
          {hasBonusTimeline ? (
            <div className="dashboard-chart dashboard-bonus-chart" dir="ltr" aria-label={t('صافي النقاط المضافة أو المخصومة بمرور الوقت', 'Net points added or deducted over time')}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.timelineData} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
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
                  <Area isAnimationActive={!reducedMotion} type="monotone" dataKey="bonus" stroke="var(--chart-cyan)" strokeWidth={2} fill="var(--chart-cyan)" fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon={<TrendingDown size={24} />} text={t('سيظهر الاتجاه بعد تسجيل نقاط فعلية.', 'The trend will appear after points are recorded.')} />
          )}
        </Panel>
      </div>
    </div>
  );
}
