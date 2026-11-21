import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import {
  requestTaskContributions,
  type ContributionsRpcClient,
} from './taskContributions';

// The server migration is owned separately; keep this adapter narrow until the generated
// Database type includes the new function. No read fallback is used when the RPC is absent.
const contributionsClient = supabase as unknown as ContributionsRpcClient;

export function useTaskContributions(year: number, memberId: number | null) {
  return useQuery({
    queryKey: ['task-contributions', year, memberId],
    queryFn: () => requestTaskContributions(contributionsClient, year, memberId),
    staleTime: 60_000,
    // Keep the previous year visible while another year loads instead of blanking the dashboard.
    placeholderData: keepPreviousData,
    retry: false,
  });
}
