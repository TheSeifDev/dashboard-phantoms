import { useEffect, useId, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Receipt, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerEntry, LedgerEntryDraft, LedgerExpenseCategory, LedgerKind, LedgerReceiver } from './types';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER, todayIso } from './types';
export interface EntryMemberOption {
  id: number;
  full_name: string | null;
  academic_number?: string | null;
  work_status?: string | null;
}
const KIND_META: Record<LedgerKind, { title: [string, string]; icon: typeof Wallet; hint: [string, string] }> = {
  payment: {
    title: ['تسجيل دفعة', 'Record a payment'],
    icon: ArrowDownLeft,
    hint: ['بتتسجل مؤكدة على طول لأنك الإدارة. العضو نفسه بيسجّل دفعة وتفضل مستنية تأكيد المستلم.', 'Recorded as approved because you are an admin. Member-submitted payments stay pending until the receiver confirms.'],
  },
  expense: {
    title: ['مصروف جديد', 'New expense'],
    icon: Receipt,
    hint: ['اكتب المصروف اتصرف في إيه — ده اللي التيم كله بيشوفه في ملخص الخزنة.', 'Describe what the money was spent on — the whole team sees this in the ledger summary.'],
  },
  withdrawal: {
    title: ['خصم / سحب عضو', 'Member withdrawal'],
    icon: ArrowUpRight,
    hint: ['لما عضو ياخد من فلوس التيم لنفسه بتتسجل خصم على الخزنة، والسبب اختياري.', 'When a member takes team money for himself it is recorded as a deduction; the reason is optional.'],
  },
};
export function EntryModal({
  isOpen,
  kind,
  teamId,
  entry,
  members,
  receivers,
  onClose,
  onSubmit,
  isPending,
}: {
  isOpen: boolean;
  kind: LedgerKind;
  teamId: string;
  entry?: LedgerEntry | null;
  members: EntryMemberOption[];
  receivers: LedgerReceiver[];
  onClose: () => void;
  onSubmit: (draft: LedgerEntryDraft) => Promise<void>;
  isPending: boolean;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [amount, setAmount] = useState('');
  const [memberId, setMemberId] = useState('');
  const [receiver, setReceiver] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LedgerExpenseCategory>('other');
  const [note, setNote] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setAmount(entry ? String(entry.amount) : '');
    setMemberId(entry?.member_id ? String(entry.member_id) : '');
    setReceiver(entry?.receiver_user_id ?? receivers[0]?.user_id ?? '');
    setTitle(entry?.title ?? '');
    setCategory(entry?.category ?? 'other');
    setNote(entry?.note ?? '');
    setOccurredOn(entry?.occurred_on?.slice(0, 10) ?? todayIso());
    setError(null);
  }, [isOpen, entry, receivers]);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const submit = async () => {
    setError(null);
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) {
      setError(t('اكتب مبلغ صحيح أكبر من صفر.', 'Enter a valid amount greater than zero.'));
      return;
    }
    if (kind !== 'expense' && !memberId) {
      setError(t('اختار العضو.', 'Pick the member.'));
      return;
    }
    if (kind === 'payment' && !receiver) {
      setError(t('اختار دفعت لمين.', 'Pick who received the payment.'));
      return;
    }
    if (kind === 'expense' && title.trim().length < 2) {
      setError(t('اكتب المصروف اتصرف في إيه.', 'Describe what the money was spent on.'));
      return;
    }
    const draft: LedgerEntryDraft = {
      kind,
      amount: amount.trim(),
      note: note.trim() || undefined,
      occurred_on: occurredOn,
      ...(kind === 'expense'
        ? { title: title.trim(), category }
        : { member_id: Number(memberId) }),
      ...(kind === 'payment' ? { receiver_user_id: receiver } : {}),
      ...(entry?.id ? { id: entry.id } : {}),
    };
    try {
      await onSubmit(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نحفظ الحركة.', 'Could not save the entry.'));
    }
  };
  const activeMembers = members.filter((member) => member.work_status !== 'left');
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(meta.title[0], meta.title[1])}
      subtitle={t(meta.hint[0], meta.hint[1])}
      icon={<Icon size={18} aria-hidden="true" />}
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
          <span>{t('المبلغ (ج.م)', 'Amount (EGP)')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            autoFocus
          />
        </label>
        {kind === 'expense' ? (
          <>
            <label className="ldg-field">
              <span>{t('اتصرف في إيه؟', 'What was it spent on?')}</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('مثال: رخصة سوفتوير للتيم', 'e.g. team software licence')}
                maxLength={160}
              />
            </label>
            <label className="ldg-field">
              <span>{t('التصنيف', 'Category')}</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as LedgerExpenseCategory)}>
                {EXPENSE_CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>{EXPENSE_CATEGORY_LABELS[value]}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="ldg-field">
            <span>{kind === 'payment' ? t('مين اللي دفع', 'Who paid') : t('مين اللي سحب', 'Who withdrew')}</span>
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
              <option value="">{t('اختار العضو', 'Select member')}</option>
              {activeMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name ?? `#${member.id}`}{member.academic_number ? ` — ${member.academic_number}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'payment' && (
          <label className="ldg-field">
            <span>{t('دفع لمين', 'Paid to')}</span>
            <select value={receiver} onChange={(event) => setReceiver(event.target.value)}>
              <option value="">{t('اختار المستلم', 'Select receiver')}</option>
              {receivers.map((item) => (
                <option key={item.user_id} value={item.user_id}>
                  {item.display_name} — {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ldg-field">
          <span>{t('التاريخ', 'Date')}</span>
          <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
        </label>
        <label className="ldg-field">
          <span>{kind === 'withdrawal' ? t('السبب (اختياري)', 'Reason (optional)') : t('ملاحظة (اختياري)', 'Note (optional)')}</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={400} />
        </label>
        {error && <p className="ldg-form-error" role="alert">{error}</p>}
        <input type="hidden" value={teamId} readOnly />
      </form>
    </Modal>
  );
}