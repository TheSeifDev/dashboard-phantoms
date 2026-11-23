-- 37 — get_member_leaderboard(): ترتيب الفريق من منظور العضو.
-- يثبت: الدالة SECURITY DEFINER ومقفولة على anon، بترفض أي device token غير
-- صالح، بتحسب البونص بنفس صيغة [B:±n] المستخدمة في لوحة الإدارة، الأولوية
-- للبونص غير المحدود، وترتيب التعادل بالـ completion_rank، وبترجّع أسماء
-- التيمات النشطة للعضو من غير ما العضو يقرأ جدول members/notes مباشرة.
BEGIN;
\ir _helpers.psql
SELECT plan(16);

-- Fixtures -------------------------------------------------------------------
DO $$
DECLARE
  v_team_id UUID := extensions.gen_random_uuid();
BEGIN
  PERFORM phantoms_test.create_user('lb_viewer');
  PERFORM phantoms_test.create_member('lb_a', 'lb_a@phantoms-test.example', true);
  PERFORM phantoms_test.create_member('lb_b');
  PERFORM phantoms_test.create_member('lb_c');

  PERFORM phantoms_test.bind_device('lb_a');
  PERFORM phantoms_test.bind_device('lb_b');
  PERFORM phantoms_test.bind_device('lb_c');

  UPDATE public.members SET completion_rank = 90 WHERE id = phantoms_test.mid('lb_a');
  UPDATE public.members SET completion_rank = 40 WHERE id = phantoms_test.mid('lb_b');
  UPDATE public.members SET completion_rank = 10 WHERE id = phantoms_test.mid('lb_c');
  -- bonus_infinite is RPC-only; the fixture opts in through the same session flag the RPC uses.
  PERFORM set_config('phantoms.member_bonus_rpc', 'enabled', true);
  UPDATE public.members SET bonus_infinite = true WHERE id = phantoms_test.mid('lb_c');
  PERFORM set_config('phantoms.member_bonus_rpc', '', true);

  INSERT INTO public.notes (text, target_member_id, target_name)
  VALUES
    ('[B:+5] شغل ممتاز', phantoms_test.mid('lb_a'), 'lb_a'),
    ('[B:10] تسليم كبير', phantoms_test.mid('lb_a'), 'lb_a'),
    ('[B:-2] تأخير', phantoms_test.mid('lb_a'), 'lb_a'),
    ('ملاحظة بدون بونص — لازم تتجاهل', phantoms_test.mid('lb_a'), 'lb_a'),
    ('[B:+20] أفضل أداء', phantoms_test.mid('lb_b'), 'lb_b');

  INSERT INTO public.teams (id, slug, name, is_active)
  VALUES (v_team_id, 'lb-team', 'LB Team', true);

  INSERT INTO public.team_memberships (team_id, member_id, status)
  VALUES
    (v_team_id, phantoms_test.mid('lb_a'), 'active'),
    (v_team_id, phantoms_test.mid('lb_b'), 'removed');
END $$;

-- Function posture -----------------------------------------------------------
SELECT has_function('public', 'get_member_leaderboard', ARRAY['bigint', 'text']::name[],
  'get_member_leaderboard(bigint, text) exists');
SELECT is(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.get_member_leaderboard(bigint,text)'::regprocedure),
  true,
  'get_member_leaderboard runs as SECURITY DEFINER');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc
          WHERE oid = 'public.get_member_leaderboard(bigint,text)'::regprocedure
            AND proconfig::text LIKE '%search_path=%'),
  'get_member_leaderboard pins its own search_path');

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_member_leaderboard(bigint,text)', 'EXECUTE'),
  'anonymous role cannot execute get_member_leaderboard');
SELECT ok(
  has_function_privilege('authenticated', 'public.get_member_leaderboard(bigint,text)', 'EXECUTE'),
  'authenticated role can execute get_member_leaderboard');

-- A stale device token is rejected before any data is returned.
RESET ROLE;
SELECT phantoms_test.login_as('lb_a');
SELECT throws_ok(
  format($$ SELECT public.get_member_leaderboard(%s, 'not-a-real-device-token') $$, phantoms_test.mid('lb_a')),
  'P0001',
  'DEVICE_REQUIRED',
  'a stale device token is rejected');

-- Ranking payload ------------------------------------------------------------
SELECT is(
  (public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) ->> 'roster_size')::INT,
  3,
  'roster_size counts every active member');
SELECT is(
  jsonb_array_length(public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) -> 'rows'),
  3,
  'the payload lists one row per active member');
SELECT is(
  public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{rows,0,full_name}',
  'lb_c',
  'unlimited bonus always ranks first');
SELECT is(
  (public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{rows,0,bonus_infinite}')::BOOLEAN,
  true,
  'the first row exposes the unlimited bonus flag');
SELECT is(
  public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{rows,2,full_name}',
  'lb_a',
  'bonus then completion_rank decide the remaining order');
SELECT is(
  (public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{me,rank}')::INT,
  3,
  'me.rank points at the requesting member');
SELECT is(
  (public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{me,bonus}')::BIGINT,
  13::BIGINT,
  'bonus sums [B:±n] markers and ignores plain notes');
SELECT is(
  public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) -> 'me' -> 'teams',
  '["LB Team"]'::JSONB,
  'me.teams lists only active memberships');
SELECT is(
  (SELECT count(*) FROM jsonb_array_elements(
      public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) -> 'rows') AS elem
    WHERE (elem ->> 'is_me')::BOOLEAN),
  1::BIGINT,
  'exactly one row is flagged as the requesting member');
SELECT is(
  public.get_member_leaderboard(phantoms_test.mid('lb_a'), phantoms_test.tok('lb_a')) #>> '{rows,1,teams}',
  '[]',
  'a removed membership is not exposed');

SELECT * FROM finish();
ROLLBACK;
