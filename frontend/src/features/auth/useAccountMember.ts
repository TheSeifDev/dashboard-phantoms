import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { useAuthStore } from '../../store/auth';
import type { Member } from '../../types/db';
/**
 * Member row linked to the signed-in admin account (matched by email).
 * Used for identity chrome such as the sidebar account card, so the admin sees
 * the same GitHub photo as the rest of the team. Fails closed to `null`.
 */
export type AccountMember = Pick<Member, 'id' | 'full_name' | 'email' | 'portfolio_url' | 'custom_fields'>;
export function useAccountMember(): AccountMember | null {
  const email = useAuthStore((state) => state.user?.email ?? null);
  const [member, setMember] = useState<AccountMember | null>(null);
  useEffect(() => {
    let cancelled = false;
    const normalized = (email ?? '').trim();
    if (!normalized) {
      setMember(null);
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('members')
          .select('id, full_name, email, portfolio_url, custom_fields')
          .ilike('email', normalized)
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setMember(error || !data ? null : (data as AccountMember));
      } catch {
        if (!cancelled) setMember(null);
      }
    })();
    return () => { cancelled = true; };
  }, [email]);
  return member;
}
