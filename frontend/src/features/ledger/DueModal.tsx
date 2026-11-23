import { useEffect, useId, useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerDue, LedgerDueDraft } from './types';
import type { EntryMemberOption } from './EntryModal';
export function DueModal({
  isOpen,
  due,
  members,
  onClose,
  onSubmit,
  isPending,
}: {
  isOpen: boolean;
  due?: LedgerDue | null;
  members: EntryMemberOption[];
  onClose: () => void;
  onSubmit: (draft: LedgerDueDraft) => Promise<void>;
  isPending: boolean;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [memberId, setMemberId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setMemberId(due ? String(due.member_id) : '');
    setLabel(due?.label ?? '');
    setAmount(due ? String(due.amount) : '');
    setDueOn(due?.due_on?.slice(0, 10) ?? '');
    setError(null);
  }, [isOpen, due]);
  const submit = async () => {
    setError(null);
    if (!memberId) {
      setError(t('اختار العضو.', 'Pick the member.'));
      return;
    }
    if (label.trim().length < 2) {
      setError(t('اكتب اسم الالتزام (اشتراك، رحلة، ...).', 'Name the due (subscription, trip, …).'));
      return;
    }
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      setError(t('اكتب مبلغ صحيح أكبر من صفر.', 'Enter a valid amount greater than zero.'));
      return;
    }
    try {
      await onSubmit({
        ...(due?.id ? { id: due.id } : {}),
        member_id: Number(memberId),
        label: label.trim(),
        amount: amount.trim(),
        due_on: dueOn || undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نحفظ الالتزام.', 'Could not save the due.'));
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('التزام على عضو', 'Member due')}
      subtitle={t('حدّد المطلوب من العضو وتاريخ الاستحقاق — النظام بيحسب فاضل كام ومين متأخر تلقائيًا.', 'Set what the member owes and when — the ledger calculates what remains and who is late.')}
      icon={<Target size={18} aria-hidden="true" />}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" form={formId} isLoading={isPending} loadingText={t('بيتحفظ…', 'Saving…')}>
            {t('حفظ', 'Save')}
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
          <span>{t('العضو', 'Member')}</span>
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            <option value="">{t('اختار العضو', 'Select member')}</option>
            {members.filter((member) => member.work_status !== 'left').map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? `#${member.id}`}{member.academic_number ? ` — ${member.academic_number}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="ldg-field">
          <span>{t('اسم الالتزام', 'Due label')}</span>
          <input type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('اشتراك التيم الشهري', 'Monthly team subscription')} maxLength={120} />
        </label>
        <label className="ldg-field">
          <span>{t('المبلغ (ج.م)', 'Amount (EGP)')}</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label className="ldg-field">
          <span>{t('تاريخ الاستحقاق (اختياري)', 'Due date (optional)')}</span>
          <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          <small>{t('بعد التاريخ ده العضو يتحسب متأخر لو لسه مدفعش.', 'After this date the member is flagged as late if still unpaid.')}</small>
        </label>
        {error && <p className="ldg-form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}