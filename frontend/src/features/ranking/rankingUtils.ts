import type { Member } from '../../types/db';

type BonusRank = Pick<Member, 'bonus_infinite' | 'completion_rank' | 'created_at'> & { totalBonus: number };

function compareTieBreakers(a: BonusRank, b: BonusRank): number {
  if (a.completion_rank && b.completion_rank) {
    return a.completion_rank - b.completion_rank;
  }
  if (a.completion_rank) return -1;
  if (b.completion_rank) return 1;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function compareMemberBonusRank(a: BonusRank, b: BonusRank): number {
  const aInfinite = a.bonus_infinite === true;
  const bInfinite = b.bonus_infinite === true;
  if (aInfinite !== bInfinite) return aInfinite ? -1 : 1;
  if (aInfinite) return compareTieBreakers(a, b);
  if (a.totalBonus !== b.totalBonus) return b.totalBonus - a.totalBonus;
  return compareTieBreakers(a, b);
}
