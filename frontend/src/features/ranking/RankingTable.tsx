import { Trophy, Medal, Award, User, Edit3 } from 'lucide-react';
import type { Member } from '../../types/db';
import type { RankedMember } from './RankingPodium';
import { formatDate } from '../../lib/dateUtils';
import { formatSigned } from '../../lib/arabic';

interface RankingTableProps {
  members: RankedMember[];
  onSelectMember?: (member: Member) => void;
  onAdjustBonus?: (member: Member) => void;
}

export function RankingTable({ members, onSelectMember, onAdjustBonus }: RankingTableProps) {
  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--border)]">
        <Trophy size={36} className="mb-3 opacity-30 text-[var(--primary)]" />
        <h4 className="font-black text-base text-[var(--text)] mb-1">مفيش أعضاء في الترتيب</h4>
        <p className="text-xs text-[var(--text-muted)]">ملقيناش أعضاء مطابقين لفلترة دلوقتي.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-clip rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <table className="data-table w-full text-start text-sm">
        <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
          <tr>
            {['الترتيب', 'العضو', 'نقاط البونص', 'رتبة الإنجاز', 'تاريخ الانضمام', 'الإجراءات'].map((label, idx) => (
              <th
                key={idx}
                className="font-bold"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isTop1 = member.rank === 1;
            const isTop2 = member.rank === 2;
            const isTop3 = member.rank === 3;

            return (
              <tr
                key={member.id}
                onClick={() => onSelectMember?.(member)}
                className="hover:bg-[var(--bg)] transition-colors group cursor-pointer"
              >
                {/* Rank number */}
                <td data-label="الترتيب">
                  <span className="inline-flex items-center gap-1.5">
                    {isTop1 ? (
                      <span className="inline-flex items-center justify-center size-8 rounded-lg bg-amber-500 text-white font-black text-xs shadow-sm">
                        <Trophy size={14} aria-hidden="true" />
                      </span>
                    ) : isTop2 ? (
                      <span className="inline-flex items-center justify-center size-8 rounded-lg bg-slate-400 text-white font-black text-xs shadow-sm">
                        <Medal size={14} aria-hidden="true" />
                      </span>
                    ) : isTop3 ? (
                      <span className="inline-flex items-center justify-center size-8 rounded-lg bg-amber-700 text-white font-black text-xs shadow-sm">
                        <Award size={14} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center size-8 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] font-black text-xs tabular-nums">
                        {member.rank}
                      </span>
                    )}
                  </span>
                </td>

                {/* Member Info */}
                <td data-label="العضو">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] font-bold text-[var(--primary)] text-sm">
                      {member.full_name.trim().charAt(0)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-sm text-[var(--text)] group-hover:text-[var(--primary)] transition-colors">
                        {member.full_name}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-muted)]" dir="ltr">
                        {member.email}
                      </span>
                    </span>
                  </span>
                </td>

                {/* Bonus Score */}
                <td data-label="نقاط البونص">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black border ${
                      member.bonus_infinite === true
                        ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300'
                        : member.totalBonus > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400'
                        : member.totalBonus < 0
                        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                    }`}
                  >
                    {member.bonus_infinite === true ? <span aria-label="بونص غير محدود">∞ بونص غير محدود</span> : `${formatSigned(member.totalBonus)} نقطة`}
                  </span>
                </td>

                {/* Completion Rank */}
                <td data-label="رتبة الإنجاز" className="text-xs font-bold text-[var(--text-muted)]">
                  {member.completion_rank ? `#${member.completion_rank}` : '—'}
                </td>

                {/* Date */}
                <td data-label="تاريخ الانضمام" className="whitespace-nowrap text-xs font-medium text-[var(--text-muted)]">
                  {member.created_at ? formatDate(member.created_at, 'd MMMM yyyy') : '—'}
                </td>

                {/* Actions */}
                <td data-label="الإجراءات">
                  <span className="flex items-center gap-1.5 sm:justify-end">
                    <button
                      type="button"
                      aria-label={`اعرض الملف الشخصي لـ ${member.full_name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMember?.(member);
                      }}
                      className="grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--surface)] transition-colors"
                    >
                      <User size={16} aria-hidden="true" />
                    </button>
                    {onAdjustBonus && (
                      <button
                        type="button"
                        aria-label={`عدّل نقاط البونص لـ ${member.full_name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdjustBonus(member);
                        }}
                        className="grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-colors"
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
