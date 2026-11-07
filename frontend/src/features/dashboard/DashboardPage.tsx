import { useMemo } from 'react';
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const notesQuery = useNotes();
  
  const members = membersQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const notes = notesQuery.data ?? [];
  
  const metrics = useMemo(() => getDashboardMetrics(members, tasks, notes), [members, tasks, notes]);

  const retry = () => {
    void Promise.all([membersQuery.refetch(), tasksQuery.refetch(), notesQuery.refetch()]);
  };

  const isLoading = membersQuery.isLoading || tasksQuery.isLoading || notesQuery.isLoading;
  const isError = membersQuery.isError || tasksQuery.isError || notesQuery.isError;

  if (isLoading) return <CardSkeletons />;

  return (
    <div className="grid gap-5" dir="rtl">
      {isError && <ErrorState message="معرفناش نحمّل بعض بيانات لوحة التحكم." onRetry={retry} />}
      
      {/* Hero Section */}
      <section className="grid gap-4 rounded-[var(--radius-lg)] bg-[var(--primary)] p-5 text-white sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center shadow-md">
        <div>
          <p className="text-sm font-bold text-violet-200 uppercase tracking-widest leading-relaxed">مركز عمليات وصلة</p>
          <h2 className="mt-1 text-2xl font-black sm:text-3xl tracking-tight">الفريق كله، في صورة واحدة</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-100/90">تابع جاهزية الأعضاء، مؤشرات المهام، والنشاط دلوقتي، وخد قراراتك بناءً على بيانات حقيقية.</p>
        </div>
        <div className="grid gap-3 sm:flex sm:flex-wrap pt-3 lg:pt-0">
          <Button onClick={() => navigate('/admin/tasks')} icon={<Plus size={17} />} className="bg-white text-purple-900 hover:bg-violet-50 transition-colors" fullOnMobile>تكليف مهمة</Button>
          <Button variant="secondary" onClick={() => navigate('/admin/members')} icon={<UserRoundPlus size={17} />} className="border-white/30 bg-white/10 text-white hover:bg-white/20" fullOnMobile>إضافة عضو</Button>
          <Button variant="ghost" onClick={() => navigate('/admin/ai-assistant')} icon={<Bot size={17} />} fullOnMobile className="text-white hover:bg-white/10">مساعد وصلة</Button>
        </div>
      </section>

      {/* Overview Analytics Row */}
      <DashboardMetricsGrid metrics={metrics} />

      {/* Advanced Widgets Grid */}
      <DashboardWidgets metrics={metrics} tasks={tasks} />
    </div>
  );
}
