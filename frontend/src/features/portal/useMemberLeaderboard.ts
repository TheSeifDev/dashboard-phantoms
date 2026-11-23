import { useQuery } from '@tanstack/react-query';
import { memberSupabase } from '../../lib/supabase/member-client';
import { toAppError } from '../../lib/supabase/errors';
import { getDeviceToken } from '../../store/auth';

export type LeaderboardRow = {
  member_id: number;
  full_name: string;
  bonus: number;
  rank: number;
  bonus_infinite: boolean;
  is_me: boolean;
  teams: string[];
};

export type LeaderboardPayload = {
  roster_size: number;
  generated_at: string;
  me: Omit<LeaderboardRow, 'is_me'> | null;
  rows: LeaderboardRow[];
};

/**
 * خطأ جلسة (device token مش صالح / صلاحية مرفوضة) مش هيحل بإعادة المحاولة،
 * فلازم يتعرض للعضو كطلب تسجيل دخول من جديد بدل loop من الـ retries.
 */
export class MemberSessionError extends Error {
  readonly sessionIssue = true;

  constructor(message: string) {
    super(message);
    this.name = 'MemberSessionError';
  }
}

export function isSessionIssue(error: unknown): boolean {
  return (
    error instanceof MemberSessionError
    || (typeof error === 'object' && error !== null && (error as { sessionIssue?: boolean }).sessionIssue === true)
  );
}

const SESSION_ISSUE_RE = /DEVICE_REQUIRED|MEMBER_SESSION_REQUIRED|MEMBER_DISABLED|MEMBER_PASSWORD_REQUIRED|\b42501\b/;

function isSessionIssuePayload(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message, details, hint } = error as Record<string, unknown>;
  return SESSION_ISSUE_RE.test(`${String(code ?? '')} ${String(message ?? '')} ${String(details ?? '')} ${String(hint ?? '')}`);
}

function normalizeRow(raw: Record<string, unknown>): LeaderboardRow {
  return {
    member_id: Number(raw.member_id ?? 0),
    full_name: String(raw.full_name ?? ''),
    bonus: Number(raw.bonus ?? 0),
    rank: Number(raw.rank ?? 0),
    bonus_infinite: raw.bonus_infinite === true,
    is_me: raw.is_me === true,
    teams: Array.isArray(raw.teams) ? raw.teams.map((team) => String(team)) : [],
  };
}

/**
 * ترتيب الفريق من منظور العضو: البونص والمرتبة وأسماء التيمات لكل الأعضاء النشطين.
 * الحساب بيتم داخل RPC محمي بـ device token، فالعضو ما بيقرأش جدولي members/notes مباشرة.
 */
export function useMemberLeaderboard(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  return useQuery({
    queryKey: ['member-leaderboard', memberId],
    enabled,
    staleTime: 30_000,
    retry: (failureCount, error) => !isSessionIssue(error) && failureCount < 1,
    queryFn: async () => {
      const deviceToken = getDeviceToken();
      if (!deviceToken) throw new MemberSessionError('سجّل دخولك من جديد للتحقق من جلسة الجهاز.');
      const { data, error } = await memberSupabase.rpc('get_member_leaderboard', {
        p_member_id: memberId as number,
        p_device_token: deviceToken,
      });
      if (error) {
        const mapped = toAppError(error, 'معرفناش نحمّل ترتيب الفريق.');
        if (isSessionIssuePayload(error)) throw new MemberSessionError(mapped.message);
        throw mapped;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(payload.rows) ? (payload.rows as Record<string, unknown>[]).map(normalizeRow) : [];
      const me = payload.me && typeof payload.me === 'object' ? normalizeRow(payload.me as Record<string, unknown>) : null;
      return {
        roster_size: Number(payload.roster_size ?? rows.length),
        generated_at: String(payload.generated_at ?? ''),
        me,
        rows,
      } satisfies LeaderboardPayload;
    },
  });
}
