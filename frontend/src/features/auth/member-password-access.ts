import { memberSupabase } from '../../lib/supabase/member-client';
import { parseMemberPasswordAccess } from './member-password';
import type { MemberPasswordAccess } from './member-password';

export async function getMemberPasswordAccess(): Promise<MemberPasswordAccess | null> {
  const { data, error } = await memberSupabase.rpc('get_member_password_access');
  if (error) return null;
  return parseMemberPasswordAccess(data);
}
