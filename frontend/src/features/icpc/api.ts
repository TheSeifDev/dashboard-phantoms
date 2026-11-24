import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import type {
  AnalyticsPayload,
  CalendarPayload,
  ContestDetail,
  ContestsPayload,
  IcpcContext,
  IcpcMode,
  NotesPayload,
  OverviewPayload,
  ProblemFilters,
  ProblemsPayload,
  TeamPayload,
  TrainingPayload,
} from './types';

interface RpcResult { data: unknown; error: { message?: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

// نفس الـadapter الضيق المستخدم في المصادر والخزنة: الـDatabase type مش عارف RPCs الجديدة.
const adminRpc = supabase as unknown as RpcClient;
const memberRpc = memberSupabase as unknown as RpcClient;

function clientFor(mode: IcpcMode): RpcClient {
  return mode === 'member' ? memberRpc : adminRpc;
}

function toMessage(cause: unknown, fallback: string): never {
  const message = typeof cause === 'object' && cause !== null && 'message' in cause
    ? String((cause as { message?: unknown }).message ?? '')
    : '';
  const cleaned = message.replace(/^[A-Z_]+:\s*/, '').trim();
  throw new Error(cleaned || fallback);
}

async function callRpc<T>(client: RpcClient, name: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  let result: RpcResult;
  try {
    result = await client.rpc(name, args);
  } catch (cause) {
    toMessage(cause, fallback);
  }
  if (result.error) toMessage(result.error, fallback);
  return result.data as T;
}

export const icpcKeys = {
  root: ['icpc'] as const,
  context: (mode: IcpcMode) => ['icpc', 'context', mode] as const,
  overview: (mode: IcpcMode, days: number, scope: string | null) => ['icpc', 'overview', mode, days, scope] as const,
  training: (mode: IcpcMode) => ['icpc', 'training', mode] as const,
  problems: (mode: IcpcMode, filters: ProblemFilters) => ['icpc', 'problems', mode, filters] as const,
  contests: (mode: IcpcMode) => ['icpc', 'contests', mode] as const,
  contest: (id: number) => ['icpc', 'contest', id] as const,
  team: (mode: IcpcMode, days: number) => ['icpc', 'team', mode, days] as const,
  calendar: (mode: IcpcMode, from: string, to: string) => ['icpc', 'calendar', mode, from, to] as const,
  notes: (mode: IcpcMode, query: string) => ['icpc', 'notes', mode, query] as const,
  analytics: (mode: IcpcMode, days: number) => ['icpc', 'analytics', mode, days] as const,
};

function invalidateAll(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: icpcKeys.root });
}

export function useIcpcContext(mode: IcpcMode) {
  return useQuery({
    queryKey: icpcKeys.context(mode),
    staleTime: 120_000,
    queryFn: () => callRpc<IcpcContext>(clientFor(mode), 'icpc_context', {}, 'معرفناش نحدد صلاحيتك في ICPC Hub.'),
  });
}

export function useIcpcOverview(mode: IcpcMode, days: number, scope: string | null) {
  return useQuery({
    queryKey: icpcKeys.overview(mode, days, scope),
    staleTime: 60_000,
    queryFn: () => callRpc<OverviewPayload>(
      clientFor(mode),
      'icpc_overview',
      { p_days: days, p_scope: scope },
      'معرفناش نحمّل نظرة ICPC العامة.',
    ),
  });
}

export function useIcpcTraining(mode: IcpcMode) {
  return useQuery({
    queryKey: icpcKeys.training(mode),
    staleTime: 60_000,
    queryFn: () => callRpc<TrainingPayload>(clientFor(mode), 'icpc_training', {}, 'معرفناش نحمّل خريطة التدريب.'),
  });
}

export function useSetTopicStatus(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { topicId: number; status: 'todo' | 'learning' | 'done' }) =>
      callRpc<{ ok: boolean }>(
        clientFor(mode),
        'icpc_set_topic',
        { p_topic_id: input.topicId, p_status: input.status },
        'معرفناش نحدّث حالة الموضوع.',
      ),
    onSuccess: () => invalidateAll(client),
  });
}

export function useIcpcProblems(mode: IcpcMode, filters: ProblemFilters) {
  return useQuery({
    queryKey: icpcKeys.problems(mode, filters),
    staleTime: 30_000,
    queryFn: () => callRpc<ProblemsPayload>(
      clientFor(mode),
      'icpc_problems',
      { p_filters: filters },
      'معرفناش نحمّل بنك المسائل.',
    ),
  });
}

export function useSaveProblem(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ id: number }>(clientFor(mode), 'icpc_save_problem', { p_payload: payload }, 'معرفناش نحفظ المسألة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useDeleteProblem(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_delete_problem', { p_id: id }, 'معرفناش نحذف المسألة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useAssignProblem(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { problemId: number; userIds: string[]; due?: string | null }) =>
      callRpc<{ assigned: number }>(
        clientFor(mode),
        'icpc_assign_problem',
        { p_problem_id: input.problemId, p_user_ids: input.userIds, p_due: input.due || null },
        'معرفناش نكلّف المسألة.',
      ),
    onSuccess: () => invalidateAll(client),
  });
}

export function useSetProgress(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: number; status: string; attempts?: number; notes?: string }) =>
      callRpc<{ ok: boolean }>(
        clientFor(mode),
        'icpc_set_progress',
        {
          p_assignment_id: input.assignmentId,
          p_status: input.status,
          p_attempts: input.attempts ?? null,
          p_notes: input.notes ?? null,
        },
        'معرفناش نحدّث تقدم المسألة.',
      ),
    onSuccess: () => invalidateAll(client),
  });
}

export function useIcpcContests(mode: IcpcMode) {
  return useQuery({
    queryKey: icpcKeys.contests(mode),
    staleTime: 30_000,
    queryFn: () => callRpc<ContestsPayload>(clientFor(mode), 'icpc_contests', {}, 'معرفناش نحمّل المسابقات.'),
  });
}

export function useSaveContest(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ id: number }>(clientFor(mode), 'icpc_save_contest', { p_payload: payload }, 'معرفناش نحفظ المسابقة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useContestDetail(id: number | null, mode: IcpcMode) {
  return useQuery({
    queryKey: icpcKeys.contest(id ?? 0),
    enabled: id !== null,
    queryFn: () => callRpc<ContestDetail>(clientFor(mode), 'icpc_contest_detail', { p_id: id }, 'معرفناش نحمّل المسابقة.'),
  });
}

export function useJoinContest(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_contest_join', { p_id: id }, 'معرفناش نسجّل مشاركتك.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useRecordContest(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ score: number }>(clientFor(mode), 'icpc_contest_record', { p_payload: payload }, 'معرفناش نسجّل نتيجة المسابقة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useIcpcTeam(mode: IcpcMode, days: number) {
  return useQuery({
    queryKey: icpcKeys.team(mode, days),
    staleTime: 60_000,
    queryFn: () => callRpc<TeamPayload>(clientFor(mode), 'icpc_team', { p_days: days }, 'معرفناش نحمّل أداء الفريق.'),
  });
}

export function useIcpcCalendar(mode: IcpcMode, from: string, to: string) {
  return useQuery({
    queryKey: icpcKeys.calendar(mode, from, to),
    staleTime: 30_000,
    queryFn: () => callRpc<CalendarPayload>(
      clientFor(mode),
      'icpc_calendar',
      { p_from: from, p_to: to },
      'معرفناش نحمّل تقويم التدريب.',
    ),
  });
}

export function useSaveSession(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ id: number }>(clientFor(mode), 'icpc_save_session', { p_payload: payload }, 'معرفناش نحفظ الجلسة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useDeleteSession(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_delete_session', { p_id: id }, 'معرفناش نحذف الجلسة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useIcpcNotes(mode: IcpcMode, query: string) {
  return useQuery({
    queryKey: icpcKeys.notes(mode, query),
    staleTime: 30_000,
    queryFn: () => callRpc<NotesPayload>(clientFor(mode), 'icpc_notes', { p_query: query || null }, 'معرفناش نحمّل المعرفة.'),
  });
}

export function useSaveNote(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ id: number }>(clientFor(mode), 'icpc_save_note', { p_payload: payload }, 'معرفناش نحفظ الملاحظة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useDeleteNote(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_delete_note', { p_id: id }, 'معرفناش نحذف الملاحظة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useIcpcAnalytics(mode: IcpcMode, days: number) {
  return useQuery({
    queryKey: icpcKeys.analytics(mode, days),
    staleTime: 60_000,
    queryFn: () => callRpc<AnalyticsPayload>(clientFor(mode), 'icpc_analytics', { p_days: days }, 'معرفناش نحمّل التحليلات.'),
  });
}

export function useLinkPlatform(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_link_platform', { p_payload: payload }, 'معرفناش نربط حساب المنصة.'),
    onSuccess: () => invalidateAll(client),
  });
}

export function useAddRating(mode: IcpcMode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callRpc<{ ok: boolean }>(clientFor(mode), 'icpc_add_rating', { p_payload: payload }, 'معرفناش نضيف التقييم.'),
    onSuccess: () => invalidateAll(client),
  });
}
