import { useEffect, useId, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import { formatDate } from '../../lib/dateUtils';
import type { LedgerEntry } from './types';
import { money } from './types';
export function DecideModal({
  entry,
  onClose,
  onSubmit,
  isPending,
}: {
  entry: LedgerEntry | null;
  onClose: () => void;
  onSubmit: (payload: { id: number; decision: 'approve' | 'reject'; note?: string; amount?: number | null }) => Promise<void>;
  isPending: boolean;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) return;
    setDecision('approve');
    setAmount(String(entry.amount));
    setNote('');
    setError(null);
  }, [entry]);
  const submit = async () => {
    if (!entry) return;
    setError(null);
    const corrected = Number(amount);
    if (decision === 'approve' && (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount.trim()) || corrected <= 0)) {
      setError(t('المبلغ لازم يكون رقم أكبر من صفر.', 'The amount must be a number greater than zero.'));
      return;
    }
    try {
      await onSubmit({
        id: entry.id,
        decision,
        note: note.trim() || undefined,
        amount: decision === 'approve' && corrected !== entry.amount ? corrected : null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نسجّل القرار.', 'Could not record the decision.'));
    }
  };
  return (
    <Modal
      isOpen={entry !== null}
      onClose={onClose}
      title={t('مراجعة الدفعة', 'Review payment')}
      subtitle={t('أكّد المبلغ اللي وصل فعلًا — تقدر تصحّحه لو مش مطابق — أو ارفضها بملاحظة توضح السبب.', 'Confirm the amount actually received — correct it if needed — or reject with a note.')}
      icon={<CheckCircle2 size={18} aria-hidden="true" />}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>{t('إغلاق', 'Close')}</Button>
          <Button
            type="submit"
            form={formId}
            variant={decision === 'reject' ? 'danger' : 'primary'}
            isLoading={isPending}
            loadingText={t('بيتحفظ…', 'Saving…')}
          >
            {decision === 'approve' ? t('تأكيد الدفعة', 'Approve payment') : t('رفض الدفعة', 'Reject payment')}
          </Button>
        </>
      }
    >
      {entry && (
        <form
          id={formId}
          className="ldg-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <dl className="ldg-review">
            <div><dt>{t('العضو', 'Member')}</dt><dd>{entry.member_name ?? '—'}</dd></div>
            <div><dt>{t('المستلم', 'Receiver')}</dt><dd>{entry.receiver_label ?? '—'}{entry.receiver_email ? ` · ${entry.receiver_email}` : ''}</dd></div>
            <div><dt>{t('المبلغ المسجّل', 'Declared amount')}</dt><dd>{money(entry.amount)}</dd></div>
            <div><dt>{t('التاريخ', 'Date')}</dt><dd>{formatDate(entry.occurred_on)}</dd></div>
            {entry.note && <div><dt>{t('ملاحظة العضو', 'Member note')}</dt><dd>{entry.note}</dd></div>}
          </dl>
          <div className="ldg-decision" role="group" aria-label={t('القرار', 'Decision')}>
            <button
              type="button"
              className="ldg-decision-btn"
              aria-pressed={decision === 'approve'}
              onClick={() => setDecision('approve')}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {t('موافق', 'Approve')}
            </button>
            <button
              type="button"
              className="ldg-decision-btn ldg-decision-btn--reject"
              aria-pressed={decision === 'reject'}
              onClick={() => setDecision('reject')}
            >
              <XCircle size={16} aria-hidden="true" />
              {t('مرفوض', 'Reject')}
            </button>
          </div>
          {decision === 'approve' && (
            <label className="ldg-field">
              <span>{t('المبلغ الصحيح (تعديل)', 'Correct amount (edit)')}</span>
              <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              <small>{t('لو المبلغ اللي وصل مختلف، عدّله هنا قبل التأكيد.', 'If the received amount differs, adjust it before approving.')}</small>
            </label>
          )}
          <label className="ldg-field">
            <span>{t('ملاحظة القرار (اختياري)', 'Decision note (optional)')}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={400} />
          </label>
          {error && <p className="ldg-form-error" role="alert">{error}</p>}
        </form>
      )}
    </Modal>
  );
}