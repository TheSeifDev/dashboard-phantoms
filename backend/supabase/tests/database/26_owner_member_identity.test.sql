-- 26 — Owner member identity: the platform owner (a global Admin account) can use
-- the Member portal through an explicit member binding, provision that identity
-- idempotently, and store a full member profile (including the GitHub link).
--
-- All direct table reads happen as the fixture owner (postgres); authenticated
-- blocks only call the RPCs and stash their results in phantoms_test.vars.
BEGIN;
\ir _helpers.psql

SELECT plan(28);

-- Disposable fixtures ---------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner', 'owner2', 'full_admin']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('full_admin', 'admin');
  -- A pre-existing member row for the second owner candidate (no Auth binding).
  PERFORM phantoms_test.create_member('owner2_row', 'owner2@phantoms-test.example', false);
END $$;

UPDATE auth.users
SET encrypted_password = 'fixture-password-hash-' || id::TEXT
WHERE id IN (phantoms_test.uid('owner'), phantoms_test.uid('owner2'), phantoms_test.uid('full_admin'));

-- Boundaries ----------------------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok(
  $$SELECT public.ensure_owner_member_identity()$$,
  '42501', NULL,
  'anonymous callers cannot provision an owner member identity'
);
RESET ROLE;

SELECT phantoms_test.login_as('full_admin');
SELECT throws_like(
  $$SELECT public.ensure_owner_member_identity()$$,
  '%UNAUTHORIZED%',
  'a global Admin that is not the owner cannot provision an owner member identity'
);
SELECT ok(
  public.get_member_password_access() IS NULL,
  'an Admin without a member binding still has no Member access'
);
RESET ROLE;

-- Owner session: every RPC result is captured, never read from tables --------
SELECT phantoms_test.login_as('owner');
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-identity', public.ensure_owner_member_identity()::TEXT);
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-access', public.get_member_password_access()::TEXT);
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-again', public.ensure_owner_member_identity()::TEXT);
RESET ROLE;

SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(phantoms_test.var('owner-identity')::JSONB) AS keys(k)),
  ARRAY['created', 'email', 'member_id']::TEXT[],
  'the identity result exposes only member_id, email and created'
);
SELECT is(
  phantoms_test.var('owner-identity')::JSONB ->> 'created',
  'true',
  'the first call creates the owner member row'
);
SELECT is(
  phantoms_test.var('owner-identity')::JSONB ->> 'email',
  'owner@phantoms-test.example',
  'the identity uses the owner verified Auth email'
);
SELECT is(
  (SELECT count(*)::INT FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  1,
  'exactly one member row is created for the owner email'
);
SELECT is(
  (SELECT full_name FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  'owner',
  'the created member row gets a usable default name'
);
SELECT is(
  (SELECT work_status FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  'active',
  'the owner member row is active'
);
SELECT is(
  (SELECT b.auth_user_id
   FROM public.member_auth_bindings AS b
   JOIN public.members AS m ON m.id = b.member_id
   WHERE pg_catalog.lower(m.email) = 'owner@phantoms-test.example'),
  phantoms_test.uid('owner'),
  'the binding points at the owner Auth user'
);
SELECT ok(
  (SELECT password_ready FROM public.member_auth_bindings WHERE auth_user_id = phantoms_test.uid('owner')),
  'the owner binding is password-ready'
);
SELECT is(
  phantoms_test.var('owner-access')::JSONB ->> 'member_id',
  phantoms_test.var('owner-identity')::JSONB ->> 'member_id',
  'the owner can read Member portal access through the binding'
);
SELECT is(
  phantoms_test.var('owner-access')::JSONB ->> 'active',
  'true',
  'the owner Member access reports active=true'
);

-- Idempotency ---------------------------------------------------------------
SELECT is(
  phantoms_test.var('owner-again')::JSONB ->> 'created',
  'false',
  'a repeated call reports created=false'
);
SELECT is(
  phantoms_test.var('owner-again')::JSONB ->> 'member_id',
  phantoms_test.var('owner-identity')::JSONB ->> 'member_id',
  'a repeated call returns the same member id'
);
SELECT is(
  (SELECT count(*)::INT FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  1,
  'a repeated call never duplicates the member row'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_auth_bindings WHERE auth_user_id = phantoms_test.uid('owner')),
  1,
  'a repeated call never duplicates the binding'
);

-- Owner profile: device session, read, then a full profile save --------------
SELECT phantoms_test.login_as('owner');
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-bound', public.bind_member_device_session('owner@phantoms-test.example', 'owner-device-token-0123456789abcdef')::TEXT);
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-settings', (public.member_get_profile_settings('owner-device-token-0123456789abcdef') IS NOT NULL)::TEXT);
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner-profile', (public.member_update_profile_settings(
    'owner-device-token-0123456789abcdef',
    '{"fullName":"Seif Owner","phone":"01012345678","residence":"Cairo","workConditions":"Full time on PHANTOMS","bio":"Owner and maintainer","device":"لابتوب","gender":"ذكر","academicNumber":"12345678","academicGroup":"G1","specialization":"software","linkedinUrl":"https://www.linkedin.com/in/seif","portfolioUrl":"https://github.com/TheSeifDev"}'::JSONB
  ) IS NOT NULL)::TEXT);
RESET ROLE;

SELECT is(phantoms_test.var('owner-bound'), 'true', 'the owner can bind a member device session');
SELECT is(phantoms_test.var('owner-settings'), 'true', 'the owner can read the member profile settings payload');
SELECT is(phantoms_test.var('owner-profile'), 'true', 'the owner can save a complete member profile');
SELECT is(
  (SELECT full_name FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  'Seif Owner',
  'the owner profile save updates the member row'
);
SELECT is(
  (SELECT portfolio_url FROM public.members WHERE pg_catalog.lower(email) = 'owner@phantoms-test.example'),
  'https://github.com/TheSeifDev',
  'the owner GitHub profile is stored for avatar and contribution graph'
);

-- A mismatched JWT email is rejected ---------------------------------------
SELECT phantoms_test.login_as('owner');
DO $$
DECLARE v_claims TEXT;
BEGIN
  -- auth.jwt() prefers the singular claim setting, so both copies must change.
  v_claims := pg_catalog.jsonb_set(
    COALESCE(NULLIF(current_setting('request.jwt.claim', true), ''), current_setting('request.jwt.claims'))::JSONB,
    '{email}',
    '"someone-else@phantoms-test.example"'
  )::TEXT;
  PERFORM set_config('request.jwt.claim', v_claims, true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
END $$;
SELECT throws_like(
  $$SELECT public.ensure_owner_member_identity()$$,
  '%IDENTITY_CONFLICT%',
  'a JWT email that differs from the stored Auth email is rejected'
);
RESET ROLE;

-- Second owner candidate: links an existing member row instead of creating one
DELETE FROM public.admin_accounts WHERE user_id = phantoms_test.uid('owner');
INSERT INTO public.admin_accounts (user_id, role) VALUES (phantoms_test.uid('owner2'), 'owner');

SELECT phantoms_test.login_as('owner2');
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner2-identity', public.ensure_owner_member_identity()::TEXT);
INSERT INTO phantoms_test.vars(key, value)
VALUES ('owner2-access', public.get_member_password_access()::TEXT);
RESET ROLE;

SELECT is(
  phantoms_test.var('owner2-identity')::JSONB ->> 'created',
  'false',
  'an existing member row with the owner email is linked, not created'
);
SELECT is(
  phantoms_test.var('owner2-identity')::JSONB ->> 'member_id',
  phantoms_test.mid('owner2_row')::TEXT,
  'the linked identity reuses the existing member id'
);
SELECT is(
  (SELECT count(*)::INT FROM public.members WHERE pg_catalog.lower(email) = 'owner2@phantoms-test.example'),
  1,
  'linking never duplicates the pre-existing member row'
);
SELECT is(
  (SELECT b.member_id FROM public.member_auth_bindings AS b WHERE b.auth_user_id = phantoms_test.uid('owner2')),
  phantoms_test.mid('owner2_row'),
  'linking creates the Auth binding for the existing member row'
);
SELECT is(
  phantoms_test.var('owner2-access')::JSONB ->> 'member_id',
  phantoms_test.mid('owner2_row')::TEXT,
  'the linked owner reads Member access for the existing member id'
);

SELECT * FROM finish();
ROLLBACK;
