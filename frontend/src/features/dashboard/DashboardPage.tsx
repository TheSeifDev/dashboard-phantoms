import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpLeft, ArrowUpRight, Bot, CalendarClock, ClipboardList, Clock3, UserRoundPlus } from 'lucide-react';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { PhantomsSymbol } from '../../components/brand/PhantomsLogo';
import { useReveal } from '../../components/motion/AnimatedNumber';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { useNotes } from '../notes/api';
import { useAdminAccess } from '../admin/access/api';
import { useAuthStore } from '../../store/auth';
import type { AdminPermission } from '../../types/db';
import { useLocale } from '../../i18n/useLocale';
import { useCompactViewport } from '../../hooks/useMediaQuery';
import { DashboardMetricsGrid, type MetricSeries } from './DashboardMetrics';
import { DashboardWidgets } from './DashboardWidgets';
import { TaskStreakHeatmap, type PersonInfo } from './TaskStreakHeatmap';
import { DayHistoryDrawer } from './DayHistoryDrawer';
import { HeroHexCluster } from './HeroHexCluster';
import { GithubMark } from './GithubMark';
import { getDashboardMetrics } from './metrics';
import { resolveDashboardQueryState } from './dashboardqueryState';
import { contributionCoverageDate, getCairoDate } from './taskContributions';
import { useTaskContributions } from './useTaskContributions';
import { buildTeamActivity, bucketSeries, cairoDayOf, cumulativeSeries, recordsOnDay } from './teamActivity';
import { useGithubLinks, useGithubTeamCalendars } from './useGithubTeam';
import { readGithubSyncPreference, writeGithubSyncPreference } from './github';
import './dashboard.css';

function QuickAction({ label, icon, onClick, tone = 'neutral' }: { label: string; icon: ReactNode; onClick: () => void; tone?: 'primary' | 'neutral' }) {
  const { dir } = useLocale();
  const Arrow = dir === 'rtl' ? ArrowUpLeft : ArrowUpRight;
  return (
    <button type="button" className={`dashboard-quick-action dashboard-quick-action-${tone} ${tone === 'primary' ? 'btn-shine' : ''}`} onClick={onClick} data-magnetic="0.22">
      <span className="dashboard-quick-action-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <Arrow size={14} aria-hidden="true" />
    </button>
  );
}

function greeting(t: (arabic: string, english: string) => string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(new Date()));
  if (hour < 5) return t('سهرانين؟ أهلًا بيك', 'Burning the midnight oil');
  if (hour < 12) return t('صباح الخير', 'Good morning');
  if (hour < 18) return t('يومك سعيد', 'Good afternoon');
  return t('مساء الخير', 'Good evening');
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t, date, locale, number } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const compact = useCompactViewport();
  const user = useAuthStore((state) => state.user);
  const accessQuery = useAdminAccess(user?.id ?? null);
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const notesQuery = useNotes();
  const dashboardState = resolveDashboardQueryState({
    members: membersQuery,
    tasks: tasksQuery,
    notes: notesQuery,
  });
  const [year, setYear] = useState(() => Number(getCairoDate().slice(0, 4)));
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [githubEnabled, setGithubEnabled] = useState(readGithubSyncPreference);
  const ready = dashboardState.status === 'ready' ? dashboardState.data : null;
  const availableMembers = useMemo(() => ready?.members ?? [], [ready]);
  const selectedMember = availableMembers.find((member) => member.id === selectedMemberId) ?? null;
  const effectiveMemberId = selectedMember?.id ?? null;
  const currentYear = Number(getCairoDate().slice(0, 4));
  const years = useMemo(
    () => Array.from({ length: Math.min(currentYear, 5) }, (_, index) => currentYear - index).reverse(),
    [currentYear],
  );
  const contributionQuery = useTaskContributions(year, effectiveMemberId);
  const githubLinks = useGithubLinks(availableMembers);
  const dataYear = contributionQuery.data?.year ?? year;
  const github = useGithubTeamCalendars(githubLinks, dataYear, currentYear, githubEnabled && githubLinks.length > 0);
  const metrics = useMemo(
    () => (ready ? getDashboardMetrics(ready.members, ready.tasks, ready.notes) : undefined),
    [ready],
  );
  const people = useMemo(() => {
    const map = new Map<number, PersonInfo>();
    const handles = new Map(githubLinks.map((link) => [link.memberId, link.handle]));
    for (const member of availableMembers) map.set(member.id, { name: member.full_name, handle: handles.get(member.id) ?? null });
    return map;
  }, [availableMembers, githubLinks]);
  const activity = useMemo(() => {
    if (!ready || !contributionQuery.data) return null;
    return buildTeamActivity({
      year: contributionQuery.data.year,
      contributions: contributionQuery.data,
      members: ready.members,
      tasks: ready.tasks,
      githubLinks: githubEnabled ? githubLinks : [],
      githubCalendars: github.calendars,
      memberId: effectiveMemberId,
    });
  }, [ready, contributionQuery.data, githubEnabled, githubLinks, github.calendars, effectiveMemberId]);
  const series = useMemo<MetricSeries | null>(() => {
    if (!ready || !contributionQuery.data) return null;
    const today = contributionQuery.data.today;
    const dates = (values: Array<string | null>) => values.filter((value): value is string => Boolean(value));
    const approvals: string[] = [];
    for (const day of contributionQuery.data.days) for (let index = 0; index < day.count; index += 1) approvals.push(day.date);
    const submissions: string[] = [];
    for (const task of ready.tasks) {
      for (const entry of Object.values(task.tracking ?? {})) {
        if (entry && (entry.status === 'under_review' || entry.status === 'approved')) {
          const day = cairoDayOf(entry.updated_at);
          if (day) submissions.push(day);
        }
      }
    }
    return {
      members: cumulativeSeries(dates(ready.members.map((member) => cairoDayOf(member.created_at))), today),
      tasks: bucketSeries(dates(ready.tasks.map((task) => cairoDayOf(task.created_at))), today),
      approvals: bucketSeries(approvals, today),
      submissions: bucketSeries(submissions, today),
    };
  }, [ready, contributionQuery.data]);

  useReveal(root, [Boolean(activity)], !compact);

  const toggleGithub = useCallback(() => {
    setGithubEnabled((value) => {
      writeGithubSyncPreference(!value);
      return !value;
    });
  }, []);
  const closeDay = useCallback(() => setOpenDate(null), []);

  const retry = () => {
    void Promise.all([
      membersQuery.refetch(),
      tasksQuery.refetch(),
      notesQuery.refetch(),
      contributionQuery.refetch(),
    ]);
  };
  const hasPermission = (permission: AdminPermission) => accessQuery.data?.is_owner === true || accessQuery.data?.permissions?.[permission] === true;

  if (dashboardState.status === 'error' || contributionQuery.isError) {
    const message = dashboardState.status === 'error'
      ? dashboardState.reason === 'missing-data'
        ? t('بيانات لوحة التحكم رجعت ناقصة. أعد المحاولة قبل عرض المؤشرات.', 'A required dashboard query returned incomplete data. Retry before viewing analytics.')
        : t('معرفناش نحمّل بيانات لوحة التحكم. أعد المحاولة قبل عرض المؤشرات.', 'Could not load the required dashboard data. Retry before viewing analytics.')
      : t('تعذر تحميل سجل اعتماد المهام. قد تكون migration السجل غير مطبقة أو تعذر الاتصال؛ لن نستخدم الحالات الحالية كبديل.', 'Could not load task approval history. The ledger migration may be missing or the RPC may be unreachable; current task states will not be used as a substitute.');
    return <div data-testid="dashboard-error"><ErrorState message={message} onRetry={retry} /></div>;
  }

  if (dashboardState.status === 'loading' || contributionQuery.isPending) {
    return <div data-testid="dashboard-loading"><CardSkeletons /></div>;
  }

  if (dashboardState.status !== 'ready' || !metrics || !contributionQuery.data || !activity || !series) {
    return (
      <div data-testid="dashboard-error">
        <ErrorState message={t('بيانات لوحة التحكم مش جاهزة للعرض. أعد المحاولة.', 'Dashboard data is not ready to display. Please retry.')} onRetry={retry} />
      </div>
    );
  }

  const contributions = contributionQuery.data;
  const contributionDate = new Date(`${contributions.today}T12:00:00.000Z`);
  const taskShortcutsAvailable = hasPermission('tasks');
  const memberShortcutsAvailable = hasPermission('members');
  const assistantShortcutAvailable = hasPermission('ai_assistant');
  const todayActivity = activity.byDate.get(contributions.today);
  const openDay = openDate ? activity.byDate.get(openDate) : undefined;
  const coverageSince = contributionCoverageDate(contributions.history_complete_since);
  const openRecords = openDate
    ? recordsOnDay(openDate, dashboardState.data.notes, dashboardState.data.tasks, dashboardState.data.members, effectiveMemberId)
    : { notes: [], tasksCreated: [], membersJoined: [] };

  return (
    <div data-testid="dashboard-ready" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div ref={root} className="dashboard-root">
        <header className="dashboard-hero glass-card" data-reveal>
          <div className="dashboard-hero-copy">
            <div className="dashboard-hero-brand">
              <span className="dashboard-brand-mark" aria-hidden="true"><PhantomsSymbol size="sm" /></span>
              <p className="dashboard-eyebrow"><span className="live-dot" aria-hidden="true" />{greeting(t)} · {t('مركز متابعة الفريق', 'TEAM COMMAND CENTER')}</p>
            </div>
            <h1 className="dashboard-hero-title">{t('لوحة الفريق', 'Team dashboard')}</h1>
            <p className="dashboard-hero-subtitle">{t('صورة واضحة للأعضاء والتكليفات واعتمادات الفريق ومساهمات GitHub في مكان واحد.', 'A clear view of members, assignments, team approvals and GitHub contributions in one place.')}</p>
            <ul className="dashboard-hero-chips" aria-label={t('حالة اليوم', 'Today at a glance')}>
              <li data-tone="amber"><Clock3 size={14} aria-hidden="true" />{t(`${number(metrics.underReview)} تحت المراجعة`, `${number(metrics.underReview)} under review`)}</li>
              <li data-tone="red"><CalendarClock size={14} aria-hidden="true" />{t(`${number(metrics.lateMembers.length)} متأخرة`, `${number(metrics.lateMembers.length)} overdue`)}</li>
              <li data-tone="violet"><GithubMark size={14} />{t(`${number(githubLinks.length)} حساب GitHub مربوط`, `${number(githubLinks.length)} linked GitHub accounts`)}</li>
            </ul>
            <div className="dashboard-page-tools">
              <time className="dashboard-today" dateTime={contributions.today}>{date(contributionDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
              <nav className="dashboard-quick-actions" aria-label={t('إجراءات سريعة', 'Quick actions')}>
                {taskShortcutsAvailable && <QuickAction label={t('تكليف مهمة', 'Assign a task')} icon={<ClipboardList size={16} />} onClick={() => navigate('/admin/tasks')} tone="primary" />}
                {memberShortcutsAvailable && <QuickAction label={t('إضافة عضو', 'Add a member')} icon={<UserRoundPlus size={16} />} onClick={() => navigate('/admin/members')} />}
                {assistantShortcutAvailable && <QuickAction label={t('المساعد الذكي', 'AI assistant')} icon={<Bot size={16} />} onClick={() => navigate('/admin/ai-assistant')} />}
              </nav>
            </div>
          </div>
          <button type="button" className="dashboard-hero-visual" onClick={() => setOpenDate(contributions.today)} aria-label={t('افتح سجل النهارده', 'Open today’s history')}>
            <HeroHexCluster heat={todayActivity?.crew ?? 0} value={number(todayActivity?.total ?? 0)} caption={t('النهارده', 'today')} />
          </button>
        </header>

        <DashboardMetricsGrid metrics={metrics} taskCount={dashboardState.data.tasks.length} series={series} />

        <TaskStreakHeatmap
          contributions={contributions}
          activity={activity}
          year={year}
          memberName={selectedMember?.full_name ?? null}
          years={years}
          memberOptions={availableMembers.map((member) => ({ id: member.id, name: member.full_name }))}
          selectedMemberId={effectiveMemberId}
          onYearChange={setYear}
          onMemberChange={(memberId) => {
            if (memberId === null || availableMembers.some((member) => member.id === memberId)) setSelectedMemberId(memberId);
          }}
          people={people}
          github={{ linked: githubLinks.length, connected: github.connected, failed: github.failed, loading: github.loading, enabled: githubEnabled, onToggle: toggleGithub }}
          onOpenDay={setOpenDate}
          isRefreshing={contributionQuery.isPlaceholderData || github.isFetching}
          compact={compact}
        />

        <DashboardWidgets
          metrics={metrics}
          tasks={dashboardState.data.tasks}
          contributions={contributions}
          activity={activity}
          people={people}
          permissions={{ tasks: taskShortcutsAvailable, members: memberShortcutsAvailable, ranking: hasPermission('ranking') }}
          onOpenDay={setOpenDate}
          compact={compact}
        />
      </div>
      <DayHistoryDrawer
        date={openDate}
        onClose={closeDay}
        day={openDay}
        records={openRecords}
        people={people}
        githubEnabled={githubEnabled}
        isUntracked={Boolean(openDate && (!coverageSince || openDate < coverageSince))}
        today={contributions.today}
      />
    </div>
  );
}
