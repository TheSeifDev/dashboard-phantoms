-- 40 — ICPC Hub: schema lockdown, role resolution, problem bank, contests,
-- training roadmap and the manager-only guards.
--
-- كل قراءة بعد تبديل الهوية بتمر عبر RPC، لأن الجداول مقفولة تمامًا على
-- anon/authenticated — وده بالظبط اللي بنختبره.
BEGIN;
\ir _helpers.psql
SELECT plan(43);
-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['icpc_owner', 'icpc_admin', 'icpc_member', 'icpc_other']) AS n;
  PERFORM phantoms_test.grant_admin('icpc_owner', 'owner');
  PERFORM phantoms_test.grant_admin('icpc_admin', 'admin');
END $$;
INSERT INTO public.members (email, full_name, academic_number)
VALUES ('icpc-member@phantoms-test.example', 'ICPC Member', 'ICPC-001')
ON CONFLICT (email) DO NOTHING;
INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id, phantoms_test.uid('icpc_member'), m.email, true
FROM public.members AS m WHERE m.email = 'icpc-member@phantoms-test.example'
ON CONFLICT DO NOTHING;
-- نلتقط معرّف موضوع قبل تبديل الهوية.
SELECT id AS stl_topic FROM public.icpc_topics WHERE slug = 'stl' \gset
-- 1) الجداول مقفولة ----------------------------------------------------------
SELECT has_table('public', 'icpc_topics', 'icpc_topics exists');
SELECT has_table('public', 'icpc_problems', 'icpc_problems exists');
SELECT has_table('public', 'icpc_assignments', 'icpc_assignments exists');
SELECT has_table('public', 'icpc_contests', 'icpc_contests exists');
SELECT has_table('public', 'icpc_contest_participants', 'icpc_contest_participants exists');
SELECT has_table('public', 'icpc_notes', 'icpc_notes exists');
SELECT is((SELECT count(*)::int FROM public.icpc_topics), 36, 'the roadmap seeds all 36 topics');
SELECT is((SELECT count(DISTINCT stage)::int FROM public.icpc_topics), 7, 'topics span the seven stages');
-- 2) الأدوار والحماية -------------------------------------------------------
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_owner')), 'admin', 'the owner resolves to admin');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_admin')), 'admin', 'an admin account resolves to admin');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_member')), 'member', 'a bound member resolves to member');
SELECT is(public.icpc_role_of(phantoms_test.uid('icpc_other')), 'guest', 'an unbound account is a guest');
SELECT ok(public.icpc_can_manage(phantoms_test.uid('icpc_admin')), 'admins can manage the hub');
SELECT ok(NOT public.icpc_can_manage(phantoms_test.uid('icpc_member')), 'members cannot manage the hub');
SELECT phantoms_test.login_as('icpc_member');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_problems$$, '42501', NULL,
  'authenticated cannot read icpc_problems directly');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_assignments$$, '42501', NULL,
  'authenticated cannot read icpc_assignments directly');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_notes$$, '42501', NULL,
  'authenticated cannot read icpc_notes directly');
SELECT throws_ok($$SELECT count(*) FROM public.icpc_topics$$, '42501', NULL,
  'authenticated cannot read icpc_topics directly');
-- 3) خريطة التدريب -----------------------------------------------------------
SELECT is(jsonb_array_length(public.icpc_training() -> 'stages'), 7, 'training returns seven stages');
SELECT is(jsonb_array_length(public.icpc_training() -> 'stages' -> 0 -> 'topics'), 5, 'stage one has five topics');
SELECT is((public.icpc_set_topic(:stl_topic, 'done') ->> 'status'), 'done', 'a member can mark a topic done');
SELECT is(public.icpc_training() -> 'stages' -> 0 -> 'topics' -> 1 ->> 'status', 'done',
  'topic progress is stored per member');
-- 4) بنك المسائل -------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.login_as('icpc_admin');
SELECT (public.icpc_save_problem(jsonb_build_object(
    'title', 'ICPC Test Problem', 'url', 'https://codeforces.com/problemset/problem/1/A',
    'platform', 'codeforces', 'difficulty', 'medium',
    'topics', jsonb_build_array('dp', 'greedy'))) ->> 'id')::bigint AS problem_id \gset
SELECT ok(:problem_id > 0, 'a manager can create a problem');
SELECT is(jsonb_array_length(public.icpc_problems('{}'::jsonb) -> 'problems'), 1, 'the bank holds the new problem');
SELECT (public.icpc_assign_problem(:problem_id, ARRAY[phantoms_test.uid('icpc_member')], CURRENT_DATE) ->> 'assigned')::int AS assigned \gset
SELECT is(:assigned, 1, 'assigning reaches one member');
RESET ROLE;
SELECT phantoms_test.login_as('icpc_member');
SELECT throws_ok($$SELECT public.icpc_save_problem('{"title":"nope"}'::jsonb)$$, 'P0001', NULL,
  'members cannot create problems');
SELECT (public.icpc_problems('{}'::jsonb) -> 'problems' -> 0 -> 'assignments' -> 0 ->> 'id')::bigint AS assignment_id \gset
SELECT is((public.icpc_set_progress(:assignment_id, 'solved') ->> 'status'), 'solved',
  'a member can mark their own assignment solved');
SELECT ok((public.icpc_problems('{}'::jsonb) -> 'problems' -> 0 -> 'assignments' -> 0 ->> 'solved_at') IS NOT NULL,
  'solving stamps solved_at');
SELECT is((public.icpc_overview(180, NULL) -> 'kpis' ->> 'problems_solved')::int, 1, 'overview counts the solved problem');
SELECT is(jsonb_array_length(public.icpc_problems('{}'::jsonb) -> 'problems' -> 0 -> 'assignments'), 1,
  'the member only sees their own assignment');
-- 5) المسابقات --------------------------------------------------------------
SELECT throws_ok($$SELECT public.icpc_save_contest('{"name":"nope"}'::jsonb)$$, 'P0001', NULL,
  'members cannot create contests');
RESET ROLE;
SELECT phantoms_test.login_as('icpc_admin');
SELECT (public.icpc_save_contest(jsonb_build_object(
    'name', 'ICPC Internal Round', 'kind', 'internal', 'platform', 'internal',
    'starts_at', (now() + interval '1 day'), 'duration_minutes', 300,
    'scoring', jsonb_build_object('penalty_minutes', 20, 'points_per_problem', 1))) ->> 'id')::bigint AS contest_id \gset
SELECT ok(:contest_id > 0, 'a manager can create a contest');
RESET ROLE;
SELECT phantoms_test.login_as('icpc_member');
SELECT is((public.icpc_contest_join(:contest_id) ->> 'ok'), 'true', 'a member can join a contest');
SELECT round((public.icpc_contest_record(jsonb_build_object(
    'contest_id', :contest_id, 'solved', 3, 'penalty', 120)) ->> 'score')::numeric)::int AS score \gset
SELECT is(:score, 1, 'the configurable scoring formula yields 3 - 2 = 1');
SELECT is(jsonb_array_length(public.icpc_contest_detail(:contest_id) -> 'scoreboard'), 1,
  'the scoreboard shows the recorded participant');
-- 6) الجلسات والمعرفة -------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.login_as('icpc_admin');
SELECT (public.icpc_save_session(jsonb_build_object(
    'title', 'ICPC Mock Session', 'kind', 'mock',
    'starts_at', now() + interval '2 days', 'duration_minutes', 300)) ->> 'id')::bigint AS session_id \gset
SELECT ok(:session_id > 0, 'a manager can schedule a session');
SELECT is(jsonb_array_length(public.icpc_calendar(CURRENT_DATE, CURRENT_DATE + 7) -> 'sessions'), 1,
  'the calendar lists the session');
RESET ROLE;
SELECT phantoms_test.login_as('icpc_member');
SELECT (public.icpc_save_note(jsonb_build_object('title', 'Member Note', 'content_md', 'hello')) ->> 'id')::bigint AS note_id \gset
SELECT ok(:note_id > 0, 'a member can contribute a note');
SELECT is(public.icpc_notes(NULL) -> 'notes' -> 0 ->> 'status', 'pending', 'member notes wait for review');
RESET ROLE;
SELECT phantoms_test.login_as('icpc_admin');
SELECT is(public.icpc_notes(NULL) -> 'notes' -> 0 ->> 'status', 'pending', 'notes are not auto-published');
SELECT ok(jsonb_array_length(public.icpc_team(90) -> 'members') >= 1, 'team analytics lists members');
SELECT ok(public.icpc_analytics(90) ? 'by_platform', 'analytics exposes the platform breakdown');
SELECT is((public.icpc_context() ->> 'role'), 'admin', 'context reports the resolved role');
SELECT * FROM finish();
ROLLBACK;
