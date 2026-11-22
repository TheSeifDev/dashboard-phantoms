import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import type { ReferenceDraft, ReferencePayload } from './types';

interface RpcResult { data: unknown; error: { message?: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

// نفس الـadapter الضيق المستخدم في الاجتماعات: الـDatabase type مش عارف RPCs الجديدة.
const adminRpc = supabase as unknown as RpcClient;
const memberRpc = memberSupabase as unknown as RpcClient;

function toMessage(cause: unknown, fallback: string): never {
  const message = typeof cause === 'object' && cause !== null && 'message' in cause
    ? String((cause as { message?: unknown }).message ?? '')
    : '';
  throw new Error(message && /[A-Z_]+:/.test(message) ? message.replace(/^[A-Z_]+:\s*/, '') : fallback);
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

export const referencesKeys = {
  admin: ['references', 'admin'] as const,
  member: ['references', 'member'] as const,
};

export function useAdminReferences(enabled = true) {
  return useQuery({
    queryKey: referencesKeys.admin,
    enabled,
    staleTime: 60_000,
    queryFn: () => callRpc<ReferencePayload>(adminRpc, 'admin_list_references', {}, 'معرفناش نحمّل المصادر.'),
  });
}

export function useSaveReference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: ReferenceDraft) =>
      callRpc<{ id: number }>(adminRpc, 'admin_save_reference', { p_payload: draft }, 'معرفناش نحفظ المصدر.'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['references'] });
    },
  });
}

export function useDeleteReference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callRpc<boolean>(adminRpc, 'admin_delete_reference', { p_id: id }, 'معرفناش نحذف المصدر.'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['references'] });
    },
  });
}

export function useMemberReferences(enabled = true) {
  return useQuery({
    queryKey: referencesKeys.member,
    enabled,
    staleTime: 60_000,
    queryFn: () => callRpc<ReferencePayload>(memberRpc, 'member_references', {}, 'معرفناش نحمّل المصادر.'),
  });
}