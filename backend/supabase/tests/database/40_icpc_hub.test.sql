-- 40 — ICPC Hub: schema lockdown, role resolution, problem bank, contests,
-- training roadmap and the manager-only guards.
BEGIN;
\ir _helpers.psql
SELECT plan(42);
-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['icpc_owner', 'icpc_admin', 'icpc_member', 'icpc_other']) AS n;
  PERFORM phantoms_test.grant_admin('icpc_owner', 'owner');
  PERFORM phantoms_test.grant_admin('icpc_admin', 'admin');
END $$;
INSERT INTO public.members (email, full_name, academic_number)
VALUES ('icpc-member@phantoms-test.example', 'ICPC Member', 'ICPC-001'),
       ('icpc-coach@phantoms-test.example', 'ICPC Coach', 'ICPC-002')
ON CONFLICT (email) DO NOTHING;
INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id, phantoms_test.uid('icpc_member'), m.email, true
FROM public.members AS m WHERE m.email = 'icpc-member@phantoms-test.example'
ON CONFLICT DO NOTHING;
-- 1) الجداول مقفولة ----------------------------------------------------------
SELECT has_table('public', 'icpc_topics', 'icpc_topics exists');
SELECT has_table('public', 'icpc_problems', 'icpc_problems exists');
SELECT has_table('public', 'icpc_assignments', 'icpc_assignments exists');
SELECT has_table('public', 'icpc_contests', 'icpc_contests exists');
SELECT has_table('public', 'icpc_contest_participants', 'icpc_contest_participants exists');
SELECT has_table('public', 'icpc_notes', 'icpc_notes exists');
SELECT is((SELECT count(*)::int FROM public.icpc_topics), 37, 'the roadmap seeds all 37 topics');
SELECT is((SELECT count(DISTINCT stage)::int FROM public.icpc_topics), 7, 'topics span the seven stages');
SELECT phantoms_test.login_as('icpc_member');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_problems$$, '42501', NULL,
  'authenticated cannot read icpc_problems directly');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_assignments$$, '42501', NULL,
  'authenticated cannot read icpc_assignments directly');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_notes$$, '42501', NULL,
  'authenticated cannot read icpc_notes directly');
-- 2) الأدوار ----------------------------------------------------------------
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_owner')), 'admin', 'the owner resolves to admin');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_admin')), 'admin', 'an admin account resolves to admin');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_member')), 'member', 'a bound member resolves to member');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_other')), 'guest', 'an unbound account is a guest');
SELECT ok(public.icpc_can_manage(phantoms_test.uid('icpc_admin')), 'admins can manage the hub');
SELECT ok(NOT public.icpc_can_manage(phantoms_test.uid('icpc_member')), 'members cannot manage the hub');
-- 3) خريطة التدريب -----------------------------------------------------------
SELECT is(jsonb_array_length(public.icpc_training() -> 'stages'), 7, 'training returns seven stages');
SELECT is(jsonb_array_length(public.icpc_training() -> 'stages' -> 0 -> 'topics'), 5, 'stage one has five topics');
SELECT is((public.icpc_set_topic((SELECT id FROM public.icpc_topics WHERE slug = 'stl'), 'done') ->> 'status'), 'done',
  'a member can mark a topic done');
SELECT is((SELECT count(*)::int FROM public.icpc_topic_progress
           WHERE user_id = phantoms_test.uid('icpc_member')), 1, 'progress is stored per user');
-- 4) بنك المسائل -------------------------------------------------------------
SELECT phantoms_test.login_as('icpc_admin');
SELECT is((public.icpc_save_problem(jsonb_build_object(
    'title', 'ICPC Test Problem', 'url', 'https://codeforces.com/problemset/problem/1/A',
    'platform', 'codeforces', 'difficulty', 'medium',
    'topics', jsonb_build_array('dp', 'greedy'))) ->> 'id')::bigint > 0, true,
  'a manager can create a problem');
SELECT is((SELECT count(*)::int FROM public.icpc_problems WHERE title = 'ICPC Test Problem'), 1, 'the problem is stored once');
SELECT is((public.icpc_assign_problem(
    (SELECT id FROM public.icpc_problems WHERE title = 'ICPC Test Problem'),
    ARRAY[phantoms_test.uid('icpc_member')], CURRENT_DATE) ->> 'assigned')::int, 1,
  'assigning reaches one member');
SELECT phantoms_test.login_as('icpc_member');
SELECT throws_ok($$SELECT public.icpc_save_problem('{"title":"nope"}'::jsonb)$$, 'P0001', NULL,
  'members cannot create problems');
SELECT is((public.icpc_set_progress(
    (SELECT a.id FROM public.icpc_assignments AS a WHERE a.user_id = phantoms_test.uid('icpc_member')), 'solved') ->> 'status'),
  'solved', 'a member can mark their own assignment solved');
SELECT ok((SELECT a.solved_at IS NOT NULL FROM public.icpc_assignments AS a
           WHERE a.user_id = phantoms_test.uid('icpc_member')), 'solving stamps solved_at');
SELECT is((public.icpc_overview(180, NULL) -> 'kpis' ->> 'problems_solved')::int, 1, 'overview counts the solved problem');
SELECT is(jsonb_array_length(public.icpc_problems('{}'::jsonb) -> 'problems'), 1, 'the member sees the bank');
SELECT is(jsonb_array_length(public.icpc_problems('{}'::jsonb) -> 'problems' -> 0 -> 'assignments'), 1,
  'the member only sees their own assignment');
-- 5) المسابقات --------------------------------------------------------------
SELECT throws_ok($$SELECT public.icpc_save_contest('{"name":"nope"}'::jsonb)$$, 'P0001', NULL,
  'members cannot create contests');
SELECT phantoms_test.login_as('icpc_admin');
SELECT is((public.icpc_save_contest(jsonb_build_object(
    'name', 'ICPC Internal Round', 'kind', 'internal', 'platform', 'internal',
    'starts_at', (now() + interval '1 day'), 'duration_minutes', 300,
    'scoring', jsonb_build_object('penalty_minutes', 20, 'points_per_problem', 1))) ->> 'id')::bigint > 0,
  true, 'a manager can create a contest');
SELECT phantoms_test.login_as('icpc_member');
SELECT is((public.icpc_contest_join((SELECT id FROM public.icpc_contests WHERE name = 'ICPC Internal Round')) ->> 'ok'), 'true',
  'a member can join a contest');
SELECT is(round((public.icpc_contest_record(jsonb_build_object(
    'contest_id', (SELECT id FROM public.icpc_contests WHERE name = 'ICPC Internal Round'),
    'solved', 3, 'penalty', 120)) ->> 'score')::numeric)::int, 1,
  'the configurable scoring formula yields 3 - 2 = 1');
SELECT is(jsonb_array_length(public.icpc_contest_detail(
    (SELECT id FROM public.icpc_contests WHERE name = 'ICPC Internal Round')) -> 'scoreboard'), 1,
  'the scoreboard shows the recorded participant');
-- 6) الجلسات والمعرفة -------------------------------------------------------
SELECT phantoms_test.login_as('icpc_admin');
SELECT is((public.icpc_save_session(jsonb_build_object(
    'title', 'ICPC Mock Session', 'kind', 'mock',
    'starts_at', now() + interval '2 days', 'duration_minutes', 300)) ->> 'id')::bigint > 0,
  true, 'a manager can schedule a session');
SELECT is(jsonb_array_length(public.icpc_calendar(CURRENT_DATE, CURRENT_DATE + 7) -> 'sessions'), 1,
  'the calendar lists the session');
SELECT phantoms_test.login_as('icpc_member');
SELECT is((public.icpc_save_note(jsonb_build_object('title', 'Member Note', 'content_md', 'hello')) ->> 'id')::bigint > 0,
  true, 'a member can contribute a note');
SELECT is((SELECT status FROM public.icpc_notes WHERE title = 'Member Note'), 'pending',
  'member notes wait for review');
SELECT phantoms_test.login_as('icpc_admin');
SELECT is((SELECT status FROM public.icpc_notes WHERE title = 'Member Note'), 'pending',
  'notes are not auto-published');
SELECT is(jsonb_array_length(public.icpc_team(90) -> 'members') >= 1, true, 'team analytics lists members');
SELECT ok(public.icpc_analytics(90) ? 'by_platform', 'analytics exposes the platform breakdown');
SELECT * FROM finish();
ROLLBACK;
