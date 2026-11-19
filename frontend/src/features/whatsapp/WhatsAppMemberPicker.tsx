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

export function WhatsAppMemberPicker({
  eligible,
  memberIds,
  loading,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: WhatsAppMemberPickerProps) {
  const { t, number, dir } = useLocale();
  return (
    <div className="grid gap-3" dir={dir}>
      <div className="flex items-center justify-between">
        <h3 className="font-black text-sm">{t("اختار الأعضاء عشان تبعت لهم", "Select recipients")} ({number(memberIds.length)} {t("محدد", "selected")})</h3>
        {eligible.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs font-bold text-[var(--primary-ink)] hover:underline"
              onClick={onSelectAll}
            >
              {t('تحديد الكل', 'Select all')}
            </button>
            <button
              type="button"
              className="text-xs text-[var(--text-muted)] hover:underline"
              onClick={onDeselectAll}
            >
              {t('إلغاء التحديد', 'Clear selection')}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p role="status" className="text-xs text-[var(--text-muted)]">
          {t('بنحمّل الأعضاء...', 'Loading members...')}
        </p>
      ) : !eligible.length ? (
        <p className="text-xs text-[var(--text-muted)]">
          {t('مفيش عضو مكلف عنده رقم تليفون صالح.', 'No assigned members have a valid phone number.')}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {eligible.map((member) => (
            <button
              type="button"
              key={member.id}
              aria-pressed={memberIds.includes(member.id)}
              className={`flex min-h-12 items-center gap-3 rounded-xl border p-3 text-start ${
                memberIds.includes(member.id)
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                  : 'border-[var(--border)]'
              }`}
              onClick={() => onToggle(member.id)}
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{member.full_name}</b>
                <small dir="ltr" className="block text-start text-[var(--text-muted)]">
                  {member.phone}
                </small>
              </span>
              <span className="text-xs font-bold text-[var(--text-muted)]">
                {memberIds.includes(member.id) ? t('محدد','Selected') : t('اختيار','Select')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
