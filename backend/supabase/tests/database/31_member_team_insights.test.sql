-- 31 — get_member_team_insights(): مساهمات الفريق للعضو المسجّل.
-- يثبت: الدالة SECURITY DEFINER ومقفولة على anon، بترفض أي مستخدم من غير
-- عضوية مربوطة، وبتسمح للعضو المسجّل بقراءة اعتمادات السنة (من غير ما يقرأ
-- الجدول نفسه)، وبتجمع عدد الناس في اليوم (crew) وبتستبعد أحداث الإلغاء.
BEGIN;
\ir _helpers.psql
SELECT plan(15);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user('member_user');
  PERFORM phantoms_test.create_user('outsider_user');
  PERFORM phantoms_test.create_member('member_a', 'member_user@phantoms-test.example');
  PERFORM phantoms_test.create_member('member_b');
  PERFORM phantoms_test.create_member('member_c');

  INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
  VALUES (phantoms_test.mid('member_a'), phantoms_test.uid('member_user'), 'member_user@phantoms-test.example', true);

  INSERT INTO public.task_contribution_events (task_id, member_id, event_type, occurred_at, actor_user_id, provenance)
  VALUES
    (990001, phantoms_test.mid('member_a'), 'approved', now() - interval '2 days', phantoms_test.uid('member_user'), 'live_transition'),
    (990002, phantoms_test.mid('member_b'), 'approved', now() - interval '2 days', phantoms_test.uid('member_user'), 'live_transition'),
    (990003, phantoms_test.mid('member_a'), 'approved', now() - interval '9 days', phantoms_test.uid('member_user'), 'live_transition'),
    (990004, phantoms_test.mid('member_c'), 'reversed', now() - interval '2 days', phantoms_test.uid('member_user'), 'live_transition');
END $$;

-- Function posture -----------------------------------------------------------
SELECT has_function('public', 'get_member_team_insights', ARRAY['integer']::name[],
  'get_member_team_insights(integer) exists');
SELECT is(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.get_member_team_insights(integer)'::regprocedure),
  true,
  'get_member_team_insights runs as SECURITY DEFINER (members cannot read the ledger directly)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc
          WHERE oid = 'public.get_member_team_insights(integer)'::regprocedure
            AND proconfig::text LIKE '%search_path=%'),
  'get_member_team_insights pins its own search_path');

-- Privileges: anon مقفول، authenticated مسموح (الحماية جوه الدالة).
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_member_team_insights(integer)', 'EXECUTE'),
  'anonymous role cannot execute get_member_team_insights');
SELECT ok(
  has_function_privilege('authenticated', 'public.get_member_team_insights(integer)', 'EXECUTE'),
  'authenticated role can execute get_member_team_insights');

-- A signed-in user without a member binding is rejected.
RESET ROLE;
SELECT phantoms_test.login_as('outsider_user');
SELECT throws_ok(
  $$ SELECT public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) $$,
  'P0001',
  'MEMBER_SCOPE_REQUIRED: ملخص مساهمات الفريق متاح لأعضاء الفريق المسجلين فقط.',
  'an authenticated user without an active member binding is rejected');

-- The bound member reads the team summary.
RESET ROLE;
SELECT phantoms_test.login_as('member_user');
SELECT is(
  public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) ->> 'timezone',
  'Africa/Cairo',
  'the summary reports the contract timezone');
SELECT is(
  (public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) ->> 'total_approvals')::BIGINT,
  3::BIGINT,
  'approvals are counted for the whole team and reversals are excluded');
SELECT is(
  jsonb_array_length(public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) -> 'days'),
  2,
  'only days with approvals are returned');
SELECT is(
  (SELECT (entry ->> 'crew')::BIGINT
     FROM jsonb_array_elements(public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) -> 'days') AS entry
    WHERE (entry ->> 'count')::BIGINT = 2
    LIMIT 1),
  2::BIGINT,
  'crew counts the distinct members active on the shared day');
SELECT is(
  jsonb_array_length(public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) -> 'members'),
  2,
  'members with approvals are ranked (a reversed-only member is excluded)');
SELECT is(
  (SELECT (entry ->> 'approved')::BIGINT
     FROM jsonb_array_elements(public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) -> 'members') AS entry
    WHERE (entry ->> 'member_id')::BIGINT = phantoms_test.mid('member_a')),
  2::BIGINT,
  'each member carries their own approval count');
SELECT ok(
  (SELECT (entry ->> 'full_name') <> ''
     FROM jsonb_array_elements(public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) -> 'members') AS entry
    WHERE (entry ->> 'member_id')::BIGINT = phantoms_test.mid('member_a')),
  'member names are resolved inside the definer function');
SELECT cmp_ok(
  (public.get_member_team_insights(EXTRACT(YEAR FROM (timezone('Africa/Cairo', now()))::date)::INTEGER) ->> 'roster_size')::INTEGER,
  '>=',
  3,
  'the roster size covers the active members');
SELECT throws_ok(
  'SELECT public.get_member_team_insights(1999)',
  'P0001',
  'INVALID_YEAR: السنة المطلوبة خارج النطاق المسموح.',
  'a year outside the allowed range is rejected');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;