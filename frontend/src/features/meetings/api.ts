import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import type {
  MarkAttendanceResult,
  Meeting,
  MeetingDraft,
  MeetingRoster,
  MemberMeetingsPayload,
} from './types';

interface RpcResult { data: unknown; error: { message?: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

// The generated Database type does not know the meetings RPCs yet; same narrow adapter
// used by the member insights hook.
const rpc = supabase as unknown as RpcClient;
// بوابة العضو عندها عميل Supabase منفصل بجلسة العضو (نفس نمط member_internal_teams).
const memberRpc = memberSupabase as unknown as RpcClient;

function fail(cause: unknown, fallback: string): never {
  const message = typeof cause === 'object' && cause !== null && 'message' in cause
    ? String((cause as { message?: unknown }).message ?? '')
    : '';
  throw new Error(message && /[A-Z_]+:/.test(message) ? message.replace(/^[A-Z_]+:\s*/, '') : fallback);
}

async function callRpc<T>(name: string, args: Record<string, unknown>, fallback: string, client: RpcClient = rpc): Promise<T> {
  let result: RpcResult;
  try {
    result = await client.rpc(name, args);
  } catch (cause) {
    fail(cause, fallback);
  }
  if (result.error) fail(result.error, fallback);
  return result.data as T;
}

export const meetingsKeys = {
  list: ['meetings', 'list'] as const,
  roster: (id: number) => ['meetings', 'roster', id] as const,
  member: ['meetings', 'member'] as const,
};

const AR_LIST = 'معرفناش نحمّل سجل الاجتماعات.';
const AR_SAVE = 'معرفناش نحفظ الاجتماع.';
const AR_ROSTER = 'معرفناش نحمّل كشف الحضور.';
const AR_SCAN = 'معرفناش نسجّل الحضور.';
const AR_MEMBER = 'معرفناش نحمّل اجتماعاتك.';

export interface MeetingListPayload { meetings: Meeting[]; total: number }

export function useMeetings(enabled = true) {
  return useQuery({
    queryKey: meetingsKeys.list,
    enabled,
    staleTime: 30_000,
    queryFn: () => callRpc<MeetingListPayload>('admin_list_meetings', { p_limit: 100, p_offset: 0 }, AR_LIST),
  });
}

export function useSaveMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: MeetingDraft) => callRpc<{ id: number }>('admin_save_meeting', { p_payload: draft }, AR_SAVE),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useDeleteMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<boolean>('admin_delete_meeting', { p_id: id }, 'معرفناش نحذف الاجتماع.'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useMeetingRoster(meetingId: number | null) {
  return useQuery({
    queryKey: meetingsKeys.roster(meetingId ?? 0),
    enabled: typeof meetingId === 'number' && meetingId > 0,
    staleTime: 10_000,
    queryFn: () => fetchMeetingRoster(meetingId as number),
  });
}

/** كشف الحضور بره الكاش — بيستخدمه تصدير كل الاجتماعات. */
export function fetchMeetingRoster(meetingId: number): Promise<MeetingRoster> {
  return callRpc<MeetingRoster>('admin_meeting_roster', { p_meeting_id: meetingId }, AR_ROSTER);
}

export function useMarkAttendance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, code }: { meetingId: number; code: string }) =>
      callRpc<MarkAttendanceResult>('admin_mark_attendance', { p_meeting_id: meetingId, p_code: code }, AR_SCAN),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: meetingsKeys.roster(variables.meetingId) });
      void client.invalidateQueries({ queryKey: meetingsKeys.list });
    },
  });
}

export function useSetAttendance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, memberId, present }: { meetingId: number; memberId: number; present: boolean }) =>
      callRpc<boolean>('admin_set_attendance', { p_meeting_id: meetingId, p_member_id: memberId, p_present: present }, 'معرفناش نعدّل الحضور.'),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: meetingsKeys.roster(variables.meetingId) });
      void client.invalidateQueries({ queryKey: meetingsKeys.list });
    },
  });
}

export function useMemberMeetings(enabled = true) {
  return useQuery({
    queryKey: meetingsKeys.member,
    enabled,
    staleTime: 60_000,
    queryFn: () => callRpc<MemberMeetingsPayload>('member_meetings', {}, AR_MEMBER, memberRpc),
  });
}
