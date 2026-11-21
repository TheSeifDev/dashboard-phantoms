import type { Member, Note, Task, TaskStatus } from '../../types/db';
import { getCairoDate, isIsoDate, type ContributionDay, type TaskContributions } from './taskContributions';
import type { GithubCalendar } from './github';

/**
 * Team activity model behind the honeycomb.
 * - Volume (cell intensity) = audited task approvals from the ledger + GitHub contributions of linked members.
 * - Crew (cell hue) = how many distinct people were active that day: GitHub contributors plus members whose
 *   task tracking moved to "submitted"/"approved" on that Cairo-local day. More people = hotter colour.
 * - The ledger stays the single source of truth for approvals; tracking timestamps only enrich the history.
 */
export type CrewTier = 0 | 1 | 2 | 3 | 4;

export interface DeliveryEvent {
  memberId: number;
  taskId: number;
  taskTitle: string;
  status: TaskStatus;
  at: string;
  url: string | null;
  note: string | null;
}

export interface GithubDayShare {
  memberId: number;
  handle: string;
  count: number;
}

export interface TeamDay {
  date: string;
  approvals: number;
  github: number;
  total: number;
  githubBy: GithubDayShare[];
  deliveries: DeliveryEvent[];
  contributorIds: number[];
  /** Distinct people active that day (unknown approvers count as one). */
  crewSize: number;
  crew: CrewTier;
}

export interface MemberActivity {
  memberId: number;
  name: string;
  handle: string | null;
  approved: number;
  submitted: number;
  github: number;
  activeDays: number;
  score: number;
}

export interface TeamActivity {
  year: number;
  byDate: Map<string, TeamDay>;
  /** Ledger + GitHub per day, shaped for the existing calendar/streak helpers. */
  mergedDays: ContributionDay[];
  totals: {
    approvals: number;
    github: number;
    total: number;
    deliveries: number;
    activeDays: number;
    crewDays: number;
    peak: TeamDay | null;
  };
  members: MemberActivity[];
  /**
   * Heat scale: 1 person → tier 1, 2 → tier 2, 3 … hot-1 → tier 3, hot+ → tier 4.
   * `hot` grows with the number of people active this year so busy teams still show contrast.
   */
  crewScale: { roster: number; hot: number };
}

export interface GithubLink {
  memberId: number;
  handle: string;
}

const DELIVERY_STATUSES: ReadonlySet<TaskStatus> = new Set(['under_review', 'approved', 'revision_requested']);

export function crewHotThreshold(roster: number): number {
  return Math.max(4, Math.ceil(Math.max(0, roster) * 0.5));
}

export function crewTier(size: number, hot = 4): CrewTier {
  if (size <= 0) return 0;
  if (size >= Math.max(4, hot)) return 4;
  if (size >= 3) return 3;
  return size as CrewTier;
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function cairoDayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isIsoDate(value)) return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  return getCairoDate(instant);
}

function emptyDay(date: string): TeamDay {
  return { date, approvals: 0, github: 0, total: 0, githubBy: [], deliveries: [], contributorIds: [], crewSize: 0, crew: 0 };
}

export function buildTeamActivity(input: {
  year: number;
  contributions: TaskContributions;
  members: readonly Member[];
  tasks: readonly Task[];
  githubLinks: readonly GithubLink[];
  githubCalendars: ReadonlyMap<string, GithubCalendar>;
  memberId?: number | null;
}): TeamActivity {
  const { year, contributions, members, tasks, githubLinks, githubCalendars } = input;
  const scope = input.memberId ?? null;
  const today = contributions.today;
  const byDate = new Map<string, TeamDay>();
  const day = (date: string) => {
    let entry = byDate.get(date);
    if (!entry) { entry = emptyDay(date); byDate.set(date, entry); }
    return entry;
  };
  const inYear = (date: string) => Number(date.slice(0, 4)) === year && date <= today;

  for (const ledgerDay of contributions.days) {
    if (ledgerDay.count > 0 && inYear(ledgerDay.date)) day(ledgerDay.date).approvals = ledgerDay.count;
  }

  const stats = new Map<number, MemberActivity>();
  const memberName = new Map(members.map((member) => [member.id, member.full_name]));
  const stat = (memberId: number) => {
    let entry = stats.get(memberId);
    if (!entry) {
      entry = { memberId, name: memberName.get(memberId) ?? `#${memberId}`, handle: null, approved: 0, submitted: 0, github: 0, activeDays: 0, score: 0 };
      stats.set(memberId, entry);
    }
    return entry;
  };
  const activeDaysByMember = new Map<number, Set<string>>();
  const markActive = (memberId: number, date: string) => {
    let set = activeDaysByMember.get(memberId);
    if (!set) { set = new Set(); activeDaysByMember.set(memberId, set); }
    set.add(date);
  };

  for (const link of githubLinks) {
    if (scope !== null && link.memberId !== scope) continue;
    const calendar = githubCalendars.get(link.handle.toLowerCase());
    if (!calendar || calendar.year !== year) continue;
    const memberStat = stat(link.memberId);
    memberStat.handle = link.handle;
    for (const [date, count] of Object.entries(calendar.days)) {
      if (!inYear(date) || count <= 0) continue;
      const entry = day(date);
      entry.github += count;
      entry.githubBy.push({ memberId: link.memberId, handle: link.handle, count });
      memberStat.github += count;
      markActive(link.memberId, date);
    }
  }

  const knownMembers = new Set(members.map((member) => member.id));
  for (const task of tasks) {
    for (const [rawId, tracking] of Object.entries(task.tracking ?? {})) {
      const memberId = Number(rawId);
      if (!Number.isSafeInteger(memberId) || !knownMembers.has(memberId)) continue;
      if (scope !== null && memberId !== scope) continue;
      if (!tracking || !DELIVERY_STATUSES.has(tracking.status)) continue;
      const date = cairoDayOf(tracking.updated_at);
      if (!date || !inYear(date)) continue;
      day(date).deliveries.push({
        memberId,
        taskId: task.id,
        taskTitle: task.title,
        status: tracking.status,
        at: tracking.updated_at ?? date,
        url: safeExternalUrl(tracking.submission_url),
        note: typeof tracking.note === 'string' && tracking.note.trim() ? tracking.note.trim() : null,
      });
      const memberStat = stat(memberId);
      if (tracking.status === 'approved') memberStat.approved += 1;
      else memberStat.submitted += 1;
      markActive(memberId, date);
    }
  }

  let approvals = 0;
  let github = 0;
  let deliveries = 0;
  let crewDays = 0;
  let activeDays = 0;
  let peak: TeamDay | null = null;
  const roster = activeDaysByMember.size;
  const hot = crewHotThreshold(roster);
  for (const entry of byDate.values()) {
    entry.total = entry.approvals + entry.github;
    const people = new Set<number>();
    for (const share of entry.githubBy) people.add(share.memberId);
    for (const delivery of entry.deliveries) people.add(delivery.memberId);
    entry.contributorIds = [...people];
    entry.crewSize = Math.max(entry.approvals > 0 ? 1 : 0, people.size);
    entry.crew = crewTier(entry.total > 0 || entry.deliveries.length > 0 ? Math.max(1, entry.crewSize) : 0, hot);
    entry.githubBy.sort((a, b) => b.count - a.count);
    entry.deliveries.sort((a, b) => a.at.localeCompare(b.at));
    approvals += entry.approvals;
    github += entry.github;
    deliveries += entry.deliveries.length;
    if (entry.total > 0) activeDays += 1;
    if (entry.crewSize >= 2) crewDays += 1;
    if (!peak || entry.total > peak.total || (entry.total === peak.total && entry.crewSize > peak.crewSize)) peak = entry.total > 0 ? entry : peak;
  }

  for (const memberStat of stats.values()) {
    memberStat.activeDays = activeDaysByMember.get(memberStat.memberId)?.size ?? 0;
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
    totals: { approvals, github, total: approvals + github, deliveries, activeDays, crewDays, peak },
    members: [...stats.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    crewScale: { roster, hot },
  };
}

/** Everything else recorded on a Cairo-local day, for the day history drawer. */
export interface DayRecords {
  notes: Note[];
  tasksCreated: Task[];
  membersJoined: Member[];
}

export function recordsOnDay(date: string, notes: readonly Note[], tasks: readonly Task[], members: readonly Member[], memberId: number | null = null): DayRecords {
  return {
    notes: notes.filter((note) => cairoDayOf(note.created_at) === date && (memberId === null || note.target_member_id === memberId)),
    tasksCreated: tasks.filter((task) => cairoDayOf(task.created_at) === date && (memberId === null || task.assigned_to === 'ALL' || (Array.isArray(task.assigned_to) && task.assigned_to.map(Number).includes(memberId)))),
    membersJoined: members.filter((member) => cairoDayOf(member.created_at) === date && (memberId === null || member.id === memberId)),
  };
}

/** Counts per bucket for the last `buckets` windows of `size` days ending today (oldest first). */
export function bucketSeries(dates: readonly string[], today: string, buckets = 10, size = 7): number[] {
  const end = Date.parse(`${today}T12:00:00Z`);
  const series = Array.from({ length: buckets }, () => 0);
  for (const date of dates) {
    const at = Date.parse(`${date}T12:00:00Z`);
    if (!Number.isFinite(at) || at > end) continue;
    const back = Math.floor((end - at) / 86_400_000 / size);
    if (back < buckets) series[buckets - 1 - back] += 1;
  }
  return series;
}

/** Running total series for cumulative KPIs (e.g. team size). */
export function cumulativeSeries(dates: readonly string[], today: string, buckets = 10, size = 7): number[] {
  const end = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: buckets }, (_, index) => {
    const cutoff = end - (buckets - 1 - index) * size * 86_400_000;
    return dates.filter((date) => {
      const at = Date.parse(`${date}T12:00:00Z`);
      return Number.isFinite(at) && at <= cutoff;
    }).length;
  });
}
