import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase/client';
import { toAppError } from '../../../lib/supabase/errors';
import { useAuthStore } from '../../../store/auth';
import type { TeamConsole, TeamGoal, TeamGoalStatus } from '../../../types/db';

/** مفاتيح الاستعلام — كل شيء تحت مظلة الفريق الواحد. */
export const teamConsoleKey = (teamId: string) => ['team-console', teamId] as const;

async function unwrapRpc<T>(request: PromiseLike<{ data: unknown; error: unknown | null }>, fallback: string): Promise<T> {
  const { data, error } = await request;
  if (error) throw toAppError(error, fallback);
  return data as T;
}

/** قراءة واحدة لكل أقسام لوحة الفريق (مهام، تقييمات، أهداف، مصادر، مشروعات). */
export function useTeamConsole(teamId: string, enabled = true) {
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return useQuery({
    queryKey: [...teamConsoleKey(teamId), userId],
    queryFn: () => unwrapRpc<TeamConsole>(
      supabase.rpc('owner_team_console', { p_team_id: teamId }),
      'معرفناش نحمّل لوحة الفريق.',
    ),
    enabled: enabled && Boolean(teamId),
    staleTime: 10_000,
    retry: false,
  });
}

function useInvalidateConsole(teamId: string) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: teamConsoleKey(teamId) }),
      client.invalidateQueries({ queryKey: ['team-members', teamId] }),
      client.invalidateQueries({ queryKey: ['owner-teams'] }),
      client.invalidateQueries({ queryKey: ['references'] }),
    ]);
  };
}

export function useSaveTeamGoal(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (input: {
      goalId: number | null;
      title: string;
      metric: string;
      targetValue: number;
      currentValue: number;
      dueDate: string | null;
      status: TeamGoalStatus;
    }) => unwrapRpc<TeamGoal>(supabase.rpc('owner_team_goal_save', {
      p_team_id: teamId,
      p_goal_id: input.goalId,
      p_title: input.title,
      p_metric: input.metric,
      p_target_value: input.targetValue,
      p_current_value: input.currentValue,
      p_due_date: input.dueDate,
      p_status: input.status,
    }), 'معرفناش نحفظ هدف الفريق.'),
    onSuccess: invalidate,
  });
}

export function useDeleteTeamGoal(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (goalId: number) => unwrapRpc<boolean>(
      supabase.rpc('owner_team_goal_delete', { p_team_id: teamId, p_goal_id: goalId }),
      'معرفناش نحذف هدف الفريق.',
    ),
    onSuccess: invalidate,
  });
}

export function useCreateTeamTask(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (input: {
      title: string;
      description: string | null;
      assignedTo: string[] | 'ALL';
      deadlineDate: string | null;
      bonusPoints: number;
    }) => {
      const deadline = input.deadlineDate ? `${input.deadlineDate}T23:59:59.999Z` : null;
      return unwrapRpc<number>(supabase.rpc('team_create_task', {
        p_team_id: teamId,
        p_title: input.title,
        p_description: input.description,
        p_assigned_to: input.assignedTo,
        p_has_deadline: deadline !== null,
        p_deadline_date: deadline,
        p_bonus_points: input.bonusPoints,
      }), 'معرفناش نضيف مهمة الفريق.');
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTeamTask(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (taskId: number) => unwrapRpc<boolean>(
      supabase.rpc('team_delete_task', { p_team_id: teamId, p_task_id: taskId }),
      'معرفناش نحذف مهمة الفريق.',
    ),
    onSuccess: invalidate,
  });
}

export function useReviewTeamTask(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (input: { taskId: number; memberId: number; action: 'approve' | 'revoke' | 'revision'; reason: string | null }) =>
      unwrapRpc<unknown>(supabase.rpc('team_review_task', {
        p_team_id: teamId,
        p_task_id: input.taskId,
        p_member_id: input.memberId,
        p_action: input.action,
        p_reason: input.reason,
      }), 'معرفناش نراجع تسليم المهمة.'),
    onSuccess: invalidate,
  });
}

export function useCreateTeamEvaluation(teamId: string) {
  const invalidate = useInvalidateConsole(teamId);
  return useMutation({
    mutationFn: (input: { memberId: number; title: string; grade: string; points: number; feedback: string }) =>
      unwrapRpc<number>(supabase.rpc('team_create_evaluation', {
        p_team_id: teamId,
        p_member_id: input.memberId,
        p_title: input.title,
        p_grade: input.grade,
        p_points: input.points,
        p_feedback: input.feedback,
      }), 'معرفناش نسجل تقييم الفريق.'),
    onSuccess: invalidate,
  });
}
