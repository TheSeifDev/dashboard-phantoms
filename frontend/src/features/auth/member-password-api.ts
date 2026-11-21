import { memberSupabase } from '../../lib/supabase/member-client';
import {
  isMemberInviteToken,
  isLegacyMemberInviteToken,
  memberAuthErrorMessage,
  normalizeAuthEmail,
  readMemberEndpointCode,
  validateMemberPassword,
} from './member-password';
import { validateMemberProfile } from '../members/profile-fields';
import type { MemberProfileInput } from '../members/profile-fields';

export interface EnrollMemberPasswordInput {
  email: string;
  token: string;
  password: string;
  confirmPassword: string;
  profile?: MemberSelfServiceProfile;
}

export type MemberSelfServiceProfile = MemberProfileInput;

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
  let safeProfile: MemberSelfServiceProfile | undefined;
  if (input.profile !== undefined) {
    const profileResult = validateMemberProfile(input.profile);
    if (!profileResult.ok) {
      throw new MemberPasswordApiError('INVALID_INPUT');
    }
    safeProfile = profileResult.profile;
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
