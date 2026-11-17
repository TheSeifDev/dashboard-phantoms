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
}

export class MemberPasswordApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(memberAuthErrorMessage(code));
    this.name = 'MemberPasswordApiError';
    this.code = code;
  }
}

export async function enrollMemberPassword(input: EnrollMemberPasswordInput): Promise<void> {
  const email = normalizeAuthEmail(input.email);
  const token = input.token.trim();
  if (!email || !isMemberInviteToken(token) || isLegacyMemberInviteToken(token)) {
    throw new MemberPasswordApiError('INVALID_INPUT');
  }
  const passwordResult = validateMemberPassword(input.password, input.confirmPassword);
  if (!passwordResult.ok) {
    throw new MemberPasswordApiError(input.password === input.confirmPassword ? 'WEAK_PASSWORD' : 'PASSWORD_MISMATCH');
  }

  const { data, error } = await memberSupabase.functions.invoke<{ ok?: boolean; code?: string }>(
    'member-password-enrollment',
    {
      body: {
        action: 'enroll',
        email,
        token,
        password: input.password,
        confirmPassword: input.confirmPassword,
      },
    },
  );

  if (error) throw new MemberPasswordApiError(await readMemberEndpointCode(error));
  if (data?.ok !== true) throw new MemberPasswordApiError(await readMemberEndpointCode(data));
}
