import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase/client';
import { toAppError } from '../../../lib/supabase/errors';
import type { AdminAccess, AdminAccount } from '../../../types/db';
import type { AdminPermissions } from '../../../types/db';
import type { AdminCapability, CapabilityInbox, CapabilityState } from './capabilities';

export const adminAccessKey = (userId: string | null) => ['admin-access', userId] as const;
export const adminAccountsKey = ['admin-accounts'] as const;

export interface AdminInviteResult {
  account: AdminAccount;
  invited: boolean;
}

export interface AdminDemotionResult {
  target_uuid: string;
  demoted: true;
  member_linked: boolean;
}

async function functionError(error: unknown, fallback: string): Promise<Error> {
  const response = (error as Error & { context?: unknown })?.context;
  if (response instanceof Response) {
    const payload = await response.clone().json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    if (typeof payload?.code === 'string' && typeof payload.message === 'string') {
      return toAppError(new Error(`${payload.code}: ${payload.message}`), fallback);
    }
  }
  return toAppError(error, fallback);
}

export function useAdminAccess(userId: string | null) {
  return useQuery({
    queryKey: adminAccessKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<AdminAccess> => {
      const { data, error } = await supabase.rpc('get_admin_access');
      if (error) throw toAppError(error, 'معرفناش نتحقق من صلاحيات الحساب.');
      return data as AdminAccess;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    retry: false,
  });
}

export function useAdminAccounts() {
  return useQuery({
    queryKey: adminAccountsKey,
    queryFn: async (): Promise<AdminAccount[]> => {
      const { data, error } = await supabase.rpc('admin_list_accounts');
      if (error) throw toAppError(error, 'معرفناش نحمّل قائمة المشرفين.');
      return data ?? [];
    },
  });
}

export function useAddAdminAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.functions.invoke<AdminInviteResult>('admin-invite', { body: { email } });
      if (error) {
        throw await functionError(error, 'معرفناش نضيف المشرف.');
      }
      if (!data?.account) throw new Error('معرفناش نضيف المشرف.');
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
    },
  });
}

export function useRemoveAdminAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke<{ deleted: boolean }>('admin-delete-account', { body: { user_id: userId } });
      if (error) throw await functionError(error, 'معرفناش نحذف الحساب.');
      if (!data?.deleted) throw new Error('ADMIN_DELETE_FAILED: لم يتم حذف الحساب.');
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
      await queryClient.invalidateQueries({ queryKey: ['admin-access'] });
    },
  });
}

function isAdminDemotionResult(value: unknown): value is AdminDemotionResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return Object.keys(result).sort().join(',') === 'demoted,member_linked,target_uuid'
    && typeof result.target_uuid === 'string'
    && result.demoted === true
    && typeof result.member_linked === 'boolean';
}

export function useDemoteAdminAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<AdminDemotionResult> => {
      const { data, error } = await supabase.rpc('admin_demote_account', { p_user_id: userId });
      if (error) throw toAppError(error, 'معرفناش نشيل صلاحية الإدارة العامة.');
      if (!isAdminDemotionResult(data) || data.target_uuid !== userId) {
        throw new Error('INVALID_ADMIN_DEMOTION_RESULT: تعذر تأكيد إزالة صلاحية الإدارة.');
      }
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
      await queryClient.invalidateQueries({ queryKey: ['admin-access'] });
    },
  });
}

export function useUpdateAdminPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: AdminPermissions }) => {
      const { data, error } = await supabase.rpc('admin_update_permissions', {
        p_user_id: userId,
        p_permissions: permissions,
      });
      if (error) throw toAppError(error, 'معرفناش نحفظ الصلاحيات.');
      if (data !== true) throw new Error('INVALID_PERMISSIONS: تعذر حفظ الصلاحيات.');
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
      await queryClient.invalidateQueries({ queryKey: ['admin-access'] });
    },
  });
}

const capabilityStateKey = ['admin-capability-state'] as const;
const capabilityInboxKey = ['admin-capability-inbox'] as const;

export function useCapabilityState(enabled: boolean) {
  return useQuery({
    queryKey: capabilityStateKey,
    enabled,
    queryFn: async (): Promise<CapabilityState> => {
      const { data, error } = await supabase.rpc('admin_capability_state');
      if (error) throw toAppError(error, 'معرفناش نتحقق من صلاحيات القدرات.');
      return data as unknown as CapabilityState;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useRequestCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ capability, note }: { capability: AdminCapability; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_request_capability', {
        p_capability: capability,
        p_note: note ?? null,
      });
      if (error) throw toAppError(error, 'معرفناش نبعت طلب الصلاحية.');
      return data as { id: number; capability: AdminCapability; status: string };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: capabilityStateKey });
      await queryClient.invalidateQueries({ queryKey: capabilityInboxKey });
    },
  });
}

export function useCancelCapabilityRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: number) => {
      const { data, error } = await supabase.rpc('admin_cancel_capability_request', { p_request_id: requestId });
      if (error) throw toAppError(error, 'معرفناش نلغي الطلب.');
      return data === true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: capabilityStateKey });
      await queryClient.invalidateQueries({ queryKey: capabilityInboxKey });
    },
  });
}

export function useCapabilityInbox(enabled: boolean) {
  return useQuery({
    queryKey: capabilityInboxKey,
    enabled,
    queryFn: async (): Promise<CapabilityInbox> => {
      const { data, error } = await supabase.rpc('admin_capability_inbox');
      if (error) throw toAppError(error, 'معرفناش نحمّل طلبات الصلاحيات.');
      return data as unknown as CapabilityInbox;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useDecideCapabilityRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, approve, minutes, note }: { requestId: number; approve: boolean; minutes?: number; note?: string }) => {
      const { data, error } = await supabase.rpc('admin_decide_capability_request', {
        p_request_id: requestId,
        p_approve: approve,
        p_minutes: minutes ?? 1440,
        p_note: note ?? null,
      });
      if (error) throw toAppError(error, 'معرفناش نحفظ القرار.');
      return data as { id: number; status: string; grant_id: number | null; expires_at: string | null };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: capabilityInboxKey });
      await queryClient.invalidateQueries({ queryKey: capabilityStateKey });
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
    },
  });
}

export function useRevokeCapabilityGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: number) => {
      const { data, error } = await supabase.rpc('admin_revoke_capability_grant', { p_grant_id: grantId });
      if (error) throw toAppError(error, 'معرفناش نسحب الصلاحية.');
      return data === true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: capabilityInboxKey });
      await queryClient.invalidateQueries({ queryKey: capabilityStateKey });
    },
  });
}

/** المالك بس: مصفوفة قدرات كل المشرفين عشان يمنح/يسحب بشكل مباشر ودائم. */
export const capabilityMatrixKey = ['admin-capability-matrix'] as const;
export interface CapabilityMatrixEntry {
  user_id: string;
  email: string;
  role: 'owner' | 'admin';
  permissions: Partial<AdminPermissions>;
  capabilities: Record<AdminCapability, { allowed: boolean; permanent: boolean; granted_until: string | null }>;
}
export function useCapabilityMatrix(enabled: boolean) {
  return useQuery({
    queryKey: capabilityMatrixKey,
    enabled,
    queryFn: async (): Promise<CapabilityMatrixEntry[]> => {
      const { data, error } = await supabase.rpc('admin_capability_matrix');
      if (error) throw toAppError(error, 'معرفناش نحمّل صلاحيات المشرفين.');
      return (data as CapabilityMatrixEntry[] | null) ?? [];
    },
    staleTime: 15_000,
    refetchOnMount: 'always',
    retry: false,
  });
}
export function useSetAdminCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, capability, granted }: { userId: string; capability: AdminCapability; granted: boolean }) => {
      const { data, error } = await supabase.rpc('admin_set_capability', {
        p_user_id: userId, p_capability: capability, p_granted: granted,
      });
      if (error) throw toAppError(error, 'معرفناش نحفظ الصلاحية.');
      return data as { user_id: string; capability: string; granted: boolean };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: capabilityMatrixKey });
      await queryClient.invalidateQueries({ queryKey: capabilityInboxKey });
      await queryClient.invalidateQueries({ queryKey: capabilityStateKey });
      await queryClient.invalidateQueries({ queryKey: adminAccountsKey });
      await queryClient.invalidateQueries({ queryKey: ['admin-access'] });
    },
  });
}
