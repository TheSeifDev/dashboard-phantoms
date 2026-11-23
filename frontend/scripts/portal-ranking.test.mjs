import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [router, groups, page, hook, css, routes, migration, db] = await Promise.all([
  read('src/router/index.tsx'),
  read('src/components/layout/workspace-groups.ts'),
  read('src/features/portal/MemberRankingPage.tsx'),
  read('src/features/portal/useMemberLeaderboard.ts'),
  read('src/features/portal/member-ranking.css'),
  read('public/manus-routes.json'),
  read('../backend/supabase/migrations/20261123223000_member_leaderboard.sql'),
  read('src/types/db.ts'),
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

test('the leaderboard RPC mirrors the admin bonus formula and ranking order behind a device guard', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /PERFORM public\.assert_member_device\(p_member_id, p_device_token\)/);
  assert.match(migration, /regexp_match\(n\.text, '\\\[B:\(\[\+-\]\?\[0-9\]\{1,9\}\)\\\]'\)/);
  assert.match(migration, /s\.bonus_infinite DESC,\s*s\.bonus DESC,\s*s\.completion_rank ASC NULLS LAST/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_member_leaderboard\(BIGINT, TEXT\) FROM PUBLIC, anon, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_member_leaderboard\(BIGINT, TEXT\) TO authenticated/);
  assert.match(migration, /tm\.status = 'active'/);
});

test('the portal ranking page animates with GSAP but respects reduced motion and flat tokens', () => {
  assert.match(page, /import gsap from 'gsap'/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /timeline\.kill\(\)/);
  assert.match(page, /data-mr-bar/);
  assert.match(page, /mr-you/);
  assert.match(page, /bonus_infinite \? '∞'/);
  assert.doesNotMatch(page, /linear-gradient|bg-\[#|text-\[#/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
