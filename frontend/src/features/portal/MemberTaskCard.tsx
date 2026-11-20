import { AlertCircle, CheckCircle2, Clock3, MessageSquareWarning, Send } from 'lucide-react';
import type { Task, TaskStatus } from '../../types/db';
import { TaskStatusBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { hasDeadlineTime, hoursRemaining, isOverdue } from '../../lib/dateUtils';
import { arDurationPhrase } from '../../lib/arabic';
import { BonusChip, taskBonus } from '../tasks/taskMeta';
import { useLocale } from '../../i18n/useLocale';

export function MemberTaskCard({ task, memberId, isUpdating = false, onStart, onSubmit }: { task: Task; memberId: string; isUpdating?: boolean; onStart: (task: Task) => void; onSubmit: (task: Task) => void }) {
  const { t, dir, locale, date, number } = useLocale();
  const tracking = task.tracking?.[memberId] || { status: 'pending' as TaskStatus };
  const isApproved = tracking.status === 'approved';
  const isUnderReview = tracking.status === 'under_review';
  const needsRevision = tracking.status === 'revision_requested';
  const approvalWasReversed = tracking.status === 'revision_requested' && Boolean(tracking.approval_reversed_at);
  const deadline = task.has_deadline ? task.deadline_date : null;
  const late = !isApproved && !isUnderReview && isOverdue(deadline);
  const hoursLeft = hoursRemaining(deadline);
  const soon = !late && !isApproved && !isUnderReview && hoursLeft !== null && hoursLeft > 0 && hoursLeft < 24;
  const urgent = soon && hoursLeft !== null && hoursLeft < 6;
  const bonus = isApproved ? (tracking.bonus_awarded ?? taskBonus(task)) : taskBonus(task);
  const deadlineLabel = deadline
    ? date(deadline, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(hasDeadlineTime(deadline) ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
    })
    : '';
  const remainingLabel = hoursLeft === null
    ? ''
    : locale === 'ar'
      ? arDurationPhrase(hoursLeft)
      : hoursLeft < 1
        ? `${number(Math.max(1, Math.ceil(hoursLeft * 60)))} min`
        : `${number(Math.ceil(hoursLeft))} h`;
  return (
    <Card dir={dir} className="grid content-between gap-4">
      <div className="grid gap-3">
        <div className="flex items-start justify-between gap-3"><h3 dir="auto" className="min-w-0 break-words text-base font-black leading-6">{task.title}</h3><TaskStatusBadge status={tracking.status} /></div>
        {task.description && <p dir="auto" className="whitespace-pre-line text-sm leading-6 text-[var(--text-2)]">{task.description}</p>}
        {(deadline || bonus > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {deadline && (
              <p className={`flex items-center gap-2 text-sm font-bold ${late || urgent ? 'text-[var(--danger-text)] dark:text-[var(--danger-text)]' : 'text-amber-800 dark:text-amber-300'}`}>
                {late ? <AlertCircle size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
                <span dir="auto">
                  {late ? t('الموعد خلص: ', 'Overdue: ') : t('الموعد النهائي: ', 'Due: ')}{deadlineLabel}
                  {soon && hoursLeft !== null && <span className="ms-1 inline-block whitespace-nowrap font-black">({t(`فاضل ${remainingLabel}`, `${remainingLabel} left`)})</span>}
                </span>
              </p>
            )}
            <BonusChip points={bonus} earned={isApproved} />
          </div>
        )}
        {tracking.note && (
          needsRevision || approvalWasReversed ? (
            <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]">
              <strong className="mb-1 flex items-center gap-1.5"><MessageSquareWarning size={16} aria-hidden="true" />{approvalWasReversed ? t('سبب إلغاء الاعتماد', 'Reason approval was revoked') : t('ملاحظات الإدارة للتعديل', 'Admin revision notes')}</strong>
              <span dir="auto" className="whitespace-pre-line">{tracking.note}</span>
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--bg)] p-3 text-sm leading-6"><strong className="block">{t('ملاحظتك اللي فاتت', 'Your previous note')}</strong><span dir="auto" className="whitespace-pre-line">{tracking.note}</span></p>
          )
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {isApproved ? <span role="status" className="flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--success-text)] dark:text-[var(--success-text)]"><CheckCircle2 size={18} aria-hidden="true" />{t('المهمة اتعتمدت', 'Task approved')}</span>
          : isUnderReview ? <span role="status" className="flex min-h-11 items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300"><Clock3 size={18} aria-hidden="true" />{t('مستنية مراجعة الإدارة', 'Awaiting admin review')}</span>
            : <>
              {tracking.status === 'pending' && <Button variant="secondary" onClick={() => onStart(task)} fullOnMobile disabled={isUpdating} aria-busy={isUpdating} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2">{isUpdating ? t('جارٍ تحديث المهمة…', 'Updating task…') : t('ابدأ الشغل', 'Start task')}</Button>}
              <Button onClick={() => onSubmit(task)} icon={<Send size={17} aria-hidden="true" />} fullOnMobile disabled={isUpdating} aria-busy={isUpdating} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2">{isUpdating ? t('جارٍ تحديث المهمة…', 'Updating task…') : needsRevision ? t('سلّم تاني بعد التعديل', 'Resubmit after revisions') : tracking.status === 'in_progress' ? t('سلّم للمراجعة', 'Submit for review') : t('سلّم المهمة', 'Submit task')}</Button>
            </>}
      </div>
    </Card>
  );
}
