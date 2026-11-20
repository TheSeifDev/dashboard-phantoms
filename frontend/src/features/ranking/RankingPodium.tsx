import { Trophy, Medal, Award, User } from 'lucide-react';
import type { Member } from '../../types/db';
import { formatSigned } from '../../lib/arabic';

import { useLocale } from '../../i18n/useLocale';
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
    { member: second, rank: 2, label: t('المركز الثاني', 'Second place'), colorBg: 'bg-slate-500', borderColor: 'border-slate-300 dark:border-slate-700', icon: Medal, height: 'sm:min-h-[220px]' },
    { member: first, rank: 1, label: t('المركز الأول', 'First place'), colorBg: 'bg-amber-500', borderColor: 'border-amber-400 dark:border-amber-600', icon: Trophy, height: 'sm:min-h-[250px]' },
    { member: third, rank: 3, label: t('المركز الثالث', 'Third place'), colorBg: 'bg-amber-700', borderColor: 'border-amber-600 dark:border-amber-800', icon: Award, height: 'sm:min-h-[200px]' },
  ];

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 sm:items-end sm:gap-4">
      {podiumSlots.map(({ member, rank, label, colorBg, borderColor, icon: Icon, height }) => {
        if (!member) {
          return (
            <article
              key={`empty-${rank}`}
              aria-label={t(`${label}: لا يوجد عضو بعد`, `${label}: no member yet`)}
              className={`flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-5 text-center text-[var(--text-muted)] ${height}`}
            >
              <div className="mb-2 grid size-10 place-items-center rounded-full border border-[var(--border)] opacity-60">
                <Icon size={18} aria-hidden="true" />
              </div>
              <span className="text-xs font-bold">{label}</span>
              <span className="mt-1 text-[11px]">{t('بانتظار ظهور متصدر', 'Waiting for a leader')}</span>
            </article>
          );
        }

        return (
          <article
            key={member.id}
            aria-label={t(`${label}: ${member.full_name}`, `${label}: ${member.full_name}`)}
            className={`group relative flex flex-col justify-between rounded-[var(--radius-lg)] border ${borderColor} bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-md sm:p-5 ${height}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${colorBg} text-sm font-black text-white shadow-sm`}>
                {number(rank)}
              </span>
              <span className="flex items-center gap-1 text-xs font-bold text-[var(--text-muted)]">
                <Icon size={14} aria-hidden="true" />
                {label}
              </span>
            </div>

            <div className="my-4 flex min-w-0 flex-col items-center text-center">
              <div className="mb-2.5 grid size-14 shrink-0 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] text-lg font-black text-[var(--primary-ink)]" aria-hidden="true">
                {member.full_name ? member.full_name.trim().charAt(0) : <User size={22} />}
              </div>
              <button
                type="button"
                onClick={() => onSelectMember?.(member)}
                aria-label={t(`اعرض الملف الشخصي لـ ${member.full_name}`, `View ${member.full_name}’s profile`)}
                className="max-w-full rounded text-base font-black text-[var(--text)] transition-colors hover:text-[var(--primary-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
              >
                <span className="block max-w-full truncate">{member.full_name}</span>
              </button>
              <span className="mt-0.5 max-w-full truncate text-xs text-[var(--text-muted)]" dir="ltr">{member.email}</span>

              <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-1.5 text-sm font-black text-[var(--primary-ink)]">
                <span className="tabular-nums">{member.bonus_infinite === true ? '∞' : formatSigned(member.totalBonus)}</span>
                <span className="text-xs font-semibold">{member.bonus_infinite === true ? t('بونص غير محدود', 'Unlimited bonus') : t('نقطة', 'points')}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => onSelectMember?.(member)}
                className="min-h-11 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs font-bold text-[var(--text)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
              >
                {t('الملف الشخصي', 'View profile')}
              </button>
              {onAdjustBonus && (
                <button
                  type="button"
                  onClick={() => onAdjustBonus(member)}
                  className="min-h-11 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                >
                  {t('تقييم', 'Evaluate')}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
