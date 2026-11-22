import { memberSupabase } from '../../lib/supabase/member-client';
import { parseMemberPasswordAccess } from './member-password';
import type { MemberPasswordAccess } from './member-password';

export async function getMemberPasswordAccess(): Promise<MemberPasswordAccess | null> {
  const { data, error } = await memberSupabase.rpc('get_member_password_access');
  if (error) return null;
  return parseMemberPasswordAccess(data);
}

/** Status-only response for the exact authenticated, inactive account owner. */
export async function isMemberPendingReview(): Promise<boolean> {
  const { data, error } = await memberSupabase.rpc('get_member_pending_review');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  return (data as Record<string, unknown>).status === 'pending_review';
}

export interface OwnerMemberIdentity {
  memberId: number;
  email: string;
  created: boolean;
}

/**
 * The platform owner is an Admin account, so the member path needs an explicit
 * member identity. This RPC (owner-only, self-scoped) creates or links the owner's
 * `members` row and binding; it is a no-op for every other account.
 */
export async function ensureOwnerMemberIdentity(): Promise<OwnerMemberIdentity | null> {
  const { data, error } = await memberSupabase.rpc('ensure_owner_member_identity');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const memberId = typeof record.member_id === 'number' ? record.member_id : Number(record.member_id);
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  if (!Number.isSafeInteger(memberId) || memberId <= 0 || !email) return null;
  return { memberId, email, created: record.created === true };
}
