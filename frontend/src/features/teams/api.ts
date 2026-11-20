import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { useAuthStore } from '../../store/auth';
import type {
  AdminPermissions,
  TeamAdminCandidate,
  TeamAdminRole,
  TeamMemberCandidate,
  TeamMemberSummary,
  TeamMembershipStatus,
  TeamOverview,
} from '../../types/db';

export const ownerTeamsKey = ['owner-teams'] as const;
export const teamAdminCandidatesKey = ['team-admin-candidates'] as const;
export const teamMembersKey = (teamId: string) => ['team-members', teamId] as const;
export const teamMemberCandidatesKey = (teamId: string) => ['team-member-candidates', teamId] as const;

async function unwrapRpc<T>(request: PromiseLike<{ data: unknown; error: unknown | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw toAppError(error, 'معرفناش ننفذ العملية على الفريق.');
  return data as T;
}

export function useOwnerTeams(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...ownerTeamsKey, userId],
    queryFn: () => unwrapRpc<TeamOverview[]>(supabase.rpc('owner_list_teams')),
    enabled,
    staleTime: 5_000,
    retry: false,
  });
}

export function useTeamAdminCandidates(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...teamAdminCandidatesKey, userId],
    queryFn: () => unwrapRpc<TeamAdminCandidate[]>(supabase.rpc('owner_list_team_admin_candidates')),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useOwnerTeamMembers(teamId: string) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...teamMembersKey(teamId), userId],
    queryFn: () => unwrapRpc<TeamMemberSummary[]>(supabase.rpc('owner_list_team_members', { p_team_id: teamId })),
    enabled: Boolean(teamId),
    retry: false,
  });
}

export function useOwnerTeamMemberCandidates(teamId: string) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...teamMemberCandidatesKey(teamId), userId],
    queryFn: () => unwrapRpc<TeamMemberCandidate[]>(supabase.rpc('owner_list_team_member_candidates', { p_team_id: teamId })),
    enabled: Boolean(teamId),
    retry: false,
  });
}

function useInvalidateTeams() {
  const client = useQueryClient();
  return async (teamId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ownerTeamsKey }),
      client.invalidateQueries({ queryKey: teamAdminCandidatesKey }),
      client.invalidateQueries({ queryKey: ['admin-access'] }),
      ...(teamId ? [client.invalidateQueries({ queryKey: teamMembersKey(teamId) }), client.invalidateQueries({ queryKey: teamMemberCandidatesKey(teamId) })] : []),
    ]);
  };
}

export function useCreateTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { slug: string; name: string }) => unwrapRpc<string>(supabase.rpc('owner_create_team', {
      p_slug: input.slug, p_name: input.name,
    })),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTeamDetails() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { teamId: string; slug: string; name: string }) => unwrapRpc<boolean>(supabase.rpc('owner_update_team_details', {
      p_team_id: input.teamId, p_slug: input.slug, p_name: input.name,
    })),
    onSuccess: () => invalidate(),
  });
}

export function useSetTeamActive() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { teamId: string; active: boolean }) => unwrapRpc<boolean>(supabase.rpc('owner_set_team_active', {
      p_team_id: input.teamId, p_is_active: input.active,
    })),
    onSuccess: () => invalidate(),
  });
}

export function useSetTeamAdminSeat() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { teamId: string; role: TeamAdminRole; userId: string | null; permissions: AdminPermissions | null }) =>
      unwrapRpc<string | null>(supabase.rpc('owner_set_team_admin_seat', {
        p_team_id: input.teamId,
        p_role: input.role,
        p_user_id: input.userId,
        p_permissions: input.permissions,
      })),
    onSuccess: () => invalidate(),
  });
}

export function useAddTeamMember() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { teamId: string; memberId: number }) => unwrapRpc<TeamMembershipStatus>(supabase.rpc('team_add_member', {
      p_team_id: input.teamId, p_member_id: input.memberId,
    })),
    onSuccess: (_status, input) => invalidate(input.teamId),
  });
}

export function useReviewTeamMember() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: { teamId: string; memberId: number; decision: 'approve' | 'suspend' | 'remove' }) =>
      unwrapRpc<TeamMembershipStatus>(supabase.rpc('team_review_member', {
        p_team_id: input.teamId, p_member_id: input.memberId, p_decision: input.decision,
      })),
    onSuccess: (_status, input) => invalidate(input.teamId),
  });
}
