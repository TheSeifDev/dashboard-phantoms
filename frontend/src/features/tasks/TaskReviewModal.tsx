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
import { STATUS_META, taskBonus } from './taskMeta';

export function TaskReviewModal({ item, members, onClose }: { item: { task: Task; memberId: number; entry: TaskTrackingEntry | undefined } | null; members: Member[]; onClose: () => void }) {
  const approve = useApproveTaskSubmission();
  const revoke = useRevokeTaskApproval();
  const revise = useUpdateTaskStatus();
  const [feedback, setFeedback] = useState('');
  const itemKey = item ? `${item.task.id}:${item.memberId}` : '';
  // ملاحظة عضو لا تنتقل لعضو آخر عند فتح مراجعة جديدة
  useEffect(() => { setFeedback(''); }, [itemKey]);

  const member = item && members.find((candidate) => candidate.id === item.memberId);
  const memberName = member?.full_name ?? (item ? `عضو #${item.memberId}` : '');
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

  const accept = async () => {
    if (!item) return;
    try {
      const result = await approve.mutateAsync({ taskId: item.task.id, memberId: item.memberId, bonus });
      const awarded = result.bonusAwarded > 0 ? ` ومنحه ${formatSigned(result.bonusAwarded)} بونص` : '';
      const total = result.totalBonus !== null ? ` — إجمالي بونصه دلوقتي ${formatSigned(result.totalBonus)}` : '';
      toast.success(`اتعتمد تسليم ${memberName}${awarded}${total}.`);
      onClose();
    } catch (cause) { toast.error(handleSupabaseError(cause).message || 'معرفناش نعتمد التسليم — مفيش حاجة اتغيرت.'); }
  };
  const requestRevision = async () => {
    if (!item) return;
    const note = feedback.trim();
    if (!note) { toast.warning('اكتب للعضو إيه اللي محتاج يتعدل قبل ما تبعت.'); document.getElementById('task-review-feedback')?.focus(); return; }
    try {
      await revise.mutateAsync({ taskId: item.task.id, memberId: item.memberId, status: 'revision_requested', note, submissionUrl: entry?.submission_url ?? '', currentTracking: item.task.tracking ?? {} });
      toast.info(`اتبعت طلب التعديل لـ ${memberName}.`);
      onClose();
    } catch (cause) { toast.error(handleSupabaseError(cause).message || 'معرفناش نبعت طلب التعديل — مفيش حاجة اتغيرت.'); }
  };
  const revokeApproval = async () => {
    if (!item) return;
    const reason = feedback.trim();
    if (reason.length < 3) {
      toast.warning('اكتب سبب إلغاء الاعتماد عشان يتسجل في سجل العضو.');
      document.getElementById('task-review-feedback')?.focus();
      return;
    }
    try {
      const result = await revoke.mutateAsync({ taskId: item.task.id, memberId: item.memberId, reason });
      const points = result.rank_reversed ? ` واتخصم ${result.rank_reversed} نقطة` : '';
      const bonus = result.bonus_reversed ? ` واتشال بونص ${formatSigned(result.bonus_reversed)}` : '';
      toast.info(`اتلغى اعتماد ${memberName}${points}${bonus}، ورجع التسليم للعضو عشان يقدر يعيد إرساله.`);
      onClose();
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نلغي الاعتماد — مفيش حاجة اتغيرت.');
    }
  };

  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onClose}
      title={isApproved ? 'إلغاء اعتماد المهمة' : 'مراجعة تسليم المهمة'}
      subtitle={item?.task.title}
      icon={<ClipboardCheck size={20} />}
      maxWidth="lg"
      footer={item && (
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="hidden sm:inline-flex">إغلاق</Button>
          <div className={`grid gap-2 sm:flex ${isApproved ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {isApproved ? <Button variant="danger" onClick={() => void revokeApproval()} isLoading={revoke.isPending} loadingText="بنلغي الاعتماد..." disabled={feedback.trim().length < 3} icon={<RotateCcw size={16} />}>إلغاء الاعتماد</Button> : <>
              <Button variant="secondary" onClick={() => void requestRevision()} isLoading={revise.isPending} loadingText="بنبعت..." disabled={approve.isPending} icon={<RotateCcw size={16} />}>طلب تعديل</Button>
              <Button onClick={() => void accept()} isLoading={approve.isPending} loadingText="بنعتمد..." disabled={revise.isPending} icon={<CheckCircle2 size={17} />}>{bonus > 0 ? `اعتمد وادّي ${formatSigned(bonus)}` : 'اعتمد التسليم'}</Button>
            </>}
          </div>
        </div>
      )}
    >
      {item && (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg)] p-3">
            <span className="font-bold">العضو: <span className="text-[var(--link)]">{memberName}</span></span>
            {entry && <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_META[entry.status]?.tone ?? ''}`}>{STATUS_META[entry.status]?.label ?? entry.status}</span>}
          </div>
          {entry?.updated_at && <p className="text-xs text-[var(--text-muted)]">آخر تحديث: {formatDateTime(entry.updated_at)}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-xs font-bold text-[var(--text-muted)]">الموعد النهائي</p>
              <p className={`mt-0.5 font-bold ${submittedLate || (deadline && isOverdue(deadline) && entry?.status !== 'under_review') ? 'text-red-700 dark:text-red-300' : 'text-[var(--text)]'}`}>
                {deadline ? formatDeadline(deadline, { weekday: true }) : 'بدون موعد'}
              </p>
              {deadline && submittedAt && entry?.status === 'under_review' && (
                <p className={`mt-0.5 text-xs font-bold ${submittedLate ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{submittedLate ? 'اتسلّمت بعد الموعد' : 'اتسلّمت في الموعد'}</p>
              )}
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-200"><Gift size={13} aria-hidden="true" />بونص المهمة</p>
              <p className="mt-0.5 font-black tabular-nums text-amber-900 dark:text-amber-100">{bonus > 0 ? `${formatSigned(bonus)} بونص عند الاعتماد` : 'بدون بونص'}</p>
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
              <p className="mb-1 text-xs font-bold text-[var(--text-muted)]">{entry.approval_reversed_at && entry.status === 'revision_requested' ? 'سبب إلغاء الاعتماد' : entry.status === 'revision_requested' ? 'آخر ملاحظة تعديل من الإدارة' : 'ملاحظة العضو'}</p>
              <p className="whitespace-pre-line leading-7">{entry.note}</p>
            </div>
          )}
          {!hasSubmission && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 font-bold leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <Info size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              {isApproved ? 'التسليم اتعتمد من غير رابط أو ملاحظة.' : 'العضو لسه ما رفعش رابط أو ملاحظة. الاعتماد هيضيف له النقاط على طول.'}
            </p>
          )}
          {isApproved && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-6 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">إلغاء الاعتماد هيرجع المهمة للعضو عشان يقدر يعيد إرسالها، وهيعكس النقاط والبونص اللي اتمنحوا بسبب الاعتماد.</p>}
          <label htmlFor="task-review-feedback" className="grid gap-1.5 font-bold">
            {isApproved ? <>سبب إلغاء الاعتماد <span className="text-xs font-medium text-[var(--text-muted)]">(مطلوب، وبيتسجل في سجل العضو)</span></> : <>توجيهات التعديل <span className="text-xs font-medium text-[var(--text-muted)]">(مطلوبة عند طلب تعديل)</span></>}
            <textarea id="task-review-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} minLength={isApproved ? 3 : undefined} maxLength={isApproved ? 1000 : 2000} placeholder={isApproved ? 'اكتب ليه بتلغي الاعتماد.' : 'مثال: الصورة التانية محتاجة دقة أعلى، والنص محتاج مراجعة لغوية.'} className="min-h-24 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-base font-normal leading-7 placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]" />
          </label>
        </div>
      )}
    </Modal>
  );
}
