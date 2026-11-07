import { AlertCircle, CheckCircle2, Clock3, MessageSquareWarning, Send } from 'lucide-react';
import type { Task, TaskStatus } from '../../types/db';
import { TaskStatusBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { formatDeadline, hoursRemaining, isOverdue } from '../../lib/dateUtils';
import { arDurationPhrase } from '../../lib/arabic';
import { BonusChip, taskBonus } from '../tasks/taskMeta';

export function MemberTaskCard({ task, memberId, onStart, onSubmit }: { task: Task; memberId: string; onStart: (task: Task) => void; onSubmit: (task: Task) => void }) {
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
  return (
    <Card className="grid content-between gap-4">
      <div className="grid gap-3">
        <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-base font-black leading-6">{task.title}</h3><TaskStatusBadge status={tracking.status} /></div>
        {task.description && <p className="whitespace-pre-line text-sm leading-6 text-[var(--text-2)]">{task.description}</p>}
        {(deadline || bonus > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {deadline && (
              <p className={`flex items-center gap-2 text-sm font-bold ${late || urgent ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
                {late ? <AlertCircle size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
                <span>
                  {late ? 'الموعد خلص: ' : 'الموعد النهائي: '}{formatDeadline(deadline, { weekday: true })}
                  {soon && hoursLeft !== null && <span className="ms-1 inline-block whitespace-nowrap font-black">(فاضل {arDurationPhrase(hoursLeft)})</span>}
                </span>
              </p>
            )}
            <BonusChip points={bonus} earned={isApproved} />
          </div>
        )}
        {tracking.note && (
          needsRevision || approvalWasReversed ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
              <strong className="mb-1 flex items-center gap-1.5"><MessageSquareWarning size={16} aria-hidden="true" />{approvalWasReversed ? 'سبب إلغاء الاعتماد' : 'ملاحظات الإدارة للتعديل'}</strong>
              <span className="whitespace-pre-line">{tracking.note}</span>
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--bg)] p-3 text-sm leading-6"><strong className="block">ملاحظتك اللي فاتت</strong><span className="whitespace-pre-line">{tracking.note}</span></p>
          )
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {isApproved ? <span className="flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300"><CheckCircle2 size={18} />المهمة اتعتمدت</span>
          : isUnderReview ? <span className="flex min-h-11 items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300"><Clock3 size={18} />مستنية مراجعة الإدارة</span>
            : <>
              {tracking.status === 'pending' && <Button variant="secondary" onClick={() => onStart(task)} fullOnMobile>ابدأ الشغل</Button>}
              <Button onClick={() => onSubmit(task)} icon={<Send size={17} />} fullOnMobile>{needsRevision ? 'سلّم تاني بعد التعديل' : tracking.status === 'in_progress' ? 'سلّم للمراجعة' : 'سلّم المهمة'}</Button>
            </>}
      </div>
    </Card>
  );
}
