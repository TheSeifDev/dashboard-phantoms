import { useEffect, useId, useMemo, useState } from 'react';
import { Check, Search, Target, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerDue, LedgerDueBulkDraft, LedgerDueDraft, LedgerDueMode } from './types';
import { money } from './types';
import type { EntryMemberOption } from './EntryModal';

const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;

function parseAmount(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!AMOUNT_PATTERN.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * الزام على عضو واحد (تعديل) أو على مجموعة أعضاء (إنشاء):
 * بيدخل المبلغ الإجمالي مرة واحدة فيتقسم، أو المبلغ للفرد فيتحسب الإجمالي.
 */
export function DueModal({
  isOpen,
  due,
  members,
  presetMemberId,
  onClose,
  onSubmit,
  onSubmitBulk,
  isPending,
}: {
  isOpen: boolean;
  due?: LedgerDue | null;
  members: EntryMemberOption[];
  presetMemberId?: number;
  onClose: () => void;
  onSubmit: (draft: LedgerDueDraft) => Promise<void>;
  onSubmitBulk: (draft: LedgerDueBulkDraft) => Promise<void>;
  isPending: boolean;
}) {
  const { t } = useLocale();
  const formId = useId();
  const editing = Boolean(due?.id);
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<LedgerDueMode>('total');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLabel(due?.label ?? '');
    setMode('total');
    setAmount(due ? String(due.amount) : '');
    setDueOn(due?.due_on?.slice(0, 10) ?? '');
    setSelected(due?.member_id ? [due.member_id] : presetMemberId ? [presetMemberId] : []);
    setQuery('');
    setError(null);
  }, [isOpen, due, presetMemberId]);

  const active = useMemo(
    () => members.filter((member) => member.work_status !== 'left'),
    [members],
  );
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (needle
      ? active.filter((member) => [member.full_name, member.academic_number, member.unit]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)))
      : active),
    [active, needle],
  );

  const amountValue = parseAmount(amount);
  const count = selected.length;
  const perMember = mode === 'total' ? (count > 0 ? amountValue / count : 0) : amountValue;
  const total = mode === 'total' ? amountValue : amountValue * count;

  const toggle = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };
  const selectAllVisible = () => {
    setSelected((current) => Array.from(new Set([...current, ...visible.map((member) => member.id)])));
  };

  const submit = async () => {
    setError(null);
    if (label.trim().length < 2) {
      setError(t('اكتب اسم الالتزام (اشتراك، رحلة، ...).', 'Name the due (subscription, trip, …).'));
      return;
    }
    if (!AMOUNT_PATTERN.test(amount.trim().replace(',', '.')) || amountValue <= 0) {
      setError(t('اكتب مبلغ صحيح أكبر من صفر.', 'Enter a valid amount greater than zero.'));
      return;
    }
    if (count === 0) {
      setError(t('اختار عضو واحد على الأقل.', 'Pick at least one member.'));
      return;
    }
    if (mode === 'total' && perMember < 0.01) {
      setError(t('المبلغ صغير جدًا على عدد الأعضاء ده.', 'The amount is too small for this many members.'));
      return;
    }
    try {
      if (editing && due?.id) {
        await onSubmit({
          id: due.id,
          member_id: selected[0] ?? null,
          label: label.trim(),
          amount: amount.trim(),
          due_on: dueOn || undefined,
        });
        return;
      }
      await onSubmitBulk({
        label: label.trim(),
        mode,
        amount: amount.trim(),
        member_ids: selected,
        due_on: dueOn || undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نحفظ الالتزام.', 'Could not save the due.'));
    }
  };

  const submitLabel = editing
    ? t('حفظ التعديل', 'Save changes')
    : count > 0
      ? t(`إضافة الالتزام لـ ${count} عضو`, `Add the due for ${count} members`)
      : t('إضافة الالتزام', 'Add the due');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="2xl"
      title={editing ? t('تعديل الالتزام', 'Edit due') : t('التزام على الأعضاء', 'Due for members')}
      subtitle={t(
        'اكتب المبلغ الإجمالي ويتقسم على المختارين، أو اكتب المبلغ للفرد ويتحسب الإجمالي — الحساب بيتم في السيرفر.',
        'Enter the total and it splits across the selected members, or enter the per-member amount and the total is calculated — the math runs on the server.',
      )}
      icon={<Target size={18} aria-hidden="true" />}
      footer={
        <div className="ldg-due-footer">
          <div className="ldg-due-footer-sum">
            <span>{count > 0 ? `${count} ${t('عضو', 'members')}` : t('مفيش أعضاء مختارين', 'No members picked')}</span>
            <strong>{money(total)}</strong>
            {count > 0 && <small>{money(perMember)} {t('للفرد', 'each')}</small>}
          </div>
          <div className="ldg-due-footer-actions">
            <Button variant="secondary" type="button" onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
            <Button type="submit" form={formId} isLoading={isPending} loadingText={t('بيتحفظ…', 'Saving…')}>
              {submitLabel}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="ldg-due"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <section className="ldg-due-step">
          <header className="ldg-due-step-head">
            <span className="ldg-due-step-num">1</span>
            <div>
              <strong>{t('اسم الالتزام', 'Due label')}</strong>
              <small>{t('الاسم ده هو اللي هيظهر لكل عضو في خزانته.', 'This label shows for every member on their ledger.')}</small>
            </div>
          </header>
          <input
            className="ldg-input"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t('اشتراك التيم الشهري', 'Monthly team subscription')}
            maxLength={120}
          />
        </section>

        <section className="ldg-due-step">
          <header className="ldg-due-step-head">
            <span className="ldg-due-step-num">2</span>
            <div>
              <strong>{t('طريقة الحساب', 'How to split it')}</strong>
              <small>{t('اختار إنت بتعرف إجمالي ولا نصيب الفرد.', 'Pick whether you know the total or the per-member share.')}</small>
            </div>
          </header>
          {editing ? (
            <label className="ldg-field">
              <span>{t('العضو', 'Member')}</span>
              <select
                value={selected[0] ? String(selected[0]) : ''}
                onChange={(event) => setSelected(event.target.value ? [Number(event.target.value)] : [])}
              >
                <option value="">{t('اختار العضو', 'Select member')}</option>
                {active.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name ?? `#${member.id}`}{member.academic_number ? ` — ${member.academic_number}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="ldg-mode" role="group" aria-label={t('طريقة حساب الالتزام', 'Due calculation mode')}>
              <button
                type="button"
                className="ldg-mode-card"
                aria-pressed={mode === 'total'}
                onClick={() => setMode('total')}
              >
                <span className="ldg-mode-title">{t('إجمالي على المجموعة', 'Total for the group')}</span>
                <span className="ldg-mode-hint">
                  {t('مثال: تكتب 3,500 فيتقسم على المختارين.', 'e.g. type 3,500 and it splits across the selected members.')}
                </span>
                <span className="ldg-mode-sample" dir="ltr">3,500 ÷ 35 = 100</span>
              </button>
              <button
                type="button"
                className="ldg-mode-card"
                aria-pressed={mode === 'per_member'}
                onClick={() => setMode('per_member')}
              >
                <span className="ldg-mode-title">{t('مبلغ لكل عضو', 'Amount per member')}</span>
                <span className="ldg-mode-hint">
                  {t('مثال: تكتب 100 فيتحسب الإجمالي لوحده.', 'e.g. type 100 and the total is calculated for you.')}
                </span>
                <span className="ldg-mode-sample" dir="ltr">100 × 35 = 3,500</span>
              </button>
            </div>
          )}
        </section>

        <section className="ldg-due-step">
          <header className="ldg-due-step-head">
            <span className="ldg-due-step-num">3</span>
            <div>
              <strong>{mode === 'total' ? t('المبلغ الإجمالي', 'Total amount') : t('المبلغ لكل عضو', 'Amount per member')}</strong>
              <small>{t('الأرقام بتتحسب وأنت بتكتب.', 'The numbers update while you type.')}</small>
            </div>
          </header>
          <label className="ldg-amount">
            <span className="ldg-amount-unit">{t('ج.م', 'EGP')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              aria-label={mode === 'total' ? t('المبلغ الإجمالي', 'Total amount') : t('المبلغ لكل عضو', 'Amount per member')}
            />
          </label>
          <div className="ldg-calc" data-mode={mode}>
            <div className="ldg-calc-cell">
              <span>{t('لكل عضو', 'Per member')}</span>
              <strong>{money(perMember)}</strong>
            </div>
            <span className="ldg-calc-op" aria-hidden="true">{mode === 'total' ? '÷' : '×'}</span>
            <div className="ldg-calc-cell">
              <span>{t('عدد الأعضاء', 'Members')}</span>
              <strong>{count}</strong>
            </div>
            <span className="ldg-calc-op" aria-hidden="true">=</span>
            <div className="ldg-calc-cell ldg-calc-cell--total">
              <span>{t('الإجمالي', 'Total')}</span>
              <strong>{money(total)}</strong>
            </div>
          </div>
        </section>

        <section className="ldg-due-step">
          <header className="ldg-due-step-head">
            <span className="ldg-due-step-num">4</span>
            <div>
              <strong>{t('الأعضاء', 'Members')}</strong>
              <small>
                {count > 0
                  ? t(`${count} عضو مختار من ${active.length}`, `${count} of ${active.length} members selected`)
                  : t('اختار مين عليه الالتزام.', 'Pick who owes it.')}
              </small>
            </div>
            {!editing && (
              <div className="ldg-picker-tools">
                <button type="button" onClick={selectAllVisible}>
                  {needle ? t('تحديد الظاهر', 'Select shown') : t('تحديد الكل', 'Select all')}
                </button>
                <button type="button" onClick={() => setSelected([])} disabled={count === 0}>
                  {t('مسح', 'Clear')}
                </button>
              </div>
            )}
          </header>
          {!editing && (
            <>
              <div className="ldg-search ldg-search--inline">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('ابحث بالاسم أو الرقم الأكاديمي…', 'Search by name or academic number…')}
                  aria-label={t('بحث في الأعضاء', 'Search members')}
                />
              </div>
              <div className="ldg-picker" role="group" aria-label={t('اختيار الأعضاء', 'Pick members')}>
                {visible.length === 0 ? (
                  <p className="ldg-picker-empty">
                    <Users size={16} aria-hidden="true" />
                    {t('مفيش عضو بالاسم ده.', 'No member matches that.')}
                  </p>
                ) : (
                  visible.map((member) => {
                    const isOn = selected.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        className="ldg-pick"
                        aria-pressed={isOn}
                        onClick={() => toggle(member.id)}
                      >
                        <span className="ldg-pick-box" aria-hidden="true">{isOn && <Check size={13} />}</span>
                        <span className="ldg-pick-copy">
                          <strong>{member.full_name ?? `#${member.id}`}</strong>
                          <small>
                            {member.academic_number ?? '—'}
                            {member.unit ? ` · ${member.unit}` : ''}
                          </small>
                        </span>
                        <span className="ldg-pick-amount">{money(perMember)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>

        <section className="ldg-due-step">
          <header className="ldg-due-step-head">
            <span className="ldg-due-step-num">5</span>
            <div>
              <strong>{t('تاريخ الاستحقاق', 'Due date')}</strong>
              <small>{t('بعد التاريخ ده العضو يتحسب متأخر لو لسه مدفعش.', 'After this date the member is flagged as late if still unpaid.')}</small>
            </div>
          </header>
          <input
            className="ldg-input"
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-label={t('تاريخ الاستحقاق', 'Due date')}
          />
        </section>

        {error && <p className="ldg-form-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
