-- 21 — Native Auth member password recovery; every fixture is transaction-local.
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
GRANT SELECT, INSERT, UPDATE ON phantoms_test.vars TO service_role;

CREATE FUNCTION phantoms_test.with_recovery_amr()
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_claim JSONB := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
BEGIN
  v_claim := jsonb_set(v_claim, '{amr}', '[{"method":"recovery"}]'::jsonb, true);
  PERFORM set_config('request.jwt.claims', v_claim::text, true);
  PERFORM set_config('request.jwt.claim', v_claim::text, true);
END $$;
GRANT EXECUTE ON FUNCTION phantoms_test.with_recovery_amr() TO authenticated, service_role;

SELECT phantoms_test.create_user('recovery_admin');
SELECT phantoms_test.grant_admin('recovery_admin', 'admin', phantoms_test.perms('members'));
SELECT phantoms_test.create_member('recovery_member', 'member@recovery-fixture.phantoms.dev', true);
SELECT phantoms_test.create_member('synthetic_member', 'synthetic@phantoms.app', true);

SELECT phantoms_test.as_service();
SELECT ok(NOT has_table_privilege('anon', 'public.member_password_recovery_sessions', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.member_password_recovery_sessions', 'SELECT')
          AND NOT has_table_privilege('service_role', 'public.member_password_recovery_sessions', 'SELECT'),
          'recovery session redemption table has no exposed table grants');
SELECT ok(has_function_privilege('authenticated', 'public.member_password_self_recovery_access()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.member_password_self_recovery_access()', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.member_password_self_recovery_access()', 'EXECUTE'),
          'callback proof is authenticated-only and boolean-only');
SELECT ok(has_function_privilege('authenticated', 'public.member_password_prepare_self_recovery(text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.member_password_prepare_self_recovery(text)', 'EXECUTE'),
          'prepare RPC is authenticated-only');
SELECT ok(NOT public.member_password_recovery_eligible('unknown@real.example'),
          'unknown address is ineligible without exposing identity');
SELECT ok(NOT public.member_password_recovery_eligible('synthetic@phantoms.app'),
          'synthetic phantoms.app address is never eligible');
SELECT ok(public.member_password_recovery_eligible('member@recovery-fixture.phantoms.dev'),
          'exact active member binding with confirmed email password is eligible');

-- A valid live Auth session with no recovery method is not enough.
RESET ROLE;
SELECT phantoms_test.login_as('recovery_member');
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(auth.role(), 'authenticated', 'member proof fixture uses authenticated JWT role, not prior service GUC');
SELECT is(public.member_password_self_recovery_access(), false,
          'ordinary password session cannot pass recovery access proof');
SELECT phantoms_test.with_recovery_amr();
SELECT is(public.member_password_self_recovery_access(), false,
          'JWT recovery AMR without the DB marker cannot pass proof');

-- Add the native server-side recovery AMR marker for this exact live session.
RESET ROLE;
INSERT INTO auth.mfa_amr_claims(id, session_id, authentication_method, created_at, updated_at)
VALUES (extensions.gen_random_uuid(), (current_setting('request.jwt.claim.session_id'))::uuid, 'recovery', now(), now());
SELECT set_config('role', 'authenticated', true);
SELECT is(public.member_password_self_recovery_access(), true,
          'matching recent JWT AMR and auth.mfa_amr_claims marker pass proof');

-- The proof is tied to the exact member/Auth email identity.
RESET ROLE;
UPDATE auth.users
SET email = 'member-drift@recovery-fixture.phantoms.dev'
WHERE id = phantoms_test.uid('recovery_member');
SELECT set_config('role', 'authenticated', true);
SELECT is(public.member_password_self_recovery_access(), false,
          'Auth email drift blocks recovery proof without client-selected identity');
RESET ROLE;
UPDATE auth.users
SET email = 'member@recovery-fixture.phantoms.dev'
WHERE id = phantoms_test.uid('recovery_member');
SELECT set_config('role', 'authenticated', true);

-- Re-establish the exact proof after restoring the identity.
SELECT is(public.member_password_self_recovery_access(), true,
          'restored exact identity passes recovery proof again');

-- The authenticated prepare RPC derives member/Auth/email from its proof and
-- stores only a hash; it creates a short-lived reset invitation atomically.
SELECT lives_ok($$SELECT public.member_password_prepare_self_recovery(
  encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex')
)$$, 'proof-backed recovery prepares an invitation');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE normalized_email = 'member@recovery-fixture.phantoms.dev' AND purpose = 'reset'), 1,
          'one exact reset invitation is created');
SELECT ok((SELECT expected_auth_user_id = phantoms_test.uid('recovery_member')
                  AND member_id = phantoms_test.mid('recovery_member')
                  AND status = 'pending'
                  AND expires_at <= clock_timestamp() + interval '15 minutes'
                  AND expires_at > clock_timestamp() + interval '14 minutes'
           FROM public.member_password_invitations
           WHERE normalized_email = 'member@recovery-fixture.phantoms.dev' AND purpose = 'reset'),
          'reset invitation is exact, pending, and expires in fifteen minutes');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE token_hash = 'phpw_' || repeat('r', 64)), 0,
          'raw recovery token is never stored');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.member_password_audit
                      WHERE invitation_id = (SELECT id FROM public.member_password_invitations
                                             WHERE normalized_email = 'member@recovery-fixture.phantoms.dev' AND purpose = 'reset')
                        AND details::text LIKE '%phpw_%'),
          'recovery audit details do not expose token material');
SELECT is((SELECT count(*)::int FROM public.member_password_recovery_sessions
           WHERE session_id = (current_setting('request.jwt.claim.session_id'))::uuid), 1,
          'the exact recovery session is durably bound to the invitation');
SET LOCAL ROLE authenticated;
SELECT is(public.member_password_self_recovery_access(), false,
          'the same recovery session cannot prepare or display a second reset');

-- Existing nonexpired manual work is not overridden or released.
RESET ROLE;
SELECT phantoms_test.as_service();
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('m', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('recovery_member'), 'member@recovery-fixture.phantoms.dev', 'reset',
  phantoms_test.uid('recovery_member'), NULL, 24, 'manual reset', phantoms_test.uid('recovery_admin')
)$$, '%REVIEW_REQUIRED%',
  'a second reset cannot override the existing recovery invitation');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE token_hash = encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex')),
          'pending', 'the existing recovery invitation remains pending');

-- Admin identities are denied even if a matching session/JWT marker exists.
RESET ROLE;
SELECT phantoms_test.login_as('recovery_admin');
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT is(auth.role(), 'authenticated', 'admin denial fixture uses authenticated JWT role');
SELECT phantoms_test.with_recovery_amr();
RESET ROLE;
INSERT INTO auth.mfa_amr_claims(id, session_id, authentication_method, created_at, updated_at)
VALUES (extensions.gen_random_uuid(), (current_setting('request.jwt.claim.session_id'))::uuid, 'recovery', now(), now());
SELECT set_config('role', 'authenticated', true);
SELECT is(public.member_password_self_recovery_access(), false,
          'admin recovery session never receives member recovery access');
SELECT throws_like($$SELECT public.member_password_prepare_self_recovery(
  encode(extensions.digest(convert_to('phpw_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex')
)$$, '%UNAUTHORIZED%', 'admin cannot prepare a member reset invitation');

SELECT * FROM finish();
ROLLBACK;
