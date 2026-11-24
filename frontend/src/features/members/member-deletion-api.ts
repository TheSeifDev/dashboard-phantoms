import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import {
  KNOWN_CODES,
  MemberDeletionApiError,
  isDeletionRequestId,
  isDeletionStatus,
  type MemberDeletionErrorCode,
  MEMBER_DELETION_POLL_MS,
  MEMBER_DELETION_QUEUE_KEY,
  MEMBER_DELETION_REASON_MAX,
  MEMBER_DELETION_STATE_KEY,
  type MemberDeletionRequestRecord,
  type MemberDeletionState,
} from './member-deletion-rules';

export * from './member-deletion-rules';

function readCode(source: unknown): MemberDeletionErrorCode {
  const message = source instanceof Error
    ? source.message
    : typeof source === 'string' ? source : '';
  const match = KNOWN_CODES.find((code) => message.includes(code));
  if (match) return match;
  if (source && typeof source === 'object') {
    const context = (source as { context?: unknown }).context;
    if (context && typeof context === 'object') {
      const body = context as { code?: unknown; error?: unknown };
      if (typeof body.code === 'string' && (KNOWN_CODES as readonly string[]).includes(body.code)) {
        return body.code as MemberDeletionErrorCode;
      }
      if (typeof body.error === 'string') {
        const inner = KNOWN_CODES.find((code) => body.error === code || (body.error as string).includes(code));
        if (inner) return inner;
      }
    }
  }
  return 'request_failed';
}

function fail(source: unknown): never {
  throw new MemberDeletionApiError(readCode(source));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function mapState(value: unknown): MemberDeletionState | null {
  const row = asObject(value);
  if (!row) return null;
  const requestId = isDeletionRequestId(row.request_id) ? row.request_id : null;
  if (!requestId || !isDeletionStatus(row.status)) return null;
  const requestedAt = isoOrNull(row.requested_at);
  if (!requestedAt) return null;
  return {
    requestId,
    status: row.status,
    requestedAt,
    decidedAt: isoOrNull(row.decided_at),
    decisionNote: text(row.decision_note, 1000),
  };
}

export async function fetchMemberDeletionState(): Promise<MemberDeletionState | null> {
  const { data, error } = await supabase.rpc('member_deletion_request_state');
  if (error) fail(error);
  const payload = asObject(data);
  if (!payload || payload.ok !== true) fail(payload ?? 'request_failed');
  if (payload.request === null || payload.request === undefined) return null;
  const state = mapState(payload.request);
  if (!state) fail('request_failed');
  return state;
}

export async function requestMemberDeletion(reason: string): Promise<MemberDeletionState | null> {
  const trimmed = reason.replace(/\s+/g, ' ').trim().slice(0, MEMBER_DELETION_REASON_MAX);
  const { error } = await supabase.rpc('request_member_deletion', { p_reason: trimmed ? trimmed : null });
  if (error) fail(error);
  return fetchMemberDeletionState();
}

export async function cancelMemberDeletion(): Promise<void> {
  const { error } = await supabase.rpc('cancel_member_deletion_request');
  if (error) fail(error);
}

function mapAdminRow(value: unknown): MemberDeletionRequestRecord | null {
  const row = asObject(value);
  if (!row) return null;
  const state = mapState(row);
  const memberName = text(row.member_name, 200);
  const memberEmail = text(row.member_email, 320);
  if (!state || !memberName || !memberEmail) return null;
  const memberId = typeof row.member_id === 'number' && Number.isSafeInteger(row.member_id) && row.member_id > 0 ? row.member_id : null;
  return {
    ...state,
    memberId,
    memberName,
    memberEmail,
    memberReason: text(row.member_reason, 1000),
  };
}

export async function fetchMemberDeletionRequests(): Promise<MemberDeletionRequestRecord[]> {
  const { data, error } = await supabase.rpc('admin_list_member_deletion_requests');
  if (error) fail(error);
  const payload = asObject(data);
  if (!payload || payload.ok !== true || !Array.isArray(payload.requests)) fail(payload ?? 'request_failed');
  return (payload.requests as unknown[]).map(mapAdminRow).filter((row): row is MemberDeletionRequestRecord => row !== null);
}

export async function rejectMemberDeletion(requestId: string, note: string): Promise<void> {
  const trimmed = note.replace(/\s+/g, ' ').trim().slice(0, 1000);
  const { error } = await supabase.rpc('admin_reject_member_deletion', {
    p_request_id: requestId,
    p_note: trimmed ? trimmed : null,
  });
  if (error) fail(error);
}

export interface ApproveDeletionResult {
  memberName: string;
  deletedRows: number;
  removedObjects: number;
}

export async function approveMemberDeletion(requestId: string, retry = false): Promise<ApproveDeletionResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    code?: string;
    member_name?: string;
    deleted_rows?: number;
    removed_objects?: number;
  }>('member-account-deletion', {
    body: { action: retry ? 'retry' : 'approve', request_id: requestId },
  });
  if (error) fail(error);
  const payload = asObject(data);
  if (!payload || payload.ok !== true) fail(payload ?? 'request_failed');
  return {
    memberName: typeof payload.member_name === 'string' ? payload.member_name : '',
    deletedRows: typeof payload.deleted_rows === 'number' ? payload.deleted_rows : 0,
    removedObjects: typeof payload.removed_objects === 'number' ? payload.removed_objects : 0,
  };
}

export function useMemberDeletionState() {
  return useQuery({
    queryKey: MEMBER_DELETION_STATE_KEY,
    queryFn: fetchMemberDeletionState,
    refetchInterval: MEMBER_DELETION_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useRequestMemberDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => requestMemberDeletion(reason),
    onSuccess: (state) => {
      queryClient.setQueryData(MEMBER_DELETION_STATE_KEY, state);
    },
  });
}

export function useCancelMemberDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelMemberDeletion,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEMBER_DELETION_STATE_KEY });
    },
  });
}

export function useMemberDeletionRequests() {
  return useQuery({
    queryKey: MEMBER_DELETION_QUEUE_KEY,
    queryFn: fetchMemberDeletionRequests,
    refetchInterval: MEMBER_DELETION_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useRejectMemberDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestId: string; note: string }) => rejectMemberDeletion(input.requestId, input.note),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEMBER_DELETION_QUEUE_KEY });
    },
  });
}

export function useApproveMemberDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestId: string; retry?: boolean }) => approveMemberDeletion(input.requestId, input.retry),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEMBER_DELETION_QUEUE_KEY });
    },
  });
}
