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
