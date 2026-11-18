-- 09 — Member-password operator inventory and reconciliation classifications.
-- This suite uses disposable RFC-2606 Auth/member fixtures and rolls back.
-- It supplements, and does not replace, suite 08 or the prior 383 assertions.
-- It does not exercise GoTrue; real Auth integration remains a separate gate.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

-- Duplicate case-insensitive Auth email rows are intentional here. The
-- fixture-only uniqueness index is never changed outside this rolled-back test.
DROP INDEX IF EXISTS auth.auth_fixture_email_unique;

DO $$
BEGIN
  INSERT INTO public.members (email, full_name, completion_rank, work_status) VALUES
    ('op-bound@phantoms-test.example', 'Operator Bound', 0, 'active'),
    ('op-unconfirmed@phantoms-test.example', 'Operator Unconfirmed', 0, 'active'),
    ('op-passwordless@phantoms-test.example', 'Operator Passwordless', 0, 'active'),
    ('op-noauth@phantoms-test.example', 'Operator No Auth', 0, 'active'),
    ('op-disabled@phantoms-test.example', 'Operator Disabled', 0, 'disabled'),
    ('op-admin-overlap@phantoms-test.example', 'Operator Admin Overlap', 0, 'active'),
    ('op-duplicate@phantoms-test.example', 'Operator Duplicate', 0, 'active'),
    ('op-marker-missing@phantoms-test.example', 'Operator Marker Missing', 0, 'active'),
    ('op-marker-wrong@phantoms-test.example', 'Operator Marker Wrong', 0, 'active'),
    ('op-auth-missing@phantoms-test.example', 'Operator Auth Missing', 0, 'active'),
    ('op-complete@phantoms-test.example', 'Operator Complete', 0, 'active'),
    ('op-review@phantoms-test.example', 'Operator Review', 0, 'active');

  INSERT INTO phantoms_test.members(name, id, email, token)
  SELECT replace(lower(email), '@phantoms-test.example', ''), id, email,
         'operator-device-0123456789abcdef'
  FROM public.members
  WHERE email LIKE 'op-%@phantoms-test.example';

  INSERT INTO auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, banned_until, deleted_at, is_sso_user
  ) VALUES
    ('20000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-bound@phantoms-test.example', 'fixture-bound-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-unconfirmed@phantoms-test.example', NULL, NULL, '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-passwordless@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-unassociated@phantoms-test.example', 'fixture-unassociated-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-admin-overlap@phantoms-test.example', 'fixture-admin-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-duplicate@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'OP-DUPLICATE@phantoms-test.example', NULL, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-wrong-marker@phantoms-test.example', 'fixture-wrong-marker-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-complete@phantoms-test.example', 'fixture-complete-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false),
    ('20000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op-disabled@phantoms-test.example', 'fixture-disabled-hash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), NULL, NULL, false);

  INSERT INTO phantoms_test.users(name, id, email) VALUES
    ('bound', '20000000-0000-4000-8000-000000000001', 'op-bound@phantoms-test.example'),
    ('unconfirmed', '20000000-0000-4000-8000-000000000002', 'op-unconfirmed@phantoms-test.example'),
    ('passwordless', '20000000-0000-4000-8000-000000000003', 'op-passwordless@phantoms-test.example'),
    ('unassociated', '20000000-0000-4000-8000-000000000004', 'op-unassociated@phantoms-test.example'),
    ('admin_overlap', '20000000-0000-4000-8000-000000000005', 'op-admin-overlap@phantoms-test.example'),
    ('duplicate_one', '20000000-0000-4000-8000-000000000006', 'op-duplicate@phantoms-test.example'),
    ('duplicate_two', '20000000-0000-4000-8000-000000000007', 'OP-DUPLICATE@phantoms-test.example'),
    ('wrong_marker', '20000000-0000-4000-8000-000000000008', 'op-wrong-marker@phantoms-test.example'),
    ('complete', '20000000-0000-4000-8000-000000000009', 'op-complete@phantoms-test.example'),
    ('disabled', '20000000-0000-4000-8000-00000000000a', 'op-disabled@phantoms-test.example');

  INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
  SELECT m.id, x.auth_id, lower(m.email), x.ready
  FROM public.members AS m
  JOIN (VALUES
    ('op-bound@phantoms-test.example', '20000000-0000-4000-8000-000000000001'::uuid, true),
    ('op-unconfirmed@phantoms-test.example', '20000000-0000-4000-8000-000000000002'::uuid, false),
    ('op-passwordless@phantoms-test.example', '20000000-0000-4000-8000-000000000003'::uuid, false),
    ('op-disabled@phantoms-test.example', '20000000-0000-4000-8000-00000000000a'::uuid, true),
    ('op-admin-overlap@phantoms-test.example', '20000000-0000-4000-8000-000000000005'::uuid, true),
    ('op-complete@phantoms-test.example', '20000000-0000-4000-8000-000000000009'::uuid, true)
  ) AS x(email, auth_id, ready) ON x.email = m.email;

  INSERT INTO public.admin_accounts(user_id, role, permissions)
  VALUES ('20000000-0000-4000-8000-000000000005', 'admin', phantoms_test.perms('members'));

  -- Reserved without marker: Auth outcome is not inferred.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, claim_id, claimed_at, status
  ) SELECT repeat('1', 64), id, lower(email), 'enroll', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000001', now(), 'reserved'
    FROM public.members WHERE email = 'op-marker-missing@phantoms-test.example';

  -- Reserved with a marker that is present and valid against the exact Auth row.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, expected_auth_user_id, claim_id, claimed_at,
    auth_write_completed_at, auth_write_user_id, status
  ) SELECT repeat('2', 64), id, lower(email), 'reset', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '20000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000002', now(), now(),
           '20000000-0000-4000-8000-000000000001', 'reserved'
    FROM public.members WHERE email = 'op-bound@phantoms-test.example';

  -- Present marker points to an existing Auth row with the wrong email.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, claim_id, claimed_at, auth_write_completed_at,
    auth_write_user_id, status
  ) SELECT repeat('3', 64), id, lower(email), 'enroll', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000003', now(), now(),
           '20000000-0000-4000-8000-000000000008', 'reserved'
    FROM public.members WHERE email = 'op-marker-wrong@phantoms-test.example';

  -- Present marker points to no Auth row. auth_write_user_id is intentionally
  -- not an FK because the trigger records it before GoTrue exposes the row.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, claim_id, claimed_at, auth_write_completed_at,
    auth_write_user_id, status
  ) SELECT repeat('4', 64), id, lower(email), 'enroll', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000004', now(), now(),
           '20000000-0000-4000-8000-0000000000aa', 'reserved'
    FROM public.members WHERE email = 'op-auth-missing@phantoms-test.example';

  -- Complete terminal state with verified marker and exact binding.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, expected_auth_user_id, claim_id, claimed_at,
    auth_user_id, auth_write_completed_at, auth_write_user_id,
    completed_at, used_at, status
  ) SELECT repeat('5', 64), id, lower(email), 'enroll', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '20000000-0000-4000-8000-000000000009',
           '30000000-0000-4000-8000-000000000005', now(),
           '20000000-0000-4000-8000-000000000009', now(),
           '20000000-0000-4000-8000-000000000009', now(), now(), 'complete'
    FROM public.members WHERE email = 'op-complete@phantoms-test.example';

  -- Review quarantine remains denied even if a marker is absent.
  INSERT INTO public.member_password_invitations(
    token_hash, member_id, normalized_email, purpose, expires_at,
    created_by, claim_id, claimed_at, review_required_at, status
  ) SELECT repeat('6', 64), id, lower(email), 'reset', now() + interval '1 day',
           '20000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000006', now(), now(), 'review_required'
    FROM public.members WHERE email = 'op-review@phantoms-test.example';
END $$;

-- Member classifications: exact binding, password state, disabled state,
-- overlap exclusion, email-only candidate ambiguity, and active quarantine.
SELECT ok((SELECT count(*) = 1
           FROM public.member_auth_bindings b
           JOIN public.members m ON m.id = b.member_id
           JOIN auth.users u ON u.id = b.auth_user_id
           WHERE m.email = 'op-bound@phantoms-test.example'
             AND b.auth_user_id = '20000000-0000-4000-8000-000000000001'
             AND coalesce(u.encrypted_password, '') <> ''),
          'member with Auth has exact UUID binding and password boolean true');
SELECT ok((SELECT count(*) = 1
           FROM public.members m
           WHERE m.email = 'op-noauth@phantoms-test.example'
             AND NOT EXISTS (SELECT 1 FROM public.member_auth_bindings b WHERE b.member_id = m.id)),
          'member without Auth binding is classified without inferring ownership from email');
SELECT ok((SELECT u.email_confirmed_at IS NULL AND coalesce(u.encrypted_password, '') = ''
           FROM public.member_auth_bindings b JOIN auth.users u ON u.id = b.auth_user_id
           JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'op-unconfirmed@phantoms-test.example'),
          'unconfirmed bound identity exposes only boolean state');
SELECT ok((SELECT u.email_confirmed_at IS NOT NULL AND coalesce(u.encrypted_password, '') = ''
           FROM public.member_auth_bindings b JOIN auth.users u ON u.id = b.auth_user_id
           JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'op-passwordless@phantoms-test.example'),
          'confirmed passwordless bound identity is classified');
SELECT ok((SELECT coalesce(u.encrypted_password, '') <> ''
           FROM public.member_auth_bindings b JOIN auth.users u ON u.id = b.auth_user_id
           JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'op-bound@phantoms-test.example'),
          'passworded identity is classified without exposing the password hash');
SELECT ok((SELECT m.work_status IS DISTINCT FROM 'active'
           FROM public.members m WHERE m.email = 'op-disabled@phantoms-test.example'),
          'disabled member is classified independently of Auth password state');
SELECT ok((SELECT EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id = b.auth_user_id)
           FROM public.member_auth_bindings b JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'op-admin-overlap@phantoms-test.example'),
          'Admin/Member overlap is visible and excluded, not relaxed');
SELECT is((SELECT count(*)::int FROM auth.users WHERE lower(email) = 'op-duplicate@phantoms-test.example'), 2,
          'duplicate normalized Auth email remains an ambiguity');
SELECT ok((SELECT count(*) > 0
           FROM public.member_password_invitations i JOIN public.members m ON m.id = i.member_id
           WHERE m.email = 'op-marker-missing@phantoms-test.example' AND i.status = 'reserved'
             AND i.auth_write_completed_at IS NULL AND i.auth_write_user_id IS NULL),
          'reserved marker-missing operation is visible and not treated as complete');
SELECT ok((SELECT count(*) > 0
           FROM public.member_password_invitations i JOIN public.members m ON m.id = i.member_id
           WHERE m.email = 'op-review@phantoms-test.example' AND i.status = 'review_required'),
          'review_required operation is classified as quarantine');

-- Auth-centric classifications: unassociated, duplicate, and overlap.
SELECT ok((SELECT NOT EXISTS (SELECT 1 FROM public.member_auth_bindings b WHERE b.auth_user_id = u.id)
           FROM auth.users u WHERE u.id = '20000000-0000-4000-8000-000000000004'),
          'Auth identity without exact binding is unassociated');
SELECT ok((SELECT count(*) = 2 FROM auth.users WHERE lower(email) = 'op-duplicate@phantoms-test.example'),
          'duplicate Auth identities are counted case-insensitively');
SELECT ok((SELECT EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id = b.auth_user_id)
           FROM public.member_auth_bindings b
           WHERE b.auth_user_id = '20000000-0000-4000-8000-000000000005'),
          'Auth identity with Admin and Member rows is overlap-excluded');

-- Marker reconciliation classifications. These are read-only SELECTs over
-- exact IDs and current boolean Auth state; no completion/release/retry is
-- attempted by the suite.
SELECT ok((SELECT i.auth_write_completed_at IS NULL AND i.auth_write_user_id IS NULL
           FROM public.member_password_invitations i JOIN public.members m ON m.id = i.member_id
           WHERE m.email = 'op-marker-missing@phantoms-test.example'),
          'reconciliation distinguishes marker missing');
SELECT ok((SELECT i.auth_write_completed_at IS NOT NULL
                  AND u.id IS NOT NULL
                  AND lower(u.email) <> i.normalized_email
           FROM public.member_password_invitations i
           JOIN public.members m ON m.id = i.member_id
           LEFT JOIN auth.users u ON u.id = i.auth_write_user_id
           WHERE m.email = 'op-marker-wrong@phantoms-test.example'),
          'reconciliation distinguishes marker wrong');
SELECT ok((SELECT i.auth_write_completed_at IS NOT NULL
                  AND u.id = i.auth_write_user_id
                  AND lower(u.email) = i.normalized_email
                  AND coalesce(u.encrypted_password, '') <> ''
                  AND u.email_confirmed_at IS NOT NULL
           FROM public.member_password_invitations i
           JOIN public.members m ON m.id = i.member_id
           JOIN auth.users u ON u.id = i.auth_write_user_id
           WHERE m.email = 'op-bound@phantoms-test.example'),
          'reconciliation distinguishes verified marker');
SELECT ok((SELECT i.auth_write_completed_at IS NOT NULL AND u.id IS NULL
           FROM public.member_password_invitations i
           JOIN public.members m ON m.id = i.member_id
           LEFT JOIN auth.users u ON u.id = i.auth_write_user_id
           WHERE m.email = 'op-auth-missing@phantoms-test.example'),
          'reconciliation distinguishes Auth missing after a marker');
SELECT ok((SELECT i.status = 'complete' AND i.auth_user_id = i.auth_write_user_id
           FROM public.member_password_invitations i JOIN public.members m ON m.id = i.member_id
           WHERE m.email = 'op-complete@phantoms-test.example'),
          'complete terminal invitation retains exact Auth UUID marker');
SELECT ok((SELECT i.status = 'review_required' AND i.completed_at IS NULL
           FROM public.member_password_invitations i JOIN public.members m ON m.id = i.member_id
           WHERE m.email = 'op-review@phantoms-test.example'),
          'quarantined invitation is not complete');

-- The raw secret-bearing columns remain in the database for service logic,
-- but a redacted operator projection contains only exact IDs and booleans.
SELECT ok((SELECT NOT (payload ?| ARRAY[
                         'encrypted_password', 'token_hash', 'details',
                         'raw_app_meta_data', 'raw_user_meta_data'
                       ])
           FROM (
             SELECT jsonb_build_object(
               'auth_user_id', u.id,
               'email_confirmed', u.email_confirmed_at IS NOT NULL,
               'has_password', coalesce(u.encrypted_password, '') <> ''
             ) AS payload
             FROM auth.users AS u
             WHERE u.id = '20000000-0000-4000-8000-000000000001'
             LIMIT 1
           ) AS redacted),
          'operator projection contains no password, token, raw metadata, or audit-detail key');

SELECT * FROM finish();
ROLLBACK;
