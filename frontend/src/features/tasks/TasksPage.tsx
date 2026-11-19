import { useState } from 'react';
import { CheckSquare, Layers, List, Plus } from 'lucide-react';
import type { Task, TaskTrackingEntry } from '../../types/db';
import { useTasks, useDeleteTask } from './api';
import { useMembers } from '../members/api';
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

export default function TasksPage() {
  const { t, dir } = useLocale();
  const tasksQuery = useTasks();
  const membersQuery = useMembers();
  const deleteTask = useDeleteTask();
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [review, setReview] = useState<ReviewItem | null>(null);
  const [remove, setRemove] = useState<Task | null>(null);
  const tasks = tasksQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const summaries = tasks.map(summarizeTask);
  const awaiting = summaries.reduce((sum, s) => sum + s.awaitingReview, 0);
  const overdue = summaries.filter((s) => s.overdue).length;
  const stats = [
    arCount(tasks.length, AR.task),
    awaiting ? `${arCount(awaiting, AR.submission)} مستنيين المراجعة` : null,
    overdue ? `${overdue} متأخرة` : null,
  ].filter(Boolean).join(' · ');

  const confirmDelete = async () => {
    if (!remove) return;
    try { await deleteTask.mutateAsync(remove.id); setRemove(null); toast.success('اتمسحت المهمة بنجاح.'); }
    catch (cause) { toast.error(handleSupabaseError(cause).message || 'معرفناش نمسح المهمة.'); }
  };

  return (
    <section className="grid grid-cols-1 gap-4" id="page-tasks" dir={dir}>
      <header className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[var(--fs-xl)] font-black"><CheckSquare size={23} className="shrink-0 text-[var(--link)]" aria-hidden="true" />{t("إدارة وتكليف المهام", "Task management and assignment")}</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {tasksQuery.isLoading ? t('بنحمّل المهام...', 'Loading tasks...') : `${stats} — ${t('تابع التسليمات وراجع الإنجاز.', 'Track submissions and review progress.')}`}
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:shrink-0">
          <Button onClick={() => setCreateOpen(true)} icon={<Plus size={18} />} fullOnMobile>{t("اعمل مهمة جديدة", "Create task")}</Button>
          {tasks.length > 0 && (
            <Button variant="secondary" onClick={() => setView((current) => current === 'cards' ? 'table' : 'cards')} icon={view === 'cards' ? <List size={17} /> : <Layers size={17} />} fullOnMobile aria-pressed={view === 'table'}>
              {view === 'cards' ? t('عرض جدول', 'Table view') : t('عرض بطاقات', 'Card view')}
            </Button>
          )}
        </div>
      </header>

      {tasksQuery.isLoading ? <CardSkeletons count={3} />
        : tasksQuery.isError ? <ErrorState message={t("معرفناش نحمّل المهام والتكليفات.", "Could not load tasks and assignments.")} onRetry={() => { void tasksQuery.refetch(); }} />
          : tasks.length === 0 ? <EmptyState title={t("مفيش مهام دلوقتي", "No tasks yet")} description={t("اعمل أول تكليف للفريق عشان تتابع الإنجاز وتراجع التسليمات.", "Create the team's first assignment to track progress and review submissions.")} action={<Button onClick={() => setCreateOpen(true)} icon={<Plus size={17} />} fullOnMobile>{t("اعمل أول مهمة", "Create the first task")}</Button>} />
            : view === 'cards' ? <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">{tasks.map((task) => <TaskCard key={task.id} task={task} members={members} onReview={setReview} onDelete={setRemove} />)}</div>
              : <TaskTable tasks={tasks} members={members} onReview={setReview} onDelete={setRemove} />}

      <TaskAssignmentModal isOpen={createOpen} members={members} membersLoading={membersQuery.isLoading} onClose={() => setCreateOpen(false)} />
      <TaskReviewModal item={review} members={members} onClose={() => setReview(null)} />
      <TaskDeleteModal task={remove} isDeleting={deleteTask.isPending} onClose={() => setRemove(null)} onConfirm={() => void confirmDelete()} />
    </section>
  );
}
