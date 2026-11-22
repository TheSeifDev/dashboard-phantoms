import { useCallback, useMemo, useState } from 'react';
import type { PersonInfo } from '../dashboard/TaskStreakHeatmap';
import { readGithubSyncPreference, writeGithubSyncPreference } from '../dashboard/github';
import { getCairoDate } from '../dashboard/taskContributions';
import type { GithubLink, TeamActivity } from '../dashboard/teamActivity';
import { useGithubTeamCalendars } from '../dashboard/useGithubTeam';
import { buildMemberTeamActivity } from './memberInsights';
import { useMemberTeamInsights } from './useMemberTeamInsights';

/**
 * مساهمات الفريق للعضو في مكان واحد: نفس بيانات RPC + نفس دمج GitHub اللي
 * بيحصل في لوحة الإدارة. الهيرو (هيكس «النهارده») وقسم المساهمات بيقروا من
 * نفس الهوك، فالأرقام متطابقة والكاش مشترك.
 */
export function useMemberTeamActivity(year: number, enabled = true) {
  const currentYear = Number(getCairoDate().slice(0, 4));
  const [githubEnabled, setGithubEnabled] = useState(readGithubSyncPreference);
  const query = useMemberTeamInsights(year, enabled);
  const links = useMemo<GithubLink[]>(
    () => (query.data?.roster ?? []).map((person) => ({ memberId: person.memberId, handle: person.githubHandle })),
    [query.data],
  );
  const github = useGithubTeamCalendars(links, year, currentYear, githubEnabled && links.length > 0);
  const activity = useMemo<TeamActivity | null>(
    () => (query.data ? buildMemberTeamActivity(query.data, { calendars: github.calendars, enabled: githubEnabled }) : null),
    [query.data, github.calendars, githubEnabled],
  );
  const people = useMemo(() => {
    const map = new Map<number, PersonInfo>();
    for (const person of query.data?.roster ?? []) map.set(person.memberId, { name: person.fullName, handle: person.githubHandle });
    for (const person of query.data?.people ?? []) {
      const known = map.get(person.memberId);
      map.set(person.memberId, { name: person.fullName, handle: known?.handle ?? person.githubHandle });
    }
    return map;
  }, [query.data]);
  const toggleGithub = useCallback(() => {
    setGithubEnabled((value) => {
      writeGithubSyncPreference(!value);
      return !value;
    });
  }, []);
  const today = useMemo(() => {
    const date = query.data?.contributions.today;
    if (!date) return null;
    const day = activity?.byDate.get(date);
    return { date, total: day?.total ?? 0, crew: day?.crewSize ?? 0, approvals: day?.approvals ?? 0, github: day?.github ?? 0 };
  }, [activity, query.data]);

  return { query, links, github, githubEnabled, toggleGithub, activity, people, today, currentYear };
}