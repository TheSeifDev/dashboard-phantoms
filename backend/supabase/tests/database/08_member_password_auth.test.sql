-- 08 — Invitation-only member password auth.
-- This suite creates explicit disposable auth.users/member rows inside one
-- rolled-back transaction. It is real PostgreSQL/pgTAP integration, not GoTrue.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

CREATE FUNCTION phantoms_test.as_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- The fabricated stack supplies this helper-only uniqueness index. Drop it
-- only inside this test transaction so duplicate-email quarantine can be
-- exercised; ROLLBACK restores it and real GoTrue is never modified.
DROP INDEX IF EXISTS auth.auth_fixture_email_unique;

-- Explicit raw fixtures: no helper auto-enrollment, mapping, or password is
-- created implicitly. All UUIDs and hashes below are synthetic test values.
DO $$
DECLARE
  v_owner UUID := '10000000-0000-4000-8000-000000000001';
  v_admin UUID := '10000000-0000-4000-8000-000000000002';
  v_old UUID := '10000000-0000-4000-8000-000000000003';
  v_passworded UUID := '10000000-0000-4000-8000-000000000004';
  v_reset UUID := '10000000-0000-4000-8000-000000000005';
  v_review UUID := '10000000-0000-4000-8000-000000000006';
  v_stale UUID := '10000000-0000-4000-8000-000000000007';
  v_unconfirmed UUID := '10000000-0000-4000-8000-000000000008';
  v_banned UUID := '10000000-0000-4000-8000-000000000009';
  v_deleted UUID := '10000000-0000-4000-8000-00000000000a';
  v_sso UUID := '10000000-0000-4000-8000-00000000000b';
  v_no_provider UUID := '10000000-0000-4000-8000-00000000000c';
  v_dup_one UUID := '10000000-0000-4000-8000-00000000000d';
  v_dup_two UUID := '10000000-0000-4000-8000-00000000000e';
  v_admin_dup UUID := '10000000-0000-4000-8000-00000000000f';
  v_new_member BIGINT;
  v_old_member BIGINT;
  v_reset_member BIGINT;
  v_review_member BIGINT;
  v_stale_member BIGINT;
  v_passworded_member BIGINT;
  v_unconfirmed_member BIGINT;
  v_banned_member BIGINT;
  v_deleted_member BIGINT;
  v_sso_member BIGINT;
  v_no_provider_member BIGINT;
BEGIN
  INSERT INTO public.members (email, full_name, completion_rank) VALUES
    ('new-member@phantoms-test.example', 'Raw New', 0),
    ('old-otp@phantoms-test.example', 'Raw Old', 0),
    ('reset@phantoms-test.example', 'Raw Reset', 0),
    ('review-reset@phantoms-test.example', 'Raw Review', 0),
    ('stale@phantoms-test.example', 'Raw Stale', 0),
    ('passworded@phantoms-test.example', 'Raw Passworded', 0),
    ('unconfirmed@phantoms-test.example', 'Raw Unconfirmed', 0),
    ('banned@phantoms-test.example', 'Raw Banned', 0),
    ('deleted@phantoms-test.example', 'Raw Deleted', 0),
    ('sso@phantoms-test.example', 'Raw SSO', 0),
    ('no-provider@phantoms-test.example', 'Raw No Provider', 0),
    ('duplicate-auth@phantoms-test.example', 'Raw Duplicate Auth', 0),
    ('admin-identity@phantoms-test.example', 'Raw Admin Identity', 0);
  SELECT id INTO v_new_member FROM public.members WHERE email = 'new-member@phantoms-test.example';
  SELECT id INTO v_old_member FROM public.members WHERE email = 'old-otp@phantoms-test.example';
  SELECT id INTO v_reset_member FROM public.members WHERE email = 'reset@phantoms-test.example';
  SELECT id INTO v_review_member FROM public.members WHERE email = 'review-reset@phantoms-test.example';
  SELECT id INTO v_stale_member FROM public.members WHERE email = 'stale@phantoms-test.example';
  SELECT id INTO v_passworded_member FROM public.members WHERE email = 'passworded@phantoms-test.example';
  SELECT id INTO v_unconfirmed_member FROM public.members WHERE email = 'unconfirmed@phantoms-test.example';
  SELECT id INTO v_banned_member FROM public.members WHERE email = 'banned@phantoms-test.example';
  SELECT id INTO v_deleted_member FROM public.members WHERE email = 'deleted@phantoms-test.example';
  SELECT id INTO v_sso_member FROM public.members WHERE email = 'sso@phantoms-test.example';
  SELECT id INTO v_no_provider_member FROM public.members WHERE email = 'no-provider@phantoms-test.example';
  INSERT INTO phantoms_test.members(name, id, email, token)
  SELECT 'new', id, email, 'device-new-0123456789abcdef' FROM public.members WHERE email = 'new-member@phantoms-test.example'
  UNION ALL SELECT 'old', id, email, 'device-old-0123456789abcdef' FROM public.members WHERE email = 'old-otp@phantoms-test.example'
  UNION ALL SELECT 'reset', id, email, 'device-reset-0123456789abcdef' FROM public.members WHERE email = 'reset@phantoms-test.example'
  UNION ALL SELECT 'review', id, email, 'device-review-0123456789abcdef' FROM public.members WHERE email = 'review-reset@phantoms-test.example'
  UNION ALL SELECT 'stale', id, email, 'device-stale-0123456789abcdef' FROM public.members WHERE email = 'stale@phantoms-test.example'
  UNION ALL SELECT 'passworded', id, email, 'device-passworded-0123456789abcdef' FROM public.members WHERE email = 'passworded@phantoms-test.example'
  UNION ALL SELECT 'unconfirmed', id, email, 'device-unconfirmed-0123456789abcdef' FROM public.members WHERE email = 'unconfirmed@phantoms-test.example'
  UNION ALL SELECT 'banned', id, email, 'device-banned-0123456789abcdef' FROM public.members WHERE email = 'banned@phantoms-test.example'
  UNION ALL SELECT 'deleted', id, email, 'device-deleted-0123456789abcdef' FROM public.members WHERE email = 'deleted@phantoms-test.example'
  UNION ALL SELECT 'sso', id, email, 'device-sso-0123456789abcdef' FROM public.members WHERE email = 'sso@phantoms-test.example'
  UNION ALL SELECT 'no_provider', id, email, 'device-provider-0123456789abcdef' FROM public.members WHERE email = 'no-provider@phantoms-test.example';
  INSERT INTO phantoms_test.users(name, id, email) VALUES
    ('owner', v_owner, 'owner@phantoms-test.example'), ('admin', v_admin, 'admin@phantoms-test.example'),
    ('old', v_old, 'old-otp@phantoms-test.example'), ('passworded', v_passworded, 'passworded@phantoms-test.example'),
    ('reset', v_reset, 'reset@phantoms-test.example'), ('review', v_review, 'review-reset@phantoms-test.example'),
    ('stale', v_stale, 'stale@phantoms-test.example'), ('unconfirmed', v_unconfirmed, 'unconfirmed@phantoms-test.example'),
    ('banned', v_banned, 'banned@phantoms-test.example'), ('deleted', v_deleted, 'deleted@phantoms-test.example'),
    ('sso', v_sso, 'sso@phantoms-test.example'), ('no_provider', v_no_provider, 'no-provider@phantoms-test.example'),
    ('dup_one', v_dup_one, 'duplicate-auth@phantoms-test.example'), ('dup_two', v_dup_two, 'DUPLICATE-AUTH@phantoms-test.example'),
    ('admin_dup', v_admin_dup, 'admin-identity@phantoms-test.example');
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until, deleted_at, is_sso_user)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phantoms-test.example', 'owner-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@phantoms-test.example', 'admin-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_old, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'old-otp@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_passworded, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'passworded@phantoms-test.example', 'existing-password-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_reset, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reset@phantoms-test.example', 'reset-old-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_review, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-reset@phantoms-test.example', 'review-old-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_stale, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stale@phantoms-test.example', 'stale-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_unconfirmed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unconfirmed@phantoms-test.example', NULL, NULL, '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_banned, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'banned@phantoms-test.example', 'banned-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), now() + interval '1 hour', NULL, false),
    (v_deleted, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deleted@phantoms-test.example', 'deleted-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, now(), false),
    (v_sso, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sso@phantoms-test.example', 'sso-fixture-hash', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now(), NULL, NULL, true),
    (v_no_provider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-provider@phantoms-test.example', 'provider-fixture-hash', now(), '{"provider":"email","providers":[]}', '{}', now(), now(), NULL, NULL, false),
    (v_dup_one, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duplicate-auth@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_dup_two, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'DUPLICATE-AUTH@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    (v_admin_dup, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-identity@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false);
  INSERT INTO public.admin_accounts(user_id, role, permissions) VALUES
    (v_owner, 'owner', phantoms_test.perms('members')), (v_admin, 'admin', phantoms_test.perms('members')), (v_admin_dup, 'admin', phantoms_test.perms('members'));
  INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
  VALUES
    (v_reset_member, v_reset, 'reset@phantoms-test.example', true),
    (v_review_member, v_review, 'review-reset@phantoms-test.example', true),
    (v_stale_member, v_stale, 'wrong-snapshot@phantoms-test.example', true);
END $$;

SELECT has_table('public', 'member_auth_bindings', 'member_auth_bindings exists');
SELECT has_table('public', 'member_password_invitations', 'bound invitation table exists');
SELECT has_table('public', 'member_password_rate_limits', 'persistent rate limiter exists');
SELECT has_trigger('auth', 'users', 'trg_guard_member_password_write', 'password guard covers INSERT and UPDATE');
SELECT ok(NOT has_table_privilege('anon', 'public.member_password_invitations', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.member_password_invitations', 'SELECT'), 'invitation rows are not directly readable');
SELECT ok(NOT has_function_privilege('anon', 'public.member_password_reserve(text,text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_reserve(text,text)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_reserve(text,text)', 'EXECUTE'), 'reserve is service-only');
SELECT ok(NOT has_function_privilege('anon', 'public.member_password_complete(uuid,uuid,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_complete(uuid,uuid,uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_complete(uuid,uuid,uuid)', 'EXECUTE'), 'complete is service-only');
SELECT ok((SELECT count(*)::int FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef
              AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS c WHERE c = 'search_path=""')) >= 1, 'security definer search paths are pinned');
SELECT throws_like($$SELECT public.create_member_invite('legacy-token', 'x', 1)$$, '%MIGRATION_REQUIRED%', 'legacy creation is disabled');

-- Every service-only RPC fails closed when the JWT role claim is absent.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.role', '', true);
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT public.member_password_service_health()$$, '%SERVICE_ONLY%', 'missing JWT service role is rejected');
RESET ROLE;
SELECT phantoms_test.as_service();

-- New-member issue and strict token hashing.
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex'),
  (SELECT id FROM public.members WHERE email = 'new-member@phantoms-test.example'), 'new-member@phantoms-test.example', 'enroll', NULL, NULL, 24, 'new raw fixture', '10000000-0000-4000-8000-000000000001')$$, 'new member invitation issues');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 1, 'new invitation row exists');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations WHERE token_hash = 'phpw_' || repeat('a', 64)), 0, 'plaintext token is never stored');
SELECT ok((SELECT token_hash ~ '^[0-9a-f]{64}$' FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 'stored token is SHA-256-shaped');
SELECT is((SELECT details ? 'token' FROM public.member_password_audit WHERE action = 'issued' AND member_id = (SELECT id FROM public.members WHERE email = 'new-member@phantoms-test.example') LIMIT 1), false, 'issue audit contains no token');

-- Missing/wrong/malformed tokens and reservation durability.
SELECT throws_like($$SELECT public.member_password_reserve(repeat('0', 64), 'new-member@phantoms-test.example')$$, '%INVALID_TOKEN%', 'unknown token is rejected');
SELECT throws_like($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex'), 'wrong@phantoms-test.example')$$, '%WRONG_EMAIL%', 'wrong email is rejected');
SELECT is((SELECT status FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 'pending', 'wrong email leaves invite pending');
SELECT lives_ok($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex'), 'new-member@phantoms-test.example')$$, 'valid token reserves');
SELECT is((SELECT status FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 'reserved', 'reservation is durable');
SELECT throws_like($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex'), 'new-member@phantoms-test.example')$$, '%REVIEW_REQUIRED%', 'reserved token cannot be re-reserved');
SELECT ok((SELECT claim_id IS NOT NULL AND claimed_at IS NOT NULL FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 'reservation has claim and timestamp');

-- The INSERT trigger authorizes only this exact reserved new-member write and
-- marks the one Auth write in the same transaction.
RESET ROLE;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new-member@phantoms-test.example', 'new-fixture-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
INSERT INTO phantoms_test.users(name, id, email) VALUES ('new', '10000000-0000-4000-8000-000000000010', 'new-member@phantoms-test.example');
SELECT phantoms_test.as_service();
SELECT is((SELECT auth_write_completed_at IS NOT NULL FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), true, 'new INSERT marks exactly one Auth write');
SELECT is((SELECT auth_write_user_id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), '10000000-0000-4000-8000-000000000010'::uuid, 'new INSERT marker records the exact Auth UUID');
RESET ROLE;
SELECT throws_like($$UPDATE auth.users SET encrypted_password = 'second-new-account-hash' WHERE id = '10000000-0000-4000-8000-000000000010'$$, '%PASSWORD_ALREADY_SET%', 'new account UPDATE cannot bypass its INSERT reservation marker');
SELECT phantoms_test.as_service();
SELECT throws_like($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), '10000000-0000-4000-8000-000000000003')$$, '%IDENTITY_CONFLICT%', 'completion requires the exact guarded Auth UUID');
SELECT lives_ok($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), '10000000-0000-4000-8000-000000000010')$$, 'new identity completes');
SELECT is((SELECT status FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), 'complete', 'new invitation is terminal complete');
SELECT is((SELECT auth_user_id FROM public.member_auth_bindings WHERE member_id = (SELECT id FROM public.members WHERE email = 'new-member@phantoms-test.example')), '10000000-0000-4000-8000-000000000010'::uuid, 'new member binds exact Auth ID');
SELECT is((SELECT password_ready FROM public.member_auth_bindings WHERE member_id = (SELECT id FROM public.members WHERE email = 'new-member@phantoms-test.example')), true, 'new binding is password-ready');
SELECT throws_like($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'new-member@phantoms-test.example'), '10000000-0000-4000-8000-000000000010')$$, '%REVIEW_REQUIRED%', 'completed invitation cannot be reused');

-- Existing OTP identity: exact expected ID/evidence, no create fallback, and
-- UPDATE trigger blocks raced/second writes.
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('b', 64), 'UTF8'), 'sha256'), 'hex'),
  (SELECT id FROM public.members WHERE email = 'old-otp@phantoms-test.example'), 'old-otp@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000003', 'reviewed old OTP', 24, 'old transition', '10000000-0000-4000-8000-000000000001')$$, 'old OTP invitation issues with exact evidence');
SELECT lives_ok($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('b', 64), 'UTF8'), 'sha256'), 'hex'), 'old-otp@phantoms-test.example')$$, 'old OTP reserves');
RESET ROLE;
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'old-new-fixture-hash' WHERE id = '10000000-0000-4000-8000-000000000003'$$, 'the one allowed old-identity write succeeds');
SELECT is((SELECT encrypted_password FROM auth.users WHERE id = '10000000-0000-4000-8000-000000000003'), 'old-new-fixture-hash', 'the first password write is present');
SELECT throws_ok($$UPDATE auth.users SET encrypted_password = 'second-password-hash' WHERE id = '10000000-0000-4000-8000-000000000003'$$, 'P0001', 'PASSWORD_ALREADY_SET', 'a second initial password write is blocked');
SELECT is((SELECT auth_write_completed_at IS NOT NULL FROM public.member_password_invitations WHERE normalized_email = 'old-otp@phantoms-test.example'), true, 'old write is marked');
SELECT lives_ok($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'old-otp@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'old-otp@phantoms-test.example'), '10000000-0000-4000-8000-000000000003')$$, 'old OTP completes exact mapping');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('x', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'old-otp@phantoms-test.example'), 'old-otp@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000003', NULL, 24, 'no evidence', '10000000-0000-4000-8000-000000000001')$$, '%PASSWORD_ALREADY_SET%', 'existing password is never overwritten by enrollment');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('y', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'passworded@phantoms-test.example'), 'passworded@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000004', 'reviewed', 24, 'no overwrite', '10000000-0000-4000-8000-000000000001')$$, '%PASSWORD_ALREADY_SET%', 'passworded identity fails initial enrollment');

-- Reset is a separate purpose and exact mapped Auth identity.
SELECT lives_ok($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'reset@phantoms-test.example'), 'reset@phantoms-test.example', 'reset', '10000000-0000-4000-8000-000000000005', NULL, 24, 'reset', '10000000-0000-4000-8000-000000000001')$$, 'reset invitation issues only for mapped identity');
SELECT lives_ok($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex'), 'reset@phantoms-test.example')$$, 'reset reserves');
RESET ROLE;
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'reset-new-fixture-hash' WHERE id = '10000000-0000-4000-8000-000000000005'$$, 'reset writes exact mapped identity');
SELECT throws_like($$UPDATE auth.users SET encrypted_password = 'second-reset-hash' WHERE id = '10000000-0000-4000-8000-000000000005'$$, '%REVIEW_REQUIRED%', 'reset permits only one write before completion');
SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'reset@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'reset@phantoms-test.example'), '10000000-0000-4000-8000-000000000005')$$, 'reset completes');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('z', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'reset@phantoms-test.example'), 'reset@phantoms-test.example', 'reset', '10000000-0000-4000-8000-000000000004', NULL, 24, 'wrong id', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'reset rejects wrong Auth ID');

-- Review quarantine blocks reset writes and does not retry/release.
SELECT lives_ok($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('q', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'review-reset@phantoms-test.example'), 'review-reset@phantoms-test.example', 'reset', '10000000-0000-4000-8000-000000000006', NULL, 24, 'review', '10000000-0000-4000-8000-000000000001')$$, 'review reset issues');
SELECT lives_ok($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('q', 64), 'UTF8'), 'sha256'), 'hex'), 'review-reset@phantoms-test.example')$$, 'review reset reserves');
SELECT lives_ok($$SELECT public.member_password_mark_review_required((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'review-reset@phantoms-test.example'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'review-reset@phantoms-test.example'))$$, 'reservation enters review quarantine');
RESET ROLE;
SELECT throws_like($$UPDATE auth.users SET encrypted_password = 'must-not-write' WHERE id = '10000000-0000-4000-8000-000000000006'$$, '%REVIEW_REQUIRED%', 'review reset write is blocked');
SELECT is((SELECT encrypted_password FROM auth.users WHERE id = '10000000-0000-4000-8000-000000000006'), 'review-old-hash', 'review write leaves hash unchanged');

-- Expiry is a committed terminal transition with audit, then a fresh issue is
-- possible only after the old row is terminal (never by releasing a claim).
SELECT lives_ok($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('e', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'unconfirmed@phantoms-test.example'), 'unconfirmed@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000008', 'review', 24, 'expiry', '10000000-0000-4000-8000-000000000001')$$, 'expiry fixture issues');
UPDATE public.member_password_invitations SET expires_at = now() - interval '1 hour' WHERE normalized_email = 'unconfirmed@phantoms-test.example';
SELECT is((public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('e', 64), 'UTF8'), 'sha256'), 'hex'), 'unconfirmed@phantoms-test.example') ->> 'status'), 'expired', 'reserve returns structured EXPIRED result');
SELECT is((SELECT status FROM public.member_password_invitations WHERE normalized_email = 'unconfirmed@phantoms-test.example'), 'expired', 'expired state commits');
SELECT is((SELECT count(*)::int FROM public.member_password_audit WHERE member_id = (SELECT id FROM public.members WHERE email = 'unconfirmed@phantoms-test.example') AND action = 'expired'), 1, 'expiry writes audit');
SELECT lives_ok($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('f', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'unconfirmed@phantoms-test.example'), 'unconfirmed@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000008', 'review', 24, 'fresh after expiry', '10000000-0000-4000-8000-000000000001')$$, 'fresh issue is separate from expired terminal row');

-- Duplicate Auth email, duplicate member email, and admin identity all fail closed.
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('d', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'new-member@phantoms-test.example'), 'new-member@phantoms-test.example', 'enroll', NULL, NULL, 24, 'duplicate auth', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'duplicate Auth email fails issue gate');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('m', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'duplicate-auth@phantoms-test.example'), 'duplicate-auth@phantoms-test.example', 'enroll', NULL, NULL, 24, 'duplicate auth', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'duplicate case-insensitive Auth email fails issue gate');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('i', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'admin-identity@phantoms-test.example'), 'admin-identity@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-00000000000f', 'reviewed', 24, 'admin collision', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'admin identity cannot be adopted');

-- Disabled, banned, deleted, SSO, and providerless identities are denied.
UPDATE public.members SET work_status = 'disabled' WHERE email = 'banned@phantoms-test.example';
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('1', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'banned@phantoms-test.example'), 'banned@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000009', 'reviewed', 24, 'disabled', '10000000-0000-4000-8000-000000000001')$$, '%MEMBER_DISABLED%', 'disabled member is denied');
UPDATE public.members SET work_status = 'active' WHERE email = 'banned@phantoms-test.example';
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('2', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'banned@phantoms-test.example'), 'banned@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-000000000009', 'reviewed', 24, 'banned', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'banned Auth identity is denied');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('3', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'deleted@phantoms-test.example'), 'deleted@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-00000000000a', 'reviewed', 24, 'deleted', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'deleted Auth identity is denied');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('4', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'sso@phantoms-test.example'), 'sso@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-00000000000b', 'reviewed', 24, 'sso', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'SSO identity is denied');
SELECT throws_like($$SELECT public.member_password_issue_invitation(encode(extensions.digest(convert_to('phpw_' || repeat('5', 64), 'UTF8'), 'sha256'), 'hex'), (SELECT id FROM public.members WHERE email = 'no-provider@phantoms-test.example'), 'no-provider@phantoms-test.example', 'enroll', '10000000-0000-4000-8000-00000000000c', 'reviewed', 24, 'providerless', '10000000-0000-4000-8000-000000000001')$$, '%IDENTITY_CONFLICT%', 'providerless identity is denied');

-- Mapping snapshot mismatch is rejected by access, bind, and lookup.
SELECT phantoms_test.login_as('stale');
SELECT is(public.get_member_password_access(), NULL::jsonb, 'stale normalized mapping has no access');
SELECT throws_like($$SELECT public.bind_member_device_session('stale@phantoms-test.example', 'device-stale-0123456789abcdef')$$, '%MEMBER_PASSWORD_REQUIRED%', 'stale mapping cannot bind device');
SELECT is((SELECT count(*)::int FROM public.lookup_member_by_email('stale@phantoms-test.example', 'device-stale-0123456789abcdef')), 0, 'stale mapping cannot lookup profile');
RESET ROLE;
SELECT phantoms_test.as_service();

-- Malformed terminal states are rejected by the explicit lifecycle CHECK.
SELECT throws_ok($$INSERT INTO public.member_password_invitations(token_hash, member_id, normalized_email, purpose, expires_at, created_by, status) VALUES (repeat('9',64), (SELECT id FROM public.members WHERE email = 'old-otp@phantoms-test.example'), 'old-otp@phantoms-test.example', 'enroll', now() + interval '1 day', '10000000-0000-4000-8000-000000000001', 'revoked')$$, '23514', 'new row for relation "member_password_invitations" violates check constraint "member_password_invitations_lifecycle_check"', 'revoked requires revoked_at and clears claim fields');
SELECT throws_ok($$INSERT INTO public.member_password_invitations(token_hash, member_id, normalized_email, purpose, expires_at, created_by, status) VALUES (repeat('8',64), (SELECT id FROM public.members WHERE email = 'old-otp@phantoms-test.example'), 'old-otp@phantoms-test.example', 'enroll', now() + interval '1 day', '10000000-0000-4000-8000-000000000001', 'expired')$$, '23514', 'new row for relation "member_password_invitations" violates check constraint "member_password_invitations_lifecycle_check"', 'expired requires expired_at and clears claim fields');

-- Independent rate-limit keys do not share a global bucket.
SELECT ok(NOT public.member_password_check_rate_limit(encode(extensions.digest(convert_to('caller-a', 'UTF8'), 'sha256'), 'hex'), 1, 900, 900), 'caller A first limiter attempt is allowed');
SELECT ok(public.member_password_check_rate_limit(encode(extensions.digest(convert_to('caller-a', 'UTF8'), 'sha256'), 'hex'), 1, 900, 900), 'caller A exhausted key is blocked');
SELECT ok(NOT public.member_password_check_rate_limit(encode(extensions.digest(convert_to('caller-b', 'UTF8'), 'sha256'), 'hex'), 1, 900, 900), 'caller B has an independent limiter budget');

-- An unconfirmed OTP identity is confirmed only alongside its authorized first
-- password write; this verifies SQL transaction semantics, not GoTrue internals.
SELECT lives_ok($$SELECT public.member_password_reserve(encode(extensions.digest(convert_to('phpw_' || repeat('f', 64), 'UTF8'), 'sha256'), 'hex'), 'unconfirmed@phantoms-test.example')$$, 'unconfirmed exact existing identity reserves');
RESET ROLE;
SELECT throws_like($$UPDATE auth.users SET encrypted_password = 'unconfirmed-first-hash' WHERE id = '10000000-0000-4000-8000-000000000008'$$, '%IDENTITY_CONFLICT%', 'unconfirmed password-only write is rejected');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'unconfirmed-first-hash', email_confirmed_at = now() WHERE id = '10000000-0000-4000-8000-000000000008'$$, 'authorized first password and confirmation succeed in one SQL write');
SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_complete((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'unconfirmed@phantoms-test.example' AND status = 'reserved'), (SELECT claim_id FROM public.member_password_invitations WHERE normalized_email = 'unconfirmed@phantoms-test.example' AND status = 'reserved'), '10000000-0000-4000-8000-000000000008')$$, 'unconfirmed transition completes without a new identity');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM auth.users WHERE lower(email) = 'unconfirmed@phantoms-test.example'), 1, 'unconfirmed transition preserves one Auth identity');
SELECT is((SELECT auth_user_id FROM public.member_auth_bindings WHERE normalized_email = 'unconfirmed@phantoms-test.example'), '10000000-0000-4000-8000-000000000008'::uuid, 'unconfirmed transition preserves the original UUID');

-- Explicit revocation and disabled-after-issue fixtures cannot reserve.
RESET ROLE;
SELECT phantoms_test.create_member('revoked_raw', 'revoked-raw@phantoms-test.example');
SELECT phantoms_test.create_member('disabled_raw', 'disabled-raw@phantoms-test.example');
SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_issue_invitation(repeat('6',64), phantoms_test.mid('revoked_raw'), 'revoked-raw@phantoms-test.example', 'enroll', NULL, NULL, 24, '', phantoms_test.uid('owner'))$$, 'revocation fixture issues');
SELECT is(public.member_password_revoke_invitation((SELECT id FROM public.member_password_invitations WHERE normalized_email = 'revoked-raw@phantoms-test.example'), phantoms_test.uid('owner')), true, 'pending invitation can be revoked by authorized actor');
SELECT throws_like($$SELECT public.member_password_reserve(repeat('6',64), 'revoked-raw@phantoms-test.example')$$, '%REVOKED%', 'revoked invitation cannot reserve');
SELECT lives_ok($$SELECT public.member_password_issue_invitation(repeat('7',64), phantoms_test.mid('disabled_raw'), 'disabled-raw@phantoms-test.example', 'enroll', NULL, NULL, 24, '', phantoms_test.uid('owner'))$$, 'disabled-after-issue fixture issues while active');
UPDATE public.members SET work_status = 'disabled' WHERE id = phantoms_test.mid('disabled_raw');
SELECT throws_like($$SELECT public.member_password_reserve(repeat('7',64), 'disabled-raw@phantoms-test.example')$$, '%MEMBER_DISABLED%', 'disabled after issuance cannot reserve');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM auth.users WHERE email IN ('revoked-raw@phantoms-test.example', 'disabled-raw@phantoms-test.example')), 0, 'denied fixtures never get synthetic Auth identities');

-- Completed reset access is current-state gated; review quarantine denies access
-- even when an older mapped password remains present.
SELECT phantoms_test.login_as('review');
SELECT is(public.get_member_password_access(), NULL::jsonb, 'review quarantine denies a previously password-ready member');
RESET ROLE;
SELECT phantoms_test.login_as('reset');
SELECT is(public.get_member_password_access() ->> 'auth_user_id', phantoms_test.uid('reset')::text, 'completed reset exposes only exact member identity');
RESET ROLE;
UPDATE public.members SET work_status = 'disabled' WHERE email = 'reset@phantoms-test.example';
SELECT phantoms_test.login_as('reset');
SELECT is(public.get_member_password_access(), NULL::jsonb, 'disabled member loses access despite existing Auth password');
RESET ROLE;
UPDATE public.members SET work_status = 'active' WHERE email = 'reset@phantoms-test.example';
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = phantoms_test.uid('reset');
SELECT phantoms_test.login_as('reset');
SELECT is(public.get_member_password_access(), NULL::jsonb, 'unconfirmed current Auth state denies portal access');
RESET ROLE;
SELECT is((SELECT encrypted_password FROM auth.users WHERE id = phantoms_test.uid('owner')), 'owner-fixture-hash', 'all member enrollment and reset operations preserve Owner password');
SELECT is((SELECT encrypted_password FROM auth.users WHERE id = phantoms_test.uid('admin')), 'admin-fixture-hash', 'all member enrollment and reset operations preserve Admin password');

SELECT * FROM finish();
ROLLBACK;
