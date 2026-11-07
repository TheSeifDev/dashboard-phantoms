import { Trophy, Medal, Award, User } from 'lucide-react';
import type { Member } from '../../types/db';
import { formatSigned } from '../../lib/arabic';

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
  if (topMembers.length === 0) return null;

  // Podium order: Silver (#2), Gold (#1), Bronze (#3) for aesthetic balance
  const first = topMembers[0];
  const second = topMembers[1];
  const third = topMembers[2];

  const podiumSlots = [
    { member: second, rank: 2, label: 'المركز الثاني', colorBg: 'bg-slate-500', colorText: 'text-slate-600 dark:text-slate-300', borderColor: 'border-slate-300 dark:border-slate-700', icon: Medal, height: 'sm:min-h-[220px]' },
    { member: first, rank: 1, label: 'المركز الأول', colorBg: 'bg-amber-500', colorText: 'text-amber-600 dark:text-amber-400', borderColor: 'border-amber-400 dark:border-amber-600', icon: Trophy, height: 'sm:min-h-[250px]' },
    { member: third, rank: 3, label: 'المركز الثالث', colorBg: 'bg-amber-700', colorText: 'text-amber-800 dark:text-amber-600', borderColor: 'border-amber-600 dark:border-amber-800', icon: Award, height: 'sm:min-h-[200px]' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
      {podiumSlots.map(({ member, rank, label, colorBg, borderColor, icon: Icon, height }) => {
        if (!member) {
          return (
            <div
              key={`empty-${rank}`}
              className={`flex flex-col items-center justify-center p-5 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] ${height}`}
            >
              <div className="size-10 rounded-full border border-[var(--border)] grid place-items-center mb-2 opacity-50">
                <Icon size={18} />
              </div>
              <span className="text-xs font-bold">{label}</span>
              <span className="text-[11px] text-[var(--text-muted)] mt-1">لسه فاضي</span>
            </div>
          );
        }

        return (
          <div
            key={member.id}
            onClick={() => onSelectMember?.(member)}
            className={`group relative flex flex-col justify-between p-5 rounded-[var(--radius-lg)] border ${borderColor} bg-[var(--surface)] shadow-[var(--shadow-sm)] hover:shadow-md transition-shadow cursor-pointer ${height}`}
          >
            {/* Top Rank Badge */}
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center justify-center size-9 rounded-xl ${colorBg} text-white font-black text-sm shadow-sm`}>
                {rank}
              </span>
              <span className="text-xs font-bold text-[var(--text-muted)] flex items-center gap-1">
                <Icon size={14} />
                {label}
              </span>
            </div>

            {/* Member Details */}
            <div className="my-4 flex flex-col items-center text-center">
              <div className="size-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] grid place-items-center text-lg font-black text-[var(--primary)] mb-2.5">
                {member.full_name ? member.full_name.charAt(0) : <User size={22} />}
              </div>
              <h4 className="font-black text-base text-[var(--text)] group-hover:text-[var(--primary)] transition-colors truncate max-w-full">
                {member.full_name}
              </h4>
              <span className="text-xs text-[var(--text-muted)] mt-0.5 truncate max-w-full" dir="ltr">
                {member.email}
              </span>

              {/* Bonus score */}
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-violet-500/10 border border-violet-200 dark:border-violet-900 text-violet-700 dark:text-violet-300 font-black text-sm">
                <span>{member.bonus_infinite === true ? '∞' : formatSigned(member.totalBonus)}</span>
                <span className="text-xs font-semibold">{member.bonus_infinite === true ? 'بونص غير محدود' : 'نقطة'}</span>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectMember?.(member);
                }}
                className="flex-1 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs font-bold text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
              >
                الملف الشخصي
              </button>
              {onAdjustBonus && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdjustBonus(member);
                  }}
                  className="px-3 min-h-11 rounded-lg bg-[var(--primary)] text-xs font-bold text-white hover:bg-[var(--primary-hover)] transition-colors"
                >
                  تقييم
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
