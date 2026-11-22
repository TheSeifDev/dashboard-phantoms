import { useQuery } from '@tanstack/react-query';
import { memberSupabase } from '../../lib/supabase/member-client';
import { toAppError } from '../../lib/supabase/errors';

export type MemberInternalTeam = {
  team_id: string;
  slug: string;
  name: string;
  status: string;
  approved_at: string | null;
};

/**
 * فرق العضو الداخلية (AI / Software / Hardware).
 * جداول teams/team_memberships محجوبة عن الأعضاء بـ RLS، فالقراءة بتمر عبر RPC
 * بيرجّع صفوف العضو الحالي فقط بناءً على auth.uid().
 */
export function useMemberTeams(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  return useQuery({
    queryKey: ['member-internal-teams', memberId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await memberSupabase.rpc('member_internal_teams');
      if (error) throw toAppError(error, 'معرفناش نحمّل فرقك الداخلية.');
      return (data ?? []) as MemberInternalTeam[];
    },
  });
}