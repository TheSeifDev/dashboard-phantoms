import { memberSupabase } from '../../lib/supabase/member-client';
import { clearDeviceToken, useAuthStore } from '../../store/auth';

/**
 * Heads, Monitors and global administrators also sign in from the member side
 * (the app's normal login screen). They are management accounts, so the member
 * session must never become their workspace: it is handed over to the admin
 * client, which then owns the session and opens the management workspace.
 */

const CHECK_TTL_MS = 60_000;
const checkCache = new Map<string, { at: number; value: boolean }>();

/** Cached per Auth user so a later member login in the same tab is never mixed up. */
export async function isManagementAccount(uid?: string | null): Promise<boolean> {
  if (uid) {
    const hit = checkCache.get(uid);
    if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.value;
  }
  let value = false;
  try {
    const { data, error } = await memberSupabase.rpc('get_admin_access');
    value = !error && data?.is_admin === true;
  } catch {
    value = false;
  }
  if (uid) checkCache.set(uid, { at: Date.now(), value });
  return value;
}

/**
 * Copy the live member session into the admin client and drop the member-local
 * state. The same Auth user owns both, so no password is needed again.
 */
export async function adoptManagementSession(): Promise<boolean> {
  try {
    const { data, error } = await memberSupabase.auth.getSession();
    const session = data.session;
    if (error || !session?.access_token || !session.refresh_token) return false;
    // Loaded lazily: member-only flows never construct the admin client.
    const { supabase } = await import('../../lib/supabase/client');
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (setSessionError) return false;
    // Only the admin client keeps refreshing from here on.
    clearDeviceToken();
    useAuthStore.getState().logoutMember();
    await memberSupabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Full hand-off: adopt the session and report whether the admin shell can open. */
export async function handOffToAdminWorkspace(uid?: string | null): Promise<boolean> {
  if (!(await isManagementAccount(uid))) return false;
  return adoptManagementSession();
}
