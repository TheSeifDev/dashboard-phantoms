import { memberSupabase } from '../../lib/supabase/member-client';
import {
  isMemberInviteToken,
  isLegacyMemberInviteToken,
  memberAuthErrorMessage,
  normalizeAuthEmail,
  readMemberEndpointCode,
  validateMemberPassword,
} from './member-password';

export interface EnrollMemberPasswordInput {
  email: string;
  token: string;
  password: string;
  confirmPassword: string;
  profile?: MemberSelfServiceProfile;
}

export interface MemberSelfServiceProfile {
  fullName: string;
  phone: string;
  residence: string;
  workConditions: string;
  bio: string;
  device: string;
  gender: string;
}

export class MemberPasswordApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(memberAuthErrorMessage(code));
    this.name = 'MemberPasswordApiError';
    this.code = code;
  }
}

export async function enrollMemberPassword(input: EnrollMemberPasswordInput): Promise<'active' | 'pending_review'> {
  const email = normalizeAuthEmail(input.email);
  const token = input.token.trim();
  if (!email || !isMemberInviteToken(token) || isLegacyMemberInviteToken(token)) {
    throw new MemberPasswordApiError('INVALID_INPUT');
  }
  const passwordResult = validateMemberPassword(input.password, input.confirmPassword);
  if (!passwordResult.ok) {
    throw new MemberPasswordApiError(input.password === input.confirmPassword ? 'WEAK_PASSWORD' : 'PASSWORD_MISMATCH');
  }
  const deviceOptions = ['', 'لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول'];
  let safeProfile: MemberSelfServiceProfile | undefined;
  if (input.profile !== undefined) {
    const profile = input.profile;
    if (!profile || typeof profile !== 'object'
      || Object.keys(profile).sort().join('|') !== ['bio', 'device', 'fullName', 'gender', 'phone', 'residence', 'workConditions'].sort().join('|')
      || Object.values(profile).some((value) => typeof value !== 'string')
      || !profile.fullName.trim() || profile.fullName.trim().length > 160
      || (profile.phone.trim() !== '' && !/^\+?[0-9 ()-]{7,32}$/.test(profile.phone.trim()))
      || profile.residence.trim().length > 160 || profile.workConditions.trim().length > 2000 || profile.bio.trim().length > 4000
      || !deviceOptions.includes(profile.device.trim())
      || (profile.gender.trim() !== '' && profile.gender.trim() !== 'ذكر' && profile.gender.trim() !== 'أنثى')) {
      throw new MemberPasswordApiError('INVALID_INPUT');
    }
    safeProfile = {
      fullName: profile.fullName.trim(), phone: profile.phone.trim(), residence: profile.residence.trim(),
      workConditions: profile.workConditions.trim(), bio: profile.bio.trim(), device: profile.device.trim(), gender: profile.gender.trim(),
    };
  }

  const { data, error } = await memberSupabase.functions.invoke<{ ok?: boolean; membership?: string; code?: string }>(
    'member-password-enrollment',
    {
      body: {
        action: 'enroll',
        email,
        token,
        password: input.password,
        confirmPassword: input.confirmPassword,
        ...(safeProfile ? { profile: safeProfile } : {}),
      },
    },
  );

  if (error) throw new MemberPasswordApiError(await readMemberEndpointCode(error));
  if (data?.ok !== true || (data.membership !== 'active' && data.membership !== 'pending_review')) {
    throw new MemberPasswordApiError(await readMemberEndpointCode(data));
  }
  return data.membership;
}
