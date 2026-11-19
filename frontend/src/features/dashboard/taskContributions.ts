export const CONTRIBUTION_TIMEZONE = 'Africa/Cairo' as const;

export interface ContributionDay {
  date: string;
  count: number;
}

export interface TaskContributions {
  timezone: typeof CONTRIBUTION_TIMEZONE;
  tracking_started_at: string | null;
  today: string;
  year: number;
  history_complete_since: string | null;
  days: ContributionDay[];
  total_approvals: number;
}

export interface ContributionCalendarDay extends ContributionDay {
  level: 0 | 1 | 2 | 3 | 4;
  inSelectedYear: boolean;
  isFuture: boolean;
  isUntracked: boolean;
}

export interface ContributionCalendar {
  weeks: ContributionCalendarDay[][];
  monthLabels: Array<{ weekIndex: number; month: number }>;
  weekStart: number;
}

export interface ContributionStreaks {
  current: number;
  best: number;
}

export interface RpcResult {
  data: unknown;
  error: unknown | null;
}

export interface ContributionsRpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}

const ROOT_KEYS = [
  'timezone',
  'tracking_started_at',
  'today',
  'year',
  'history_complete_since',
  'days',
  'total_approvals',
] as const;
const DAY_KEYS = ['date', 'count'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(year, month - 1, day);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function asUtcDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function isoFromUtcDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addIsoDays(date: string, days: number): string | null {
  if (!isIsoDate(date) || !Number.isInteger(days)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const result = asUtcDate(year, month - 1, day + days);
  return isIsoDate(isoFromUtcDate(result)) ? isoFromUtcDate(result) : null;
}

/** Gets today's date in the contract timezone, independent of the browser's configured zone. */
export function getCairoDate(now: Date = new Date()): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('A valid date is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONTRIBUTION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Could not determine the Cairo-local date.');
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

function validTimestampOrDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) return false;
  const datePart = value.slice(0, 10);
  return isIsoDate(datePart) && (isIsoDate(value) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) && Number.isFinite(Date.parse(value));
}

/** Coverage metadata from PostgreSQL is a timestamp; convert its day in Cairo, not UTC. */
export function contributionCoverageDate(value: string | null): string | null {
  if (value === null || !validTimestampOrDate(value)) return null;
  if (isIsoDate(value)) return value;
  const instant = new Date(value);
  const cairoDay = getCairoDate(instant);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: CONTRIBUTION_TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(instant);
  return time === '00:00:00' && instant.getUTCMilliseconds() === 0 ? cairoDay : addIsoDays(cairoDay, 1);
}

/** Validates and projects the exact public RPC contract; unexpected identity fields are rejected. */
export function parseTaskContributions(value: unknown, expectedYear: number): TaskContributions | null {
  if (!Number.isInteger(expectedYear) || expectedYear < 1 || expectedYear > 9999 || !isRecord(value)) return null;
  if (!hasOnlyKeys(value, ROOT_KEYS)) return null;
  if (value.timezone !== CONTRIBUTION_TIMEZONE || value.year !== expectedYear) return null;
  if (!isIsoDate(value.today)) return null;
  if (!(value.tracking_started_at === null || validTimestampOrDate(value.tracking_started_at))) return null;
  if (!(value.history_complete_since === null || validTimestampOrDate(value.history_complete_since))) return null;
  if (!Array.isArray(value.days) || value.days.length > 366 || !Number.isSafeInteger(value.total_approvals) || (value.total_approvals as number) < 0) return null;

  const seen = new Set<string>();
  let sum = 0;
  const days: ContributionDay[] = [];
  for (const rawDay of value.days) {
    if (!isRecord(rawDay) || !hasOnlyKeys(rawDay, DAY_KEYS)) return null;
    if (!isIsoDate(rawDay.date) || !Number.isSafeInteger(rawDay.count) || (rawDay.count as number) < 0) return null;
    if (Number(rawDay.date.slice(0, 4)) !== expectedYear || seen.has(rawDay.date)) return null;
    if (rawDay.date > value.today && (rawDay.count as number) > 0) return null;
    seen.add(rawDay.date);
    sum += rawDay.count as number;
    if (!Number.isSafeInteger(sum)) return null;
    days.push({ date: rawDay.date, count: rawDay.count as number });
  }
  if (sum !== value.total_approvals) return null;

  return {
    timezone: CONTRIBUTION_TIMEZONE,
    tracking_started_at: value.tracking_started_at,
    today: value.today,
    year: expectedYear,
    history_complete_since: value.history_complete_since,
    days,
    total_approvals: value.total_approvals as number,
  };
}

export async function requestTaskContributions(
  client: ContributionsRpcClient,
  year: number,
  memberId: number | null = null,
): Promise<TaskContributions> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new TypeError('A valid contribution year is required.');
  if (memberId !== null && (!Number.isSafeInteger(memberId) || memberId < 1)) throw new TypeError('A valid member ID is required.');
  let result: RpcResult;
  try {
    result = await client.rpc('get_task_contributions', { p_year: year, p_member_id: memberId });
  } catch {
    throw new Error('Task contribution history could not be loaded.');
  }
  if (result.error !== null) throw new Error('Task contribution history could not be loaded.');
  const parsed = parseTaskContributions(result.data, year);
  if (!parsed) throw new Error('Task contribution history returned an invalid response.');
  return parsed;
}

function contributionLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Pads a complete calendar year into Sunday-first columns of seven days (52 or 53 weeks). */
export function buildContributionCalendar(
  year: number,
  days: readonly ContributionDay[],
  today?: string,
  coverageSince?: string | null,
): ContributionCalendar | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Array.isArray(days) || (today !== undefined && !isIsoDate(today))) return null;
  if (coverageSince !== undefined && coverageSince !== null && !isIsoDate(coverageSince)) return null;
  const byDate = new Map<string, number>();
  for (const day of days) {
    if (!day || !isIsoDate(day.date) || Number(day.date.slice(0, 4)) !== year) return null;
    if (!Number.isSafeInteger(day.count) || day.count < 0 || byDate.has(day.date)) return null;
    byDate.set(day.date, day.count);
  }

  const first = asUtcDate(year, 0, 1);
  const last = asUtcDate(year, 11, 31);
  // A Sunday-first leap year beginning on Saturday needs 54 fully aligned columns.
  // Start that one edge case on Monday so the entire year fits the requested 52/53 grid.
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const weekStart = leapYear && first.getUTCDay() === 6 ? 1 : 0;
  const firstOffset = (first.getUTCDay() - weekStart + 7) % 7;
  const lastOffset = (last.getUTCDay() - weekStart + 7) % 7;
  const start = asUtcDate(year, 0, 1 - firstOffset);
  const end = asUtcDate(year, 11, 31 + (6 - lastOffset));
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const weekCount = totalDays / 7;
  if (!Number.isInteger(weekCount) || weekCount < 52 || weekCount > 53) return null;

  const weeks: ContributionCalendarDay[][] = Array.from({ length: weekCount }, () => []);
  const monthLabels: Array<{ weekIndex: number; month: number }> = [];
  for (let offset = 0; offset < totalDays; offset += 1) {
    const current = asUtcDate(year, 0, 1 - firstOffset + offset);
    const date = isoFromUtcDate(current);
    const inSelectedYear = current.getUTCFullYear() === year;
    const isFuture = Boolean(today && inSelectedYear && date > today);
    const isUntracked = Boolean(inSelectedYear && coverageSince !== undefined && (!coverageSince || date < coverageSince));
    const count = inSelectedYear && !isFuture ? byDate.get(date) ?? 0 : 0;
    const weekIndex = Math.floor(offset / 7);
    weeks[weekIndex].push({ date, count, level: contributionLevel(count), inSelectedYear, isFuture, isUntracked });
    if (inSelectedYear && current.getUTCDate() === 1) monthLabels.push({ weekIndex, month: current.getUTCMonth() });
  }
  if (weeks.some((week) => week.length !== 7)) return null;
  return { weeks, monthLabels, weekStart };
}

/** Current streak starts today, or yesterday when today is inactive; future activity is ignored. */
export function calculateContributionStreaks(
  days: readonly ContributionDay[],
  today: string,
): ContributionStreaks | null {
  if (!isIsoDate(today) || !Array.isArray(days)) return null;
  const active = new Set<string>();
  const seen = new Set<string>();
  for (const day of days) {
    if (!day || !isIsoDate(day.date) || !Number.isSafeInteger(day.count) || day.count < 0 || seen.has(day.date)) return null;
    seen.add(day.date);
    if (day.count > 0) active.add(day.date);
  }

  const ordered = [...active].filter((date) => date <= today).sort();
  let best = 0;
  let run = 0;
  let prior: string | null = null;
  for (const date of ordered) {
    run = prior !== null && addIsoDays(prior, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prior = date;
  }

  let anchor: string | null = active.has(today) ? today : addIsoDays(today, -1);
  let current = 0;
  if (anchor && active.has(anchor)) {
    while (anchor && active.has(anchor)) {
      current += 1;
      anchor = addIsoDays(anchor, -1);
    }
  }
  return { current, best };
}

export function buildMonthlyApprovalTrend(
  year: number,
  days: readonly ContributionDay[],
  today?: string,
  coverageSince?: string | null,
): Array<{ month: number; approvals: number | null; partial: boolean }> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return [];
  if (today !== undefined && !isIsoDate(today)) return [];
  if (coverageSince !== undefined && coverageSince !== null && !isIsoDate(coverageSince)) return [];
  const currentYear = today ? Number(today.slice(0, 4)) : year;
  const monthCount = today && year > currentYear ? 0 : today && year === currentYear ? Number(today.slice(5, 7)) : 12;
  const totals = Array.from({ length: monthCount }, (_, month) => {
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const partial = coverageSince !== undefined && (coverageSince === null || monthStart < coverageSince);
    return { month, approvals: partial ? null : 0, partial } as { month: number; approvals: number | null; partial: boolean };
  });
  for (const day of days) {
    if (isIsoDate(day.date) && Number(day.date.slice(0, 4)) === year && Number.isSafeInteger(day.count) && day.count > 0 && (!today || day.date <= today)) {
      const slot = totals[Number(day.date.slice(5, 7)) - 1];
      if (slot) slot.approvals = (slot.approvals ?? 0) + day.count;
    }
  }
  return totals;
}
