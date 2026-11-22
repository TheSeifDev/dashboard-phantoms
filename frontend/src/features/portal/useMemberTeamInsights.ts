import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { requestMemberTeamInsights, type MemberInsightsRpcClient } from './memberInsights';

// Same narrow adapter as the admin contributions hook: the RPC is additive and
// the generated Database type does not know it yet.
const insightsClient = supabase as unknown as MemberInsightsRpcClient;

/** مساهمات الفريق للعضو: نفس سجل الاعتماد لكن من RPC مسموحة للأعضاء. */
export function useMemberTeamInsights(year: number, enabled = true) {
  return useQuery({
    queryKey: ['member-team-insights', year],
    queryFn: () => requestMemberTeamInsights(insightsClient, year),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}