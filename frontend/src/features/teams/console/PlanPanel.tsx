import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole, TeamGoal, TeamGoalStatus } from '../../../types/db';
import { useDeleteTeamGoal, useSaveTeamGoal } from './api';
import { GOAL_STATUS_COPY, PanelShell, StateChip } from './shared';
import { ProgressRing } from './charts';

interface Draft {
  id: number | null;
  title: string;
  metric: string;
  target: number;
  current: number;
  dueDate: string;
  status: TeamGoalStatus;
}

const EMPTY_DRAFT: Draft = { id: null, title: '', metric: '', target: 100, current: 0, dueDate: '', status: 'active' };

export function PlanPanel({ teamId, data }: { teamId: string; data: TeamConsole }) {
  const { t, locale, number, date } = useLocale();
  const saveGoal = useSaveTeamGoal(teamId);
  const deleteGoal = useDeleteTeamGoal(teamId);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pendingDelete, setPendingDelete] = useState<TeamGoal | null>(null);

  const goals = data.goals;
  const overall = goals.length === 0
    ? 0
    : goals.reduce((sum, goal) => sum + Math.min(1, goal.target_value > 0 ? goal.current_value / goal.target_value : 0), 0) / goals.length;
  const done = goals.filter((goal) => goal.status === 'done').length;

  const startEdit = (goal: TeamGoal) => {
    setDraft({
      id: goal.id,
      title: goal.title,
      metric: goal.metric,
      target: goal.target_value,
      current: goal.current_value,
      dueDate: goal.due_date ?? '',
      status: goal.status,
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.title.trim().length < 3) {
      toast.error(t('اكتب عنوان واضح للهدف.', 'Write a clear goal title.'));
      return;
    }
    try {
      await saveGoal.mutateAsync({
        goalId: draft.id,
        title: draft.title.trim(),
        metric: draft.metric.trim(),
        targetValue: Math.max(1, draft.target),
        currentValue: Math.max(0, draft.current),
        dueDate: draft.dueDate || null,
        status: draft.status,
      });
      toast.success(draft.id ? t('اتحدث الهدف.', 'Goal updated.') : t('اتضاف الهدف للخطة.', 'Goal added to the plan.'));
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ الهدف.', 'Could not save the goal.')).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteGoal.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذف الهدف من الخطة.', 'Goal removed from the plan.'));
      setPendingDelete(null);
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحذف الهدف.', 'Could not delete the goal.')).message);
    }
  };

  return (
    <>
      <div className="tmc-metrics">
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">{Math.round(overall * 100)}%</strong>
          <span>{t('إنجاز الخطة', 'plan progress')}</span>
          <small>{t('متوسط كل الأهداف', 'average of all goals')}</small>
        </article>
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">{number(goals.length)}</strong>
          <span>{t('أهداف', 'goals')}</span>
          <small>{number(done)} {t('خلصوا', 'completed')}</small>
        </article>
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">{number(goals.filter((goal) => goal.status === 'active').length)}</strong>
          <span>{t('شغالين', 'active')}</span>
          <small>{t('متابعة أسبوعية', 'weekly tracking')}</small>
        </article>
      </div>

      <PanelShell
        id="tmc-plan-goals"
        kicker={<><Target size={14} aria-hidden="true" />{t('خطة أداء الفريق', 'Team performance plan')}</>}
        title={t('أهداف الفريق ومؤشراتها', 'Team goals and metrics')}
        hint={t('كل هدف له مؤشر وقيمة مستهدفة وقيمة حالية حقيقية؛ الحلقة بتتحسب من نسبتهم.', 'Each goal has a metric, target, and real current value; the ring is their ratio.')}
      >
        {goals.length === 0
          ? <p className="tmc-note">{t('لسه مفيش أهداف. ضيف أول هدف من الفورم تحت.', 'No goals yet. Add the first goal below.')}</p>
          : (
            <ul className="tmc-goal-grid">
              {goals.map((goal) => (
                <li key={goal.id} className="tmc-goal" data-tmc-anim>
                  <ProgressRing
                    value={goal.current_value}
                    max={goal.target_value}
                    label={goal.title}
                    sublabel={goal.metric || t('هدف', 'goal')}
                    tone={goal.status === 'done' ? 'primary' : goal.status === 'paused' ? 'muted' : 'accent'}
                  />
                  <div className="tmc-goal-copy">
                    <h3>{goal.title}</h3>
                    <p className="tmc-goal-metric">{goal.metric || t('بدون مؤشر', 'No metric')}</p>
                    <div className="tmc-goal-meta">
                      <StateChip tone={goal.status === 'done' ? 'primary' : goal.status === 'paused' ? 'muted' : 'accent'}>
                        {GOAL_STATUS_COPY[goal.status][locale === 'ar' ? 'ar' : 'en']}
                      </StateChip>
                      <span dir="ltr">{number(goal.current_value)} / {number(goal.target_value)}</span>
                      {goal.due_date ? <span>{t('لحد', 'by')} {date(goal.due_date)}</span> : null}
                    </div>
                  </div>
                  <div className="tmc-goal-actions">
                    <button type="button" className="tmc-icon-btn" onClick={() => startEdit(goal)} aria-label={t(`تعديل ${goal.title}`, `Edit ${goal.title}`)}>
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="tmc-icon-btn is-danger" onClick={() => setPendingDelete(goal)} aria-label={t(`حذف ${goal.title}`, `Delete ${goal.title}`)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </PanelShell>

      <PanelShell
        id="tmc-plan-form"
        kicker={<><Plus size={14} aria-hidden="true" />{draft.id ? t('تعديل هدف', 'Edit goal') : t('هدف جديد', 'New goal')}</>}
        title={draft.id ? t('حدّث الهدف', 'Update the goal') : t('ضيف هدف للخطة', 'Add a goal to the plan')}
      >
        <form className="tmc-form" onSubmit={(event) => void submit(event)}>
          <label className="tmc-field tmc-field--wide">
            <span>{t('عنوان الهدف', 'Goal title')}</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value.slice(0, 160) })} required minLength={3} maxLength={160} placeholder={t('مثال: تسليم منتج الفريق قبل نهاية الترم', 'e.g. Ship the team product before term end')} />
          </label>
          <label className="tmc-field">
            <span>{t('المؤشر', 'Metric')}</span>
            <input value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value.slice(0, 80) })} maxLength={80} placeholder={t('مثال: مهام معتمدة', 'e.g. approved tasks')} />
          </label>
          <label className="tmc-field">
            <span>{t('القيمة المستهدفة', 'Target value')}</span>
            <input type="number" min={1} max={1000000} value={draft.target} onChange={(event) => setDraft({ ...draft, target: Number(event.target.value) || 1 })} />
          </label>
          <label className="tmc-field">
            <span>{t('القيمة الحالية', 'Current value')}</span>
            <input type="number" min={0} max={1000000} value={draft.current} onChange={(event) => setDraft({ ...draft, current: Number(event.target.value) || 0 })} />
          </label>
          <label className="tmc-field">
            <span>{t('آخر ميعاد', 'Due date')}</span>
            <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
          </label>
          <label className="tmc-field">
            <span>{t('الحالة', 'Status')}</span>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TeamGoalStatus })}>
              {(['active', 'done', 'paused'] as TeamGoalStatus[]).map((value) => (
                <option key={value} value={value}>{GOAL_STATUS_COPY[value][locale === 'ar' ? 'ar' : 'en']}</option>
              ))}
            </select>
          </label>
          <div className="tmc-form-actions">
            <Button type="submit" icon={<Target size={15} aria-hidden="true" />} isLoading={saveGoal.isPending}>
              {draft.id ? t('حفظ التعديل', 'Save changes') : t('إضافة الهدف', 'Add goal')}
            </Button>
            {draft.id ? (
              <Button type="button" variant="ghost" icon={<X size={15} aria-hidden="true" />} onClick={() => setDraft(EMPTY_DRAFT)} disabled={saveGoal.isPending}>
                {t('إلغاء التعديل', 'Cancel edit')}
              </Button>
            ) : null}
          </div>
        </form>
      </PanelShell>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('حذف الهدف؟', 'Delete this goal?')}
        description={t('الهدف هيختفي من خطة أداء الفريق نهائيًا.', 'The goal will be permanently removed from the team plan.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={deleteGoal.isPending}
        pendingLabel={t('بيتم الحذف...', 'Deleting…')}
      />
    </>
  );
}
