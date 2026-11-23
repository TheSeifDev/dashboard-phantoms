import { memberSupabase } from '../../lib/supabase/member-client';
import { memberAuthErrorMessage, readMemberEndpointCode, validateMemberPassword } from './member-password';

export class MemberPasswordChangeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(memberAuthErrorMessage(code, 'تعذر تغيير كلمة المرور. حاول مرة أخرى.'));
    this.name = 'MemberPasswordChangeError';
    this.code = code;
  }
}

export interface ChangeMemberPasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Replaces the signed-in member's password. The Edge function re-checks the
 * current password against GoTrue and writes the new hash through the same
 * guarded claim the invitation flows use, so the member never has to open a
 * link to keep their own account safe.
 */
export async function changeMemberPassword(input: ChangeMemberPasswordInput): Promise<void> {
  if (!input.currentPassword) throw new MemberPasswordChangeError('INVALID_INPUT');
  const validation = validateMemberPassword(input.newPassword, input.confirmPassword);
  if (!validation.ok) throw new MemberPasswordChangeError(validation.code);
  if (input.newPassword === input.currentPassword) throw new MemberPasswordChangeError('INVALID_INPUT');

  const { data, error } = await memberSupabase.functions.invoke<{ ok?: boolean; code?: string }>(
    'member-password-enrollment',
    {
      body: {
        action: 'change_password',
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        confirmPassword: input.confirmPassword,
      },
    },
  );
  if (error) throw new MemberPasswordChangeError(await readMemberEndpointCode(error));
  if (data?.ok !== true) throw new MemberPasswordChangeError(await readMemberEndpointCode(data));
}
