-- 07 — Authenticated member projection: the 23 safe columns are readable by
-- admins without broadening table SELECT, RLS, anon access, or secret columns.
BEGIN;
\ir _helpers.psql

SELECT plan(35);

-- Disposable Auth/admin/member fixtures -------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner', 'members_admin', 'outsider', 'noperm_admin']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.grant_admin('noperm_admin', 'admin', phantoms_test.perms());
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  UPDATE public.members
  SET team_notes = 'fixture note',
      phone = '+201000000001'
  WHERE email = 'alice@phantoms-test.example';
END $$;

-- The disposable chain applies all 91 canonical files; historical provenance remains
-- anchored to the original 24 initialization migrations.
SELECT is((SELECT count(*)::int FROM supabase_migrations.schema_migrations), 91,
  'local disposable migration history records all 91 canonical files');
SELECT is((SELECT max(version) FROM supabase_migrations.schema_migrations), '20261124220000',
  'local disposable migration history ends at the ICPC hub API migration');
SELECT is((SELECT count(*)::int FROM supabase_migrations.schema_migrations
           WHERE version <= '20261114164006'), 24,
  'historical migration cohort through 20261114164006 remains exactly 24 migrations');
SELECT is((SELECT max(version) FROM supabase_migrations.schema_migrations
           WHERE version <= '20261114164006'), '20261114164006',
  'historical migration cohort max remains 20261114164006');

-- Exact privilege/RLS posture -----------------------------------------------
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name)
   FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'members'
     AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
  ARRAY[
    'academic_group', 'academic_number', 'bio', 'bonus_infinite', 'can_go_alexandria', 'completion_rank',
    'created_at', 'custom_fields', 'device', 'email', 'full_name', 'gender',
    'id', 'linkedin_url', 'meeting_attendance', 'phone', 'portfolio_url', 'residence', 'specialization', 'team_notes',
    'university_email', 'work_conditions', 'work_status'
  ]::text[],
  'authenticated has SELECT on exactly the 23 safe member columns');
SELECT ok(NOT has_table_privilege('authenticated', 'public.members', 'SELECT'),
  'authenticated has no table-level SELECT privilege on members');
SELECT is((SELECT count(*)::int FROM information_schema.column_privileges
           WHERE table_schema = 'public' AND table_name = 'members'
             AND grantee = 'authenticated' AND privilege_type = 'SELECT'
             AND column_name IN ('session_token', 'push_subscription')), 0,
  'authenticated has no SELECT privilege on session_token or push_subscription');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = 'members' AND grantee = 'anon'), 0,
  'anon retains no table-level grants on members');
SELECT is((SELECT count(*)::int FROM information_schema.column_privileges
           WHERE table_schema = 'public' AND table_name = 'members' AND grantee = 'anon'), 0,
  'anon retains no column grants on members');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.members'::regclass),
  'members RLS remains enabled');
SELECT is((SELECT count(*)::int FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'members'), 4,
  'members retains its four historical RLS policies');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname)
   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'members'),
  ARRAY['Admin delete members', 'Admin insert members',
        'Admin read members by feature', 'Admin update members']::text[],
  'members RLS policy names remain unchanged');

-- Owner: safe projection SELECT and full CRUD with RETURNING -----------------
SELECT phantoms_test.login_as('owner');
SELECT lives_ok($sql$
  SELECT id, created_at, email, full_name, completion_rank, team_notes, residence,
         work_conditions, bio, phone, device, gender, meeting_attendance,
         work_status, can_go_alexandria, bonus_infinite, custom_fields
  FROM public.members ORDER BY id
$sql$, 'owner can SELECT the complete 17-column safe projection');
SELECT lives_ok($sql$
  UPDATE public.members
  SET full_name = 'Owner Renamed'
  WHERE email = 'alice@phantoms-test.example'
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'owner can update a member and RETURN the complete safe projection');
SELECT is((SELECT full_name FROM public.members WHERE email = 'alice@phantoms-test.example'),
  'Owner Renamed', 'fresh re-read sees the owner name-only update');
SELECT is((SELECT phone FROM public.members WHERE email = 'alice@phantoms-test.example'),
  '+201000000001', 'name-only update preserves the existing member phone');
SELECT lives_ok($sql$
  INSERT INTO public.members (
    email, full_name, team_notes, residence, work_conditions, bio, phone,
    device, gender, meeting_attendance, work_status, can_go_alexandria,
    bonus_infinite, custom_fields, completion_rank
  ) VALUES (
    'owner-insert@phantoms-test.example', 'Owner Insert', 'owner note',
    'Alexandria', 'remote', 'owner bio', '+201000000002', 'owner-device',
    'female', 'present', 'active', true, false, '{"source":"owner"}'::jsonb, 7
  )
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'owner can insert a member and RETURN the complete safe projection');
SELECT is((SELECT count(*)::int FROM public.members
           WHERE email = 'owner-insert@phantoms-test.example'), 1,
  'fresh re-read sees the owner insertion persisted');
SELECT lives_ok($sql$
  DELETE FROM public.members
  WHERE email = 'owner-insert@phantoms-test.example'
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'owner can delete a member and RETURN the complete safe projection');
SELECT is((SELECT count(*)::int FROM public.members
           WHERE email = 'owner-insert@phantoms-test.example'), 0,
  'fresh re-read confirms owner cleanup deletion');
RESET ROLE;

-- Members admin: the same safe projection and CRUD path ---------------------
SELECT phantoms_test.login_as('members_admin');
SELECT lives_ok($sql$
  SELECT id, created_at, email, full_name, completion_rank, team_notes, residence,
         work_conditions, bio, phone, device, gender, meeting_attendance,
         work_status, can_go_alexandria, bonus_infinite, custom_fields
  FROM public.members ORDER BY id
$sql$, 'members admin can SELECT the complete 17-column safe projection');
SELECT lives_ok($sql$
  UPDATE public.members
  SET full_name = 'Admin Renamed'
  WHERE email = 'bob@phantoms-test.example'
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'members admin can update a member and RETURN the complete safe projection');
SELECT is((SELECT full_name FROM public.members WHERE email = 'bob@phantoms-test.example'),
  'Admin Renamed', 'fresh re-read sees the members-admin name-only update');
SELECT lives_ok($sql$
  INSERT INTO public.members (email, full_name, team_notes, custom_fields)
  VALUES ('admin-insert@phantoms-test.example', 'Admin Insert', 'admin note', '{"source":"admin"}'::jsonb)
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'members admin can insert a member and RETURN the complete safe projection');
SELECT is((SELECT count(*)::int FROM public.members
           WHERE email = 'admin-insert@phantoms-test.example'), 1,
  'fresh re-read sees the members-admin insertion persisted');
SELECT lives_ok($sql$
  DELETE FROM public.members
  WHERE email = 'admin-insert@phantoms-test.example'
  RETURNING id, created_at, email, full_name, completion_rank, team_notes, residence,
            work_conditions, bio, phone, device, gender, meeting_attendance,
            work_status, can_go_alexandria, bonus_infinite, custom_fields
$sql$, 'members admin can delete a member and RETURN the complete safe projection');
SELECT is((SELECT count(*)::int FROM public.members
           WHERE email = 'admin-insert@phantoms-test.example'), 0,
  'fresh re-read confirms members-admin cleanup deletion');
RESET ROLE;

-- Secrets and wildcard expansion remain denied; failed INSERT RETURNING * leaves no row.
SELECT phantoms_test.login_as('owner');
SELECT throws_ok($$SELECT session_token FROM public.members LIMIT 1$$, '42501', NULL,
  'owner cannot explicitly SELECT session_token');
SELECT throws_ok($$SELECT push_subscription FROM public.members LIMIT 1$$, '42501', NULL,
  'owner cannot explicitly SELECT push_subscription');
SELECT throws_ok($$SELECT * FROM public.members LIMIT 1$$, '42501', NULL,
  'owner cannot use wildcard member projection');
SELECT throws_ok($$INSERT INTO public.members (email, full_name)
  VALUES ('wildcard-insert@phantoms-test.example', 'Wildcard Insert') RETURNING *$$,
  '42501', NULL, 'wildcard INSERT RETURNING * is denied');
SELECT is((SELECT count(*)::int FROM public.members
           WHERE email = 'wildcard-insert@phantoms-test.example'), 0,
  'failed wildcard INSERT RETURNING * leaves no persisted row');
RESET ROLE;

-- Authenticated non-admins retain RLS row hiding; anon retains no direct access.
SELECT phantoms_test.login_as('outsider');
SELECT is((SELECT count(id)::int FROM public.members), 0,
  'outsider sees no member rows through the safe projection');
RESET ROLE;
SELECT phantoms_test.login_as('noperm_admin');
SELECT is((SELECT count(id)::int FROM public.members), 0,
  'no-permission admin sees no member rows through the safe projection');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT id, full_name FROM public.members LIMIT 1$$, '42501', NULL,
  'anon cannot access members directly');

SELECT * FROM finish();
ROLLBACK;
