import { useQuery } from '@tanstack/react-query';
import { memberSupabase } from '../../lib/supabase/member-client';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { normalizeAuthEmail } from '../auth/member-password';
import { validateMemberProfile, type MemberProfileInput } from './profile-fields';

export type MemberProfileSnapshot = {
  member_id: number;
  email: string;
  full_name: string;
  phone: string | null;
  academic_number: string | null;
  academic_group: string | null;
  specialization: string | null;
  university_email: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  residence: string | null;
  work_conditions: string | null;
  bio: string | null;
  device: string | null;
  gender: string | null;
  profile_complete: boolean;
  missing_fields: string[];
};
export class MemberProfileApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const SAFE_CODES = new Set(['INVALID_INPUT', 'ACADEMIC_NUMBER_CONFLICT', 'IDENTITY_CONFLICT', 'MEMBER_SESSION_REQUIRED', 'MEMBER_PASSWORD_REQUIRED', 'DEVICE_REQUIRED', 'MEMBER_DISABLED']);
const profileCode = (message: string, code?: string): string => code === '23505'
  ? 'ACADEMIC_NUMBER_CONFLICT'
  : [...SAFE_CODES].find((candidate) => message.includes(candidate)) ?? 'SERVER_UNAVAILABLE';

export function profileToInput(profile: MemberProfileSnapshot): MemberProfileInput {
  return {
    fullName: profile.full_name, phone: profile.phone ?? '',
    academicNumber: profile.academic_number ?? '', academicGroup: profile.academic_group ?? '',
    specialization: profile.specialization ?? '', linkedinUrl: profile.linkedin_url ?? '', portfolioUrl: profile.portfolio_url ?? '',
    residence: profile.residence ?? '', workConditions: profile.work_conditions ?? '',
    bio: profile.bio ?? '', device: profile.device ?? '', gender: profile.gender ?? '',
  };
}

export function parseMemberProfile(value: unknown, memberId: number, email: string): MemberProfileSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  const row = value as Record<string, unknown>;
  if (row.member_id !== memberId || typeof row.email !== 'string' || normalizeAuthEmail(row.email) !== normalizeAuthEmail(email)) {
    throw new MemberProfileApiError('IDENTITY_CONFLICT');
  }
  if (typeof row.full_name !== 'string' || typeof row.profile_complete !== 'boolean'
      || !Array.isArray(row.missing_fields) || !row.missing_fields.every((field) => typeof field === 'string')) {
    throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  }
  const nullableKeys = ['phone', 'academic_number', 'academic_group', 'specialization', 'university_email', 'linkedin_url', 'portfolio_url', 'residence', 'work_conditions', 'bio', 'device', 'gender'] as const;
  for (const key of nullableKeys) {
    if (row[key] !== null && typeof row[key] !== 'string') throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  }
  // Copy only the explicit profile projection; never cache an accidental secret.
  const profile = {
    member_id: memberId, email: normalizeAuthEmail(row.email), full_name: row.full_name,
    profile_complete: row.profile_complete, missing_fields: [...row.missing_fields],
    ...Object.fromEntries(nullableKeys.map((key) => [key, row[key]])),
  } as MemberProfileSnapshot;
  const derived = profile.academic_number ? `${profile.academic_number}@batechu.com` : null;
  if (profile.university_email !== derived) throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  // Every profile field is mandatory, so the server only reports completion
  // once all twelve values validate. Incomplete legacy rows still parse so the
  // member can open Settings and fix them.
  if (profile.profile_complete && !validateMemberProfile(profileToInput(profile)).ok) throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  return profile;
}

function assertOwner(memberId: number, email: string, deviceToken: string): void {
  const current = useAuthStore.getState().currentMember;
  if (!current || current.id !== memberId || normalizeAuthEmail(current.email) !== normalizeAuthEmail(email) || getDeviceToken() !== deviceToken) {
    throw new MemberProfileApiError('MEMBER_SESSION_REQUIRED');
  }
}
/**
 * Core identity fields that must be present before the member workspace opens.
 * The seven newer mandatory fields do not lock the portal: they are collected
 * through the persistent banner and the recurring completion reminders.
 */
export function isMemberCoreProfileComplete(profile: MemberProfileSnapshot): boolean {
  return profile.full_name.trim() !== ''
    && (profile.phone ?? '').trim() !== ''
    && (profile.academic_number ?? '').trim() !== ''
    && (profile.academic_group ?? '').trim() !== ''
    && (profile.specialization ?? '').trim() !== '';
}

export const memberProfileKey = (memberId: number | null, email: string) => ['member-profile-settings', memberId, normalizeAuthEmail(email)] as const;

export async function fetchMemberProfile(memberId: number, email: string, deviceToken: string): Promise<MemberProfileSnapshot> {
  assertOwner(memberId, email, deviceToken);
  const { data, error } = await memberSupabase.rpc('member_get_profile_settings', { p_device_token: deviceToken });
  assertOwner(memberId, email, deviceToken);
  if (error) throw new MemberProfileApiError(profileCode(error.message, error.code));
  return parseMemberProfile(data, memberId, email);
}
export async function saveMemberProfile(memberId: number, email: string, deviceToken: string, input: MemberProfileInput): Promise<MemberProfileSnapshot> {
  const valid = validateMemberProfile(input);
  if (!valid.ok) throw new MemberProfileApiError('INVALID_INPUT');
  assertOwner(memberId, email, deviceToken);
  const { data, error } = await memberSupabase.rpc('member_update_profile_settings', { p_device_token: deviceToken, p_profile: valid.profile });
  assertOwner(memberId, email, deviceToken);
  if (error) throw new MemberProfileApiError(profileCode(error.message, error.code));
  const result = parseMemberProfile(data, memberId, email);
  if (!result.profile_complete) throw new MemberProfileApiError('SERVER_UNAVAILABLE');
  return result;
}
export function useMemberProfile() {
  const member = useAuthStore((state) => state.currentMember);
  const device = getDeviceToken();
  return useQuery({
    queryKey: memberProfileKey(member?.id ?? null, member?.email ?? ''),
    queryFn: () => fetchMemberProfile(member!.id, member!.email, device!),
    enabled: Boolean(member && device), staleTime: 0, gcTime: 0, retry: false,
    refetchOnWindowFocus: true, refetchOnMount: 'always',
  });
}
