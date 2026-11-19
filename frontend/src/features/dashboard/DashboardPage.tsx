import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ArrowUpLeft, Bot, ClipboardList, UserRoundPlus } from 'lucide-react';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { PhantomsSymbol } from '../../components/brand/PhantomsLogo';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { useNotes } from '../notes/api';
import { useAdminAccess } from '../admin/access/api';
import { useAuthStore } from '../../store/auth';
import type { AdminPermission } from '../../types/db';
import { useLocale } from '../../i18n/useLocale';
import { DashboardMetricsGrid } from './DashboardMetrics';
import { DashboardWidgets } from './DashboardWidgets';
import { TaskStreakHeatmap } from './TaskStreakHeatmap';
import { getDashboardMetrics } from './metrics';
import { resolveDashboardQueryState } from './dashboardqueryState';
import { getCairoDate } from './taskContributions';
import { useTaskContributions } from './useTaskContributions';
import './dashboard.css';

gsap.registerPlugin(useGSAP);

function DashboardEntrance({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const targets = root.current?.querySelectorAll<HTMLElement>('.dashboard-reveal');
    if (!targets?.length) return;
    // Small, non-blocking entrance treatment; the content is visible while it animates.
    gsap.from(targets, { y: 7, opacity: 0.82, duration: 0.24, stagger: 0.035, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: root });

  return <div ref={root} className="dashboard-root">{children}</div>;
}

function QuickAction({ label, icon, onClick, tone = 'neutral' }: { label: string; icon: ReactNode; onClick: () => void; tone?: 'primary' | 'neutral' }) {
  return (
    <button type="button" className={`dashboard-quick-action dashboard-quick-action-${tone}`} onClick={onClick}>
      <span className="dashboard-quick-action-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <ArrowUpLeft size={14} aria-hidden="true" />
    </button>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t, date, locale } = useLocale();
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
  const availableMembers = dashboardState.status === 'ready' ? dashboardState.data.members : [];
  const selectedMember = availableMembers.find((member) => member.id === selectedMemberId) ?? null;
  const effectiveMemberId = selectedMember?.id ?? null;
  const currentYear = Number(getCairoDate().slice(0, 4));
  const years = useMemo(
    () => Array.from({ length: Math.min(currentYear, 5) }, (_, index) => currentYear - index).reverse(),
    [currentYear],
  );
  const contributionQuery = useTaskContributions(year, effectiveMemberId);
  const metrics = dashboardState.status === 'ready'
    ? getDashboardMetrics(dashboardState.data.members, dashboardState.data.tasks, dashboardState.data.notes)
    : undefined;

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

  if (dashboardState.status !== 'ready' || !metrics || !contributionQuery.data) {
    return (
      <div data-testid="dashboard-error">
        <ErrorState message={t('بيانات لوحة التحكم مش جاهزة للعرض. أعد المحاولة.', 'Dashboard data is not ready to display. Please retry.')} onRetry={retry} />
      </div>
    );
  }

  const contributionDate = new Date(`${contributionQuery.data.today}T12:00:00.000Z`);
  const taskShortcutsAvailable = hasPermission('tasks');
  const memberShortcutsAvailable = hasPermission('members');
  const assistantShortcutAvailable = hasPermission('ai_assistant');

  return (
    <div data-testid="dashboard-ready" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <DashboardEntrance>
        <header className="dashboard-page-header dashboard-reveal">
          <div className="dashboard-page-title-block">
            <span className="dashboard-brand-mark" aria-hidden="true"><PhantomsSymbol size="sm" /></span>
            <div>
              <p className="dashboard-eyebrow">{t('مركز متابعة الفريق', 'TEAM COMMAND CENTER')}</p>
              <h1>{t('لوحة الفريق', 'Team dashboard')}</h1>
              <p>{t('صورة واضحة للأعضاء والتكليفات واعتمادات الفريق.', 'A clear view of members, assignments, and team approvals.')}</p>
            </div>
          </div>
          <div className="dashboard-page-tools">
            <time className="dashboard-today" dateTime={contributionQuery.data.today}>{date(contributionDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
            <nav className="dashboard-quick-actions" aria-label={t('إجراءات سريعة', 'Quick actions')}>
              {taskShortcutsAvailable && <QuickAction label={t('تكليف مهمة', 'Assign a task')} icon={<ClipboardList size={16} />} onClick={() => navigate('/admin/tasks')} tone="primary" />}
              {memberShortcutsAvailable && <QuickAction label={t('إضافة عضو', 'Add a member')} icon={<UserRoundPlus size={16} />} onClick={() => navigate('/admin/members')} />}
              {assistantShortcutAvailable && <QuickAction label={t('المساعد الذكي', 'AI assistant')} icon={<Bot size={16} />} onClick={() => navigate('/admin/ai-assistant')} />}
            </nav>
          </div>
        </header>

        <section className="dashboard-overview" aria-label={t('نظرة عامة على الفريق', 'Team overview')}>
          <DashboardMetricsGrid metrics={metrics} taskCount={dashboardState.data.tasks.length} />
          <TaskStreakHeatmap
            contributions={contributionQuery.data}
            year={year}
            memberName={selectedMember?.full_name ?? null}
            years={years}
            memberOptions={availableMembers.map((member) => ({ id: member.id, name: member.full_name }))}
            selectedMemberId={effectiveMemberId}
            onYearChange={setYear}
            onMemberChange={(memberId) => {
              if (memberId === null || availableMembers.some((member) => member.id === memberId)) setSelectedMemberId(memberId);
            }}
          />
        </section>

        <DashboardWidgets
          metrics={metrics}
          tasks={dashboardState.data.tasks}
          contributions={contributionQuery.data}
          permissions={{ tasks: taskShortcutsAvailable, members: memberShortcutsAvailable, ranking: hasPermission('ranking') }}
        />
      </DashboardEntrance>
    </div>
  );
}
