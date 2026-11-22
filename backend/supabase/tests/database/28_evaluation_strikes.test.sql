-- 28 — Evaluation kinds, member strikes (3 per member) and owner-only expulsion.
-- Proves: the strike limit is enforced atomically, strikes never carry stars,
-- members can only read their own warnings, and expulsion revokes access.
BEGIN;
\ir _helpers.psql
SELECT plan(32);
-- Disposable fixtures -------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner', 'ranking_admin', 'noperm_admin']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('ranking_admin', 'admin', phantoms_test.perms('ranking'));
  PERFORM phantoms_test.grant_admin('noperm_admin', 'admin', phantoms_test.perms());
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  PERFORM phantoms_test.create_member('carol', NULL, true);
  PERFORM phantoms_test.create_member('self', 'owner@phantoms-test.example');
  UPDATE public.members
  SET work_status = 'active'
  WHERE email IN ('alice@phantoms-test.example', 'carol@phantoms-test.example');
  UPDATE public.members
  SET work_status = 'inactive'
  WHERE email = 'bob@phantoms-test.example';
  PERFORM phantoms_test.bind_device('carol');
  INSERT INTO public.team_memberships (team_id, member_id, status)
  SELECT t.id, phantoms_test.mid('carol'), 'active'
  FROM public.teams AS t WHERE t.slug = 'software';
END $$;
-- Schema posture ------------------------------------------------------------
SELECT has_column('public', 'member_evaluations', 'kind',
  'member_evaluations carries an evaluation kind column');
SELECT is(
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'member_evaluations' AND column_name = 'kind'),
  '''stars''::text',
  'evaluation kind defaults to stars');
SELECT has_table('public', 'member_strikes', 'member_strikes table exists');
SELECT is(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.member_strikes'::regclass),
  true,
  'member_strikes has RLS enabled');
SELECT is(
  (SELECT array_agg(polname::text ORDER BY polname) FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.member_strikes'::regclass),
  ARRAY['member_strikes_admin_read'],
  'member_strikes exposes a single admin read policy');
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type)
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'member_strikes' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'authenticated may only select from member_strikes');
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'member_strikes' AND grantee = 'anon'),
  0,
  'anon has no member_strikes privileges');
SELECT is(public.member_strike_limit(), 3, 'the strike limit is 3');
-- Limit enforcement (owner) -------------------------------------------------
SELECT phantoms_test.login_as('owner');
SELECT is(
  (public.admin_issue_strike(phantoms_test.mid('alice'), 'تحذير أول', 'تأخر متكرر', 'Owner') ->> 'strikes')::int,
  1,
  'the first strike records strike number 1');
SELECT is(
  (public.admin_issue_strike(phantoms_test.mid('alice'), 'تحذير تاني', 'غياب بدون إذن', 'Owner') ->> 'strikes')::int,
  2,
  'the second strike records strike number 2');
SELECT is(
  (public.admin_issue_strike(phantoms_test.mid('alice'), 'تحذير تالت', 'إهمال مهام', 'Owner') ->> 'expulsion_required'),
  'true',
  'the third strike requires expulsion');
SELECT throws_ok(
  $$ SELECT public.admin_issue_strike(phantoms_test.mid('alice'), 'تحذير رابع', 'مرفوض', 'Owner') $$,
  'P0001', 'STRIKE_LIMIT_REACHED',
  'a fourth strike is rejected by the limit');
SELECT throws_ok(
  $$ SELECT public.admin_issue_strike(phantoms_test.mid('bob'), 'تحذير', 'عضو غير نشط', 'Owner') $$,
  'P0001', 'MEMBER_NOT_ACTIVE',
  'inactive members cannot be warned');
-- Permission split ----------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.login_as('noperm_admin');
SELECT throws_ok(
  $$ SELECT public.admin_issue_strike(phantoms_test.mid('alice'), 'تحذير', 'بدون صلاحية', 'Admin') $$,
  'P0001', 'UNAUTHORIZED',
  'admins without the ranking permission cannot issue strikes');
SELECT throws_ok(
  $$ SELECT public.owner_expel_member(phantoms_test.mid('alice'), 'بدون صلاحية') $$,
  'P0001', 'OWNER_ONLY',
  'admins cannot expel members');
RESET ROLE;
SELECT phantoms_test.login_as('ranking_admin');
SELECT is(
  (public.admin_issue_strike(phantoms_test.mid('carol'), 'تحذير كارول', 'تسليم متأخر', 'Ranking admin') ->> 'strikes')::int,
  1,
  'the ranking permission is enough to issue a strike');
RESET ROLE;
-- Stored rows ---------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.member_strikes WHERE member_id = phantoms_test.mid('alice')),
  3,
  'all three strikes are persisted for the member');
SELECT is(
  (SELECT count(*)::int FROM public.member_evaluations
   WHERE member_id = phantoms_test.mid('alice') AND kind = 'strike' AND points = 0 AND grade = 'warning'),
  3,
  'each strike also records a zero-point warning evaluation');
SELECT is(
  (SELECT count(*)::int FROM public.member_strikes WHERE member_id = phantoms_test.mid('carol')),
  1,
  'the strike count stays per member');
SELECT phantoms_test.login_as('owner');
SELECT is(
  (SELECT count(*)::int FROM public.member_strikes),
  4,
  'admins can read every strike through RLS');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok(
  $$ SELECT count(*) FROM public.member_strikes $$,
  '42501', NULL,
  'anon cannot read strikes');
RESET ROLE;
-- Member self-read ----------------------------------------------------------
SELECT phantoms_test.login_as('carol');
SELECT is((public.member_my_strikes() ->> 'limit')::int, 3, 'members read the strike limit');
SELECT is(
  pg_catalog.jsonb_array_length(public.member_my_strikes() -> 'strikes'),
  1,
  'a member sees only their own strikes');
SELECT is(
  public.member_my_strikes() -> 'strikes' -> 0 ->> 'reason',
  'تسليم متأخر',
  'the member sees the strike reason');
SELECT throws_ok(
  $$ SELECT public.owner_expel_member(phantoms_test.mid('alice'), 'محاولة') $$,
  'P0001', 'OWNER_ONLY',
  'members cannot expel anyone');
-- Owner-only expulsion ------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.login_as('owner');
SELECT throws_ok(
  $$ SELECT public.owner_expel_member(phantoms_test.mid('self'), 'محاولة') $$,
  'P0001', 'CANNOT_EXPEL_OWNER',
  'the owner cannot expel their own account');
SELECT is(
  (public.owner_expel_member(phantoms_test.mid('carol'), 'الوصول لحد التحذيرات') ->> 'expelled'),
  'true',
  'the owner can expel a member');
RESET ROLE;
SELECT is(
  (SELECT work_status FROM public.members WHERE id = phantoms_test.mid('carol')),
  'inactive',
  'expulsion deactivates the member');
SELECT is(
  (SELECT status FROM public.team_memberships WHERE member_id = phantoms_test.mid('carol')),
  'removed',
  'expulsion removes the member from their teams');
SELECT is(
  (SELECT count(*)::int FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('carol')),
  0,
  'expulsion deletes the sign-in binding');
SELECT is(
  (SELECT count(*)::int FROM public.member_device_sessions WHERE member_id = phantoms_test.mid('carol')),
  0,
  'expulsion deletes the device sessions');
SELECT phantoms_test.login_as('carol');
SELECT throws_ok(
  $$ SELECT public.member_my_strikes() $$,
  'P0001', 'UNAUTHORIZED',
  'an expelled member can no longer read the portal');
SELECT * FROM finish();
ROLLBACK;
