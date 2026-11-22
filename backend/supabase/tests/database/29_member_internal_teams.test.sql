-- 29 — member_internal_teams(): العضو بيشوف فرقه الداخلية بس.
-- يثبت: الدالة SECURITY DEFINER ومقفولة على anon، بترجع صفوف صاحب الجلسة فقط،
-- بتستبعد العضويات المرفوضة والفرق الموقوفة، وبتشتغل للعضو اللي معندوش أي فريق.
BEGIN;
\ir _helpers.psql
SELECT plan(11);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user('stranger');
  PERFORM phantoms_test.create_member('alice', NULL, true);
  PERFORM phantoms_test.create_member('bob', NULL, true);
  INSERT INTO public.team_memberships (team_id, member_id, status, approved_at)
  SELECT t.id, phantoms_test.mid('alice'), 'active', now() FROM public.teams AS t WHERE t.slug = 'software';
  INSERT INTO public.team_memberships (team_id, member_id, status)
  SELECT t.id, phantoms_test.mid('alice'), 'pending' FROM public.teams AS t WHERE t.slug = 'ai';
  INSERT INTO public.team_memberships (team_id, member_id, status)
  SELECT t.id, phantoms_test.mid('alice'), 'rejected' FROM public.teams AS t WHERE t.slug = 'hardware';
  INSERT INTO public.team_memberships (team_id, member_id, status)
  SELECT t.id, phantoms_test.mid('bob'), 'active' FROM public.teams AS t WHERE t.slug = 'software';
  -- A suspended team must never leak into a member's chips.
  INSERT INTO public.teams (slug, name, is_active)
  VALUES ('retired', 'Retired Team', false);
  INSERT INTO public.team_memberships (team_id, member_id, status)
  SELECT t.id, phantoms_test.mid('alice'), 'active' FROM public.teams AS t WHERE t.slug = 'retired';
END $$;

-- Function posture -----------------------------------------------------------
SELECT has_function('public', 'member_internal_teams', ARRAY[]::name[],
  'member_internal_teams() exists with no arguments');
SELECT is(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.member_internal_teams()'::regprocedure),
  true,
  'member_internal_teams runs as SECURITY DEFINER (members cannot read teams directly)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc
          WHERE oid = 'public.member_internal_teams()'::regprocedure
            AND proconfig::text LIKE '%search_path=%'),
  'member_internal_teams pins its own search_path');
SELECT ok(
  NOT has_function_privilege('anon', 'public.member_internal_teams()', 'EXECUTE'),
  'anonymous role cannot execute member_internal_teams');
SELECT ok(
  has_function_privilege('authenticated', 'public.member_internal_teams()', 'EXECUTE'),
  'authenticated role can execute member_internal_teams');

-- Anonymous call is denied ----------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT * FROM public.member_internal_teams()$$, '42501', NULL,
  'anon calling member_internal_teams is rejected by privileges');
RESET ROLE;

-- Scoped results --------------------------------------------------------------
SELECT phantoms_test.login_as('alice');
SELECT is(
  (SELECT count(*)::int FROM public.member_internal_teams()),
  2,
  'alice sees exactly her approved/pending teams (rejected and inactive ones are excluded)');
SELECT is(
  (SELECT pg_catalog.array_agg(slug ORDER BY slug)::text FROM public.member_internal_teams()),
  '{ai,software}',
  'alice gets the ai and software slugs only');
SELECT is(
  (SELECT status FROM public.member_internal_teams() WHERE slug = 'software'),
  'active',
  'membership status is returned so the portal can show pending state');
RESET ROLE;

-- Other identities see only their own rows ------------------------------------
SELECT phantoms_test.login_as('bob');
SELECT is(
  (SELECT count(*)::int FROM public.member_internal_teams()),
  1,
  'bob sees his own team only, never alice rows');
RESET ROLE;

SELECT phantoms_test.login_as('stranger');
SELECT is(
  (SELECT count(*)::int FROM public.member_internal_teams()),
  0,
  'an authenticated user without a member binding sees nothing');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;