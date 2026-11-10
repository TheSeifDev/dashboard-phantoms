import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { TABLES } from '../../types/db';
import type { Member, MemberCustomField } from '../../types/db';
import {
  ONBOARDING_CARRIER_LABEL,
  extractMemberCustomFields,
  isMissingCustomFieldsColumnError,
  isMissingRelationError,
  normalizeFieldRow,
  packTeamNotesWithCustomFields,
  sanitizeCustomFieldsMap,
} from './customFieldsApi';

export const MEMBER_INVITES_KEY = ['member_registration_invites'] as const;
const PRE0020_TOKEN_PREFIX = 'wsl1_';
const INVITE_PLACEHOLDER_DOMAIN = '@invite.phantoms.local';
const LEGACY_INVITE_PLACEHOLDER_DOMAIN = '@invite.wasla.local';

export interface MemberInviteRecord {
  id: number;
  note: string | null;
  expires_at: string;
  used_at: string | null;
  is_revoked: boolean;
  created_at: string;
  mode: 'native' | 'fallback';
}

export interface CreatedMemberInvite {
  id: number;
  token: string;
  url: string;
  note: string;
  expires_at: string;
}

export interface MemberInviteContext {
  valid: boolean;
  reason?: string;
  note?: string;
  expires_at?: string;
  custom_fields: MemberCustomField[];
}

export interface MemberSelfRegistrationPayload {
  full_name: string;
  email: string;
  phone: string;
  residence: string;
  work_conditions: string;
  device: string;
  gender: string;
  bio: string;
  can_go_alexandria: boolean;
  custom_fields: Record<string, string | number | boolean | null>;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeUtf8Base64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64Url(bytes);
}

function decodeUtf8Base64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * يولّد رمز دعوة عشوائي طويل جداً ومؤمّن تشفيرياً (96+ حرفاً)
 */
export function generateLongInviteToken(): string {
  const bytes = new Uint8Array(72);
  window.crypto.getRandomValues(bytes);
  return `phm_${bytesToBase64Url(bytes)}`;
}

export function buildMemberInviteUrl(token: string): string {
  const configuredWebUrl = (
    (import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined) ||
    'https://admin-phantoms.vercel.app'
  ).replace(/\/+$/, '');

  const rawOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const isNativeContainerOrigin =
    !rawOrigin ||
    rawOrigin === 'https://localhost' ||
    rawOrigin === 'http://localhost' ||
    rawOrigin.startsWith('capacitor://');

  const baseOrigin = isNativeContainerOrigin ? configuredWebUrl : rawOrigin;
  return `${baseOrigin}/join/${encodeURIComponent(token)}`;
}

interface FallbackTokenPayload {
  m: number;
  s: string;
  x: string;
  n: string;
  r: string;
}

function parseFallbackToken(token: string): FallbackTokenPayload | null {
  if (!token.startsWith(PRE0020_TOKEN_PREFIX)) return null;
  try {
    const rawJson = decodeUtf8Base64Url(token.slice(PRE0020_TOKEN_PREFIX.length));
    const parsed = JSON.parse(rawJson) as Partial<FallbackTokenPayload>;
    if (
      typeof parsed.m !== 'number' ||
      typeof parsed.s !== 'string' ||
      parsed.s.length < 16 ||
      typeof parsed.x !== 'string'
    ) {
      return null;
    }
    return {
      m: parsed.m,
      s: parsed.s,
      x: parsed.x,
      n: typeof parsed.n === 'string' ? parsed.n : '',
      r: typeof parsed.r === 'string' ? parsed.r : '',
    };
  } catch {
    return null;
  }
}

async function ensureOnboardingCarrierField(): Promise<number> {
  const existing = await (supabase as any)
    .from('member_info_fields')
    .select('id, is_active')
    .eq('label', ONBOARDING_CARRIER_LABEL)
    .maybeSingle();

  if (!existing.error && existing.data?.id) {
    if (!existing.data.is_active) {
      await (supabase as any)
        .from('member_info_fields')
        .update({ is_active: true })
        .eq('id', existing.data.id);
    }
    return Number(existing.data.id);
  }

  const inserted = await (supabase as any)
    .from('member_info_fields')
    .insert({
      label: ONBOARDING_CARRIER_LABEL,
      field_type: 'json',
      options: [],
      help_text: '',
      is_required: false,
      is_active: true,
      sort_order: -9999,
    })
    .select('id')
    .single();

  if (inserted.error || !inserted.data?.id) {
    throw toAppError(inserted.error, 'معرفناش نجهّز قناة رابط الدعوة.');
  }
  return Number(inserted.data.id);
}

export function isInvitePlaceholderMember(member: Pick<Member, 'email'>): boolean {
  if (!member.email) return false;
  const email = member.email.toLowerCase();
  return email.endsWith(INVITE_PLACEHOLDER_DOMAIN) || email.endsWith(LEGACY_INVITE_PLACEHOLDER_DOMAIN);
}

async function applyRegistrationPayloadToMemberRow(
  memberId: number,
  payload: MemberSelfRegistrationPayload,
): Promise<Member | null> {
  const cleanCustom = sanitizeCustomFieldsMap(payload.custom_fields);
  const updateBody = {
    full_name: payload.full_name.trim(),
    email: payload.email.trim().toLowerCase(),
    phone: payload.phone.trim() || null,
    residence: payload.residence.trim() || null,
    work_conditions: payload.work_conditions.trim() || null,
    device: payload.device.trim() || 'لابتوب',
    gender: payload.gender.trim() || null,
    bio: payload.bio.trim() || null,
    can_go_alexandria: Boolean(payload.can_go_alexandria),
    work_status: 'active',
    team_notes: null,
    custom_fields: cleanCustom,
  };

  const primary = await supabase
    .from(TABLES.members)
    .update(updateBody)
    .eq('id', memberId)
    .select()
    .maybeSingle();

  if (!primary.error && primary.data) {
    return extractMemberCustomFields(primary.data as Member);
  }

  if (isMissingCustomFieldsColumnError(primary.error)) {
    const { custom_fields: _cf, ...rest } = updateBody;
    const fallback = await supabase
      .from(TABLES.members)
      .update({
        ...rest,
        team_notes: packTeamNotesWithCustomFields(null, cleanCustom),
      })
      .eq('id', memberId)
      .select()
      .maybeSingle();

    if (!fallback.error && fallback.data) {
      return extractMemberCustomFields(fallback.data as Member);
    }
  }

  return null;
}

/**
 * يزامن الدعوات المسجّلة في وضع التوافق (قبل تطبيق 0020) ويرقّيها تلقائياً إلى أعضاء حقيقيين
 */
export async function syncPendingPre0020Invites(rawMembers: Member[]): Promise<Member[]> {
  const placeholders = rawMembers.filter(isInvitePlaceholderMember);
  const regularMembers = rawMembers.filter((m) => !isInvitePlaceholderMember(m));

  if (placeholders.length === 0) {
    return regularMembers;
  }

  try {
    const placeholderIds = placeholders.map((p) => p.id);
    const submissionsRes = await (supabase as any)
      .from('member_info_submissions')
      .select('member_id, values')
      .in('member_id', placeholderIds);

    if (submissionsRes.error || !Array.isArray(submissionsRes.data) || submissionsRes.data.length === 0) {
      return regularMembers;
    }

    const promotedMembers: Member[] = [];
    for (const sub of submissionsRes.data as Array<{ member_id: number; values: Record<string, unknown> }>) {
      const valuesObj = sub.values && typeof sub.values === 'object' ? sub.values : {};
      let foundPayload: MemberSelfRegistrationPayload | null = null;

      for (const val of Object.values(valuesObj)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const candidate = val as Partial<MemberSelfRegistrationPayload>;
          if (typeof candidate.email === 'string' && typeof candidate.full_name === 'string') {
            foundPayload = {
              full_name: candidate.full_name,
              email: candidate.email,
              phone: typeof candidate.phone === 'string' ? candidate.phone : '',
              residence: typeof candidate.residence === 'string' ? candidate.residence : '',
              work_conditions: typeof candidate.work_conditions === 'string' ? candidate.work_conditions : '',
              device: typeof candidate.device === 'string' ? candidate.device : 'لابتوب',
              gender: typeof candidate.gender === 'string' ? candidate.gender : '',
              bio: typeof candidate.bio === 'string' ? candidate.bio : '',
              can_go_alexandria: Boolean(candidate.can_go_alexandria),
              custom_fields: sanitizeCustomFieldsMap(candidate.custom_fields),
            };
            break;
          }
        }
      }

      if (foundPayload) {
        const promoted = await applyRegistrationPayloadToMemberRow(Number(sub.member_id), foundPayload);
        if (promoted) {
          promotedMembers.push(promoted);
        }
      }
    }

    return [...regularMembers, ...promotedMembers].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, 'ar'),
    );
  } catch {
    return regularMembers;
  }
}

export function useCreateMemberInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      note = '',
      expiresInHours = 168,
    }: {
      note?: string;
      expiresInHours?: number;
    }): Promise<CreatedMemberInvite> => {
      const cleanNote = note.trim();
      const rawToken = generateLongInviteToken();

      const nativeRes = await (supabase as any).rpc('create_member_invite', {
        p_token: rawToken,
        p_note: cleanNote || null,
        p_expires_in_hours: expiresInHours,
      });

      if (!nativeRes.error && nativeRes.data) {
        const data = nativeRes.data as { id: number; expires_at: string; note?: string | null };
        return {
          id: Number(data.id),
          token: rawToken,
          url: buildMemberInviteUrl(rawToken),
          note: data.note ?? cleanNote,
          expires_at: data.expires_at,
        };
      }

      if (isMissingRelationError(nativeRes.error, 'create_member_invite')) {
        await ensureOnboardingCarrierField();

        const deviceBytes = new Uint8Array(32);
        const saltBytes = new Uint8Array(18);
        window.crypto.getRandomValues(deviceBytes);
        window.crypto.getRandomValues(saltBytes);

        const deviceToken = bytesToHex(deviceBytes);
        const saltHex = bytesToHex(saltBytes);
        const expiresAt = new Date(Date.now() + expiresInHours * 3600_000).toISOString();
        const placeholderEmail = `invite.${Date.now()}.${saltHex.slice(0, 12)}${INVITE_PLACEHOLDER_DOMAIN}`;

        const metaNote = JSON.stringify({
          __phantoms_invite: true,
          __wasla_invite: true,
          note: cleanNote,
          expires_at: expiresAt,
        });

        const insertedMember = await supabase
          .from(TABLES.members)
          .insert({
            email: placeholderEmail,
            full_name: `[دعوة معلقة] ${cleanNote || 'عضو جديد'}`,
            completion_rank: null,
            residence: null,
            work_conditions: null,
            bio: null,
            phone: null,
            device: null,
            gender: null,
            meeting_attendance: null,
            work_status: 'inactive',
            can_go_alexandria: false,
            team_notes: metaNote,
          })
          .select('id')
          .single();

        if (insertedMember.error || !insertedMember.data) {
          throw toAppError(insertedMember.error, 'معرفناش ننشئ رابط الدعوة المحمي.');
        }

        const memberId = Number(insertedMember.data.id);
        const bindRes = await supabase.rpc('lookup_member_by_email', {
          p_email: placeholderEmail,
          p_device_token: deviceToken,
        });

        if (bindRes.error) {
          await supabase.from(TABLES.members).delete().eq('id', memberId);
          throw toAppError(bindRes.error, 'معرفناش نفعّل حماية رابط الدعوة.');
        }

        const fallbackPayload: FallbackTokenPayload = {
          m: memberId,
          s: deviceToken,
          x: expiresAt,
          n: cleanNote,
          r: saltHex,
        };

        const encodedToken = `${PRE0020_TOKEN_PREFIX}${encodeUtf8Base64Url(JSON.stringify(fallbackPayload))}`;
        return {
          id: memberId,
          token: encodedToken,
          url: buildMemberInviteUrl(encodedToken),
          note: cleanNote,
          expires_at: expiresAt,
        };
      }

      throw toAppError(nativeRes.error, 'معرفناش ننشئ رابط التسجيل.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_INVITES_KEY });
    },
  });
}

export function usePendingMemberInvites() {
  return useQuery({
    queryKey: MEMBER_INVITES_KEY,
    queryFn: async (): Promise<MemberInviteRecord[]> => {
      const native = await (supabase as any)
        .from('member_registration_invites')
        .select('id, note, expires_at, used_at, is_revoked, created_at')
        .eq('is_revoked', false)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (!native.error) {
        return ((native.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: Number(row.id),
          note: typeof row.note === 'string' ? row.note : null,
          expires_at: String(row.expires_at),
          used_at: typeof row.used_at === 'string' ? row.used_at : null,
          is_revoked: Boolean(row.is_revoked),
          created_at: String(row.created_at),
          mode: 'native' as const,
        }));
      }

      if (isMissingRelationError(native.error, 'member_registration_invites')) {
        const allMembersRes = await supabase
          .from(TABLES.members)
          .select('*')
          .order('created_at', { ascending: false });

        if (!allMembersRes.error && allMembersRes.data) {
          await syncPendingPre0020Invites(allMembersRes.data as Member[]);
        }

        const placeholders = await supabase
          .from(TABLES.members)
          .select('id, created_at, full_name, email, team_notes')
          .or(`email.like.%${INVITE_PLACEHOLDER_DOMAIN},email.like.%${LEGACY_INVITE_PLACEHOLDER_DOMAIN}`)
          .order('created_at', { ascending: false });

        if (placeholders.error || !placeholders.data) return [];

        const records: MemberInviteRecord[] = [];
        for (const row of placeholders.data) {
          let note: string | null = null;
          let expiresAt = new Date(Date.now() + 86400_000).toISOString();
          if (row.team_notes) {
            try {
              const parsed = JSON.parse(row.team_notes) as { note?: string; expires_at?: string };
              note = parsed.note || null;
              if (parsed.expires_at) expiresAt = parsed.expires_at;
            } catch {
              note = null;
            }
          }
          if (new Date(expiresAt).getTime() > Date.now()) {
            records.push({
              id: row.id,
              note,
              expires_at: expiresAt,
              used_at: null,
              is_revoked: false,
              created_at: row.created_at,
              mode: 'fallback',
            });
          }
        }
        return records;
      }

      return [];
    },
  });
}

export function useRevokeMemberInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invite: Pick<MemberInviteRecord, 'id' | 'mode'>): Promise<number> => {
      if (invite.mode === 'fallback') {
        const { error } = await supabase.from(TABLES.members).delete().eq('id', invite.id);
        if (error) throw toAppError(error, 'معرفناش نلغي رابط الدعوة.');
        return invite.id;
      }

      const { error } = await (supabase as any)
        .from('member_registration_invites')
        .update({ is_revoked: true })
        .eq('id', invite.id);
      if (error) throw toAppError(error, 'معرفناش نلغي رابط الدعوة.');
      return invite.id;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_INVITES_KEY });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export async function fetchMemberInviteContext(token: string): Promise<MemberInviteContext> {
  const cleanToken = token.trim();
  if (!cleanToken || cleanToken.length < 24) {
    return { valid: false, reason: 'INVALID_TOKEN', custom_fields: [] };
  }

  const fallbackParsed = parseFallbackToken(cleanToken);
  if (fallbackParsed) {
    if (new Date(fallbackParsed.x).getTime() <= Date.now()) {
      return { valid: false, reason: 'EXPIRED', custom_fields: [] };
    }

    const formRes = await (supabase as any).rpc('get_member_info_form', {
      p_member_id: fallbackParsed.m,
      p_device_token: fallbackParsed.s,
    });

    if (formRes.error || !formRes.data) {
      const msg = String(formRes.error?.message ?? '');
      if (msg.includes('INVALID_MEMBER_SESSION') || msg.includes('DEVICE_REQUIRED')) {
        return { valid: false, reason: 'ALREADY_USED', custom_fields: [] };
      }
      return { valid: false, reason: 'INVALID_TOKEN', custom_fields: [] };
    }

    const rawFields = Array.isArray(formRes.data.fields)
      ? (formRes.data.fields as Array<Record<string, unknown>>)
      : [];
    const submissions = Array.isArray(formRes.data.submissions)
      ? (formRes.data.submissions as Array<Record<string, unknown>>)
      : [];
    if (submissions.length > 0) {
      return { valid: false, reason: 'ALREADY_USED', custom_fields: [] };
    }

    const customFields = rawFields
      .filter((f) => String(f.label ?? '') !== ONBOARDING_CARRIER_LABEL)
      .map((f) => normalizeFieldRow(f));

    return {
      valid: true,
      note: fallbackParsed.n,
      expires_at: fallbackParsed.x,
      custom_fields: customFields,
    };
  }

  const nativeRes = await (supabase as any).rpc('get_member_invite_context', {
    p_token: cleanToken,
  });

  if (nativeRes.error || !nativeRes.data) {
    return { valid: false, reason: 'INVALID_TOKEN', custom_fields: [] };
  }

  const data = nativeRes.data as {
    valid?: boolean;
    reason?: string;
    note?: string;
    expires_at?: string;
    custom_fields?: Array<Record<string, unknown>>;
  };

  if (!data.valid) {
    return {
      valid: false,
      reason: data.reason ?? 'INVALID_TOKEN',
      custom_fields: [],
    };
  }

  const customFields = Array.isArray(data.custom_fields)
    ? data.custom_fields
        .map((f) => normalizeFieldRow(f))
        .filter((f) => f.label !== ONBOARDING_CARRIER_LABEL)
    : [];

  return {
    valid: true,
    note: data.note ?? '',
    expires_at: data.expires_at,
    custom_fields: customFields,
  };
}

export async function submitMemberRegistrationInvite(
  token: string,
  payload: MemberSelfRegistrationPayload,
): Promise<void> {
  const cleanToken = token.trim();
  const cleanEmail = payload.email.trim().toLowerCase();

  const fallbackParsed = parseFallbackToken(cleanToken);
  if (fallbackParsed) {
    if (new Date(fallbackParsed.x).getTime() <= Date.now()) {
      throw new Error('انتهت صلاحية رابط التسجيل. اطلب رابط جديد من الإدارة.');
    }

    // التحقق من عدم تكرار البريد الإلكتروني
    const existingLookup = await supabase.rpc('lookup_member_by_email', {
      p_email: cleanEmail,
      p_device_token: null,
    });
    if (!existingLookup.error && Array.isArray(existingLookup.data) && existingLookup.data.length > 0) {
      throw new Error('البريد الإلكتروني ده مسجّل بالفعل في الفريق.');
    }

    const formRes = await (supabase as any).rpc('get_member_info_form', {
      p_member_id: fallbackParsed.m,
      p_device_token: fallbackParsed.s,
    });

    if (formRes.error || !formRes.data) {
      throw new Error('الرابط ده تم استخدامه بالفعل أو تم إلغاؤه.');
    }

    const rawFields = Array.isArray(formRes.data.fields)
      ? (formRes.data.fields as Array<Record<string, unknown>>)
      : [];
    const carrierField = rawFields.find((f) => String(f.label ?? '') === ONBOARDING_CARRIER_LABEL);

    if (!carrierField?.id) {
      throw new Error('حصلت مشكلة في قناة استلام البيانات. تواصل مع الإدارة.');
    }

    const cleanCustomMap = sanitizeCustomFieldsMap(payload.custom_fields);
    const submitRes = await (supabase as any).rpc('submit_member_info', {
      p_member_id: fallbackParsed.m,
      p_device_token: fallbackParsed.s,
      p_values: {
        ...cleanCustomMap,
        [String(carrierField.id)]: {
          ...payload,
          email: cleanEmail,
          full_name: payload.full_name.trim(),
          custom_fields: cleanCustomMap,
        },
      },
    });

    if (submitRes.error) {
      throw toAppError(submitRes.error, 'معرفناش نسجّل البيانات. حاول تاني.');
    }

    // إبطال رمز الجلسة فوراً بحيث يصبح الرابط صالحاً لمرة واحدة فقط ولا يمكن إعادة فتحه
    await supabase.rpc('logout_member_device', {
      p_member_id: fallbackParsed.m,
      p_device_token: fallbackParsed.s,
    });

    // إذا كان المشرف يجرب الرابط من نفس المتصفح، رقِّ السجل فوراً
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      await applyRegistrationPayloadToMemberRow(fallbackParsed.m, payload);
    }

    return;
  }

  const nativeRes = await (supabase as any).rpc('submit_member_registration_invite', {
    p_token: cleanToken,
    p_payload: {
      ...payload,
      email: cleanEmail,
      full_name: payload.full_name.trim(),
      custom_fields: sanitizeCustomFieldsMap(payload.custom_fields),
    },
  });

  if (nativeRes.error) {
    const msg = String(nativeRes.error.message ?? '');
    if (msg.includes('EMAIL_EXISTS')) {
      throw new Error('البريد الإلكتروني ده مسجّل بالفعل في الفريق.');
    }
    if (msg.includes('ALREADY_USED')) {
      throw new Error('الرابط ده تم استخدامه قبل كده ومقفول دلوقتي.');
    }
    if (msg.includes('EXPIRED')) {
      throw new Error('انتهت صلاحية رابط التسجيل. اطلب رابط جديد من الإدارة.');
    }
    if (msg.includes('REVOKED') || msg.includes('INVALID_TOKEN')) {
      throw new Error('رابط التسجيل غير صالح أو تم إلغاؤه.');
    }
    throw toAppError(nativeRes.error, 'معرفناش نسجّل البيانات.');
  }
}
