import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ExternalLink, Gift, Info, RotateCcw } from 'lucide-react';
import type { Member, Task, TaskTrackingEntry } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { safeHref } from '../../lib/validators';
import { formatDateTime, formatDeadline, isOverdue, parseDeadline } from '../../lib/dateUtils';
import { formatSigned } from '../../lib/arabic';
import { useApproveTaskSubmission, useRevokeTaskApproval, useUpdateTaskStatus } from './api';
import { STATUS_META, taskBonus, taskStatusLabel } from './taskMeta';
import { useLocale } from '../../i18n/useLocale';

function signedBonus(value: number, locale: 'ar' | 'en'): string {
  return locale === 'ar'
    ? formatSigned(value)
    : new Intl.NumberFormat('en-GB', { signDisplay: 'always', maximumFractionDigits: 0 }).format(value);
}

export function TaskReviewModal({ item, members, onClose }: { item: { task: Task; memberId: number; entry: TaskTrackingEntry | undefined } | null; members: Member[]; onClose: () => void }) {
  const { t, date, locale } = useLocale();
  const approve = useApproveTaskSubmission();
  const revoke = useRevokeTaskApproval();
  const revise = useUpdateTaskStatus();
  const [feedback, setFeedback] = useState('');
  const itemKey = item ? `${item.task.id}:${item.memberId}` : '';
  // ملاحظة عضو لا تنتقل لعضو آخر عند فتح مراجعة جديدة
  useEffect(() => { setFeedback(''); }, [itemKey]);

  const member = item && members.find((candidate) => candidate.id === item.memberId);
  const memberName = member?.full_name ?? (item ? t(`عضو #${item.memberId}`, `Member #${item.memberId}`) : '');
  const entry = item?.entry;
  const href = entry?.submission_url ? safeHref(entry.submission_url) : null;
  const hasSubmission = Boolean(href || entry?.note);
  const isApproved = entry?.status === 'approved';
  const busy = approve.isPending || revise.isPending || revoke.isPending;
  const bonus = item ? taskBonus(item.task) : 0;
  const deadline = item?.task.has_deadline ? item.task.deadline_date : null;
  const submittedAt = entry?.updated_at ? new Date(entry.updated_at) : null;
  const deadlineAt = parseDeadline(deadline);
  const submittedLate = Boolean(deadlineAt && submittedAt && submittedAt.getTime() > deadlineAt.getTime());
  const formatLocalizedDateTime = (value: string) => locale === 'ar'
    ? formatDateTime(value)
    : date(value, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatLocalizedDeadline = (value: string) => locale === 'ar'
    ? formatDeadline(value, { weekday: true })
    : date(value, { weekday: 'long', day: 'numeric', month: 'long', ...(deadlineAt && deadlineAt.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });

  const accept = async () => {
    if (!item) return;
    try {
      const result = await approve.mutateAsync({ taskId: item.task.id, memberId: item.memberId, bonus });
      const awarded = result.bonusAwarded > 0
        ? t(` ومنحه ${signedBonus(result.bonusAwarded, locale)} بونص`, ` and awarded ${signedBonus(result.bonusAwarded, locale)} bonus points`)
        : '';
      const total = result.totalBonus !== null
        ? t(` — إجمالي بونصه دلوقتي ${signedBonus(result.totalBonus, locale)}`, ` — total bonus is now ${signedBonus(result.totalBonus, locale)}`)
        : '';
      toast.success(t(`اتعتمد تسليم ${memberName}${awarded}${total}.`, `Approved ${memberName}’s submission${awarded}${total}.`));
      onClose();
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نعتمد التسليم — مفيش حاجة اتغيرت.', 'Could not approve the submission; nothing was changed.'));
    }
  };
  const requestRevision = async () => {
    if (!item) return;
    const note = feedback.trim();
    if (!note) { toast.warning(t('اكتب للعضو إيه اللي محتاج يتعدل قبل ما تبعت.', 'Tell the member what needs to be revised before sending the request.')); document.getElementById('task-review-feedback')?.focus(); return; }
    try {
      await revise.mutateAsync({ taskId: item.task.id, memberId: item.memberId, status: 'revision_requested', note, submissionUrl: entry?.submission_url ?? '', currentTracking: item.task.tracking ?? {} });
      toast.info(t(`اتبعت طلب التعديل لـ ${memberName}.`, `Revision request sent to ${memberName}.`));
      onClose();
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نبعت طلب التعديل — مفيش حاجة اتغيرت.', 'Could not send the revision request; nothing was changed.'));
    }
  };
  const revokeApproval = async () => {
    if (!item) return;
    const reason = feedback.trim();
    if (reason.length < 3) {
      toast.warning(t('اكتب سبب إلغاء الاعتماد عشان يتسجل في سجل العضو.', 'Enter a reason for revoking approval so it can be recorded in the member history.'));
      document.getElementById('task-review-feedback')?.focus();
      return;
    }
    try {
      const result = await revoke.mutateAsync({ taskId: item.task.id, memberId: item.memberId, reason });
      const points = result.rank_reversed ? t(` واتخصم ${result.rank_reversed} نقطة`, ` and reversed ${result.rank_reversed} points`) : '';
      const bonusReversed = result.bonus_reversed ? t(` واتشال بونص ${signedBonus(result.bonus_reversed, locale)}`, ` and reversed ${signedBonus(result.bonus_reversed, locale)} bonus`) : '';
      toast.info(t(`اتلغى اعتماد ${memberName}${points}${bonusReversed}، ورجع التسليم للعضو عشان يقدر يعيد إرساله.`, `Approval for ${memberName} was revoked${points}${bonusReversed}; the submission was returned so they can send it again.`));
      onClose();
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نلغي الاعتماد — مفيش حاجة اتغيرت.', 'Could not revoke approval; nothing was changed.'));
    }
  };

  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onClose}
      title={isApproved ? t('إلغاء اعتماد المهمة', 'Revoke task approval') : t('مراجعة تسليم المهمة', 'Review task submission')}
      subtitle={item?.task.title}
      icon={<ClipboardCheck size={20} />}
      maxWidth="lg"
      footer={item && (
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="hidden sm:inline-flex">{t('إغلاق', 'Close')}</Button>
          <div className={`grid gap-2 sm:flex ${isApproved ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {isApproved ? <Button variant="danger" onClick={() => void revokeApproval()} isLoading={revoke.isPending} loadingText={t('بنلغي الاعتماد...', 'Revoking approval...')} disabled={feedback.trim().length < 3} icon={<RotateCcw size={16} />}>{t('إلغاء الاعتماد', 'Revoke approval')}</Button> : <>
              <Button variant="secondary" onClick={() => void requestRevision()} isLoading={revise.isPending} loadingText={t('بنبعت...', 'Sending...')} disabled={approve.isPending} icon={<RotateCcw size={16} />}>{t('طلب تعديل', 'Request revision')}</Button>
              <Button onClick={() => void accept()} isLoading={approve.isPending} loadingText={t('بنعتمد...', 'Approving...')} disabled={revise.isPending} icon={<CheckCircle2 size={17} />}>{bonus > 0 ? t(`اعتمد وادّي ${signedBonus(bonus, locale)}`, `Approve and award ${signedBonus(bonus, locale)}`) : t('اعتمد التسليم', 'Approve submission')}</Button>
            </>}
          </div>
        </div>
      )}
    >
      {item && (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg)] p-3">
            <span className="font-bold">{t('العضو:', 'Member:')} <span className="text-[var(--link)]">{memberName}</span></span>
            {entry && <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_META[entry.status]?.tone ?? ''}`}>{taskStatusLabel(entry.status, locale) ?? entry.status}</span>}
          </div>
          {entry?.updated_at && <p className="text-xs text-[var(--text-muted)]">{t('آخر تحديث:', 'Last updated:')} {formatLocalizedDateTime(entry.updated_at)}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-xs font-bold text-[var(--text-muted)]">{t('الموعد النهائي', 'Deadline')}</p>
              <p className={`mt-0.5 font-bold ${submittedLate || (deadline && isOverdue(deadline) && entry?.status !== 'under_review') ? 'text-red-700 dark:text-red-300' : 'text-[var(--text)]'}`}>
                {deadline ? formatLocalizedDeadline(deadline) : t('بدون موعد', 'No deadline')}
              </p>
              {deadline && submittedAt && entry?.status === 'under_review' && (
                <p className={`mt-0.5 text-xs font-bold ${submittedLate ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{submittedLate ? t('اتسلّمت بعد الموعد', 'Submitted late') : t('اتسلّمت في الموعد', 'Submitted on time')}</p>
              )}
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-200"><Gift size={13} aria-hidden="true" />{t('بونص المهمة', 'Task bonus')}</p>
              <p className="mt-0.5 font-black tabular-nums text-amber-900 dark:text-amber-100">{bonus > 0 ? t(`${signedBonus(bonus, locale)} بونص عند الاعتماد`, `${signedBonus(bonus, locale)} bonus on approval`) : t('بدون بونص', 'No bonus')}</p>
            </div>
          </div>
          {href && (
            <a href={href} target="_blank" rel="noreferrer noopener" className="flex min-h-11 items-center gap-2 break-all rounded-xl border border-[var(--border)] px-3 py-2 font-bold text-[var(--link)] hover:bg-[var(--primary-soft)]">
              <ExternalLink size={16} className="shrink-0" aria-hidden="true" />
              <span dir="ltr" className="min-w-0 break-all text-start">{href}</span>
            </a>
          )}
          {entry?.note && (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="mb-1 text-xs font-bold text-[var(--text-muted)]">{entry.approval_reversed_at && entry.status === 'revision_requested' ? t('سبب إلغاء الاعتماد', 'Reason approval was revoked') : entry.status === 'revision_requested' ? t('آخر ملاحظة تعديل من الإدارة', 'Latest revision note from admin') : t('ملاحظة العضو', 'Member note')}</p>
              <p className="whitespace-pre-line leading-7">{entry.note}</p>
            </div>
          )}
          {!hasSubmission && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 font-bold leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <Info size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              {isApproved ? t('التسليم اتعتمد من غير رابط أو ملاحظة.', 'This submission was approved without a link or note.') : t('العضو لسه ما رفعش رابط أو ملاحظة. الاعتماد هيضيف له النقاط على طول.', 'The member has not submitted a link or note yet. Approval will award points immediately.')}
            </p>
          )}
          {isApproved && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-6 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{t('إلغاء الاعتماد هيرجع المهمة للعضو عشان يقدر يعيد إرسالها، وهيعكس النقاط والبونص اللي اتمنحوا بسبب الاعتماد.', 'Revoking approval returns the task to the member for resubmission and reverses the points and bonus awarded for approval.')}</p>}
          <label htmlFor="task-review-feedback" className="grid gap-1.5 font-bold">
            {isApproved ? <>{t('سبب إلغاء الاعتماد', 'Reason for revoking approval')} <span className="text-xs font-medium text-[var(--text-muted)]">{t('(مطلوب، وبيتسجل في سجل العضو)', '(required; recorded in the member history)')}</span></> : <>{t('توجيهات التعديل', 'Revision instructions')} <span className="text-xs font-medium text-[var(--text-muted)]">{t('(مطلوبة عند طلب تعديل)', '(required when requesting a revision)')}</span></>}
            <textarea id="task-review-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} minLength={isApproved ? 3 : undefined} maxLength={isApproved ? 1000 : 2000} placeholder={isApproved ? t('اكتب ليه بتلغي الاعتماد.', 'Explain why you are revoking approval.') : t('مثال: الصورة التانية محتاجة دقة أعلى، والنص محتاج مراجعة لغوية.', 'Example: The second image needs higher resolution, and the text needs proofreading.')} className="min-h-24 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-base font-normal leading-7 placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]" />
          </label>
        </div>
      )}
    </Modal>
  );
}
