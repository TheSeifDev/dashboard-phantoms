import { useMemo } from 'react';
import { Check, KanbanSquare, Undo2 } from 'lucide-react';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole, TeamConsoleTask, TeamConsoleTaskState } from '../../../types/db';
import { useReviewTeamTask } from './api';
import { PanelShell, StateChip, TASK_STATE_COPY } from './shared';

const COLUMNS: TeamConsoleTaskState[] = ['open', 'review', 'revision', 'approved'];

export function AgilePanel({ teamId, data }: { teamId: string; data: TeamConsole }) {
  const { t, locale, number, date } = useLocale();
  const reviewTask = useReviewTeamTask(teamId);

  const columns = useMemo(() => {
    const buckets = new Map<TeamConsoleTaskState, TeamConsoleTask[]>(COLUMNS.map((state) => [state, []]));
    for (const task of data.tasks) {
      buckets.get(task.state)?.push(task);
    }
    return COLUMNS.map((state) => ({ state, tasks: buckets.get(state) ?? [] }));
  }, [data.tasks]);

  const review = async (task: TeamConsoleTask, memberId: number, action: 'approve' | 'revision') => {
    try {
      await reviewTask.mutateAsync({ taskId: task.id, memberId, action, reason: null });
      toast.success(action === 'approve' ? t('اتعتمد التسليم.', 'Submission approved.') : t('طلبنا تعديل التسليم.', 'Revision requested.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نراجع التسليم.', 'Could not review the submission.')).message);
    }
  };

  return (
    <PanelShell
      id="tmc-agile"
      kicker={<><KanbanSquare size={14} aria-hidden="true" />{t('أجايل', 'Agile')}</>}
      title={t('لوحة أجايل للفريق', 'Team agile board')}
      hint={t('كل عمود حالة حقيقية من تسليمات الأعضاء. الأعمدة بتتحرك لوحدها مع كل اعتماد.', 'Every column is a real submission state and moves as you approve.')}
    >
      <div className="tmc-kanban">
        {columns.map(({ state, tasks }) => {
          const copy = TASK_STATE_COPY[state];
          return (
            <section key={state} className={`tmc-column is-${copy.tone}`} aria-label={copy[locale === 'ar' ? 'ar' : 'en']}>
              <header className="tmc-column-head">
                <span className="tmc-column-dot" aria-hidden="true" />
                <h3>{copy[locale === 'ar' ? 'ar' : 'en']}</h3>
                <b dir="ltr">{number(tasks.length)}</b>
              </header>
              <div className="tmc-column-body">
                {tasks.length === 0
                  ? <p className="tmc-column-empty">{t('فاضي', 'Empty')}</p>
                  : tasks.map((task) => (
                    <article key={task.id} className="tmc-kcard" data-tmc-anim>
                      <h4>{task.title}</h4>
                      <div className="tmc-kcard-meta">
                        {task.has_deadline && task.deadline_date ? <span>{date(task.deadline_date)}</span> : <span>{t('بدون ميعاد', 'No deadline')}</span>}
                        {task.bonus_points > 0 ? <StateChip tone="primary">+{number(task.bonus_points)}</StateChip> : null}
                      </div>
                      {task.assignees.length > 0 && (
                        <ul className="tmc-kcard-people">
                          {task.assignees.slice(0, 4).map((assignee) => (
                            <li key={assignee.member_id} title={`${assignee.full_name} · ${assignee.status}`}>
                              <span className={`tmc-avatar-dot is-${assignee.status === 'approved' ? 'primary' : assignee.status === 'under_review' ? 'accent' : assignee.status === 'revision' ? 'warning' : 'muted'}`} aria-hidden="true" />
                              {assignee.full_name.split(' ')[0]}
                              {assignee.status === 'under_review' && (
                                <span className="tmc-kcard-actions">
                                  <button type="button" aria-label={t('اعتماد', 'Approve')} onClick={() => void review(task, assignee.member_id, 'approve')} disabled={reviewTask.isPending}>
                                    <Check size={12} aria-hidden="true" />
                                  </button>
                                  <button type="button" aria-label={t('طلب تعديل', 'Request revision')} onClick={() => void review(task, assignee.member_id, 'revision')} disabled={reviewTask.isPending}>
                                    <Undo2 size={12} aria-hidden="true" />
                                  </button>
                                </span>
                              )}
                            </li>
                          ))}
                          {task.assignees.length > 4 ? <li className="tmc-more">+{number(task.assignees.length - 4)}</li> : null}
                        </ul>
                      )}
                    </article>
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    </PanelShell>
  );
}
