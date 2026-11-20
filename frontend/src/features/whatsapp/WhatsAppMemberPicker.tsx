import { Check, Users } from 'lucide-react';
import type { Member } from '../../types/db';

import { useLocale } from '../../i18n/useLocale';
interface WhatsAppMemberPickerProps {
  eligible: Member[];
  memberIds: number[];
  loading: boolean;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function WhatsAppMemberPicker({ eligible, memberIds, loading, onToggle, onSelectAll, onDeselectAll }: WhatsAppMemberPickerProps) {
  const { t, number, dir } = useLocale();
  return (
    <div className="grid gap-3" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-[var(--text)]">
          <Users size={17} className="text-[var(--link)]" aria-hidden="true" />
          <span>{t('المستلمون', 'Recipients')}</span>
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-bold text-[var(--text-muted)]">{number(memberIds.length)} {t('محدد', 'selected')}</span>
        </h3>
        {eligible.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-lg px-2 text-xs font-bold text-[var(--primary-ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={onSelectAll}>
              {t('تحديد الكل', 'Select all')}
            </button>
            <button type="button" className="min-h-11 rounded-lg px-2 text-xs text-[var(--text-muted)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={onDeselectAll}>
              {t('إلغاء التحديد', 'Clear selection')}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p role="status" aria-live="polite" className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('جارٍ تحميل المستلمين…', 'Loading recipients…')}</p>
      ) : !eligible.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-sm leading-6 text-[var(--text-muted)]">{t('لا يوجد عضو مؤهل مرتبط بالمهمة ولديه رقم هاتف صالح.', 'No eligible member assigned to this task has a valid phone number.')}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {eligible.map((member) => {
            const selected = memberIds.includes(member.id);
            return (
              <button
                type="button"
                key={member.id}
                aria-pressed={selected}
                className={`flex min-h-[60px] min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'}`}
                onClick={() => onToggle(member.id)}
              >
                <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] text-transparent'}`} aria-hidden="true">
                  {selected && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-[var(--text)]">{member.full_name}</b>
                  <small dir="ltr" className="mt-0.5 block truncate text-start text-xs text-[var(--text-muted)]">{member.phone}</small>
                </span>
                <span className="shrink-0 text-xs font-bold text-[var(--text-muted)]">{selected ? t('محدد', 'Selected') : t('اختيار', 'Select')}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
