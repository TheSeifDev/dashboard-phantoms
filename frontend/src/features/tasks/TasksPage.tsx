import { useState } from 'react';
import { CheckSquare, Layers, List, Plus, Search, X } from 'lucide-react';
import type { Task, TaskTrackingEntry } from '../../types/db';
import { useTasks, useDeleteTask } from './api';
import { useMemberTeamDirectory, useMembers } from '../members/api';
import { useAdminAccess } from '../admin/access/api';
import { authorizedTeamEntries } from '../teams/access';
import { useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { TaskAssignmentModal } from './TaskAssignmentModal';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { AR, arCount } from '../../lib/arabic';
import { TaskCard } from './TaskCard';
import { TaskTable } from './TaskTable';
import { TaskReviewModal } from './TaskReviewModal';
import { TaskDeleteModal } from './TaskDeleteModal';
import { summarizeTask } from './taskMeta';

import { useLocale } from '../../i18n/useLocale';
type ReviewItem = { task: Task; memberId: number; entry: TaskTrackingEntry };
type TaskFilter = 'all' | 'review' | 'overdue' | 'complete';

export default function TasksPage() {
  const { t, dir, locale, number } = useLocale();
  const tasksQuery = useTasks();
  const membersQuery = useMembers();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessQuery = useAdminAccess(userId);
  const teamDirectory = useMemberTeamDirectory();
  const deleteTask = useDeleteTask();
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [review, setReview] = useState<ReviewItem | null>(null);
  const [remove, setRemove] = useState<Task | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const allTasks = tasksQuery.data ?? [];
  const allMembers = membersQuery.data ?? [];
  // Head/Monitor seats manage their own team only: the assignment picker is
  // limited to that team's active members and the task is stamped with it.
  const managerTeams = authorizedTeamEntries(accessQuery.data);
  const managerTeamSlugs = new Set(managerTeams.map((team) => team.slug));
  const members = managerTeams.length > 0 && teamDirectory.data
    ? allMembers.filter((member) => (teamDirectory.data.byMember[member.id] ?? []).some((slug) => managerTeamSlugs.has(slug)))
    : allMembers;
  const managerTeamId = managerTeams.length === 1 ? managerTeams[0].team_id : null;
  const managerTeamIds = new Set(managerTeams.map((team) => team.team_id));
  const tasks = managerTeams.length > 0
    ? allTasks.filter((task) => Boolean(task.team_id) && managerTeamIds.has(String(task.team_id)))
    : allTasks;

  const items = tasks.map((task) => ({ task, summary: summarizeTask(task) }));
  const awaiting = items.reduce((sum, item) => sum + item.summary.awaitingReview, 0);
  const overdue = items.filter((item) => item.summary.overdue).length;
  const taskCount = locale === 'ar' ? arCount(tasks.length, AR.task) : `${number(tasks.length)} ${t('مهمة', 'tasks')}`;
  const stats = [
    taskCount,
    awaiting ? (locale === 'ar' ? `${arCount(awaiting, AR.submission)} مستنيين المراجعة` : `${number(awaiting)} awaiting review`) : null,
    overdue ? (locale === 'ar' ? `${number(overdue)} متأخرة` : `${number(overdue)} overdue`) : null,
  ].filter(Boolean).join(' · ');
  const normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase(locale);
  const filteredTasks = items.filter(({ task, summary }) => {
    const matchesFilter = filter === 'all'
      || (filter === 'review' && summary.awaitingReview > 0)
      || (filter === 'overdue' && summary.overdue)
      || (filter === 'complete' && summary.isComplete);
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;

    const assigneeNames = Object.keys(task.tracking ?? {}).map((id) =>
      members.find((member) => String(member.id) === id)?.full_name ?? t(`عضو #${id}`, `Member #${id}`),
    );
    const searchableText = [task.title, task.description, task.assigned_to === 'ALL' ? t('كل الفريق', 'Entire team') : '', ...assigneeNames]
      .filter(Boolean)
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase(locale);
    return searchableText.includes(normalizedQuery);
  });
  const hasActiveSearch = query.trim().length > 0;
  const hasActiveFilters = hasActiveSearch || filter !== 'all';
  const clearFilters = () => { setQuery(''); setFilter('all'); };

  const confirmDelete = async () => {
    if (!remove) return;
    try { await deleteTask.mutateAsync(remove.id); setRemove(null); toast.success('اتمسحت المهمة بنجاح.'); }
    catch (cause) { toast.error(handleSupabaseError(cause).message || 'معرفناش نمسح المهمة.'); }
  };

  return (
    <section className="grid grid-cols-1 gap-4" id="page-tasks" dir={dir}>
      <header className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[var(--fs-xl)] font-black"><CheckSquare size={23} className="shrink-0 text-[var(--link)]" aria-hidden="true" />{t('إدارة وتكليف المهام', 'Task management and assignment')}</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]" aria-live="polite">
            {tasksQuery.isLoading ? t('بنحمّل المهام...', 'Loading tasks...') : `${stats} — ${t('تابع التسليمات وراجع الإنجاز.', 'Track submissions and review progress.')}`}
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:shrink-0">
          <Button onClick={() => setCreateOpen(true)} icon={<Plus size={18} />} fullOnMobile>{t('اعمل مهمة جديدة', 'Create task')}</Button>
          {tasks.length > 0 && (
            <Button variant="secondary" onClick={() => setView((current) => current === 'cards' ? 'table' : 'cards')} icon={view === 'cards' ? <List size={17} /> : <Layers size={17} />} fullOnMobile aria-pressed={view === 'table'}>
              {view === 'cards' ? t('عرض جدول', 'Table view') : t('عرض بطاقات', 'Card view')}
            </Button>
          )}
        </div>
      </header>

      {tasks.length > 0 && !tasksQuery.isLoading && !tasksQuery.isError && (
        <section className="grid gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex sm:items-end sm:p-4" aria-label={t('البحث والتصفية في المهام', 'Search and filter tasks')}>
          <label htmlFor="tasks-search" className="grid min-w-0 flex-1 gap-1.5 text-xs font-bold text-[var(--text-muted)]">
            {t('بحث', 'Search')}
            <span className="relative block">
              <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="tasks-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} dir={dir} autoComplete="off" placeholder={t('عنوان المهمة أو وصفها أو اسم العضو', 'Task title, description, or member name')} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] ps-10 pe-3 text-sm font-medium text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-soft)]" />
            </span>
          </label>
          <label className="grid gap-1.5 text-xs font-bold text-[var(--text-muted)] sm:w-52">
            {t('تصفية حسب الحالة', 'Filter by status')}
            <select value={filter} onChange={(event) => setFilter(event.target.value as TaskFilter)} dir={dir} className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-soft)]">
              <option value="all">{t('كل المهام', 'All tasks')}</option>
              <option value="review">{t('تحتاج مراجعة', 'Awaiting review')}</option>
              <option value="overdue">{t('متأخرة', 'Overdue')}</option>
              <option value="complete">{t('مكتملة', 'Complete')}</option>
            </select>
          </label>
          {hasActiveFilters && (
            <Button variant="secondary" onClick={clearFilters} icon={<X size={16} />} fullOnMobile className="sm:mb-0">
              {t('مسح البحث والتصفية', 'Clear search and filters')}
            </Button>
          )}
          <p className="text-xs font-bold tabular-nums text-[var(--text-muted)] sm:pb-3" aria-live="polite">
            {t(`${number(filteredTasks.length)} من ${number(tasks.length)} مهمة`, `${number(filteredTasks.length)} of ${number(tasks.length)} tasks`)}
          </p>
        </section>
      )}

      {tasksQuery.isLoading ? <div role="status" aria-label={t('بنحمّل المهام...', 'Loading tasks...')}><CardSkeletons count={3} /></div>
        : tasksQuery.isError ? <ErrorState message={t('معرفناش نحمّل المهام والتكليفات.', 'Could not load tasks and assignments.')} onRetry={() => { void tasksQuery.refetch(); }} />
          : tasks.length === 0 ? <EmptyState title={t('مفيش مهام دلوقتي', 'No tasks yet')} description={t('اعمل أول تكليف للفريق عشان تتابع الإنجاز وتراجع التسليمات.', "Create the team's first assignment to track progress and review submissions.")} action={<Button onClick={() => setCreateOpen(true)} icon={<Plus size={17} />} fullOnMobile>{t('اعمل أول مهمة', 'Create the first task')}</Button>} />
            : filteredTasks.length === 0 ? <EmptyState title={t('مفيش نتائج مطابقة', 'No matching tasks')} description={t('جرّب كلمات بحث مختلفة أو غيّر التصفية عشان تلاقي المهمة.', 'Try another search or change the filters to find a task.')} action={<Button variant="secondary" onClick={clearFilters} icon={<X size={16} />} fullOnMobile>{t('مسح البحث والتصفية', 'Clear search and filters')}</Button>} />
              : view === 'cards' ? <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredTasks.map(({ task }) => <TaskCard key={task.id} task={task} members={members} onReview={setReview} onDelete={setRemove} />)}</div>
                : <TaskTable tasks={filteredTasks.map(({ task }) => task)} members={members} onReview={setReview} onDelete={setRemove} />}

      <TaskAssignmentModal isOpen={createOpen} members={members} membersLoading={membersQuery.isLoading || (managerTeams.length > 0 && teamDirectory.isLoading)} teamId={managerTeamId} onClose={() => setCreateOpen(false)} />
      <TaskReviewModal item={review} members={members} onClose={() => setReview(null)} />
      <TaskDeleteModal task={remove} isDeleting={deleteTask.isPending} onClose={() => setRemove(null)} onConfirm={() => void confirmDelete()} />
    </section>
  );
}
