import { Trophy, Medal, Award, User, Edit3, Search } from 'lucide-react';
import type { Member } from '../../types/db';
import type { RankedMember } from './RankingPodium';

import { useLocale } from '../../i18n/useLocale';
interface RankingTableProps {
  members: RankedMember[];
  onSelectMember?: (member: Member) => void;
  onAdjustBonus?: (member: Member) => void;
  hasFilters?: boolean;
  onClearFilters?: () => void;
}

export function RankingTable({ members, onSelectMember, onAdjustBonus, hasFilters = false, onClearFilters }: RankingTableProps) {
  const { t, number, date } = useLocale();
  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center sm:px-8 sm:py-12" role="status">
        <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--primary-ink)]">
          {hasFilters ? <Search size={22} aria-hidden="true" /> : <Trophy size={22} aria-hidden="true" />}
        </div>
        <h4 className="text-base font-black text-[var(--text)]">
          {hasFilters ? t('لا توجد نتائج مطابقة', 'No matching results') : t('لا يوجد أعضاء في الترتيب بعد', 'No members to rank yet')}
        </h4>
        <p className="mt-1 max-w-md text-sm leading-6 text-[var(--text-muted)]">
          {hasFilters
            ? t('جرّب تعديل كلمات البحث أو مسح الفلاتر لعرض كل أعضاء الفريق.', 'Try changing your search or clear the filters to see all team members.')
            : t('ستظهر قائمة الفريق هنا عند توفر أعضاء للترتيب.', 'The team ranking will appear here when members are available.')}
        </p>
        {hasFilters && onClearFilters && (
          <button type="button" onClick={onClearFilters} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-white transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]">
            {t('مسح الفلاتر', 'Clear filters')}
          </button>
        )}
      </div>
    );
  }

  const labels = [
    t('الترتيب', 'Rank'),
    t('العضو', 'Member'),
    t('نقاط البونص', 'Bonus points'),
    t('رتبة الإنجاز', 'Completion rank'),
    t('تاريخ الانضمام', 'Joined'),
    t('الإجراءات', 'Actions'),
  ];

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <table className="data-table w-full text-start text-sm">
        <caption className="sr-only">{t('ترتيب أعضاء الفريق حسب رصيد البونص', 'Team member ranking by bonus balance')}</caption>
        <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
          <tr>
            {labels.map((label) => <th key={label} scope="col" className="font-bold">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isTop1 = member.rank === 1;
            const isTop2 = member.rank === 2;
            const isTop3 = member.rank === 3;
            const rankLabel = isTop1
              ? t('المركز الأول', 'First place')
              : isTop2
                ? t('المركز الثاني', 'Second place')
                : isTop3
                  ? t('المركز الثالث', 'Third place')
                  : t(`المركز ${number(member.rank)}`, `Rank ${number(member.rank)}`);

            return (
              <tr key={member.id} className="transition-colors hover:bg-[var(--bg)]">
                <td data-label={labels[0]}>
                  <span className="inline-flex items-center gap-1.5">
                    {isTop1 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-amber-500 text-xs font-black text-white shadow-sm"><Trophy size={14} aria-hidden="true" /><span className="sr-only">{rankLabel}</span></span>
                    ) : isTop2 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-slate-400 text-xs font-black text-white shadow-sm"><Medal size={14} aria-hidden="true" /><span className="sr-only">{rankLabel}</span></span>
                    ) : isTop3 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-amber-700 text-xs font-black text-white shadow-sm"><Award size={14} aria-hidden="true" /><span className="sr-only">{rankLabel}</span></span>
                    ) : (
                      <span className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs font-black text-[var(--text-muted)] tabular-nums">{number(member.rank)}</span>
                    )}
                  </span>
                </td>

                <td data-label={labels[1]}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-sm font-bold text-[var(--primary-ink)]" aria-hidden="true">
                      {member.full_name.trim().charAt(0) || <User size={16} />}
                    </span>
                    <span className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectMember?.(member)}
                        aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
                        className="block max-w-full truncate rounded text-start text-sm font-bold text-[var(--text)] transition-colors hover:text-[var(--primary-ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--link)]"
                      >
                        {member.full_name}
                      </button>
                      <span className="block max-w-full truncate text-xs text-[var(--text-muted)]" dir="ltr">{member.email}</span>
                    </span>
                  </span>
                </td>

                <td data-label={labels[2]}>
                  <span className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-black ${
                    member.bonus_infinite === true
                      ? 'border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary-ink)]'
                      : member.totalBonus > 0
                        ? 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]'
                        : member.totalBonus < 0
                          ? 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)] dark:text-[var(--danger)]'
                          : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                  }`}>
                    {member.bonus_infinite === true
                      ? <span>{'∞ '}{t('بونص غير محدود', 'Unlimited bonus')}</span>
                      : <span className="tabular-nums">{number(member.totalBonus)} {t('نقطة', 'points')}</span>}
                  </span>
                </td>

                <td data-label={labels[3]} className="text-xs font-bold text-[var(--text-muted)]">
                  {member.completion_rank ? <span dir="ltr">#{number(member.completion_rank)}</span> : '—'}
                </td>

                <td data-label={labels[4]} className="whitespace-nowrap text-xs font-medium text-[var(--text-muted)]">
                  {member.created_at ? date(member.created_at, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                </td>

                <td data-label={labels[5]}>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
                      onClick={() => onSelectMember?.(member)}
                      className="grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--primary-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                    >
                      <User size={16} aria-hidden="true" />
                    </button>
                    {onAdjustBonus && (
                      <button
                        type="button"
                        aria-label={t(`عدّل نقاط البونص لـ ${member.full_name}`, `Edit ${member.full_name}’s bonus points`)}
                        onClick={() => onAdjustBonus(member)}
                        className="grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary-ink)] transition-colors hover:bg-[var(--primary)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                      >
                        <Edit3 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
