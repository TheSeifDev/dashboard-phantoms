import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';

export type TelegramNotifyFlags = {
  tasks: boolean;
  announcements: boolean;
  evaluations: boolean;
  strikes: boolean;
  meetings: boolean;
  ledger: boolean;
  references: boolean;
  projects: boolean;
  capability: boolean;
  accounts: boolean;
  bonus: boolean;
  notes: boolean;
};

export type TelegramAdminState = {
  configured: boolean;
  enabled: boolean;
  bot_username: string | null;
  has_token: boolean;
  drain_url: string;
  webhook_set_at: string | null;
  last_webhook_at: string | null;
  last_error: string | null;
  updated_at: string;
  updated_by: string | null;
  notify: TelegramNotifyFlags;
  links: { total: number; muted: number; members: number };
  outbox: { pending: number; failed: number; sent_24h: number };
};

export type TelegramLink = {
  id: number;
  user_id: string;
  member_id: number | null;
  full_name: string | null;
  email: string | null;
  chat_id: number;
  username: string | null;
  muted: boolean;
  linked_at: string;
  last_seen_at: string;
};

export type TelegramOutboxRow = {
  id: number;
  chat_id: number;
  kind: string;
  body: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type TelegramMemberState = {
  enabled: boolean;
  bot_username: string | null;
  linked: boolean;
  username: string | null;
  muted: boolean;
  linked_at: string | null;
};

export type TelegramLinkCode = {
  code: string;
  expires_at: string;
  bot_username: string | null;
  deep_link: string | null;
};

const stateKey = ['telegram', 'state'] as const;
const linksKey = ['telegram', 'links'] as const;
const outboxKey = ['telegram', 'outbox'] as const;
const memberKey = ['telegram', 'member'] as const;

type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

/** RPCs here are newer than the generated Database union, so they go through an untyped call. */
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as UntypedRpc)(name, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export function useTelegramState(enabled = true) {
  return useQuery({
    queryKey: stateKey,
    enabled,
    queryFn: () => rpc<TelegramAdminState>('telegram_admin_state'),
    refetchInterval: 45_000,
  });
}

export function useSaveTelegramSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => rpc<TelegramAdminState>('telegram_save_settings', { p_payload: payload }),
    onSuccess: (data) => {
      queryClient.setQueryData(stateKey, data);
      void queryClient.invalidateQueries({ queryKey: stateKey });
    },
  });
}

export function useTelegramLinks(enabled = true) {
  return useQuery({
    queryKey: linksKey,
    enabled,
    queryFn: () => rpc<TelegramLink[]>('telegram_links_list'),
  });
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) => rpc<boolean>('telegram_unlink', { p_link_id: linkId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey });
      void queryClient.invalidateQueries({ queryKey: stateKey });
    },
  });
}

export function useMuteTelegramLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, muted }: { linkId: number; muted: boolean }) =>
      rpc<boolean>('telegram_set_muted', { p_link_id: linkId, p_muted: muted }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey });
      void queryClient.invalidateQueries({ queryKey: stateKey });
    },
  });
}

export function useTelegramOutbox(enabled = true) {
  return useQuery({
    queryKey: outboxKey,
    enabled,
    queryFn: () => rpc<TelegramOutboxRow[]>('telegram_outbox_list', { p_limit: 40 }),
    refetchInterval: 30_000,
  });
}

export function useRetryTelegramMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rpc<boolean>('telegram_retry_message', { p_id: id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outboxKey }),
  });
}

export function useSendTelegramTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<{ queued: boolean; id: number }>('telegram_send_test'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outboxKey }),
  });
}

export function useBroadcastTelegram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ text, audience }: { text: string; audience: Record<string, unknown> }) =>
      rpc<number>('telegram_broadcast', { p_text: text, p_audience: audience }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: outboxKey }),
  });
}

/** يفعّل الويبهوك على تلجرام عبر الـ edge function بعد ما المالك يحط التوكن. */
export function useSyncTelegramWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('telegram-bot', { body: { action: 'sync-auth' } });
      if (error) throw new Error(error.message);
      const payload = data as { ok?: boolean; description?: string } | null;
      if (!payload?.ok) throw new Error(payload?.description ?? 'فشل تفعيل الويبهوك.');
      return payload;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: stateKey }),
  });
}

export function useTelegramMemberState(enabled = true) {
  return useQuery({
    queryKey: memberKey,
    enabled,
    queryFn: () => rpc<TelegramMemberState>('telegram_member_link_state'),
  });
}

export function useCreateTelegramLinkCode() {
  return useMutation({
    mutationFn: () => rpc<TelegramLinkCode>('telegram_member_link_code'),
  });
}

export function useUnlinkTelegramSelf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<boolean>('telegram_unlink_self'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: memberKey }),
  });
}

export function useToggleTelegramMuteSelf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<boolean>('telegram_toggle_mute_self'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: memberKey }),
  });
}

export const TELEGRAM_EVENT_LABELS: Array<{ key: keyof TelegramNotifyFlags; ar: string; en: string }> = [
  { key: 'tasks', ar: 'المهام الجديدة', en: 'New tasks' },
  { key: 'announcements', ar: 'الإعلانات', en: 'Announcements' },
  { key: 'evaluations', ar: 'التقييمات', en: 'Evaluations' },
  { key: 'strikes', ar: 'التحذيرات', en: 'Strikes' },
  { key: 'meetings', ar: 'الاجتماعات والحضور', en: 'Meetings and attendance' },
  { key: 'ledger', ar: 'الخزنة والدفعات', en: 'Ledger and payments' },
  { key: 'references', ar: 'المصادر', en: 'References' },
  { key: 'projects', ar: 'مشاريع الويب', en: 'Web projects' },
  { key: 'capability', ar: 'طلبات الصلاحيات', en: 'Capability requests' },
  { key: 'accounts', ar: 'طلبات الحذف', en: 'Account requests' },
  { key: 'bonus', ar: 'البونص المفتوح', en: 'Open bonus' },
  { key: 'notes', ar: 'الملاحظات', en: 'Notes' },
];
