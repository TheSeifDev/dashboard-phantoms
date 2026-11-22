import { Trophy, Medal, Award, Coins, User, Edit3, Search } from 'lucide-react';
import type { Member } from '../../types/db';
import type { RankedMember } from './RankingPodium';

import { useLocale } from '../../i18n/useLocale';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
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
      <div className="rank-board-empty" role="status">
        <div className="rank-place" aria-hidden="true">
          {hasFilters ? <Search size={16} /> : <Trophy size={16} />}
        </div>
        <b>{hasFilters ? t('لا توجد نتائج مطابقة', 'No matching results') : t('لا يوجد أعضاء في الترتيب بعد', 'No members to rank yet')}</b>
        <span>
          {hasFilters
            ? t('جرّب تعديل كلمات البحث أو مسح الفلاتر لعرض كل أعضاء الفريق.', 'Try changing your search or clear the filters to see all team members.')
            : t('ستظهر قائمة الفريق هنا عند توفر أعضاء للترتيب.', 'The team ranking will appear here when members are available.')}
        </span>
        {hasFilters && onClearFilters && (
          <button type="button" onClick={onClearFilters}>{t('مسح الفلاتر', 'Clear filters')}</button>
        )}
      </div>
    );
  }

  const labels = [
    t('الترتيب', 'Place'),
    t('العضو', 'Member'),
    t('نقاط البونص', 'Points'),
    t('رتبة الإنجاز', 'Completion'),
    t('تاريخ الانضمام', 'Joined'),
    t('الإجراءات', 'Actions'),
  ];

  return (
    <div className="rank-board">
      <table className="rank-table">
        <caption>{t('ترتيب أعضاء الفريق حسب رصيد البونص', 'Team member ranking by bonus balance')}</caption>
        <thead>
          <tr>
            {labels.map((label, index) => (
              <th key={label} scope="col" className={index === 5 ? 'text-end' : undefined}>{label}</th>
            ))}
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
            const pointsTone = member.bonus_infinite === true
              ? 'rank-points--inf'
              : member.totalBonus > 0
                ? 'rank-points--pos'
                : member.totalBonus < 0
                  ? 'rank-points--neg'
                  : '';

            return (
              <tr key={member.id}>
                <td data-label={labels[0]}>
                  <span className={`rank-place ${isTop1 ? 'rank-place--1' : isTop2 ? 'rank-place--2' : isTop3 ? 'rank-place--3' : ''}`}>
                    {isTop1 ? <Trophy size={12} aria-hidden="true" /> : isTop2 ? <Medal size={12} aria-hidden="true" /> : isTop3 ? <Award size={12} aria-hidden="true" /> : null}
                    <span className="tabular-nums">{number(member.rank)}</span>
                    <span className="sr-only">{rankLabel}</span>
                  </span>
                </td>

                <td data-label={labels[1]}>
                  <span className="rank-member">
                    <MemberAvatar member={member} name={member.full_name} size={64} className="rank-member-avatar" fallback={<User size={15} />} />
                    <span className="rank-member-copy">
                      <button
                        type="button"
                        onClick={() => onSelectMember?.(member)}
                        aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
                        className="rank-member-name"
                      >
                        {member.full_name}
                      </button>
                      <span className="rank-member-mail" dir="ltr">{member.email}</span>
                    </span>
                  </span>
                </td>

                <td data-label={labels[2]}>
                  <span className={`rank-points ${pointsTone}`}>
                    <Coins size={12} aria-hidden="true" />
                    {member.bonus_infinite === true ? '∞' : number(member.totalBonus)}
                  </span>
                </td>

                <td data-label={labels[3]} className="rank-hide-sm">
                  <span className="rank-meta">{member.completion_rank ? `#${number(member.completion_rank)}` : '—'}</span>
                </td>

                <td data-label={labels[4]} className="rank-hide-sm">
                  <span className="rank-meta">
                    {member.created_at ? date(member.created_at, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </td>

                <td data-label={labels[5]}>
                  <span className="rank-row-actions">
                    <button
                      type="button"
                      aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
                      onClick={() => onSelectMember?.(member)}
                      className="rank-icon-btn"
                    >
                      <User size={15} aria-hidden="true" />
                    </button>
                    {onAdjustBonus && (
                      <button
                        type="button"
                        aria-label={t(`عدّل نقاط البونص لـ ${member.full_name}`, `Edit ${member.full_name}’s bonus points`)}
                        onClick={() => onAdjustBonus(member)}
                        className="rank-icon-btn rank-icon-btn--accent"
                      >
                        <Edit3 size={15} aria-hidden="true" />
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
