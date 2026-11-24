import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const read = (relative) => readFileSync(resolve(repoRoot, relative), 'utf8');

const hub = read('frontend/src/features/icpc/IcpcHub.tsx');
const api = read('frontend/src/features/icpc/api.ts');
const types = read('frontend/src/features/icpc/types.ts');
const overview = read('frontend/src/features/icpc/pages/OverviewPage.tsx');
const problems = read('frontend/src/features/icpc/pages/ProblemsPage.tsx');
const contests = read('frontend/src/features/icpc/pages/ContestsPage.tsx');
const training = read('frontend/src/features/icpc/pages/TrainingPage.tsx');
const calendar = read('frontend/src/features/icpc/pages/CalendarPage.tsx');
const knowledge = read('frontend/src/features/icpc/pages/KnowledgePage.tsx');
const heatmap = read('frontend/src/features/icpc/components/ActivityHeatmap.tsx');
const css = read('frontend/src/features/icpc/icpc.css');
const router = read('frontend/src/router/index.tsx');
const sidebar = read('frontend/src/components/layout/AppSidebar.tsx');
const memberGroups = read('frontend/src/components/layout/workspace-groups.ts');
const schema = read('backend/supabase/migrations/20261124150000_icpc_hub_schema.sql');
const rpc = read('backend/supabase/migrations/20261124150100_icpc_hub_api.sql');

test('ICPC Hub is a native module with eight nested routes', () => {
  for (const tab of ['training', 'problems', 'contests', 'team', 'calendar', 'knowledge', 'analytics']) {
    assert.ok(hub.includes(`case '${tab}'`), `missing hub tab ${tab}`);
    assert.ok(hub.includes(`'${tab}',`), `missing tab metadata for ${tab}`);
  }
  assert.match(router, /path: 'icpc\/\*'[\s\S]*?AdminSection permission="dashboard"/);
  assert.match(router, /path: 'icpc\/\*'[\s\S]*?MemberIcpc/);
  assert.match(sidebar, /to: '\/admin\/icpc'/);
  assert.match(memberGroups, /to: '\/portal\/icpc'/);
});

test('every read and write goes through a security definer RPC', () => {
  for (const fn of [
    'icpc_context', 'icpc_overview', 'icpc_training', 'icpc_set_topic', 'icpc_problems',
    'icpc_save_problem', 'icpc_delete_problem', 'icpc_assign_problem', 'icpc_set_progress',
    'icpc_contests', 'icpc_save_contest', 'icpc_contest_detail', 'icpc_contest_join',
    'icpc_contest_record', 'icpc_team', 'icpc_calendar', 'icpc_save_session', 'icpc_delete_session',
    'icpc_notes', 'icpc_save_note', 'icpc_delete_note', 'icpc_link_platform', 'icpc_add_rating',
    'icpc_analytics',
  ]) {
    assert.ok(api.includes(`'${fn}'`), `api.ts never calls ${fn}`);
    assert.ok(rpc.includes(`FUNCTION public.${fn}(`), `${fn} is not defined in the migration`);
  }
  assert.doesNotMatch(api, /from\('icpc_/);
});

test('the schema keeps the tables locked and the roadmap seeded', () => {
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /REVOKE ALL ON public\.%I FROM anon, authenticated/);
  assert.match(rpc, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/);
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION %s TO authenticated/);
  assert.match(rpc, /RAISE EXCEPTION 'ICPC_FORBIDDEN/);
  for (const stage of [1, 2, 3, 4, 5, 6, 7]) {
    assert.ok(new RegExp(`\\(.*?, ${stage}, '(easy|medium|hard)'`).test(schema), `stage ${stage} has no seed rows`);
  }
});

test('the overview mirrors the analytical reference', () => {
  for (const marker of ['kpis', 'heatmap', 'rating', 'recent_contests', 'recent_ac', 'mastery', 'topics_top', 'workout']) {
    assert.ok(overview.includes(marker), `overview misses ${marker}`);
    assert.ok(rpc.includes(`'${marker}'`), `payload misses ${marker}`);
  }
  assert.match(heatmap, /data-level=\{level\}/);
  assert.match(heatmap, /icpc-hex/);
  assert.match(css, /clip-path: polygon\(50% 0%/);
});

test('problems support the full lifecycle', () => {
  for (const status of ['todo', 'solving', 'solved', 'upsolving', 'revisit']) {
    assert.ok(types.includes(`'${status}'`), `missing status ${status}`);
    assert.ok(schema.includes(`'${status}'`), `db rejects status ${status}`);
  }
  for (const marker of ['useSaveProblem', 'useAssignProblem', 'useSetProgress', 'useDeleteProblem']) {
    assert.ok(problems.includes(marker), `problems page never calls ${marker}`);
  }
  for (const rpcName of ['icpc_save_problem', 'icpc_assign_problem', 'icpc_set_progress', 'icpc_delete_problem']) {
    assert.ok(api.includes(rpcName), `api.ts never exposes ${rpcName}`);
  }
  assert.match(problems, /directory/);
});

test('contests are configurable and scoreboard driven', () => {
  assert.match(contests, /points_per_problem/);
  assert.match(contests, /penalty_minutes/);
  assert.match(contests, /useJoinContest/);
  assert.match(contests, /useRecordContest/);
  assert.match(api, /icpc_contest_join/);
  assert.match(api, /icpc_contest_record/);
  assert.match(rpc, /v_points := v_solved \* COALESCE/);
});

test('training, calendar and knowledge pages are wired to real data', () => {
  assert.match(training, /useSetTopicStatus/);
  assert.match(training, /STAGE_TITLES/);
  assert.match(calendar, /useSaveSession/);
  assert.match(calendar, /useDeleteSession/);
  assert.match(knowledge, /useSaveNote/);
  assert.match(knowledge, /NOTE_CATEGORIES/);
  assert.match(rpc, /CASE WHEN v_role IN \('admin', 'coach', 'captain'\) THEN 'published' ELSE 'pending' END/);
});

test('the design system is respected — tokens only, no hardcoded palette', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /\b(gray|blue|green|red|slate|zinc)-[0-9]{2,3}\b/);
  assert.doesNotMatch(css, /min-w-\[/);
  assert.match(css, /var\(--primary\)/);
  assert.match(css, /var\(--surface\)/);
  assert.doesNotMatch(overview + problems + contests + knowledge, /window\.(alert|confirm)/);
});
