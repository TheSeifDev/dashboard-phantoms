import { Trophy, Medal, Award, Coins, User } from 'lucide-react';
import type { Member } from '../../types/db';
import { formatSigned } from '../../lib/arabic';

import { useLocale } from '../../i18n/useLocale';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
export interface RankedMember extends Member {
  totalBonus: number;
  rank: number;
}

interface RankingPodiumProps {
  topMembers: RankedMember[];
  onSelectMember?: (member: Member) => void;
  onAdjustBonus?: (member: Member) => void;
}

export function RankingPodium({ topMembers, onSelectMember, onAdjustBonus }: RankingPodiumProps) {
  const { t, number } = useLocale();
  // Keep the established visual podium order and the source ranking untouched.
  const first = topMembers[0];
  const second = topMembers[1];
  const third = topMembers[2];

  const podiumSlots = [
    { member: second, rank: 2, label: t('المركز الثاني', 'Second place'), icon: Medal },
    { member: first, rank: 1, label: t('المركز الأول', 'First place'), icon: Trophy },
    { member: third, rank: 3, label: t('المركز الثالث', 'Third place'), icon: Award },
  ];

  return (
    <div className="rank-podium">
      {podiumSlots.map(({ member, rank, label, icon: Icon }) => {
        if (!member) {
          return (
            <article
              key={`empty-${rank}`}
              aria-label={t(`${label}: لا يوجد عضو بعد`, `${label}: no member yet`)}
              className={`rank-empty rank-card--${rank}`}
            >
              <Icon size={20} aria-hidden="true" />
              <b>{label}</b>
              <span>{t('بانتظار ظهور متصدر', 'Waiting for a leader')}</span>
            </article>
          );
        }

        const subLabel = member.completion_rank
          ? t(`رتبة الإنجاز #${number(member.completion_rank)}`, `Completion rank #${number(member.completion_rank)}`)
          : t('بدون رتبة إنجاز', 'No completion rank');

        return (
          <article
            key={member.id}
            aria-label={t(`${label}: ${member.full_name}`, `${label}: ${member.full_name}`)}
            className={`rank-card rank-card--${rank}`}
          >
            <span className="rank-medal" aria-hidden="true">{number(rank)}</span>

            <div className="rank-avatar-wrap">
              <span className="rank-avatar-glow" aria-hidden="true" />
              <MemberAvatar member={member} name={member.full_name} size={128} className="rank-avatar" fallback={<User size={24} />} />
            </div>

            <h3 className="rank-name">
              <button
                type="button"
                onClick={() => onSelectMember?.(member)}
                aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
              >
                {member.full_name}
              </button>
            </h3>

            <p className="rank-sub">
              <Icon size={12} aria-hidden="true" />
              {subLabel}
            </p>

            <div className="rank-prize">
              <span className="rank-prize-badge" aria-hidden="true"><Icon size={13} /></span>
              <span className="rank-prize-value">
                <Coins size={15} aria-hidden="true" />
                {member.bonus_infinite === true ? '∞' : number(member.totalBonus)}
              </span>
              <span className="rank-prize-label">
                {member.bonus_infinite === true ? t('بونص غير محدود', 'Unlimited bonus') : t('نقاط البونص', 'Bonus points')}
              </span>
            </div>

            <div className="rank-card-actions">
              <button type="button" className="rank-btn" onClick={() => onSelectMember?.(member)}>
                {t('الملف الشخصي', 'Profile')}
              </button>
              {onAdjustBonus && (
                <button
                  type="button"
                  className="rank-btn rank-btn--tone"
                  onClick={() => onAdjustBonus(member)}
                  aria-label={t(`عدّل نقاط ${member.full_name}`, `Adjust ${member.full_name}’s points`)}
                >
                  {t('تقييم', 'Award')}
                </button>
              )}
            </div>
            <span className="sr-only">{formatSigned(member.totalBonus)}</span>
          </article>
        );
      })}
    </div>
  );
}
