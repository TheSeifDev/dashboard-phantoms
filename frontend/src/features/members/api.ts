import { MemberDeletionError } from './member-delete-errors';
// =====================================================
// طبقة بيانات الأعضاء — Online-First صارمة
// لا قاعدة ظل. لا سقوط صامت. الخطأ = isError في الواجهة.
// التحديثات التفاؤلية (Optimistic) مع تراجع تلقائي عند رفض الخادم.
// =====================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import { toAppError } from '../../lib/supabase/errors';
import { TABLES } from '../../types/db';
import type { Member, MemberInsert, MemberUpdate } from '../../types/db';
import { getDeviceToken } from '../../store/auth';
import {
  extractMemberCustomFields,
  isMissingCustomFieldsColumnError,
  packTeamNotesWithCustomFields,
  sanitizeCustomFieldsMap,
} from './customFieldsApi';
import { isInvitePlaceholderMember, syncPendingPre0020Invites } from './memberInviteApi';
import { ADMIN_MEMBER_COLUMNS, PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS } from './memberColumns';
import { assertMemberDeletionResult } from './member-delete-errors';
export { ADMIN_MEMBER_COLUMNS } from './memberColumns';

/**
  * الأعمدة العامة المسموح للـ anon بقراءتها (مطابقة لـ GRANT في
  * backend/migrations/0009_member_device_binding.sql).
  * session_token مستبعد عمداً — يُدار server-side فقط ولا يُرجع لأي عميل.
  */
export const PUBLIC_MEMBER_COLUMNS =
  'id, created_at, email, full_name, completion_rank, bio, device, meeting_attendance, work_status, can_go_alexandria' as const;

/**
  * الحقول القابلة للكتابة عبر مسار الإدارة فقط.
  * أي حقل خارج هذه القائمة (session_token, push_subscription, id,
  * created_at, completion_rank) يُسقط بصمت قبل الإرسال لمنع
  * Mass Assignment / Privilege Escalation.
  */
export const MEMBER_WRITABLE_FIELDS = [
  'email',
  'full_name',
  'team_notes',
  'residence',
  'work_conditions',
  'bio',
  'phone',
  'device',
  'gender',
  'meeting_attendance',
  'work_status',
  'can_go_alexandria',
  'custom_fields',
] as const;

type WritableUpdate = Partial<MemberInsert>;

export const sanitizeMemberUpdate = (member: MemberUpdate): WritableUpdate => {
  const clean: Record<string, unknown> = {};
  for (const field of MEMBER_WRITABLE_FIELDS) {
    if ((member as Record<string, unknown>)[field as string] !== undefined) {
      if (field === 'custom_fields') {
        clean.custom_fields = sanitizeCustomFieldsMap(member.custom_fields);
      } else {
        clean[field as string] = (member as Record<string, unknown>)[field as string];
      }
    }
  }
  return clean as WritableUpdate;
};

const getMembers = async (): Promise<Member[]> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const query = supabase.from(TABLES.members);

  if (sessionData.session) {
    const { data, error } = await query.select(ADMIN_MEMBER_COLUMNS).order('full_name', { ascending: true });
    if (error) throw toAppError(error, 'حصلت مشكلة وإحنا بنحمّل الأعضاء.');
    const extracted = (data ?? []).map((row) => extractMemberCustomFields(row as Member));
    return syncPendingPre0020Invites(extracted);
  }

  const { data, error } = await query
    .select(PUBLIC_MEMBER_COLUMNS)
    .order('full_name', { ascending: true });
  if (error) throw toAppError(error, 'حصلت مشكلة وإحنا بنحمّل الأعضاء.');
  return ((data ?? []) as Member[])
    .filter((m) => !isInvitePlaceholderMember(m))
    .map(extractMemberCustomFields);
};

export const useMembers = () => {
  return useQuery({
    queryKey: ['members'],
    queryFn: getMembers,
  });
};

export const useAddMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (member: MemberInsert) => {
      // لا يُنشأ session_token/push_subscription من العميل — تُدار server-side فقط.
      const { session_token: _st, push_subscription: _ps, ...insertable } = member as MemberInsert & {
        session_token?: unknown;
        push_subscription?: unknown;
      };
      const cleanCustomFields = sanitizeCustomFieldsMap(insertable.custom_fields);
      const payload = {
        ...insertable,
        custom_fields: cleanCustomFields,
      };

      const { data, error } = await supabase
        .from(TABLES.members)
        .insert(payload)
        .select(ADMIN_MEMBER_COLUMNS)
        .single();

      if (!error && data) {
        return extractMemberCustomFields(data as Member);
      }

      if (isMissingCustomFieldsColumnError(error)) {
        const { custom_fields: _cf, ...fallbackInsertable } = payload;
        const fallbackPayload = {
          ...fallbackInsertable,
          team_notes: packTeamNotesWithCustomFields(insertable.team_notes, cleanCustomFields),
        };
        const fallback = await supabase
          .from(TABLES.members)
          .insert(fallbackPayload)
          .select(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS)
          .single();
        if (fallback.error) throw toAppError(fallback.error, 'حصلت مشكلة في إضافة العضو.');
        return extractMemberCustomFields(fallback.data as Member);
      }

      throw toAppError(error, 'حصلت مشكلة في إضافة العضو.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
};

export const useUpdateMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (member: MemberUpdate) => {
      const sanitized = sanitizeMemberUpdate(member);
      const { data, error } = await supabase
        .from(TABLES.members)
        .update(sanitized)
        .eq('id', member.id)
        .select(ADMIN_MEMBER_COLUMNS)
        .single();

      if (!error && data) {
        return extractMemberCustomFields(data as Member);
      }

      if (isMissingCustomFieldsColumnError(error)) {
        const { custom_fields: customFields, ...fallbackSanitized } = sanitized;
        const fallbackPayload = {
          ...fallbackSanitized,
          team_notes: packTeamNotesWithCustomFields(sanitized.team_notes, customFields),
        };
        const fallback = await supabase
          .from(TABLES.members)
          .update(fallbackPayload)
          .eq('id', member.id)
          .select(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS)
          .single();
        if (fallback.error) throw toAppError(fallback.error, 'حصلت مشكلة في تحديث بيانات العضو.');
        return extractMemberCustomFields(fallback.data as Member);
      }

      throw toAppError(error, 'حصلت مشكلة في تحديث بيانات العضو.');
    },
    // تحديث تفاؤلي: أظهر التغيير فوراً، وارْجِعه إن رفض الخادم
    onMutate: async (member: MemberUpdate) => {
      await qc.cancelQueries({ queryKey: ['members'] });
      const prev = qc.getQueryData<Member[]>(['members']);
      qc.setQueryData<Member[]>(['members'], (old) =>
        old?.map((m) => (m.id === member.id ? { ...m, ...member } : m)) ?? []
      );
      return { prev };
    },
    onError: (_err, _member, ctx) => {
      if (ctx?.prev) qc.setQueryData(['members'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
};

export const useDeleteMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase
        .from(TABLES.members)
        .delete()
        .eq('id', id)
        .select('id');
      return assertMemberDeletionResult(id, data, error);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
};

type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;
/**
 * الحذف النهائي لسجل العضو — للمالك فقط.
 * الـ RPC بيتعامل مع الدعوات والاشتراكات والمراجع المرتبطة (RESTRICT) وبعدين
 * بيمسح السجل، بدل ما الخادم يرفض الحذف بسبب دعوة قديمة.
 */
export const useOwnerDeleteMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await (supabase.rpc as unknown as UntypedRpc)('owner_delete_member', { p_member_id: id });
      if (error) throw new MemberDeletionError('member_delete_unknown');
      return data as { ok: boolean; member_id: number };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
};

export const useBulkUpsertMembers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (members: MemberInsert[]) => {
      const normalized = members.map((m) => ({
        ...m,
        custom_fields: sanitizeCustomFieldsMap(m.custom_fields),
      }));
      const { data, error } = await supabase
        .from(TABLES.members)
        .upsert(normalized, { onConflict: 'email' })
        .select(ADMIN_MEMBER_COLUMNS);

      if (!error) {
        return ((data ?? []) as Member[]).map(extractMemberCustomFields);
      }

      if (isMissingCustomFieldsColumnError(error)) {
        const fallbackRows = normalized.map(({ custom_fields, ...rest }) => ({
          ...rest,
          team_notes: packTeamNotesWithCustomFields(rest.team_notes, custom_fields),
        }));
        const fallback = await supabase
          .from(TABLES.members)
          .upsert(fallbackRows, { onConflict: 'email' })
          .select(PRE_CUSTOM_FIELDS_ADMIN_MEMBER_COLUMNS);
        if (fallback.error) throw toAppError(fallback.error, 'معرفناش نستورد الدفعة — مفيش حاجة اتحفظت.');
        return ((fallback.data ?? []) as Member[]).map(extractMemberCustomFields);
      }

      throw toAppError(error, 'معرفناش نستورد الدفعة — مفيش حاجة اتحفظت.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
};

/**
  * البحث عن عضو ببريده — لتسجيل دخول بوابة الأعضاء.
  * يستخدم RPC محصورة (lookup_member_by_email) بدل SELECT مباشر.
  * تُرجع الأعمدة العامة فقط (بلا session_token) — رمز الجهاز يُحفظ
  * في مفتاح مستقل ويُمرر لكل RPC عضوية لاحقة لإثبات الملكية.
  */
export const fetchMemberByEmail = async (email: string, deviceToken?: string): Promise<Member | null> => {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await memberSupabase
    .rpc('lookup_member_by_email', {
      p_email: cleanEmail,
      p_device_token: deviceToken || null,
    })
    .maybeSingle();

  if (error) {
    if (error.message.includes('DEVICE_CONFLICT')) {
      throw new Error('الحساب ده مفتوح من متصفح أو جهاز تاني. اخرج من الجهاز الأول وجرّب تاني.');
    }
    throw toAppError(error, 'معرفناش نتحقق من البريد الإلكتروني.');
  }
  return (data as Member | null) ?? null;
};

export const bindMemberDeviceSession = async (email: string, deviceToken: string): Promise<boolean> => {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await memberSupabase.rpc('bind_member_device_session', {
    p_email: cleanEmail,
    p_device_token: deviceToken,
  });
  if (error) throw toAppError(error, 'معرفناش نوثق ونربط هذا الجهاز.');
  return data === true;
};

export const logoutMemberDevice = async (memberId: number, deviceToken: string): Promise<void> => {
  const { error } = await memberSupabase.rpc('logout_member_device', {
    p_member_id: memberId,
    p_device_token: deviceToken,
  });
  if (error) throw toAppError(error, 'معرفناش نسجّل خروج الجهاز.');
};

/** جاهزية الميدان — خدمة ذاتية للعضو عبر RPC (عمود واحد، برمز الجهاز) */
export const updateMemberReadiness = async (memberId: number, canGo: boolean): Promise<boolean> => {
  const { data, error } = await memberSupabase.rpc('update_member_readiness', {
    p_member_id: memberId,
    p_device_token: getDeviceToken() ?? '',
    p_can_go: canGo,
  });
  if (error) throw toAppError(error, 'معرفناش نحدّث حالة الاستعداد.');
  return data === true;
};

/** ------------------------------------------------------------------
 * دليل التيمات الداخلية (Software / AI / Hardware) لصفحة الأعضاء.
 * القراءة مسموحة للإدارة عبر RLS: teams لأي admin، وteam_memberships
 * لمن عنده صلاحية members. الفشل لا يوقف الصفحة — الفلتر يختفي فقط.
 * ------------------------------------------------------------------ */
export interface MemberTeamDirectory {
  teams: Array<{ slug: string; name: string }>;
  /** member_id → أكواد التيمات النشطة */
  byMember: Record<number, string[]>;
  /** member_id → team slug → status (active/pending/suspended) */
  statusByMember: Record<number, Record<string, string>>;
}

export const useMemberTeamDirectory = (enabled = true) => {
  return useQuery({
    queryKey: ['member-team-directory'],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<MemberTeamDirectory> => {
      const [teamsResult, membershipsResult] = await Promise.all([
        supabase.from('teams').select('id, slug, name, is_active').eq('is_active', true).order('name'),
        supabase.from('team_memberships').select('member_id, team_id, status'),
      ]);
      if (teamsResult.error) throw toAppError(teamsResult.error, 'معرفناش نحمّل التيمات الداخلية.');
      if (membershipsResult.error) throw toAppError(membershipsResult.error, 'معرفناش نحمّل عضويات التيمات.');
      const teams = (teamsResult.data ?? []).map((row) => ({ id: String(row.id), slug: row.slug, name: row.name }));
      const slugById = new Map(teams.map((team) => [team.id, team.slug]));
      const byMember: Record<number, string[]> = {};
      const statusByMember: Record<number, Record<string, string>> = {};
      for (const row of membershipsResult.data ?? []) {
        const slug = slugById.get(String(row.team_id));
        if (!slug) continue;
        const memberId = Number(row.member_id);
        statusByMember[memberId] = { ...statusByMember[memberId], [slug]: row.status };
        if (row.status === 'active') byMember[memberId] = [...(byMember[memberId] ?? []), slug];
      }
      return { teams: teams.map(({ slug, name }) => ({ slug, name })), byMember, statusByMember };
    },
  });
};
