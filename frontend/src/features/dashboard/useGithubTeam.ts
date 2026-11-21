import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Member } from '../../types/db';
import { fetchGithubCalendar, fetchGithubEvents, resolveGithubHandle, type GithubCalendar, type GithubEvent } from './github';
import type { GithubLink } from './teamActivity';

export interface GithubTeamState {
  links: GithubLink[];
  calendars: Map<string, GithubCalendar>;
  connected: number;
  failed: number;
  loading: number;
  isFetching: boolean;
}

/** Members whose profile already carries a GitHub handle (custom field or github.com portfolio). */
export function useGithubLinks(members: readonly Member[]): GithubLink[] {
  return useMemo(() => {
    const seen = new Set<string>();
    const links: GithubLink[] = [];
    for (const member of members) {
      const handle = resolveGithubHandle(member);
      if (!handle || seen.has(handle.toLowerCase())) continue;
      seen.add(handle.toLowerCase());
      links.push({ memberId: member.id, handle });
    }
    return links;
  }, [members]);
}

/** One cached calendar request per linked member-year. Failures are counted, never thrown at the page. */
export function useGithubTeamCalendars(links: readonly GithubLink[], year: number, currentYear: number, enabled: boolean): GithubTeamState {
  const results = useQueries({
    queries: links.map((link) => ({
      queryKey: ['github-calendar', link.handle.toLowerCase(), year],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchGithubCalendar(link.handle, year, currentYear, signal),
      enabled,
      staleTime: year >= currentYear ? 30 * 60_000 : 24 * 60 * 60_000,
      gcTime: 60 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const signature = results.map((result) => `${result.status}:${result.dataUpdatedAt}`).join('|');
  return useMemo(() => {
    const calendars = new Map<string, GithubCalendar>();
    let connected = 0;
    let failed = 0;
    let loading = 0;
    results.forEach((result) => {
      if (result.data) { calendars.set(result.data.handle.toLowerCase(), result.data); connected += 1; }
      else if (result.isError) failed += 1;
      else if (enabled) loading += 1;
    });
    return { links: [...links], calendars, connected, failed, loading, isFetching: results.some((result) => result.isFetching) };
    // `results` identity changes every render; the signature captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, links, enabled]);
}

/** Lazily loads public events for the handles active on an opened day. */
export function useGithubDayEvents(handles: readonly string[], date: string | null, enabled: boolean) {
  const key = [...handles].map((handle) => handle.toLowerCase()).sort().join(',');
  return useQuery({
    queryKey: ['github-day-events', key, date],
    enabled: enabled && Boolean(date) && handles.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<{ events: GithubEvent[]; failed: string[] }> => {
      const settled = await Promise.allSettled(handles.map((handle) => fetchGithubEvents(handle, signal)));
      const events: GithubEvent[] = [];
      const failed: string[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') events.push(...outcome.value);
        else failed.push(handles[index]);
      });
      return { events, failed };
    },
  });
}
