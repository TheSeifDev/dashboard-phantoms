import type { Member } from '../../types/db';

/**
 * GitHub enrichment for the team contribution map.
 * - Handles come from an existing member field (a custom field labelled "GitHub" or a github.com portfolio URL); no schema change.
 * - Daily counts come from the public contributions calendar mirror; event details are fetched lazily per day.
 * - Every failure degrades to "not synced" — GitHub never blocks or errors the dashboard.
 */
const HANDLE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const RESERVED = new Set(['about', 'orgs', 'settings', 'features', 'topics', 'collections', 'marketplace', 'sponsors', 'login', 'join', 'explore', 'pricing', 'enterprise']);
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
export const GITHUB_CONTRIB_BASE = (env.VITE_GITHUB_CONTRIB_BASE || 'https://github-contributions-api.jogruber.de').replace(/\/+$/, '');
export const GITHUB_API_BASE = (env.VITE_GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const CACHE_PREFIX = 'phantoms_gh_v1:';
export const GITHUB_SYNC_PREFERENCE = 'phantoms_github_sync';

export function normalizeGithubHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i.exec(value);
  if (url) value = url[1];
  else if (/^https?:\/\//i.test(value) || value.includes('/')) return null;
  value = value.replace(/^@/, '');
  if (!HANDLE.test(value) || RESERVED.has(value.toLowerCase())) return null;
  return value;
}

/** Custom field whose key mentions GitHub wins; otherwise a github.com portfolio URL. */
export function resolveGithubHandle(member: Pick<Member, 'portfolio_url' | 'custom_fields'>): string | null {
  const fields = member.custom_fields ?? {};
  for (const [key, value] of Object.entries(fields)) {
    if (/git\s*hub|جيت\s*هاب/i.test(key)) {
      const handle = normalizeGithubHandle(value);
      if (handle) return handle;
    }
  }
  return normalizeGithubHandle(member.portfolio_url ?? null);
}

export function githubAvatarUrl(handle: string, size = 64): string {
  return `https://github.com/${encodeURIComponent(handle)}.png?size=${size}`;
}

interface CacheEntry<T> { at: number; etag?: string; value: T }
function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return typeof parsed?.at === 'number' ? parsed : null;
  } catch { return null; }
}
function writeCache<T>(key: string, entry: CacheEntry<T>) {
  try { window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry)); } catch { /* Cache is best-effort only. */ }
}

export interface GithubCalendar { handle: string; year: number; days: Record<string, number>; total: number }

function parseCalendar(handle: string, year: number, value: unknown): GithubCalendar | null {
  if (typeof value !== 'object' || value === null) return null;
  const list = (value as { contributions?: unknown }).contributions;
  if (!Array.isArray(list)) return null;
  const days: Record<string, number> = {};
  let total = 0;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { date, count } = item as { date?: unknown; count?: unknown };
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== year) continue;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) continue;
    days[date] = Math.min(count, 500);
    total += days[date];
  }
  return { handle, year, days, total };
}

/** One request per member-year; current year refreshes every 30 minutes, past years weekly. */
export async function fetchGithubCalendar(handle: string, year: number, currentYear: number, signal?: AbortSignal): Promise<GithubCalendar> {
  const key = `cal:${handle.toLowerCase()}:${year}`;
  const ttl = year >= currentYear ? 30 * 60_000 : 7 * 24 * 60 * 60_000;
  const cached = readCache<GithubCalendar>(key);
  if (cached && Date.now() - cached.at < ttl) return cached.value;
  const response = await fetch(`${GITHUB_CONTRIB_BASE}/v4/${encodeURIComponent(handle)}?y=${year}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (cached) return cached.value;
    throw new Error(`GitHub calendar unavailable (${response.status})`);
  }
  const parsed = parseCalendar(handle, year, await response.json());
  if (!parsed) throw new Error('GitHub calendar returned an unexpected shape');
  writeCache(key, { at: Date.now(), value: parsed });
  return parsed;
}

export type GithubEventKind = 'push' | 'pull_request' | 'review' | 'issue' | 'create' | 'release' | 'comment' | 'other';
export interface GithubEvent {
  id: string;
  kind: GithubEventKind;
  handle: string;
  repo: string;
  repoUrl: string;
  createdAt: string;
  title: string;
  detail: string;
  url: string;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const safeGithubUrl = (value: unknown, fallback: string) => {
  const candidate = str(value);
  return /^https:\/\/github\.com\//.test(candidate) ? candidate : fallback;
};

function mapEvent(raw: unknown): GithubEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as { id?: unknown; type?: unknown; created_at?: unknown; repo?: { name?: unknown }; actor?: { login?: unknown }; payload?: Record<string, unknown> };
  const repo = str(event.repo?.name);
  const createdAt = str(event.created_at);
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isFinite(Date.parse(createdAt))) return null;
  const repoUrl = `https://github.com/${repo}`;
  const payload = event.payload ?? {};
  const base = { id: str(event.id) || `${repo}-${createdAt}`, handle: str(event.actor?.login), repo, repoUrl, createdAt };
  switch (event.type) {
    case 'PushEvent': {
      const ref = str(payload.ref).replace(/^refs\/heads\//, '');
      const head = str(payload.head).slice(0, 7);
      const size = typeof payload.size === 'number' ? payload.size : null;
      return { ...base, kind: 'push', title: ref || 'push', detail: [size ? `${size} commit${size === 1 ? '' : 's'}` : '', head].filter(Boolean).join(' · '), url: head ? `${repoUrl}/commit/${str(payload.head)}` : `${repoUrl}/tree/${encodeURIComponent(ref)}` };
    }
    case 'PullRequestEvent': {
      const pr = (payload.pull_request ?? {}) as Record<string, unknown>;
      const action = pr.merged === true && payload.action === 'closed' ? 'merged' : str(payload.action);
      return { ...base, kind: 'pull_request', title: str(pr.title) || `#${String(payload.number ?? '')}`, detail: `${action} · #${String(payload.number ?? pr.number ?? '')}`, url: safeGithubUrl(pr.html_url, repoUrl) };
    }
    case 'PullRequestReviewEvent': {
      const pr = (payload.pull_request ?? {}) as Record<string, unknown>;
      const review = (payload.review ?? {}) as Record<string, unknown>;
      return { ...base, kind: 'review', title: str(pr.title) || 'review', detail: `${str(review.state) || 'reviewed'} · #${String(pr.number ?? '')}`, url: safeGithubUrl(pr.html_url, repoUrl) };
    }
    case 'IssuesEvent': {
      const issue = (payload.issue ?? {}) as Record<string, unknown>;
      return { ...base, kind: 'issue', title: str(issue.title) || 'issue', detail: `${str(payload.action)} · #${String(issue.number ?? '')}`, url: safeGithubUrl(issue.html_url, repoUrl) };
    }
    case 'IssueCommentEvent': {
      const issue = (payload.issue ?? {}) as Record<string, unknown>;
      return { ...base, kind: 'comment', title: str(issue.title) || 'comment', detail: `comment · #${String(issue.number ?? '')}`, url: safeGithubUrl((payload.comment as Record<string, unknown> | undefined)?.html_url, repoUrl) };
    }
    case 'CreateEvent':
      return { ...base, kind: 'create', title: str(payload.ref) || repo, detail: str(payload.ref_type) || 'created', url: repoUrl };
    case 'ReleaseEvent': {
      const release = (payload.release ?? {}) as Record<string, unknown>;
      return { ...base, kind: 'release', title: str(release.name) || str(release.tag_name) || 'release', detail: str(release.tag_name), url: safeGithubUrl(release.html_url, repoUrl) };
    }
    default:
      return { ...base, kind: 'other', title: str(event.type).replace(/Event$/, '') || 'activity', detail: '', url: repoUrl };
  }
}

/** Public events (last ~90 days, 100 max) with ETag revalidation; GitHub answers 304 without spending rate limit. */
export async function fetchGithubEvents(handle: string, signal?: AbortSignal): Promise<GithubEvent[]> {
  const key = `events:${handle.toLowerCase()}`;
  const cached = readCache<GithubEvent[]>(key);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  const response = await fetch(`${GITHUB_API_BASE}/users/${encodeURIComponent(handle)}/events/public?per_page=100`, { signal, headers });
  if (response.status === 304 && cached) { writeCache(key, { ...cached, at: Date.now() }); return cached.value; }
  if (!response.ok) {
    if (cached) return cached.value;
    throw new Error(`GitHub events unavailable (${response.status})`);
  }
  const body = await response.json();
  const events = (Array.isArray(body) ? body : []).map(mapEvent).filter((item): item is GithubEvent => item !== null)
    .map((item) => ({ ...item, handle: item.handle || handle }));
  writeCache(key, { at: Date.now(), etag: response.headers.get('ETag') ?? undefined, value: events });
  return events;
}

export function readGithubSyncPreference(): boolean {
  try { return window.localStorage.getItem(GITHUB_SYNC_PREFERENCE) !== 'off'; } catch { return true; }
}
export function writeGithubSyncPreference(enabled: boolean) {
  try { window.localStorage.setItem(GITHUB_SYNC_PREFERENCE, enabled ? 'on' : 'off'); } catch { /* Preference only. */ }
}
