import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { TABLES } from '../../types/db';
import type {
  Member,
  MemberCustomField,
  MemberCustomFieldInsert,
  MemberCustomFieldType,
} from '../../types/db';

import { LEGACY_COMPATIBILITY_MARKERS } from '../../lib/legacyCompatibility';

export const MEMBER_CUSTOM_FIELDS_KEY = ['member_custom_fields'] as const;
export const ONBOARDING_CARRIER_LABEL = '__PHANTOMS_ONBOARDING__';
export const LEGACY_ONBOARDING_CARRIER_LABEL = LEGACY_COMPATIBILITY_MARKERS.ONBOARDING_CARRIER_LABEL;

const CF_MARKER_PREFIX = LEGACY_COMPATIBILITY_MARKERS.PHANTOMS_CF_MARKER_PREFIX;
const CF_MARKER_REGEX = LEGACY_COMPATIBILITY_MARKERS.CF_MARKER_REGEX;
const LOCAL_STORAGE_FALLBACK_KEY = 'phantoms_member_custom_fields_v1';
const LEGACY_LOCAL_STORAGE_FALLBACK_KEY = 'wasla_member_custom_fields_v1';

export const CUSTOM_FIELD_TYPE_LABELS: Record<MemberCustomFieldType, string> = {
  short_text: 'نص حر (كتابة أي قيمة)',
  select: 'قائمة اختيارات محددة',
  number: 'رقم',
  yes_no: 'نعم / لا',
  date: 'تاريخ',
  long_text: 'نص طويل / تفصيلي',
};

export function isMissingRelationError(error: unknown, relationOrColumn: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const code = String(err.code ?? '');
  const msg = `${err.message ?? ''} ${err.details ?? ''}`.toLowerCase();
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' || code === '42883' || code === 'PGRST202') {
    return true;
  }
  return msg.includes(relationOrColumn.toLowerCase()) && (
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find')
  );
}

function encodeLegacyHelpText(placeholder: string, showInCard: boolean): string {
  const cleanPlaceholder = (placeholder || '').trim().slice(0, 140);
  if (showInCard && !cleanPlaceholder) return '';
  return JSON.stringify({ p: cleanPlaceholder, c: showInCard }).slice(0, 300);
}

function decodeLegacyHelpText(helpText: unknown): { placeholder: string; show_in_card: boolean } {
  const raw = typeof helpText === 'string' ? helpText.trim() : '';
  if (!raw) return { placeholder: '', show_in_card: true };
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as { p?: unknown; c?: unknown };
      return {
        placeholder: typeof parsed.p === 'string' ? parsed.p : '',
        show_in_card: parsed.c !== false,
      };
    } catch {
      return { placeholder: raw, show_in_card: true };
    }
  }
  return { placeholder: raw, show_in_card: true };
}

export function normalizeFieldRow(row: Record<string, unknown>): MemberCustomField {
  const validTypes: MemberCustomFieldType[] = ['short_text', 'long_text', 'number', 'date', 'yes_no', 'select'];
  const rawType = String(row.field_type ?? 'short_text') as MemberCustomFieldType;
  const fieldType: MemberCustomFieldType = validTypes.includes(rawType) ? rawType : 'short_text';
  const rawOptions = Array.isArray(row.options) ? row.options : [];
  const options = rawOptions.map((item) => String(item ?? '').trim()).filter(Boolean);

  const hasNativeShowInCard = typeof row.show_in_card === 'boolean';
  const legacyMeta = hasNativeShowInCard
    ? { placeholder: String(row.placeholder ?? ''), show_in_card: Boolean(row.show_in_card) }
    : decodeLegacyHelpText(row.help_text);

  return {
    id: Number(row.id),
    label: String(row.label ?? '').trim(),
    field_type: fieldType,
    options,
    placeholder: legacyMeta.placeholder,
    show_in_card: legacyMeta.show_in_card,
    is_required: Boolean(row.is_required),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function readLocalFallbackFields(): MemberCustomField[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY) ?? window.localStorage.getItem(LEGACY_LOCAL_STORAGE_FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map((r) => normalizeFieldRow(r as Record<string, unknown>))
          .filter((f) => f.is_active && f.label !== ONBOARDING_CARRIER_LABEL && f.label !== LEGACY_ONBOARDING_CARRIER_LABEL)
      : [];
  } catch {
    return [];
  }
}

function writeLocalFallbackFields(fields: MemberCustomField[]): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(fields));
    try { window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_FALLBACK_KEY); } catch {}
  } catch {
    // ignore storage errors
  }
}

async function fetchMemberCustomFields(): Promise<MemberCustomField[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return readLocalFallbackFields();
  }

  const primary = await supabase
    .from(TABLES.member_custom_fields)
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (!primary.error) {
    const normalized = (primary.data ?? [])
      .map((row) => normalizeFieldRow(row as unknown as Record<string, unknown>))
      .filter((f) => f.label !== ONBOARDING_CARRIER_LABEL);
    writeLocalFallbackFields(normalized);
    return normalized;
  }

  if (isMissingRelationError(primary.error, 'member_custom_fields')) {
    const legacy = await (supabase as any)
      .from('member_info_fields')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });

    if (!legacy.error) {
      const normalized = (legacy.data ?? [])
        .map((row: Record<string, unknown>) => normalizeFieldRow(row))
        .filter((f: MemberCustomField) => f.label !== ONBOARDING_CARRIER_LABEL);
      writeLocalFallbackFields(normalized);
      return normalized;
    }
    return readLocalFallbackFields();
  }

  throw toAppError(primary.error, 'معرفناش نحمّل الحقول المخصصة للأعضاء.');
}

export function useMemberCustomFields() {
  return useQuery({
    queryKey: MEMBER_CUSTOM_FIELDS_KEY,
    queryFn: fetchMemberCustomFields,
  });
}

export function useSaveMemberCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, field }: { id?: number; field: MemberCustomFieldInsert }): Promise<MemberCustomField> => {
      const cleanLabel = field.label.trim();
      const cleanOptions = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
      const payload: MemberCustomFieldInsert = {
        label: cleanLabel,
        field_type: field.field_type,
        options: field.field_type === 'select' ? cleanOptions : [],
        placeholder: (field.placeholder ?? '').trim(),
        show_in_card: field.show_in_card !== false,
        is_required: Boolean(field.is_required),
        is_active: field.is_active !== false,
        sort_order: Number(field.sort_order ?? 0),
      };

      const primary = id
        ? await supabase
            .from(TABLES.member_custom_fields)
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()
        : await supabase
            .from(TABLES.member_custom_fields)
            .insert(payload)
            .select()
            .single();

      if (!primary.error && primary.data) {
        return normalizeFieldRow(primary.data as unknown as Record<string, unknown>);
      }

      if (isMissingRelationError(primary.error, 'member_custom_fields')) {
        const legacyPayload = {
          label: payload.label,
          field_type: payload.field_type,
          options: payload.options,
          help_text: encodeLegacyHelpText(payload.placeholder, payload.show_in_card),
          is_required: payload.is_required,
          is_active: payload.is_active,
          sort_order: payload.sort_order,
        };

        const legacy = id
          ? await (supabase as any)
              .from('member_info_fields')
              .update({ ...legacyPayload, updated_at: new Date().toISOString() })
              .eq('id', id)
              .select()
              .single()
          : await (supabase as any)
              .from('member_info_fields')
              .insert(legacyPayload)
              .select()
              .single();

        if (!legacy.error && legacy.data) {
          return normalizeFieldRow(legacy.data as Record<string, unknown>);
        }
      }

      throw toAppError(primary.error, 'معرفناش نحفظ الحقل المخصص.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_CUSTOM_FIELDS_KEY });
    },
  });
}

export function useDeleteMemberCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fieldId: number): Promise<number> => {
      const primary = await supabase
        .from(TABLES.member_custom_fields)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', fieldId);

      if (!primary.error) {
        return fieldId;
      }

      if (isMissingRelationError(primary.error, 'member_custom_fields')) {
        const legacy = await (supabase as any)
          .from('member_info_fields')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', fieldId);

        if (!legacy.error) {
          return fieldId;
        }
      }

      throw toAppError(primary.error, 'معرفناش نحذف الحقل المخصص.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MEMBER_CUSTOM_FIELDS_KEY });
    },
  });
}

export function sanitizeCustomFieldsMap(
  raw: unknown,
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed !== '') result[key] = trimmed;
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      result[key] = val;
    } else if (typeof val === 'boolean') {
      result[key] = val;
    }
  }
  return result;
}

export function extractMemberCustomFields(member: Member): Member {
  const nativeMap = sanitizeCustomFieldsMap(member.custom_fields);
  const rawNotes = member.team_notes ?? '';
  const match = rawNotes.match(CF_MARKER_REGEX);

  if (!match) {
    return {
      ...member,
      custom_fields: nativeMap,
    };
  }

  let packedMap: Record<string, string | number | boolean | null> = {};
  try {
    packedMap = sanitizeCustomFieldsMap(JSON.parse(match[1]));
  } catch {
    packedMap = {};
  }

  const cleanedNotes = rawNotes.replace(CF_MARKER_REGEX, '').trim();
  return {
    ...member,
    team_notes: cleanedNotes || null,
    custom_fields: { ...packedMap, ...nativeMap },
  };
}

export function packTeamNotesWithCustomFields(
  teamNotes: string | null | undefined,
  customFields: Record<string, string | number | boolean | null> | undefined,
): string | null {
  const cleanNote = (teamNotes ?? '').replace(CF_MARKER_REGEX, '').trim();
  const cleanCustom = sanitizeCustomFieldsMap(customFields);
  const hasCustom = Object.keys(cleanCustom).length > 0;

  if (!hasCustom) {
    return cleanNote || null;
  }

  const marker = `${CF_MARKER_PREFIX}${JSON.stringify(cleanCustom)}]]`;
  return cleanNote ? `${cleanNote}\n${marker}` : marker;
}

export function isMissingCustomFieldsColumnError(error: unknown): boolean {
  return isMissingRelationError(error, 'custom_fields');
}

export function getMemberCustomFieldValue(
  member: Pick<Member, 'custom_fields'>,
  field: Pick<MemberCustomField, 'id' | 'label'>,
): string | number | boolean | null {
  const map = member.custom_fields;
  if (!map) return null;
  const byId = map[String(field.id)];
  if (byId !== undefined && byId !== null && byId !== '') return byId;
  const byLabel = map[field.label];
  if (byLabel !== undefined && byLabel !== null && byLabel !== '') return byLabel;
  return null;
}

export function formatCustomFieldValue(
  field: Pick<MemberCustomField, 'field_type'>,
  value: string | number | boolean | null | undefined,
): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.field_type === 'yes_no') {
    if (value === true || value === 'true' || value === 'نعم') return 'نعم';
    if (value === false || value === 'false' || value === 'لا') return 'لا';
  }
  return String(value);
}
