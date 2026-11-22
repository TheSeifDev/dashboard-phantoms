import {
  CONTRIBUTION_TIMEZONE,
  isIsoDate,
  type ContributionDay,
  type RpcResult,
  type TaskContributions,
} from '../dashboard/taskContributions';
import {
  crewHotThreshold,
  crewTier,
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
}

export interface MemberTeamInsights {
  contributions: TaskContributions;
  days: MemberInsightDay[];
  people: MemberInsightPerson[];
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
  'roster_size',
] as const;
const DAY_KEYS = ['date', 'count', 'crew'] as const;
const PERSON_KEYS = ['member_id', 'full_name', 'approved', 'active_days', 'last_approved_on'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
    seenMembers.add(memberId);
    people.push({
      memberId,
      fullName: raw.full_name,
      approved: raw.approved,
      activeDays: raw.active_days,
      lastApprovedOn: last,
    });
  }
  const memberSum = people.reduce((total, person) => total + person.approved, 0);
  if (memberSum !== value.total_approvals) return null;

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

/**
 * Shapes the member payload into the same TeamActivity model the admin widgets
 * consume, so the pulse and trend panels stay byte-for-byte identical.
 */
export function buildMemberTeamActivity(insights: MemberTeamInsights): TeamActivity {
  const { contributions, days, people, rosterSize } = insights;
  const year = contributions.year;
  const hot = crewHotThreshold(rosterSize);
  const byDate = new Map<string, TeamDay>();
  let crewDays = 0;
  let peak: TeamDay | null = null;
  for (const entry of days) {
    if (entry.count <= 0) continue;
    const teamDay: TeamDay = {
      date: entry.date,
      approvals: entry.count,
      github: 0,
      total: entry.count,
      githubBy: [],
      deliveries: [],
      contributorIds: [],
      crewSize: entry.crew,
      crew: crewTier(entry.crew, hot),
    };
    byDate.set(entry.date, teamDay);
    if (entry.crew >= 2) crewDays += 1;
    if (!peak || teamDay.total > peak.total) peak = teamDay;
  }
  const members: MemberActivity[] = people.map((person) => ({
    memberId: person.memberId,
    name: person.fullName,
    handle: null,
    approved: person.approved,
    submitted: 0,
    github: 0,
    activeDays: person.activeDays,
    score: person.approved * 5,
  })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const mergedDays = [...byDate.values()]
    .map((entry) => ({ date: entry.date, count: entry.total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    year,
    byDate,
    mergedDays,
    totals: {
      approvals: contributions.total_approvals,
      github: 0,
      total: contributions.total_approvals,
      deliveries: 0,
      activeDays: byDate.size,
      crewDays,
      peak,
    },
    members,
    crewScale: { roster: rosterSize, hot },
  };
}