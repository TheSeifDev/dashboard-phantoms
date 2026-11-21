-- 25 — Minimal client-reported Android app-use evidence.
-- Every fixture and assertion is transaction-local; the whole test rolls back.
-- This proves app use only, not installation, device inventory, hardware identity,
-- or attestation.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner', 'members_admin', 'team_head', 'team_monitor']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));

  PERFORM phantoms_test.create_member(n, NULL, true)
  FROM unnest(ARRAY[
    'usage-member', 'usage-other', 'inactive-member', 'revoked-member',
    'bad-binding', 'bad-email', 'unconfirmed-member'
  ]) AS n;
  UPDATE public.members
  SET work_status = 'inactive'
  WHERE id = phantoms_test.mid('inactive-member');

  PERFORM phantoms_test.bind_device(n)
  FROM unnest(ARRAY[
    'usage-member', 'usage-other', 'inactive-member', 'revoked-member',
    'bad-binding', 'bad-email', 'unconfirmed-member'
  ]) AS n;
END $$;

-- Canonical migration inventory is now 24 historical + 31 forward files.
SELECT is((SELECT count(*)::int FROM supabase_migrations.schema_migrations), 54,
  'local disposable migration history records all 55 canonical files');
SELECT is((SELECT max(version) FROM supabase_migrations.schema_migrations), '20261121144600',
  'local disposable migration history ends at the Storage vector-index lock-scope correction');
SELECT is((SELECT count(*)::int FROM supabase_migrations.schema_migrations
           WHERE version <= '20261114164006'), 24,
  'historical migration cohort remains exactly 24 migrations');

-- Table/RPC posture and exact numeric member-id contract ---------------------
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_app_usage'::regclass),
  'member_app_usage has RLS enabled');
SELECT is((SELECT count(*)::int FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'member_app_usage'), 0,
  'member_app_usage has no direct table policies');
SELECT ok(NOT has_table_privilege('anon', 'public.member_app_usage', 'SELECT'),
  'anon has no direct table SELECT privilege');
SELECT ok(NOT has_table_privilege('authenticated', 'public.member_app_usage', 'SELECT'),
  'authenticated has no direct table SELECT privilege');
SELECT ok(NOT has_function_privilege('anon', 'public.member_record_app_usage(text,text,text)', 'EXECUTE'),
  'anon cannot execute member recording');
SELECT ok(has_function_privilege('authenticated', 'public.member_record_app_usage(text,text,text)', 'EXECUTE'),
  'authenticated can execute only the recording RPC');
SELECT ok(has_function_privilege('authenticated', 'public.owner_member_app_usage(bigint[])', 'EXECUTE'),
  'authenticated can invoke the owner read RPC, which performs its own owner guard');
SELECT is((SELECT pg_get_function_result('public.owner_member_app_usage(bigint[])'::regprocedure)),
  'TABLE(member_id bigint, first_used_at timestamp with time zone, last_used_at timestamp with time zone, last_app_version text, last_app_build text)',
  'owner read returns only numeric member id and first/last usage/version/build fields');

-- Preserve existing Member/Auth binding rows around successful recording.
INSERT INTO phantoms_test.vars(key, value)
SELECT 'member-before', to_jsonb(m)::text
FROM public.members AS m WHERE m.id = phantoms_test.mid('usage-member');
INSERT INTO phantoms_test.vars(key, value)
SELECT 'binding-before', to_jsonb(b)::text
FROM public.member_auth_bindings AS b WHERE b.member_id = phantoms_test.mid('usage-member');

-- Bound active Member: server time and exact session/device identity ----------
SELECT phantoms_test.login_as('usage-member');
INSERT INTO phantoms_test.vars(key, value)
VALUES ('usage-first', public.member_record_app_usage(
  phantoms_test.tok('usage-member'), '1.0.0', '100'
)::text);
SELECT is(
  (SELECT array_agg(k ORDER BY k)
   FROM jsonb_object_keys(phantoms_test.var('usage-first')::jsonb) AS keys(k)),
  ARRAY['evidence_classification', 'first_used_at', 'last_app_build', 'last_app_version',
        'last_used_at', 'member_id', 'platform']::text[],
  'recording returns only bounded self-use evidence fields');
SELECT is(phantoms_test.var('usage-first')::jsonb ->> 'member_id',
  phantoms_test.mid('usage-member')::text,
  'recording resolves the exact bound member rather than accepting a caller member id');
SELECT is(phantoms_test.var('usage-first')::jsonb ->> 'platform', 'android',
  'recording stores the only accepted platform');
SELECT is(phantoms_test.var('usage-first')::jsonb ->> 'evidence_classification', 'client_reported',
  'recording labels evidence as explicitly client reported');
SELECT is(phantoms_test.var('usage-first')::jsonb ->> 'last_app_version', '1.0.0',
  'recording trims and stores the bounded app version');
SELECT is(phantoms_test.var('usage-first')::jsonb ->> 'last_app_build', '100',
  'recording stores the bounded app build');
SELECT ok((phantoms_test.var('usage-first')::jsonb ->> 'first_used_at')::timestamptz
          <= (phantoms_test.var('usage-first')::jsonb ->> 'last_used_at')::timestamptz,
  'server first_used_at is not after server last_used_at');

-- A changed version/build updates last usage but never first usage. A repeated
-- identical report inside the one-minute throttle does not create timestamp spam.
INSERT INTO phantoms_test.vars(key, value)
VALUES ('usage-second', public.member_record_app_usage(
  phantoms_test.tok('usage-member'), '1.0.1', '101'
)::text);
SELECT is(phantoms_test.var('usage-second')::jsonb ->> 'first_used_at',
  phantoms_test.var('usage-first')::jsonb ->> 'first_used_at',
  'first_used_at is immutable across upserts');
SELECT ok((phantoms_test.var('usage-second')::jsonb ->> 'last_used_at')::timestamptz
          >= (phantoms_test.var('usage-first')::jsonb ->> 'last_used_at')::timestamptz,
  'last_used_at is monotonic server time');
SELECT is(phantoms_test.var('usage-second')::jsonb ->> 'last_app_version', '1.0.1',
  'changed app version is retained as the last reported version');
INSERT INTO phantoms_test.vars(key, value)
VALUES ('usage-third', public.member_record_app_usage(
  phantoms_test.tok('usage-member'), '1.0.1', '101'
)::text);
SELECT is(phantoms_test.var('usage-third')::jsonb ->> 'last_used_at',
  phantoms_test.var('usage-second')::jsonb ->> 'last_used_at',
  'identical duplicate reports are throttled within one minute');
SELECT throws_ok(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('usage-member'), '1.0.0', '100', now())$$,
  '42883', NULL,
  'recording RPC has no caller timestamp or member-id input');
RESET ROLE;

SELECT is((SELECT to_jsonb(m)::text FROM public.members AS m
           WHERE m.id = phantoms_test.mid('usage-member')),
  phantoms_test.var('member-before'),
  'successful recording does not mutate the existing member row');
SELECT is((SELECT to_jsonb(b)::text FROM public.member_auth_bindings AS b
           WHERE b.member_id = phantoms_test.mid('usage-member')),
  phantoms_test.var('binding-before'),
  'successful recording does not mutate the existing auth binding row');

-- Owner read returns requested usage rows only, in requested order; absent rows
-- remain absent so the frontend can distinguish no recorded usage from RPC failure.
SELECT phantoms_test.login_as('owner');
SELECT is((SELECT count(*)::int
           FROM public.owner_member_app_usage(ARRAY[
             phantoms_test.mid('usage-other'), phantoms_test.mid('usage-member'), 999999999::bigint
           ])), 1,
  'owner read returns only members with recorded usage among requested IDs');
SELECT is((SELECT member_id FROM public.owner_member_app_usage(ARRAY[
             phantoms_test.mid('usage-other'), phantoms_test.mid('usage-member')
           ])), phantoms_test.mid('usage-member'),
  'owner read returns the recorded member id and omits no-usage members');
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY(SELECT generate_series(1,101)::bigint))$$,
  '%INVALID_INPUT%',
  'owner read rejects more than 100 requested member ids');
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[NULL::bigint])$$,
  '%INVALID_INPUT%',
  'owner read rejects null member ids');
SELECT set_config('request.jwt.claims', (auth.jwt() || jsonb_build_object(
  'amr', jsonb_build_array(jsonb_build_object('method', 'recovery'))
))::text, true);
SELECT set_config('request.jwt.claim', current_setting('request.jwt.claims'), true);
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[phantoms_test.mid('usage-member')])$$,
  '%RECOVERY_SESSION_FORBIDDEN%', 'Owner recovery session cannot read app use');
RESET ROLE;
SELECT phantoms_test.login_as('owner');
RESET ROLE;
DELETE FROM auth.sessions WHERE id::text = auth.jwt() ->> 'session_id' AND user_id = phantoms_test.uid('owner');
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[phantoms_test.mid('usage-member')])$$,
  '%MEMBER_SESSION_REQUIRED%', 'Owner revoked session cannot read app use');
RESET ROLE;

-- Admin, ordinary Member, and unrelated Team Head/Monitor cannot read usage.
SELECT phantoms_test.login_as('members_admin');
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[phantoms_test.mid('usage-member')])$$,
  '%OWNER_ONLY%', 'global Admin cannot use the owner-only usage read');
RESET ROLE;
SELECT phantoms_test.login_as('usage-member');
SELECT throws_like(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[phantoms_test.mid('usage-member')])$$,
  '%OWNER_ONLY%', 'ordinary Member cannot use the owner-only usage read');
RESET ROLE;
SELECT phantoms_test.login_as('team_head');
SELECT throws_like(
  $$SELECT public.member_record_app_usage('irrelevant-device-token', '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'unrelated Team Head cannot record as a Member');
RESET ROLE;
SELECT phantoms_test.login_as('team_monitor');
SELECT throws_like(
  $$SELECT public.member_record_app_usage('irrelevant-device-token', '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'unrelated Team Monitor cannot record as a Member');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok(
  $$SELECT * FROM public.owner_member_app_usage(ARRAY[1::bigint])$$,
  '42501', NULL, 'anonymous caller cannot execute owner usage read');
RESET ROLE;

-- Member recording rejects wrong device, recovery AMR, inactive/revoked Auth,
-- mismatched binding/email, and unconfirmed Auth email.
SELECT phantoms_test.login_as('usage-member');
SELECT throws_like(
  $$SELECT public.member_record_app_usage('wrong-device-token-0123456789', '1.0.0', '100')$$,
  '%DEVICE_REQUIRED%', 'wrong device token is rejected');

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', phantoms_test.uid('usage-member'), 'email', 'usage-member@phantoms-test.example',
  'role', 'authenticated', 'aud', 'authenticated', 'session_id', auth.jwt() ->> 'session_id',
  'amr', jsonb_build_array(jsonb_build_object('method', 'recovery'))
)::text, true);
SELECT set_config('request.jwt.claim', current_setting('request.jwt.claims'), true);
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('usage-member'), '1.0.0', '100')$$,
  '%RECOVERY_SESSION_FORBIDDEN%', 'recovery AMR cannot record ordinary app usage');
RESET ROLE;

SELECT phantoms_test.login_as('inactive-member');
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('inactive-member'), '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'inactive Member cannot record app usage');
RESET ROLE;

UPDATE auth.users
SET banned_until = pg_catalog.clock_timestamp() + INTERVAL '1 hour'
WHERE id = phantoms_test.uid('revoked-member');
SELECT phantoms_test.login_as('revoked-member');
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('revoked-member'), '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'banned/revoked Auth identity cannot record app usage');
RESET ROLE;

UPDATE public.member_auth_bindings
SET normalized_email = 'binding-mismatch@phantoms-test.example'
WHERE member_id = phantoms_test.mid('bad-binding');
SELECT phantoms_test.login_as('bad-binding');
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('bad-binding'), '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'mismatched member_auth_bindings email cannot record app usage');
RESET ROLE;

UPDATE auth.users
SET email = 'auth-email-mismatch@phantoms-test.example'
WHERE id = phantoms_test.uid('bad-email');
SELECT phantoms_test.login_as('bad-email');
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('bad-email'), '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'mismatched Auth email cannot record app usage');
RESET ROLE;

UPDATE auth.users
SET email_confirmed_at = NULL
WHERE id = phantoms_test.uid('unconfirmed-member');
SELECT phantoms_test.login_as('unconfirmed-member');
SELECT throws_like(
  $$SELECT public.member_record_app_usage(phantoms_test.tok('unconfirmed-member'), '1.0.0', '100')$$,
  '%UNAUTHORIZED%', 'unconfirmed Auth email cannot record app usage');
RESET ROLE;

-- Bounded inputs and immutable relational safety constraints ------------------
SELECT throws_ok($$
  INSERT INTO public.member_app_usage (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build, platform
  ) VALUES (
    phantoms_test.mid('usage-other'), now(), now(), '1.0.0', '100', 'ios'
  )
$$, '23514', NULL, 'platform is constrained to android');
SELECT throws_ok($$
  INSERT INTO public.member_app_usage (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build
  ) VALUES (
    phantoms_test.mid('usage-other'), now(), now(), repeat('x', 65), '100'
  )
$$, '23514', NULL, 'app version is bounded and control-free');
SELECT throws_ok($$
  INSERT INTO public.member_app_usage (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build
  ) VALUES (
    phantoms_test.mid('usage-other'), now(), now(), '1.0.0', repeat('x', 65)
  )
$$, '23514', NULL, 'app build is bounded and control-free');
SELECT throws_ok($$
  INSERT INTO public.member_app_usage (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build
  ) VALUES (
    phantoms_test.mid('usage-other'), now(), now(), '1.0.0', repeat('x', 33)
  )
$$, '23514', NULL, 'app build respects the 32-character frontend limit');
SELECT throws_ok($$
  INSERT INTO public.member_app_usage (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build
  ) VALUES (
    phantoms_test.mid('usage-other'), now(), now() - interval '1 second', '1.0.0', '100'
  )
$$, '23514', NULL, 'first usage cannot be after last usage');
SELECT throws_ok($$
  DELETE FROM public.members WHERE id = phantoms_test.mid('usage-member')
$$, '23503', NULL,
  'member FK is RESTRICT and app usage does not alter lifecycle/deletion semantics');

UPDATE public.member_app_usage SET last_used_at = clock_timestamp() + INTERVAL '1 day'
WHERE member_id = phantoms_test.mid('usage-member');
INSERT INTO phantoms_test.vars(key,value) SELECT 'future-last', last_used_at::text
FROM public.member_app_usage WHERE member_id = phantoms_test.mid('usage-member');
SELECT phantoms_test.login_as('usage-member');
SELECT is((public.member_record_app_usage(phantoms_test.tok('usage-member'), '2.0.0', '200') ->> 'last_used_at')::timestamptz,
  phantoms_test.var('future-last')::timestamptz, 'monotonic upsert survives a clock regression');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
