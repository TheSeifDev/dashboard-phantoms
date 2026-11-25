import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { useAuthStore } from '../../store/auth';
import type { TeamAccent, TeamProfile } from '../../types/db';

export const teamProfileKey = (teamId: string) => ['team-profile', teamId] as const;

async function unwrapRpc<T>(request: PromiseLike<{ data: unknown; error: unknown | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw toAppError(error, 'معرفناش ننفذ العملية على تخصيص الفريق.');
  return data as T;
}

/** تخصيص الفريق: وصف قصير، لون التمييز، ومحاور الشغل. */
export function useTeamProfile(teamId: string, enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...teamProfileKey(teamId), userId],
    queryFn: () => unwrapRpc<TeamProfile>(supabase.rpc('team_profile_get', { p_team_id: teamId })),
    enabled: Boolean(teamId) && enabled,
    staleTime: 10_000,
    retry: false,
  });
}

export function useSaveTeamProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { teamId: string; tagline: string; accent: TeamAccent; focusAreas: string[] }) =>
      unwrapRpc<TeamProfile>(supabase.rpc('owner_team_profile_set', {
        p_team_id: input.teamId,
        p_tagline: input.tagline,
        p_accent: input.accent,
        p_focus_areas: input.focusAreas,
      })),
    onSuccess: (profile) => {
      void client.invalidateQueries({ queryKey: teamProfileKey(profile.team_id) });
    },
  });
}
