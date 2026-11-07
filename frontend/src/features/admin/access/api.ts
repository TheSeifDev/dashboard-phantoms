import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase/client';
import { toAppError } from '../../../lib/supabase/errors';
import type { AdminAccess, AdminAccount } from '../../../types/db';
import type { AdminPermissions } from '../../../types/db';

export const adminAccessKey = (userId: string | null) => ['admin-access', userId] as const;
export const adminAccountsKey = ['admin-accounts'] as const;

export interface AdminInviteResult {
  account: AdminAccount;
  invited: boolean;
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
