import { useEffect, useId, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerPaymentDraft, LedgerReceiver, MemberLedgerDue } from './types';
import { money, todayIso } from './types';
export function PayModal({
  isOpen,
  receivers,
  dues,
  remaining,
  onClose,
  onSubmit,
  isPending,
}: {
  isOpen: boolean;
  receivers: LedgerReceiver[];
  dues: MemberLedgerDue[];
  remaining: number;
  onClose: () => void;
  onSubmit: (draft: LedgerPaymentDraft) => Promise<void>;
  isPending: boolean;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [amount, setAmount] = useState('');
  const [receiver, setReceiver] = useState('');
  const [dueId, setDueId] = useState('');
  const [note, setNote] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setAmount(remaining > 0 ? String(remaining) : '');
    setReceiver(receivers[0]?.user_id ?? '');
    setDueId('');
    setNote('');
    setOccurredOn(todayIso());
    setError(null);
  }, [isOpen, receivers, remaining]);
  const submit = async () => {
    setError(null);
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      setError(t('اكتب مبلغ صحيح أكبر من صفر.', 'Enter a valid amount greater than zero.'));
      return;
    }
    if (!receiver) {
      setError(t('اختار دفعت لمين.', 'Pick who received the payment.'));
      return;
    }
    try {
      await onSubmit({
        amount: amount.trim(),
        receiver_user_id: receiver,
        due_id: dueId ? Number(dueId) : null,
        note: note.trim() || undefined,
        occurred_on: occurredOn,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نسجّل الدفعة.', 'Could not record the payment.'));
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('أنا دفعت', 'I paid')}
      subtitle={t('سجّل المبلغ اللي دفعته واختار استلم من مين — الدفعة تفضل «مستنية تأكيد» لحد ما المستلم يوافق عليها.', 'Record what you paid and who received it — it stays pending until the receiver approves.')}
      icon={<HandCoins size={18} aria-hidden="true" />}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" form={formId} isLoading={isPending} loadingText={t('بيتسجل…', 'Saving…')}>
            {t('تسجيل الدفعة', 'Record payment')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="ldg-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="ldg-field">
          <span>{t('المبلغ (ج.م)', 'Amount (EGP)')}</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" autoFocus />
          {remaining > 0 && <small>{t('المتبقي عليك', 'Remaining for you')}: {money(remaining)}</small>}
        </label>
        <label className="ldg-field">
          <span>{t('دفعت لمين', 'Paid to')}</span>
          <select value={receiver} onChange={(event) => setReceiver(event.target.value)}>
            <option value="">{t('اختار المستلم', 'Select receiver')}</option>
            {receivers.map((item) => (
              <option key={item.user_id} value={item.user_id}>{item.display_name} — {item.label}</option>
            ))}
          </select>
        </label>
        {dues.length > 0 && (
          <label className="ldg-field">
            <span>{t('الدفعة دي على أنهي التزام؟ (اختياري)', 'Which due is this for? (optional)')}</span>
            <select value={dueId} onChange={(event) => setDueId(event.target.value)}>
              <option value="">{t('دفعة عامة', 'General payment')}</option>
              {dues.map((due) => (
                <option key={due.id} value={due.id}>{due.label} — {money(due.amount)}</option>
              ))}
            </select>
          </label>
        )}
        <label className="ldg-field">
          <span>{t('التاريخ', 'Date')}</span>
          <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
        </label>
        <label className="ldg-field">
          <span>{t('ملاحظة (اختياري)', 'Note (optional)')}</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={400} placeholder={t('مثال: تحويل فودافون كاش', 'e.g. Vodafone Cash transfer')} />
        </label>
        {error && <p className="ldg-form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}