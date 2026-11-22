import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';

/** Client-reported prior APK use, never proof of current installation. */
export interface MemberAppUsage {
  member_id: number;
  first_used_at: string;
  last_used_at: string;
  last_app_version: string;
  last_app_build: string;
}

export function appUsageMemberIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}

export function parseAppUsageRows(value: unknown, requested: number[]): MemberAppUsage[] {
  if (!Array.isArray(value) || requested.length > 100) throw new Error('APP_USAGE_UNAVAILABLE');
  const allowed = new Set(requested);
  const seen = new Set<number>();
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('APP_USAGE_UNAVAILABLE');
    const row = raw as Record<string, unknown>;
    if (typeof row.member_id !== 'number' || !allowed.has(row.member_id) || seen.has(row.member_id)
      || typeof row.first_used_at !== 'string' || !Number.isFinite(Date.parse(row.first_used_at))
      || typeof row.last_used_at !== 'string' || !Number.isFinite(Date.parse(row.last_used_at))
      || Date.parse(row.last_used_at) < Date.parse(row.first_used_at)
      || typeof row.last_app_version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(row.last_app_version)
      || typeof row.last_app_build !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(row.last_app_build)) {
      throw new Error('APP_USAGE_UNAVAILABLE');
    }
    seen.add(row.member_id);
    return {
      member_id: row.member_id, first_used_at: row.first_used_at, last_used_at: row.last_used_at,
      last_app_version: row.last_app_version, last_app_build: row.last_app_build,
    };
  });
}

export async function fetchOwnerAppUsage(ids: number[]): Promise<MemberAppUsage[]> {
  const memberIds = appUsageMemberIds(ids);
  if (memberIds.length > 100) throw new Error('APP_USAGE_PAGE_TOO_LARGE');
  if (!memberIds.length) return [];
  const { data, error } = await supabase.rpc('owner_member_app_usage', { p_member_ids: memberIds });
  if (error) throw new Error('APP_USAGE_UNAVAILABLE');
  return parseAppUsageRows(data, memberIds);
}

export function useOwnerAppUsage(ownerId: string | null, isOwner: boolean, ids: number[]) {
  const memberIds = appUsageMemberIds(ids);
  return useQuery({
    queryKey: ['owner-app-usage', ownerId, memberIds],
    enabled: Boolean(ownerId) && isOwner && memberIds.length > 0,
    queryFn: () => fetchOwnerAppUsage(memberIds),
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export async function recordMemberAppUsage(deviceToken: string, version: string, build: string): Promise<void> {
  const { error } = await memberSupabase.rpc('member_record_app_usage', {
    p_device_token: deviceToken, p_app_version: version, p_app_build: build,
  });
  if (error) throw new Error('APP_USAGE_UNAVAILABLE');
}

/**
 * سجل استخدام التطبيق لكل الأعضاء (للفلترة على مستوى الدليل).
 * الخادم يقبل 100 معرّف في المرة، فبنقسّم الطلب على دفعات ونلمّ النتيجة.
 */
export function useOwnerAppUsageDirectory(ownerId: string | null, isOwner: boolean, ids: number[]) {
  const memberIds = appUsageMemberIds(ids);
  const chunks: number[][] = [];
  for (let index = 0; index < memberIds.length; index += 100) chunks.push(memberIds.slice(index, index + 100));
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['owner-app-usage-directory', ownerId, chunk],
      enabled: Boolean(ownerId) && isOwner && chunk.length > 0,
      queryFn: () => fetchOwnerAppUsage(chunk),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const rows = results.flatMap((result) => result.data ?? []);
  return {
    data: rows,
    isLoading: results.some((result) => result.isPending),
    isError: results.some((result) => result.isError),
    refetch: () => { for (const result of results) void result.refetch(); },
  };
}
