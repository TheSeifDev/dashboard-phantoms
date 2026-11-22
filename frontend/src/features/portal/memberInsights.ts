import {
  CONTRIBUTION_TIMEZONE,
  isIsoDate,
  type ContributionDay,
  type RpcResult,
  type TaskContributions,
} from '../dashboard/taskContributions';
import type { GithubCalendar } from '../dashboard/github';
import {
  crewHotThreshold,
  crewTier,
  type GithubDayShare,
  type MemberActivity,
  type TeamActivity,
  type TeamDay,
} from '../dashboard/teamActivity';

/** A single ledger day as exposed by get_member_team_insights(): approvals + distinct people. */
export interface MemberInsightDay extends ContributionDay {
  crew: number;
}

export interface MemberInsightPerson {
  memberId: number;
  fullName: string;
  approved: number;
  activeDays: number;
  lastApprovedOn: string | null;
  /** Handle from the member's GitHub custom field or a github.com portfolio link. */
  githubHandle: string | null;
}

/** A member who linked GitHub: enough to fetch the public calendar and show an avatar. */
export interface MemberInsightRosterEntry {
  memberId: number;
  fullName: string;
  githubHandle: string;
}

export interface MemberTeamInsights {
  contributions: TaskContributions;
  days: MemberInsightDay[];
  people: MemberInsightPerson[];
  roster: MemberInsightRosterEntry[];
  rosterSize: number;
}

export interface MemberInsightsRpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}

export const MEMBER_INSIGHTS_RPC = 'get_member_team_insights' as const;

const ROOT_KEYS = [
  'timezone',
  'tracking_started_at',
  'today',
  'year',
  'history_complete_since',
  'days',
  'total_approvals',
  'members',
  'roster',
  'roster_size',
] as const;
const DAY_KEYS = ['date', 'count', 'crew'] as const;
const PERSON_KEYS = ['member_id', 'full_name', 'approved', 'active_days', 'last_approved_on', 'github_handle'] as const;
const ROSTER_KEYS = ['member_id', 'full_name', 'github_handle'] as const;
const HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalHandle(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && HANDLE_PATTERN.test(value));
}

/**
 * Validates the member-facing RPC contract strictly: unknown keys, duplicate
 * days, future activity or a sum mismatch all reject the payload instead of
 * rendering a misleading heatmap.
 */
export function parseMemberTeamInsights(value: unknown, expectedYear: number): MemberTeamInsights | null {
  if (!Number.isInteger(expectedYear) || expectedYear < 1 || !isRecord(value)) return null;
  if (!hasOnlyKeys(value, ROOT_KEYS)) return null;
  if (value.timezone !== CONTRIBUTION_TIMEZONE || value.year !== expectedYear) return null;
  if (!isIsoDate(value.today)) return null;
  if (!(value.tracking_started_at === null || typeof value.tracking_started_at === 'string')) return null;
  if (!(value.history_complete_since === null || typeof value.history_complete_since === 'string')) return null;
  if (!isCount(value.total_approvals) || !isCount(value.roster_size)) return null;
  if (!Array.isArray(value.days) || value.days.length > 366) return null;
  if (!Array.isArray(value.members)) return null;
  if (!Array.isArray(value.roster) || value.roster.length > 500) return null;

  const today = value.today;
  const seen = new Set<string>();
  const days: MemberInsightDay[] = [];
  let sum = 0;
  for (const raw of value.days) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, DAY_KEYS)) return null;
    if (!isIsoDate(raw.date) || !isCount(raw.count) || !isCount(raw.crew)) return null;
    if (Number(raw.date.slice(0, 4)) !== expectedYear || seen.has(raw.date)) return null;
    if (raw.date > today && raw.count > 0) return null;
    if (raw.crew > raw.count) return null;
    seen.add(raw.date);
    sum += raw.count;
    if (!Number.isSafeInteger(sum)) return null;
    days.push({ date: raw.date, count: raw.count, crew: raw.crew });
  }
  if (sum !== value.total_approvals) return null;

  const people: MemberInsightPerson[] = [];
  const seenMembers = new Set<number>();
  for (const raw of value.members) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, PERSON_KEYS)) return null;
    const memberId = raw.member_id;
    if (typeof memberId !== 'number' || !Number.isSafeInteger(memberId) || memberId < 1) return null;
    if (seenMembers.has(memberId)) return null;
    if (typeof raw.full_name !== 'string' || raw.full_name.trim().length === 0) return null;
    if (!isCount(raw.approved) || !isCount(raw.active_days) || raw.approved === 0) return null;
    if (raw.active_days > raw.approved) return null;
    const last = raw.last_approved_on;
    if (!(last === null || (isIsoDate(last) && last <= today))) return null;
    if (!isOptionalHandle(raw.github_handle)) return null;
    seenMembers.add(memberId);
    people.push({
      memberId,
      fullName: raw.full_name,
      approved: raw.approved,
      activeDays: raw.active_days,
      lastApprovedOn: last,
      githubHandle: raw.github_handle,
    });
  }
  const memberSum = people.reduce((total, person) => total + person.approved, 0);
  if (memberSum !== value.total_approvals) return null;

  const roster: MemberInsightRosterEntry[] = [];
  const seenHandles = new Set<string>();
  for (const raw of value.roster) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ROSTER_KEYS)) return null;
    const memberId = raw.member_id;
    if (typeof memberId !== 'number' || !Number.isSafeInteger(memberId) || memberId < 1) return null;
    if (typeof raw.full_name !== 'string' || raw.full_name.trim().length === 0) return null;
    if (typeof raw.github_handle !== 'string' || !HANDLE_PATTERN.test(raw.github_handle)) return null;
    const key = raw.github_handle.toLowerCase();
    if (seenHandles.has(key)) return null;
    seenHandles.add(key);
    roster.push({ memberId, fullName: raw.full_name, githubHandle: raw.github_handle });
  }

  return {
    contributions: {
      timezone: CONTRIBUTION_TIMEZONE,
      tracking_started_at: value.tracking_started_at,
      today,
      year: expectedYear,
      history_complete_since: value.history_complete_since,
      days: days.map(({ date, count }) => ({ date, count })),
      total_approvals: value.total_approvals,
    },
    days,
    people,
    roster,
    rosterSize: value.roster_size,
  };
}

export async function requestMemberTeamInsights(
  client: MemberInsightsRpcClient,
  year: number,
): Promise<MemberTeamInsights> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new TypeError('A valid contribution year is required.');
  let result: RpcResult;
  try {
    result = await client.rpc(MEMBER_INSIGHTS_RPC, { p_year: year });
  } catch {
    throw new Error('Team insights could not be loaded.');
  }
  if (result.error !== null) throw new Error('Team insights could not be loaded.');
  const parsed = parseMemberTeamInsights(result.data, year);
  if (!parsed) throw new Error('Team insights returned an invalid response.');
  return parsed;
}

export interface MemberGithubMerge {
  /** Public calendars keyed by lowercase handle, fetched in the browser. */
  calendars: ReadonlyMap<string, GithubCalendar>;
  enabled: boolean;
}

/**
 * Shapes the member payload into the same TeamActivity model the admin widgets
 * consume. Approvals come from the RPC ledger; GitHub volume is merged here
 * exactly like the admin dashboard (calendar days added to the cell volume and
 * to the crew count), so the heatmap, pulse and trend stay identical.
 */
export function buildMemberTeamActivity(insights: MemberTeamInsights, github?: MemberGithubMerge): TeamActivity {
  const { contributions, days, people, roster, rosterSize } = insights;
  const year = contributions.year;
  const today = contributions.today;
  const byDate = new Map<string, TeamDay>();
  const day = (date: string): TeamDay => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { date, approvals: 0, github: 0, total: 0, githubBy: [], deliveries: [], contributorIds: [], crewSize: 0, crew: 0 };
      byDate.set(date, entry);
    }
    return entry;
  };
  const inYear = (date: string) => Number(date.slice(0, 4)) === year && date <= today;

  for (const entry of days) {
    if (entry.count <= 0 || !inYear(entry.date)) continue;
    const teamDay = day(entry.date);
    teamDay.approvals = entry.count;
    teamDay.crewSize = Math.max(teamDay.crewSize, entry.crew);
  }

  const names = new Map<number, string>();
  for (const person of people) names.set(person.memberId, person.fullName);
  for (const person of roster) if (!names.has(person.memberId)) names.set(person.memberId, person.fullName);
  const stats = new Map<number, MemberActivity>();
  const stat = (memberId: number): MemberActivity => {
    let entry = stats.get(memberId);
    if (!entry) {
      entry = {
        memberId,
        name: names.get(memberId) ?? `#${memberId}`,
        handle: null,
        approved: 0,
        submitted: 0,
        github: 0,
        activeDays: 0,
        score: 0,
      };
      stats.set(memberId, entry);
    }
    return entry;
  };
  const githubDaysByMember = new Map<number, Set<string>>();

  if (github?.enabled) {
    for (const person of roster) {
      const calendar = github.calendars.get(person.githubHandle.toLowerCase());
      if (!calendar || calendar.year !== year) continue;
      const memberStat = stat(person.memberId);
      memberStat.handle = person.githubHandle;
      for (const [date, count] of Object.entries(calendar.days)) {
        if (count <= 0 || !inYear(date)) continue;
        const teamDay = day(date);
        teamDay.github += count;
        teamDay.githubBy.push({ memberId: person.memberId, handle: person.githubHandle, count });
        memberStat.github += count;
        let set = githubDaysByMember.get(person.memberId);
        if (!set) {
          set = new Set();
          githubDaysByMember.set(person.memberId, set);
        }
        set.add(date);
      }
    }
  }

  for (const person of people) {
    const memberStat = stat(person.memberId);
    memberStat.approved = person.approved;
    if (!memberStat.handle && person.githubHandle) memberStat.handle = person.githubHandle;
    memberStat.activeDays = Math.max(person.activeDays, githubDaysByMember.get(person.memberId)?.size ?? 0);
  }
  for (const [memberId, dates] of githubDaysByMember) {
    const memberStat = stat(memberId);
    memberStat.activeDays = Math.max(memberStat.activeDays, dates.size);
  }

  const rosterActive = new Set<number>();
  for (const [memberId, memberStat] of stats) {
    if (memberStat.approved > 0 || memberStat.github > 0) rosterActive.add(memberId);
  }
  const hot = crewHotThreshold(Math.max(rosterSize, rosterActive.size));

  let approvals = 0;
  let githubTotal = 0;
  let activeDays = 0;
  let crewDays = 0;
  let peak: TeamDay | null = null;
  for (const entry of byDate.values()) {
    entry.total = entry.approvals + entry.github;
    const contributors = new Set<number>();
    for (const share of entry.githubBy) contributors.add(share.memberId);
    entry.contributorIds = [...contributors];
    const approvalCrew = entry.approvals > 0 ? 1 : 0;
    // The RPC already counted distinct approvers for the day; GitHub adds people who only committed.
    entry.crewSize = Math.max(entry.crewSize, approvalCrew, contributors.size);
    entry.crew = crewTier(entry.total > 0 ? Math.max(1, entry.crewSize) : 0, hot);
    entry.githubBy.sort((a, b) => b.count - a.count);
    approvals += entry.approvals;
    githubTotal += entry.github;
    if (entry.total > 0) activeDays += 1;
    if (entry.crewSize >= 2) crewDays += 1;
    if (!peak || entry.total > peak.total || (entry.total === peak.total && entry.crewSize > peak.crewSize)) {
      peak = entry.total > 0 ? entry : peak;
    }
  }

  for (const memberStat of stats.values()) {
    memberStat.score = memberStat.approved * 5 + memberStat.submitted * 2 + memberStat.github;
  }

  const mergedDays = [...byDate.values()]
    .filter((entry) => entry.total > 0)
    .map((entry) => ({ date: entry.date, count: entry.total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    year,
    byDate,
    mergedDays,
    totals: {
      approvals,
      github: githubTotal,
      total: approvals + githubTotal,
      deliveries: 0,
      activeDays,
      crewDays,
      peak,
    },
    members: [...stats.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    crewScale: { roster: rosterSize, hot },
  };
}

/** GitHub shares of one day, used by the member-safe day summary. */
export function githubSharesOf(activity: TeamActivity, date: string): GithubDayShare[] {
  return activity.byDate.get(date)?.githubBy ?? [];
}
