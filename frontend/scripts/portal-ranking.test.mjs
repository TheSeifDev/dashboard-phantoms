import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [router, groups, page, hook, css, tokens, routes, migration, db, metrics, noteBonus, rankingCss] = await Promise.all([
  read('src/router/index.tsx'),
  read('src/components/layout/workspace-groups.ts'),
  read('src/features/portal/MemberRankingPage.tsx'),
  read('src/features/portal/useMemberLeaderboard.ts'),
  read('src/features/portal/member-ranking.css'),
  read('src/styles/tokens.css'),
  read('public/manus-routes.json'),
  read('../backend/supabase/migrations/20261124020000_member_leaderboard_parity.sql'),
  read('src/types/db.ts'),
  read('src/features/dashboard/metrics.ts'),
  read('src/features/notes/noteBonus.ts'),
  read('src/features/ranking/ranking.css'),
]);

test('the member portal exposes a ranking route next to the other member pages', () => {
  assert.match(router, /const MemberRankingPage = lazy\(\(\) => import\('\.\.\/features\/portal\/MemberRankingPage'\)\)/);
  assert.match(router, /path: 'ranking', element: <Page><MemberRankingPage \/><\/Page>/);
  assert.ok(JSON.parse(routes).routes.some((route) => route.path === '/portal/ranking'));
  assert.match(groups, /\{ to: '\/portal\/ranking', label: 'ترتيب الفريق', icon: Trophy \}/);
  assert.match(groups, /Trophy/);
});

test('the portal leaderboard reads one member-scoped RPC with the device token, never the admin tables', () => {
  assert.match(hook, /memberSupabase\.rpc\('get_member_leaderboard', \{/);
  assert.match(hook, /getDeviceToken\(\)/);
  assert.match(hook, /p_member_id: memberId as number,\s*p_device_token: deviceToken/);
  assert.doesNotMatch(hook, /from\('members'\)|from\('notes'\)/);
  assert.match(db, /get_member_leaderboard: \{ Args: \{ p_member_id: number; p_device_token: string \}; Returns: unknown \}/);
});

test('a device-session failure is surfaced as a re-login state instead of a retry loop', () => {
  assert.match(hook, /export class MemberSessionError extends Error/);
  assert.match(hook, /export function isSessionIssue\(error: unknown\): boolean/);
  assert.match(hook, /DEVICE_REQUIRED\|MEMBER_SESSION_REQUIRED\|MEMBER_DISABLED\|MEMBER_PASSWORD_REQUIRED\|\\b42501\\b/);
  assert.match(hook, /retry: \(failureCount, error\) => !isSessionIssue\(error\) && failureCount < 1/);
  assert.match(page, /isSessionIssue\(leaderboard\.error\)/);
  assert.match(page, /mr-session/);
});

// comments between ORDER BY keys would break the literal match below
const migrationSql = migration.replace(/--[^\n]*/g, '');
// the leaderboard function only — assert_member_device legitimately reads work_status
const leaderboardSql = migrationSql.split('CREATE OR REPLACE FUNCTION public.assert_member_device')[0];

test('the leaderboard RPC mirrors the admin ranking order behind the device guard', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /PERFORM public\.assert_member_device\(p_member_id, p_device_token\)/);
  // same marker as calculateBonus(): up to 18 digits, optional sign
  assert.match(migration, /regexp_match\(n\.text, '\\\[B:\(\[\+-\]\?\[0-9\]\{1,18\}\)\\\]'\)/);
  // same branch order as compareMemberBonusRank(): infinite, bonus, unranked 0/NULL, rank, created_at DESC
  assert.match(
    migrationSql,
    /s\.bonus_infinite DESC,\s*\(CASE WHEN s\.bonus_infinite THEN NULL ELSE s\.bonus END\) DESC NULLS LAST,\s*\(COALESCE\(s\.completion_rank, 0\) = 0\) ASC,\s*s\.completion_rank ASC,\s*s\.created_at DESC,\s*s\.member_id ASC/,
  );
  // the admin board ranks every member, so the portal must not filter the roster
  assert.doesNotMatch(leaderboardSql, /work_status/);
  assert.match(leaderboardSql, /FROM public\.members m/);
  // bounded payload, real roster size
  assert.match(migration, /ORDER BY rank LIMIT 500/);
  assert.match(migration, /COALESCE\(\(SELECT MAX\(rank\) FROM ranked\), 0\)/);
  // device sessions are touched at most once every five minutes
  assert.match(migration, /s\.last_seen_at < pg_catalog\.now\(\) - INTERVAL '5 minutes'/);
  // grants: anon/authenticated only, service_role revoked on purpose
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_member_leaderboard\(BIGINT, TEXT\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_member_leaderboard\(BIGINT, TEXT\) TO anon, authenticated/);
});

test('the SQL ranking order and compareMemberBonusRank() produce the same ranking', () => {
  const url = pathToFileURL(resolve(root, 'src/features/ranking/rankingUtils.ts')).href;
  const script = `import { compareMemberBonusRank } from ${JSON.stringify(url)};
const rows = [
  { name: 'lb_a', bonus_infinite: false, completion_rank: 90, created_at: '2026-01-01T00:00:00Z', totalBonus: 13 },
  { name: 'lb_b', bonus_infinite: false, completion_rank: 40, created_at: '2026-01-02T00:00:00Z', totalBonus: 20 },
  { name: 'lb_c', bonus_infinite: true, completion_rank: 10, created_at: '2026-01-03T00:00:00Z', totalBonus: 0 },
  { name: 'lb_d', bonus_infinite: false, completion_rank: 0, created_at: '2026-01-04T00:00:00Z', totalBonus: 20 },
  { name: 'lb_e', bonus_infinite: false, completion_rank: 0, created_at: '2026-01-05T00:00:00Z', totalBonus: 0 },
  { name: 'lb_f', bonus_infinite: false, completion_rank: 0, created_at: '2026-01-06T00:00:00Z', totalBonus: 0 }
];
rows.sort(compareMemberBonusRank);
console.log(JSON.stringify(rows.map((row) => row.name)));`;
  const out = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  // نفس الترتيب اللي بيتأكد منه 37_member_leaderboard.test.sql على مستوى الـ SQL
  assert.deepEqual(JSON.parse(out.trim()), ['lb_c', 'lb_b', 'lb_d', 'lb_a', 'lb_f', 'lb_e']);
});

test('the bonus formula is shared: one marker regex, one reader, one implementation', () => {
  assert.match(noteBonus, /export const BONUS_MARKER = \/\\\[B:\(\[\+-\]\?\\d\{1,18\}\)\\\]\//);
  assert.match(noteBonus, /export function readBonusPoints/);
  assert.match(metrics, /import \{ readBonusPoints \} from '\.\.\/notes\/noteBonus'/);
  assert.match(metrics, /readBonusPoints\(note\.text\) \?\? 0/);
  assert.doesNotMatch(metrics, /parseInt\(match\[1\]/);
});

test('the portal ranking page animates once, marks the caller row and keeps a readable podium order', () => {
  assert.match(page, /import gsap from 'gsap'/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /timeline\.kill\(\)/);
  assert.match(page, /data-mr-bar/);
  assert.match(page, /mr-you/);
  assert.match(page, /bonus_infinite \? '∞'/);
  // F6 — the timeline runs once per mount, not on every refetch
  assert.match(page, /const animatedRef = useRef\(false\)/);
  assert.match(page, /if \(!root \|\| animatedRef\.current \|\| !motionAllowed\(\) \|\| rows\.length === 0\) return;/);
  assert.doesNotMatch(page, /generated_at\]/);
  // F13 — DOM order 1·2·3, visual order from CSS
  assert.match(page, /\{\[0, 1, 2\]\.map\(\(index\) => \{/);
  assert.match(css, /\.mr-step--2 \{ order: 1; \}/);
  assert.match(css, /\.mr-step--1 \{ order: 2; \}/);
  assert.match(css, /\.mr-step--3 \{ order: 3; \}/);
  // F14 — the caller row is announced as the current item
  assert.match(page, /aria-current=\{row\.is_me \? 'true' : undefined\}/);
  // F7 — a member missing from the ranking gets an explanation, not an empty card
  assert.match(page, /\{me === null && \(/);
  assert.doesNotMatch(page, /linear-gradient|bg-\[#|text-\[#/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});

test('medal colours live in tokens.css so both leaderboards share one palette', () => {
  assert.match(tokens, /--medal-gold: #E0A426/);
  assert.match(tokens, /--medal-silver: #A7B0C0/);
  assert.match(tokens, /--medal-bronze: #C2703A/);
  assert.match(tokens, /--medal-gold: #F2BC48/);
  assert.match(css, /--mr-gold: var\(--medal-gold\)/);
  assert.match(rankingCss, /--rank-gold: var\(--medal-gold\)/);
  // no component-local palette hexes left behind
  assert.doesNotMatch(css, /#[0-9A-Fa-f]{6}/);
  assert.doesNotMatch(rankingCss, /#[0-9A-Fa-f]{6}/);
});
