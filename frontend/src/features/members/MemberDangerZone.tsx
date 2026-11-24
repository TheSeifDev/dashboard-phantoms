import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import {
  DELETION_CONFIRM_WORDS,
  MEMBER_DELETION_REASON_MAX,
  MemberDeletionApiError,
  deletionConfirmationMatches,
  memberDeletionErrorMessage,
  useCancelMemberDeletion,
  useMemberDeletionState,
  useRequestMemberDeletion,
} from './member-deletion-api';

const FIELD_CLASS = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--primary-soft)] disabled:opacity-60';

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(date)
    : '—';
}

/**
 * منطقة الخطر في آخر صفحة الإعدادات: العضو يطلب حذف حسابه نهائيًا،
 * والطلب يوصل للأدمن للموافقة أو الرفض. الحذف الفعلي بيحصل بعد الموافقة بس.
 */
export function MemberDangerZone() {
  const { t, dir, locale } = useLocale();
  const stateQuery = useMemberDeletionState();
  const requestDeletion = useRequestMemberDeletion();
  const cancelDeletion = useCancelMemberDeletion();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const state = stateQuery.data ?? null;
  const pending = state?.status === 'pending';
  const approved = state?.status === 'approved';
  const rejected = state?.status === 'rejected';
  const busy = requestDeletion.isPending || cancelDeletion.isPending;
  const confirmWord = locale === 'ar' ? DELETION_CONFIRM_WORDS.ar : DELETION_CONFIRM_WORDS.en;
  const canSubmit = deletionConfirmationMatches(confirmation, locale) && !busy;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  const submit = async () => {
    if (!canSubmit) return;
    setError('');
    try {
      await requestDeletion.mutateAsync(reason);
      setOpen(false);
      setReason('');
      setConfirmation('');
      toast.success(t('تم إرسال طلبك للإدارة. هتوصلك النتيجة بعد المراجعة.', 'Your request was sent to the admins. You will see the result after review.'));
    } catch (caught) {
      setError(caught instanceof MemberDeletionApiError
        ? memberDeletionErrorMessage(caught.code, locale)
        : t('تعذّر إرسال الطلب. حاول مرة أخرى.', 'Could not send the request. Try again.'));
    }
  };

  const cancel = async () => {
    setError('');
    try {
      await cancelDeletion.mutateAsync();
      toast.success(t('تم إلغاء طلب الحذف.', 'Deletion request cancelled.'));
    } catch (caught) {
      setError(caught instanceof MemberDeletionApiError
        ? memberDeletionErrorMessage(caught.code, locale)
        : t('تعذّر إلغاء الطلب. حاول مرة أخرى.', 'Could not cancel the request. Try again.'));
    }
  };

  return (
    <section id="delete-account" dir={dir} aria-labelledby="member-danger-title" className="grid gap-3 rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--surface)] text-[var(--danger-text)]" aria-hidden="true"><ShieldAlert size={18} /></span>
        <div className="min-w-0">
          <h2 id="member-danger-title" className="text-sm font-black text-[var(--danger-text)]">{t('حذف الحساب نهائيًا', 'Delete account permanently')}</h2>
          <p className="mt-0.5 text-xs leading-5 text-[var(--text-2)]">
            {t('لو مش عايز تكمل معانا، ابعت طلب حذف. الطلب بيوصل للإدارة للموافقة، وبعد الموافقة بنحذف حسابك وبياناتك من اللوحة نهائيًا ومش بنقدر نرجّعها.', 'If you want to leave, send a deletion request. It goes to the admins for approval; once approved, your account and dashboard data are deleted permanently and cannot be restored.')}
          </p>
        </div>
      </div>

      {stateQuery.isPending && <p className="text-xs font-medium text-[var(--text-muted)]">{t('بنراجع حالة طلباتك...', 'Checking your requests...')}</p>}

      {pending && (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="m-0 text-xs font-bold text-[var(--text)]" role="status">
            {t(`طلبك في انتظار مراجعة الإدارة (أُرسل ${formatDate(state.requestedAt, locale)}).`, `Your request is waiting for admin review (sent ${formatDate(state.requestedAt, locale)}).`)}
          </p>
          <p className="m-0 text-[11px] leading-5 text-[var(--text-muted)]">{t('لو غيّرت رأيك، الغِ الطلب وهنمسحه من قائمة المراجعة.', 'If you changed your mind, cancel it and it leaves the review queue.')}</p>
          <div className="flex justify-start">
            <Button variant="secondary" icon={<Undo2 size={16} aria-hidden="true" />} isLoading={cancelDeletion.isPending} loadingText={t('بنلغي الطلب...', 'Cancelling...')} onClick={() => { void cancel(); }}>
              {t('إلغاء طلب الحذف', 'Cancel deletion request')}
            </Button>
          </div>
        </div>
      )}

      {approved && (
        <p className="m-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs font-bold text-[var(--text)]" role="status">
          {t('الإدارة وافقت على طلبك وجاري تنفيذ الحذف. الحساب هيتقفل نهائيًا بعد لحظات.', 'An admin approved your request and deletion is running. Your account will be closed permanently shortly.')}
        </p>
      )}

      {rejected && state && (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="m-0 text-xs font-bold text-[var(--text)]" role="status">
            {t(`الإدارة رفضت طلب الحذف${state.decidedAt ? ` (${formatDate(state.decidedAt, locale)})` : ''}. حسابك شغال عادي.`, `An admin rejected the deletion request${state.decidedAt ? ` (${formatDate(state.decidedAt, locale)})` : ''}. Your account is still active.`)}
          </p>
          {state.decisionNote && (
            <p className="m-0 rounded-lg bg-[var(--surface-2,var(--surface))] p-2 text-[11px] leading-5 text-[var(--text-2)]">{t('سبب الرفض: ', 'Reason: ')}{state.decisionNote}</p>
          )}
          <p className="m-0 text-[11px] leading-5 text-[var(--text-muted)]">{t('لو لسه عايز تحذف حسابك، ابعت طلب جديد ووضّح السبب.', 'If you still want to delete your account, send a new request and explain why.')}</p>
        </div>
      )}

      {error && <p className="m-0 rounded-lg border border-[var(--danger-border)] bg-[var(--surface)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{error}</p>}

      {!pending && !approved && (
        <div className="flex justify-start">
          <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => { setError(''); setOpen(true); }}>
            {rejected ? t('إرسال طلب حذف جديد', 'Send a new deletion request') : t('حذف حسابي نهائيًا', 'Delete my account permanently')}
          </Button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="member-danger-dialog-title" tabIndex={-1} dir={dir} className="w-full max-w-[460px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl outline-none">
            <div className="flex items-start gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger-text)]" aria-hidden="true"><AlertTriangle size={18} /></span>
              <div className="min-w-0">
                <h3 id="member-danger-dialog-title" className="m-0 text-sm font-black text-[var(--text)]">{t('تأكيد طلب حذف الحساب', 'Confirm account deletion request')}</h3>
                <p className="mt-1 mb-0 text-xs leading-5 text-[var(--text-2)]">
                  {t('الطلب مش بيحذف حاجة على طول. الإدارة بتراجعه، ولو وافقت بيتحذف حسابك وبياناتك (المهام، الإشعارات، العضويات، ملفاتك) نهائيًا.', 'This does not delete anything right away. Admins review it; if approved, your account and data (tasks, announcements, memberships, your files) are removed permanently.')}
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-deletion-reason">
                {t('سبب الحذف (اختياري)', 'Reason (optional)')}
                <textarea id="member-deletion-reason" value={reason} maxLength={MEMBER_DELETION_REASON_MAX} rows={3} onChange={(event) => setReason(event.target.value)} className={FIELD_CLASS} disabled={busy} placeholder={t('مثال: مش هقدر أكمل مع الفريق حاليًا', 'For example: I cannot continue with the team right now')} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-deletion-confirm">
                {t(`اكتب كلمة «${confirmWord}» للتأكيد`, `Type "${confirmWord}" to confirm`)}
                <input id="member-deletion-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={FIELD_CLASS} dir={locale === 'ar' ? 'rtl' : 'ltr'} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} />
              </label>
              {error && <p className="m-0 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{error}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t('رجوع', 'Back')}</Button>
                <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} disabled={!canSubmit} isLoading={requestDeletion.isPending} loadingText={t('بنرسل الطلب...', 'Sending...')} onClick={() => { void submit(); }}>
                  {t('تأكيد وإرسال الطلب', 'Confirm and send request')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default MemberDangerZone;
