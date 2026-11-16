import { useNavigate } from 'react-router-dom';
import { Bot, Plus, UserRoundPlus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { useNotes } from '../notes/api';
import { DashboardMetricsGrid } from './DashboardMetrics';
import { DashboardWidgets } from './DashboardWidgets';
import { getDashboardMetrics } from './metrics';
import { resolveDashboardQueryState } from './dashboardqueryState';

export default function DashboardPage() {
  const navigate = useNavigate();
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const notesQuery = useNotes();

  const dashboardState = resolveDashboardQueryState({
    members: membersQuery,
    tasks: tasksQuery,
    notes: notesQuery,
  });
  const metrics = dashboardState.status === 'ready'
    ? getDashboardMetrics(dashboardState.data.members, dashboardState.data.tasks, dashboardState.data.notes)
    : undefined;

  const retry = () => {
    void Promise.all([membersQuery.refetch(), tasksQuery.refetch(), notesQuery.refetch()]);
  };

  if (dashboardState.status === 'loading') {
    return <div data-testid="dashboard-loading"><CardSkeletons /></div>;
  }

  if (dashboardState.status === 'error') {
    const message = dashboardState.reason === 'missing-data'
      ? 'بيانات لوحة التحكم رجعت ناقصة. أعد المحاولة قبل عرض المؤشرات.'
      : 'معرفناش نحمّل بيانات لوحة التحكم. أعد المحاولة قبل عرض المؤشرات.';
    return (
      <div data-testid="dashboard-error">
        <ErrorState message={message} onRetry={retry} />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div data-testid="dashboard-error">
        <ErrorState message="بيانات لوحة التحكم مش جاهزة للعرض. أعد المحاولة." onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="grid gap-5" dir="rtl">
      {/* Hero Section — Official PHANTOMS Art Direction */}
      <section className="relative overflow-hidden grid gap-4 rounded-[var(--radius-lg)] bg-[var(--phantom-black)] border border-white/10 border-s-4 border-s-[var(--primary)] p-5 text-white sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center shadow-lg">
        {/* Subtle brutalist geometric technical reticle in background */}
        <div className="pointer-events-none absolute -end-10 -bottom-10 size-48 rounded-full border border-red-900/20 opacity-30 sm:size-64" aria-hidden="true" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 mb-1.5">
            <span className="size-2 rounded-full bg-[var(--primary)] animate-pulse" aria-hidden="true" />
            <p className="text-xs font-black tracking-widest text-[var(--accent-pink)] uppercase font-['Montserrat',sans-serif]">
              DESIGN FROM THE SHADOW • IDEAS INTO IMPACT
            </p>
          </div>
          <h2 className="mt-1 text-2xl font-black sm:text-3xl tracking-tight text-[var(--editorial-white)] font-[var(--font-arabic)]">
            مركز عمليات PHANTOMS
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--soft-grey)]">
            متابعة فورية لجاهزية الأعضاء، مؤشرات الإنجاز، والتكليفات التشغيلية بدقة وكفاءة عالية.
          </p>
        </div>
        <div className="relative z-10 grid gap-3 sm:flex sm:flex-wrap pt-3 lg:pt-0">
          <Button onClick={() => navigate('/admin/tasks')} icon={<Plus size={17} />} className="bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] border-0" fullOnMobile>
            تكليف مهمة
          </Button>
          <Button variant="secondary" onClick={() => navigate('/admin/members')} icon={<UserRoundPlus size={17} />} className="border-white/20 bg-white/10 text-[var(--editorial-white)] hover:bg-white/20" fullOnMobile>
            إضافة عضو
          </Button>
          <Button variant="ghost" onClick={() => navigate('/admin/ai-assistant')} icon={<Bot size={17} />} fullOnMobile className="text-[var(--editorial-white)] hover:bg-white/10">
            مساعد PHANTOMS
          </Button>
        </div>
      </section>

      {/* Overview Analytics Row */}
      <DashboardMetricsGrid metrics={metrics} />

      {/* Advanced Widgets Grid */}
      <DashboardWidgets metrics={metrics} tasks={dashboardState.data.tasks} />
    </div>
  );
}
