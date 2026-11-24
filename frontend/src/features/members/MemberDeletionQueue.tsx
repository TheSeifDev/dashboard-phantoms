import { useState } from 'react';
import { CheckCircle2, ShieldX, Trash2, UserRoundX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import {
  MemberDeletionApiError,
  memberDeletionErrorMessage,
  useApproveMemberDeletion,
  useMemberDeletionRequests,
  useRejectMemberDeletion,
} from './member-deletion-api';
import type { MemberDeletionRequestRecord } from './member-deletion-api';

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(date)
    : '—';
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100',
  approved: 'border-[var(--border)] bg-[var(--primary-soft)] text-[var(--text)]',
  rejected: 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)]',
};

/** طابور مراجعة طلبات حذف الحساب: الأدمن يوافق (حذف نهائي) أو يرفض بسبب. */
export function MemberDeletionQueue() {
  const { t, dir, locale } = useLocale();
  const requestsQuery = useMemberDeletionRequests();
  const approve = useApproveMemberDeletion();
  const reject = useRejectMemberDeletion();
  const [approveTarget, setApproveTarget] = useState<MemberDeletionRequestRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<MemberDeletionRequestRecord | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [actionError, setActionError] = useState('');

  const requests = requestsQuery.data ?? [];
  const pendingCount = requests.filter((row) => row.status === 'pending').length;

  const confirmApprove = async () => {
    if (!approveTarget) return;
    setActionError('');
    try {
      const result = await approve.mutateAsync({ requestId: approveTarget.requestId });
      toast.success(t(
        `اتحذف حساب ${result.memberName || approveTarget.memberName} نهائيًا (${result.deletedRows} صف بيانات${result.removedObjects ? ` و${result.removedObjects} ملف` : ''}).`,
        `${result.memberName || approveTarget.memberName} was deleted permanently (${result.deletedRows} data rows${result.removedObjects ? ` and ${result.removedObjects} files` : ''}).`,
      ));
      setApproveTarget(null);
    } catch (caught) {
      setActionError(caught instanceof MemberDeletionApiError
        ? memberDeletionErrorMessage(caught.code, locale)
        : t('تعذّر تنفيذ الحذف. حاول مرة أخرى.', 'Deletion could not run. Try again.'));
    }
  };

  const retryApprove = async (row: MemberDeletionRequestRecord) => {
    setActionError('');
    try {
      await approve.mutateAsync({ requestId: row.requestId, retry: true });
      toast.success(t('اكتمل حذف الحساب.', 'Account deletion completed.'));
    } catch (caught) {
      setActionError(caught instanceof MemberDeletionApiError
        ? memberDeletionErrorMessage(caught.code, locale)
        : t('تعذّر إكمال الحذف. حاول مرة أخرى.', 'Could not finish the deletion. Try again.'));
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    setActionError('');
    try {
      await reject.mutateAsync({ requestId: rejectTarget.requestId, note: rejectNote });
      toast.success(t('تم رفض طلب الحذف وإبلاغ العضو بالسبب.', 'Deletion request rejected and the member can see the reason.'));
      setRejectTarget(null);
      setRejectNote('');
    } catch (caught) {
      setActionError(caught instanceof MemberDeletionApiError
        ? memberDeletionErrorMessage(caught.code, locale)
        : t('تعذّر رفض الطلب. حاول مرة أخرى.', 'Could not reject the request. Try again.'));
    }
  };

  if (requestsQuery.isPending) {
    return <div className="member-dir-console-note" role="status">{t('بنراجع طلبات حذف الحساب...', 'Loading account deletion requests...')}</div>;
  }
  if (requestsQuery.isError) {
    return <ErrorState message={t('تعذّر تحميل طلبات حذف الحساب.', 'Account deletion requests could not be loaded.')} onRetry={() => { void requestsQuery.refetch(); }} />;
  }
  if (requests.length === 0) return null;

  return (
    <section dir={dir} aria-labelledby="member-deletion-queue-title" className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="member-deletion-queue-title" className="m-0 flex items-center gap-2 text-sm font-black text-[var(--text)]">
          <UserRoundX size={17} aria-hidden="true" />
          {t('طلبات حذف الحساب', 'Account deletion requests')}
        </h3>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--text-2)]">
          {t(`${pendingCount} في الانتظار`, `${pendingCount} pending`)}
        </span>
      </div>
      <p className="m-0 text-[11px] leading-5 text-[var(--text-muted)]">
        {t('الموافقة بتحذف العضو من كل سجلات اللوحة (المهام، الإشعارات، العضويات، استخدام التطبيق، ملفاته) وبتقفل حساب الدخول نهائيًا. الرفض بيوقف الحذف وبيوصل السبب للعضو.', 'Approving removes the member from every dashboard record (tasks, announcements, memberships, app usage, files) and closes the sign-in account permanently. Rejecting stops the deletion and shows your reason to the member.')}
      </p>

      {actionError && <p className="m-0 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{actionError}</p>}

      <ul className="m-0 grid list-none gap-2 p-0">
        {requests.map((row) => (
          <li key={row.requestId} className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2,var(--surface))] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-[var(--text)]">{row.memberName}</p>
                <p className="m-0 text-[11px] font-medium text-[var(--text-muted)]" dir="ltr">{row.memberEmail}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[row.status] ?? 'border-[var(--border)] text-[var(--text-2)]'}`}>
                {row.status === 'pending' ? t('في الانتظار', 'Pending')
                  : row.status === 'approved' ? t('معتمد — جاري التنفيذ', 'Approved — running')
                    : t('مرفوض', 'Rejected')}
              </span>
            </div>
            <p className="m-0 text-[11px] leading-5 text-[var(--text-2)]">
              {t('اتطلب في ', 'Requested ')}{formatDate(row.requestedAt, locale)}
              {row.memberReason ? ` — ${t('السبب: ', 'Reason: ')}${row.memberReason}` : ''}
              {row.decisionNote ? ` — ${t('ملاحظة الرفض: ', 'Rejection note: ')}${row.decisionNote}` : ''}
            </p>
            {row.status === 'pending' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => { setActionError(''); setApproveTarget(row); }}>
                  {t('موافقة وحذف نهائي', 'Approve and delete')}
                </Button>
                <Button variant="secondary" icon={<ShieldX size={15} aria-hidden="true" />} onClick={() => { setActionError(''); setRejectTarget(row); setRejectNote(''); }}>
                  {t('رفض الطلب', 'Reject request')}
                </Button>
              </div>
            )}
            {row.status === 'approved' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" icon={<CheckCircle2 size={15} aria-hidden="true" />} isLoading={approve.isPending} loadingText={t('بنكمل الحذف...', 'Finishing...')} onClick={() => { void retryApprove(row); }}>
                  {t('إعادة المحاولة لإكمال الحذف', 'Retry to finish deletion')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        isOpen={Boolean(approveTarget)}
        onClose={() => setApproveTarget(null)}
        onConfirm={() => { void confirmApprove(); }}
        title={t('تأكيد الحذف النهائي', 'Confirm permanent deletion')}
        itemName={approveTarget?.memberName}
        description={t('هيتحذف العضو من كل سجلات اللوحة، وتتحذف ملفاته، ويتقفل حسابه نهائيًا. الإجراء ده مش قابل للتراجع.', 'The member will be removed from every dashboard record, their files deleted, and their account closed permanently. This cannot be undone.')}
        confirmLabel={t('حذف نهائي', 'Delete permanently')}
        isPending={approve.isPending}
        pendingLabel={t('بنحذف...', 'Deleting...')}
      />

      {rejectTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !reject.isPending) setRejectTarget(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="member-deletion-reject-title" dir={dir} className="w-full max-w-[440px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
            <h3 id="member-deletion-reject-title" className="m-0 text-sm font-black text-[var(--text)]">{t('رفض طلب حذف الحساب', 'Reject the deletion request')}</h3>
            <p className="mt-1 mb-0 text-xs leading-5 text-[var(--text-2)]">{rejectTarget.memberName}</p>
            <label className="mt-3 grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-deletion-reject-note">
              {t('سبب الرفض (بيظهر للعضو)', 'Rejection reason (shown to the member)')}
              <textarea id="member-deletion-reject-note" rows={3} maxLength={1000} value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--primary-soft)]" disabled={reject.isPending} />
            </label>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={reject.isPending}>{t('رجوع', 'Back')}</Button>
              <Button variant="secondary" icon={<ShieldX size={15} aria-hidden="true" />} isLoading={reject.isPending} loadingText={t('بنرفض...', 'Rejecting...')} onClick={() => { void submitReject(); }}>
                {t('تأكيد الرفض', 'Confirm rejection')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default MemberDeletionQueue;
