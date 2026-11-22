import { useRef } from 'react';
import { Trophy, Medal, Award, Coins, User, Plus } from 'lucide-react';
import type { Member } from '../../types/db';
import { formatSigned } from '../../lib/arabic';

import { useLocale } from '../../i18n/useLocale';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
import { gsap, useGSAP, prefersReducedMotion } from '../../components/motion/gsap';
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
  const stageRef = useRef<HTMLDivElement>(null);
  // Keep the established visual podium order and the source ranking untouched.
  const first = topMembers[0];
  const second = topMembers[1];
  const third = topMembers[2];

  const podiumSlots = [
    { member: second, rank: 2, label: t('المركز الثاني', 'Second place'), icon: Medal },
    { member: first, rank: 1, label: t('المركز الأول', 'First place'), icon: Trophy },
    { member: third, rank: 3, label: t('المركز الثالث', 'Third place'), icon: Award },
  ];

  // One-shot entrance: the steps grow out of the floor, then the contenders land on top.
  useGSAP(
    () => {
      const stage = stageRef.current;
      if (!stage || prefersReducedMotion()) return;

      const blocks = gsap.utils.toArray<HTMLElement>('.rank-block', stage);
      const contenders = gsap.utils.toArray<HTMLElement>('.rank-contender', stage);
      const trophy = stage.querySelector('.rank-trophy');

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from(blocks, {
        y: 56,
        scaleY: 0.72,
        opacity: 0,
        transformOrigin: 'bottom center',
        duration: 0.7,
        stagger: 0.1,
      }).from(
        contenders,
        { y: 16, opacity: 0, duration: 0.5, stagger: 0.08 },
        '-=0.42',
      );
      if (trophy) {
        tl.from(trophy, { scale: 0, opacity: 0, rotate: -22, duration: 0.5, ease: 'back.out(2)' }, '-=0.18');
      }
      return () => {
        tl.kill();
      };
    },
    { scope: stageRef },
  );

  return (
    <div className="rank-podium" ref={stageRef}>
      {podiumSlots.map(({ member, rank, label, icon: Icon }) => {
        if (!member) {
          return (
            <article
              key={`empty-${rank}`}
              aria-label={t(`${label}: لا يوجد عضو بعد`, `${label}: no member yet`)}
              className={`rank-slot rank-slot--${rank} rank-slot--empty`}
            >
              <div className="rank-contender">
                <span className="rank-empty-label">
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </span>
                <span className="rank-empty-note">{t('بانتظار متصدر', 'Waiting for a leader')}</span>
              </div>
              <div className="rank-block rank-block--empty" aria-hidden="true">
                <span className="rank-block-num">{number(rank)}</span>
              </div>
            </article>
          );
        }

        const subLabel = member.completion_rank
          ? t(`رتبة الإنجاز #${number(member.completion_rank)}`, `Completion rank #${number(member.completion_rank)}`)
          : t('بدون رتبة إنجاز', 'No completion rank');
        const pointsLabel = t('نقاط البونص', 'Bonus points');

        return (
          <article
            key={member.id}
            aria-label={t(`${label}: ${member.full_name}`, `${label}: ${member.full_name}`)}
            className={`rank-slot rank-slot--${rank}`}
          >
            <div className="rank-contender">
              {rank === 1 && (
                <span className="rank-trophy" aria-hidden="true">
                  <Trophy size={22} strokeWidth={2.2} />
                </span>
              )}

              <div className="rank-avatar-wrap">
                <MemberAvatar
                  member={member}
                  name={member.full_name}
                  size={128}
                  className="rank-avatar"
                  fallback={<User size={22} />}
                />
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

              <p className="rank-sub" title={subLabel}>
                <Icon size={11} aria-hidden="true" />
                {subLabel}
              </p>

              <span className="rank-pill" title={pointsLabel}>
                <Coins size={12} aria-hidden="true" />
                {member.bonus_infinite === true ? '∞' : number(member.totalBonus)}
                <span className="rank-pill-label">{pointsLabel}</span>
              </span>
            </div>

            <div className="rank-block" aria-hidden="true">
              <span className="rank-block-num">{number(rank)}</span>
            </div>

            <div className="rank-card-actions">
              <button
                type="button"
                className="rank-btn rank-btn--icon"
                onClick={() => onSelectMember?.(member)}
                aria-label={t(`الملف الشخصي لـ ${member.full_name}`, `${member.full_name}’s profile`)}
                title={t('الملف الشخصي', 'Profile')}
              >
                <User size={14} aria-hidden="true" />
              </button>
              {onAdjustBonus && (
                <button
                  type="button"
                  className="rank-btn rank-btn--icon rank-btn--tone"
                  onClick={() => onAdjustBonus(member)}
                  aria-label={t(`عدّل نقاط ${member.full_name}`, `Adjust ${member.full_name}’s points`)}
                  title={t('تقييم', 'Award')}
                >
                  <Plus size={14} aria-hidden="true" />
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