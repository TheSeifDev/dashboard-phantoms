import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import type {
  AdminLedgerPayload,
  LedgerDueDraft,
  LedgerEntryDraft,
  LedgerPaymentDraft,
  LedgerSeriesPoint,
  MemberLedgerPayload,
} from './types';
import type { LedgerDueBulkDraft, LedgerDueBulkResult } from './types';
interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}
interface RpcClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
}
// نفس الـadapter الضيق المستخدم في المصادر والاجتماعات: الـDatabase type مش عارف RPCs الجديدة.
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
/** الخزنة بقت واحدة global — الفلتر الوحيد هو التيم/الوحدة. */
export const ledgerKeys = {
  admin: (unit: string | null) => ['ledger', 'admin', unit ?? 'all'] as const,
  member: () => ['ledger', 'member'] as const,
  series: (unit: string | null) => ['ledger', 'series', unit ?? 'all'] as const,
  directory: () => ['ledger', 'directory'] as const,
};
export interface LedgerDirectoryMember {
  id: number;
  full_name: string | null;
  academic_number: string | null;
  unit: string | null;
  work_status: string | null;
}
export function useLedgerDirectory(enabled = true) {
  return useQuery({
    queryKey: ledgerKeys.directory(),
    staleTime: 60_000,
    enabled,
    queryFn: () =>
      callRpc<{ members: LedgerDirectoryMember[] }>(
        adminRpc,
        'admin_ledger_directory',
        {},
        'معرفناش نحمّل قائمة الأعضاء.',
      ).then((payload) => payload.members ?? []),
  });
}
export function useAdminLedger(unit: string | null = null) {
  return useQuery({
    queryKey: ledgerKeys.admin(unit),
    staleTime: 30_000,
    queryFn: () => callRpc<AdminLedgerPayload>(
      adminRpc,
      'admin_ledger_overview',
      { p_unit: unit },
      'معرفناش نحمّل الخزنة.',
    ),
  });
}
/** أرقام آخر 6 شهور للـ chart والـ sparkline. */
export function useLedgerSeries(unit: string | null = null, client: 'admin' | 'member' = 'admin') {
  return useQuery({
    queryKey: ledgerKeys.series(unit),
    staleTime: 30_000,
    queryFn: () => callRpc<LedgerSeriesPoint[]>(
      client === 'admin' ? adminRpc : memberRpc,
      'ledger_series',
      { p_unit: unit },
      'معرفناش نحمّل أرقام الخزنة.',
    ),
  });
}
function useLedgerInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['ledger'] });
  };
}
export function useSaveLedgerEntry() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: ({ draft }: { draft: LedgerEntryDraft }) =>
      callRpc<{ id: number }>(
        adminRpc,
        'admin_ledger_save_entry',
        { p_payload: draft },
        'معرفناش نحفظ الحركة.',
      ),
    onSuccess: invalidate,
  });
}
export function useDeleteLedgerEntry() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: (id: number) =>
      callRpc<{ id: number }>(adminRpc, 'admin_ledger_delete_entry', { p_id: id }, 'معرفناش نحذف الحركة.'),
    onSuccess: invalidate,
  });
}
export function useDecideLedgerPayment() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: ({ id, decision, note, amount }: { id: number; decision: 'approve' | 'reject'; note?: string; amount?: number | null }) =>
      callRpc<{ id: number; status: string; amount: number }>(
        adminRpc,
        'admin_ledger_decide',
        { p_id: id, p_decision: decision, p_note: note ?? null, p_amount: amount ?? null },
        'معرفناش نسجّل القرار.',
      ),
    onSuccess: invalidate,
  });
}
export function useSaveLedgerDue() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: ({ draft }: { draft: LedgerDueDraft }) =>
      callRpc<{ id: number }>(
        adminRpc,
        'admin_ledger_save_due',
        { p_payload: draft },
        'معرفناش نحفظ الالتزام.',
      ),
    onSuccess: invalidate,
  });
}
export function useDeleteLedgerDue() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: (id: number) =>
      callRpc<{ id: number }>(adminRpc, 'admin_ledger_delete_due', { p_id: id }, 'معرفناش نحذف الالتزام.'),
    onSuccess: invalidate,
  });
}
export function useMemberLedger() {
  return useQuery({
    queryKey: ledgerKeys.member(),
    staleTime: 30_000,
    queryFn: () => callRpc<MemberLedgerPayload>(
      memberRpc,
      'member_ledger',
      {},
      'معرفناش نحمّل الخزنة.',
    ),
  });
}
export function useDeclarePayment() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: ({ draft }: { draft: LedgerPaymentDraft }) =>
      callRpc<{ id: number; status: string; amount: number; receiver_label: string | null }>(
        memberRpc,
        'member_ledger_declare_payment',
        { p_payload: draft },
        'معرفناش نسجّل الدفعة.',
      ),
    onSuccess: invalidate,
  });
}

export function useSaveLedgerDueBulk() {
  const invalidate = useLedgerInvalidation();
  return useMutation({
    mutationFn: ({ draft }: { draft: LedgerDueBulkDraft }) =>
      callRpc<LedgerDueBulkResult>(
        adminRpc,
        'admin_ledger_save_due_bulk',
        { p_payload: draft },
        'معرفناش نحفظ الالتزام.',
      ),
    onSuccess: invalidate,
  });
}
