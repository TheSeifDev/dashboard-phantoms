export type MemberRecoveryCallback =
  | { kind: 'code'; code: string }
  | { kind: 'invalid' }
  | { kind: 'none' };

/** Only PKCE recovery exchange can prove recovery AMR on pinned GoTrue.
 * The URL code is captured in memory and scrubbed before asynchronous work.
 */
export function parseMemberRecoveryLocation(location: { pathname: string; search: string; hash: string }): MemberRecoveryCallback {
  if (location.pathname !== '/member/recovery' || location.hash) return { kind: 'invalid' };
  if (!location.search) return { kind: 'none' };
  const query = new URLSearchParams(location.search);
  const code = query.get('code') ?? '';
  if ([...query.keys()].length !== 1 || query.getAll('code').length !== 1
      || !/^[A-Za-z0-9_-]{16,256}$/.test(code)) return { kind: 'invalid' };
  return { kind: 'code', code };
}
