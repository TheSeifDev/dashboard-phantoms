import { useMemo, useState, type FormEvent } from 'react';
import { Check, ClipboardList, ListPlus, PencilRuler, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole, TeamConsoleTask } from '../../../types/db';
import { useCreateTeamTask, useDeleteTeamTask, useReviewTeamTask } from './api';
import { PanelShell, StateChip, TASK_STATE_COPY } from './shared';

const MAX_BONUS = 50;

export function TasksPanel({ teamId, data }: { teamId: string; data: TeamConsole }) {
  const { t, locale, number, date } = useLocale();
  const createTask = useCreateTeamTask(teamId);
  const deleteTask = useDeleteTeamTask(teamId);
  const reviewTask = useReviewTeamTask(teamId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [bonus, setBonus] = useState(0);
  const [audience, setAudience] = useState<'ALL' | number[]>('ALL');
  const [pendingDelete, setPendingDelete] = useState<TeamConsoleTask | null>(null);

  const members = data.members;
  const selected = useMemo(() => (audience === 'ALL' ? [] : audience), [audience]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim().length < 3) {
      toast.error(t('اكتب عنوان مهمة واضح (3 حروف على الأقل).', 'Write a clear task title (at least 3 characters).'));
      return;
    }
    try {
      await createTask.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        assignedTo: audience === 'ALL' ? 'ALL' : selected.map((id) => String(id)),
        deadlineDate: deadline || null,
        bonusPoints: bonus,
      });
      toast.success(t('اتضافت المهمة على الفريق.', 'Task added to the team.'));
      setTitle('');
      setDescription('');
      setDeadline('');
      setBonus(0);
      setAudience('ALL');
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نضيف المهمة.', 'Could not add the task.')).message);
    }
  };

  const review = async (task: TeamConsoleTask, memberId: number, action: 'approve' | 'revision') => {
    try {
      await reviewTask.mutateAsync({ taskId: task.id, memberId, action, reason: null });
      toast.success(action === 'approve' ? t('اتعتمد التسليم.', 'Submission approved.') : t('طلبنا تعديل التسليم.', 'Revision requested.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نراجع التسليم.', 'Could not review the submission.')).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteTask.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذفت المهمة.', 'Task deleted.'));
      setPendingDelete(null);
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحذف المهمة.', 'Could not delete the task.')).message);
    }
  };

  return (
    <>
      <PanelShell
        id="tmc-task-create"
        kicker={<><ListPlus size={14} aria-hidden="true" />{t('مهمة جديدة', 'New task')}</>}
        title={t('أضف مهمة للفريق', 'Add a team task')}
        hint={t('المهمة تظهر لكل الأعضاء المختارين، والبونص بيتحسب عند الاعتماد بس.', 'The task shows for the chosen members; bonus is granted only on approval.')}
      >
        <form className="tmc-form" onSubmit={(event) => void submit(event)}>
          <label className="tmc-field tmc-field--wide">
            <span>{t('عنوان المهمة', 'Task title')}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} required minLength={3} maxLength={160} placeholder={t('مثال: مراجعة كود وحدة الدفع', 'e.g. Review the payments module code')} />
          </label>
          <label className="tmc-field tmc-field--wide">
            <span>{t('تفاصيل المهمة', 'Task details')}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 2000))} rows={3} maxLength={2000} placeholder={t('اكتب المطلوب بالتفصيل (اختياري).', 'Describe the requirement (optional).')} />
          </label>
          <label className="tmc-field">
            <span>{t('آخر ميعاد', 'Deadline')}</span>
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          <label className="tmc-field">
            <span>{t('بونص الاعتماد', 'Approval bonus')}</span>
            <input type="number" min={0} max={MAX_BONUS} value={bonus} onChange={(event) => setBonus(Math.max(0, Math.min(MAX_BONUS, Number(event.target.value) || 0)))} />
          </label>
          <fieldset className="tmc-audience">
            <legend>{t('لمين المهمة؟', 'Who is it for?')}</legend>
            <div className="tmc-segmented" role="group">
              <button type="button" className={audience === 'ALL' ? 'is-active' : ''} aria-pressed={audience === 'ALL'} onClick={() => setAudience('ALL')}>{t('كل الفريق', 'Whole team')}</button>
              <button type="button" className={audience !== 'ALL' ? 'is-active' : ''} aria-pressed={audience !== 'ALL'} onClick={() => setAudience([])}>{t('أعضاء محددين', 'Specific members')}</button>
            </div>
            {audience !== 'ALL' && (
              members.length === 0
                ? <p className="tmc-note">{t('مفيش أعضاء نشطين تختار منهم.', 'No active members to pick from.')}</p>
                : (
                  <div className="tmc-pick-list">
                    {members.map((member) => {
                      const active = selected.includes(member.member_id);
                      return (
                        <button
                          key={member.member_id}
                          type="button"
                          className={`tmc-pick${active ? ' is-active' : ''}`}
                          aria-pressed={active}
                          onClick={() => setAudience(active ? selected.filter((id) => id !== member.member_id) : [...selected, member.member_id])}
                        >
                          {active ? <Check size={13} aria-hidden="true" /> : null}
                          {member.full_name}
                        </button>
                      );
                    })}
                  </div>
                )
            )}
          </fieldset>
          <div className="tmc-form-actions">
            <Button type="submit" icon={<ListPlus size={15} aria-hidden="true" />} isLoading={createTask.isPending} disabled={audience !== 'ALL' && selected.length === 0}>
              {t('إضافة المهمة', 'Add task')}
            </Button>
          </div>
        </form>
      </PanelShell>

      <PanelShell
        id="tmc-task-list"
        kicker={<><ClipboardList size={14} aria-hidden="true" />{t('قائمة المهام', 'Task list')}</>}
        title={t('مهام الفريق', 'Team tasks')}
        hint={t('راجع تسليمات الأعضاء واعتمدها من هنا؛ الاعتماد بيمنح البونص.', 'Review and approve member submissions here; approval grants the bonus.')}
      >
        {data.tasks.length === 0
          ? <p className="tmc-note">{t('لسه مفيش مهام للفريق. ابدأ بأول مهمة من الفورم فوق.', 'No team tasks yet. Start with the form above.')}</p>
          : (
            <ul className="tmc-task-list">
              {data.tasks.map((task) => {
                const copy = TASK_STATE_COPY[task.state];
                return (
                  <li key={task.id} className="tmc-task" data-tmc-anim>
                    <div className="tmc-task-head">
                      <div>
                        <h3>{task.title}</h3>
                        <div className="tmc-task-meta">
                          <StateChip tone={copy.tone}>{copy[locale === 'ar' ? 'ar' : 'en']}</StateChip>
                          {task.has_deadline && task.deadline_date
                            ? <span>{t('آخر ميعاد', 'Due')} {date(task.deadline_date)}</span>
                            : <span>{t('بدون ميعاد', 'No deadline')}</span>}
                          {task.bonus_points > 0 ? <span dir="ltr">+{number(task.bonus_points)} {t('بونص', 'bonus')}</span> : null}
                          <span>{task.assigned_all ? t('لكل الفريق', 'Whole team') : `${number(task.assignees.length)} ${t('عضو', 'members')}`}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        icon={<Trash2 size={14} aria-hidden="true" />}
                        onClick={() => setPendingDelete(task)}
                        aria-label={t(`حذف ${task.title}`, `Delete ${task.title}`)}
                      >
                        {t('حذف', 'Delete')}
                      </Button>
                    </div>
                    {task.description ? <p className="tmc-task-desc">{task.description}</p> : null}
                    {task.assignees.length > 0 && (
                      <ul className="tmc-assignees">
                        {task.assignees.map((assignee) => {
                          const needsReview = assignee.status === 'under_review';
                          const isRevision = assignee.status === 'revision';
                          return (
                            <li key={assignee.member_id}>
                              <span className="tmc-assignee-name">{assignee.full_name}</span>
                              <StateChip tone={assignee.status === 'approved' ? 'primary' : needsReview ? 'accent' : isRevision ? 'warning' : 'muted'}>
                                {assignee.status === 'approved' ? t('معتمد', 'Approved')
                                  : needsReview ? t('تحت المراجعة', 'In review')
                                    : isRevision ? t('تعديل', 'Revision')
                                      : t('مستني', 'Pending')}
                              </StateChip>
                              {needsReview && (
                                <span className="tmc-assignee-actions">
                                  <button type="button" className="tmc-mini-btn is-ok" onClick={() => void review(task, assignee.member_id, 'approve')} disabled={reviewTask.isPending}>
                                    <Check size={12} aria-hidden="true" />{t('اعتماد', 'Approve')}
                                  </button>
                                  <button type="button" className="tmc-mini-btn" onClick={() => void review(task, assignee.member_id, 'revision')} disabled={reviewTask.isPending}>
                                    <Undo2 size={12} aria-hidden="true" />{t('تعديل', 'Revision')}
                                  </button>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {task.state === 'approved' && (
                      <p className="tmc-task-done"><PencilRuler size={13} aria-hidden="true" />{t('كل التسليمات معتمدة.', 'All submissions approved.')}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </PanelShell>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('حذف المهمة؟', 'Delete this task?')}
        description={t('المهمة وتتبعها هيتحذفوا. البونص المعتمد قبل كده مش بيتأثر.', 'The task and its tracking will be removed. Previously approved bonus is unaffected.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={deleteTask.isPending}
        pendingLabel={t('بيتم الحذف...', 'Deleting…')}
      />
    </>
  );
}
