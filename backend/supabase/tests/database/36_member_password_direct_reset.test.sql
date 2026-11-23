-- 36 — Administrator direct reset and member self-service password change.
-- Both paths reuse the Auth write guard: a short-lived `reserved` reset claim is
-- minted for the member's exact identity, the password write is accepted only
-- through that claim, and the claim is then completed. A temporary password set
-- by an administrator is flagged so the portal can demand a personal one.
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
GRANT SELECT ON phantoms_test.users, phantoms_test.members TO service_role;

SELECT phantoms_test.create_user('reset-admin');
SELECT phantoms_test.grant_admin('reset-admin', 'admin', phantoms_test.perms('members'));
SELECT phantoms_test.create_member('reset_member', 'reset-member@phantoms-test.example', true);
SELECT phantoms_test.create_member('reset_disabled', 'reset-disabled@phantoms-test.example', true);
UPDATE public.members SET work_status = 'inactive' WHERE email = 'reset-disabled@phantoms-test.example';
SELECT phantoms_test.bind_device('reset_member');

-- A direct reset is service-role only.
SELECT phantoms_test.login_as('reset-admin');
SELECT throws_ok(
  format($$SELECT public.member_password_begin_direct_reset(%s, %L, 'admin_reset')$$,
         phantoms_test.mid('reset_member'), phantoms_test.uid('reset-admin')),
  '42501', NULL, 'an authenticated session cannot open a direct reset claim');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- The administrator path opens a reserved claim bound to the exact identity.
SELECT phantoms_test.as_service();
SELECT lives_ok(
  format($$INSERT INTO phantoms_test.vars(key, value)
           SELECT 'admin_claim', public.member_password_begin_direct_reset(%s, %L, 'admin_reset')::text$$,
         phantoms_test.mid('reset_member'), phantoms_test.uid('reset-admin')),
  'an administrator opens a direct reset claim');
SELECT is((SELECT value::jsonb ->> 'auth_user_id' FROM phantoms_test.vars WHERE key = 'admin_claim'),
          phantoms_test.uid('reset_member')::text,
          'the claim is bound to the member''s existing Auth identity');
SELECT is((SELECT value::jsonb ->> 'email' FROM phantoms_test.vars WHERE key = 'admin_claim'),
          'reset-member@phantoms-test.example', 'the claim carries the normalized member email');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE id = ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'invitation_id')::uuid),
          'reserved', 'the direct reset invitation is reserved, not a reusable link');
SELECT is((SELECT expected_auth_user_id FROM public.member_password_invitations
           WHERE id = ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'invitation_id')::uuid),
          phantoms_test.uid('reset_member'),
          'the guard can match the claim to the identity it will write');
SELECT is((SELECT must_change_password FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('reset_member')),
          true, 'an administrator-set password is flagged for change');
SELECT throws_ok(
  format($$SELECT public.member_password_begin_direct_reset(%s, %L, 'admin_reset')$$,
         phantoms_test.mid('reset_disabled'), phantoms_test.uid('reset-admin')),
  'MEMBER_DISABLED', 'an inactive membership cannot receive a password');

-- The guarded Auth write only succeeds through the reserved claim.
RESET ROLE;
SELECT lives_ok(
  format($$UPDATE auth.users SET encrypted_password = 'temporary-fixture-hash', updated_at = now() WHERE id = %L$$,
         phantoms_test.uid('reset_member')),
  'the guarded Auth write accepts the prepared claim');
SELECT is((SELECT auth_write_user_id FROM public.member_password_invitations
           WHERE id = ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'invitation_id')::uuid),
          phantoms_test.uid('reset_member'), 'the Auth write is recorded against the claim');

SELECT phantoms_test.as_service();
SELECT is((public.member_password_complete(
            ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'invitation_id')::uuid,
            ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'claim_id')::uuid,
            phantoms_test.uid('reset_member')) ->> 'ok'), 'true',
          'the direct reset claim completes');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE id = ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'admin_claim') ->> 'invitation_id')::uuid),
          'complete', 'the direct reset invitation reaches a terminal state');
SELECT is((SELECT must_change_password FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('reset_member')),
          true, 'the temporary password still requires a change after completion');

-- A password write with no prepared claim is still refused.
RESET ROLE;
SELECT throws_ok(
  format($$UPDATE auth.users SET encrypted_password = 'unclaimed-hash', updated_at = now() WHERE id = %L$$,
         phantoms_test.uid('reset_member')),
  'REVIEW_REQUIRED', 'an unprepared Auth password write stays blocked');

-- The portal sees the flag through the member access projection.
SELECT phantoms_test.login_as('reset_member');
SELECT is((public.get_member_password_access() ->> 'must_change_password'), 'true',
          'the member access projection reports the temporary password');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- The member's own change: self-scoped claim, personal password, flag cleared.
SELECT phantoms_test.as_service();
SELECT throws_ok(
  format($$SELECT public.member_password_begin_direct_reset(%s, %L, 'self_change')$$,
         phantoms_test.mid('reset_member'), phantoms_test.uid('reset-admin')),
  'UNAUTHORIZED', 'a self change cannot target another identity');
SELECT lives_ok(
  format($$INSERT INTO phantoms_test.vars(key, value)
           SELECT 'self_claim', public.member_password_begin_direct_reset(%s, %L, 'self_change')::text$$,
         phantoms_test.mid('reset_member'), phantoms_test.uid('reset_member')),
  'a member opens a claim for their own identity');
SELECT is((SELECT must_change_password FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('reset_member')),
          true, 'a self change does not clear the flag before the write');
RESET ROLE;
SELECT lives_ok(
  format($$UPDATE auth.users SET encrypted_password = 'personal-fixture-hash', updated_at = now() WHERE id = %L$$,
         phantoms_test.uid('reset_member')),
  'the guarded Auth write accepts the member''s own claim');
SELECT phantoms_test.as_service();
SELECT is((public.member_password_complete(
            ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'self_claim') ->> 'invitation_id')::uuid,
            ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'self_claim') ->> 'claim_id')::uuid,
            phantoms_test.uid('reset_member')) ->> 'ok'), 'true',
          'the member''s own claim completes');
SELECT is(public.member_password_clear_must_change(phantoms_test.uid('reset_member')), true,
          'clearing the temporary-password flag reports a change');
SELECT is((SELECT must_change_password FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('reset_member')),
          false, 'the member now has a personal password');
RESET ROLE;
SELECT phantoms_test.login_as('reset_member');
SELECT is((public.get_member_password_access() ->> 'must_change_password'), 'false',
          'the access projection reflects the cleared flag');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Abandoning an explicit Auth failure must not leave the member locked out.
SELECT phantoms_test.as_service();
SELECT lives_ok(
  format($$INSERT INTO phantoms_test.vars(key, value)
           SELECT 'abandon_claim', public.member_password_begin_direct_reset(%s, %L, 'admin_reset')::text$$,
         phantoms_test.mid('reset_member'), phantoms_test.uid('reset-admin')),
  'a second direct reset claim can be opened');
SELECT is((public.member_password_abandon_direct_reset(
            ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'abandon_claim') ->> 'invitation_id')::uuid,
            phantoms_test.uid('reset-admin')) ->> 'status'), 'revoked',
          'an abandoned claim is revoked');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE id = ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'abandon_claim') ->> 'invitation_id')::uuid),
          'revoked', 'the abandoned invitation no longer blocks sign-in');
RESET ROLE;
SELECT phantoms_test.login_as('reset_member');
SELECT ok(public.get_member_password_access() IS NOT NULL,
          'a member with no pending claim keeps a working access projection');
RESET ROLE;

SELECT finish();
ROLLBACK;
