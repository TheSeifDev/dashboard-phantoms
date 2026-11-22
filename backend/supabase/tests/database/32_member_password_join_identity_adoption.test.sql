-- 31 — Self-service join adopts a stranded sign-in identity.
-- A stranded identity is an Auth user with no member_auth_bindings row, no
-- members row, and no admin account. It cannot read or write member data, so the
-- join link may adopt it instead of returning a permanent IDENTITY_CONFLICT.
-- Bound, admin, and already-registered addresses must still conflict.
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

SELECT phantoms_test.create_user('adopt-admin');
SELECT phantoms_test.grant_admin('adopt-admin', 'admin', phantoms_test.perms('members'));
SELECT phantoms_test.create_user('adopt-stranded');
SELECT phantoms_test.create_member('adoption_bound', 'adopt-bound@phantoms-test.example', true);

-- The stranded identity is classified as adoptable; bound and admin ones are not.
SELECT phantoms_test.as_service();
SELECT is((public.member_password_stranded_identity('adopt-stranded@phantoms-test.example') ->> 'adoptable'),
          'true', 'a sign-in identity without membership is adoptable');
SELECT is((public.member_password_stranded_identity('adopt-stranded@phantoms-test.example') ->> 'auth_user_id'),
          phantoms_test.uid('adopt-stranded')::text, 'the classification returns the existing Auth UUID');
SELECT is((public.member_password_stranded_identity('adopt-bound@phantoms-test.example') ->> 'adoptable'),
          'false', 'an address owned by a member is never adoptable');
SELECT is((public.member_password_stranded_identity('adopt-admin@phantoms-test.example') ->> 'adoptable'),
          'false', 'an administrator identity is never adoptable');

SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('s', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL, NULL, 'join', NULL, NULL, 24, 'adoption join', phantoms_test.uid('adopt-admin'))$$,
  'an Admin issues one unbound join link');
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('t', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL, NULL, 'join', NULL, NULL, 24, 'adoption bound join', phantoms_test.uid('adopt-admin'))$$,
  'a second unbound join link is issued for the bound address');

SELECT lives_ok($$INSERT INTO phantoms_test.vars(key, value)
SELECT 'adoption_claim', public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('s', 64), 'UTF8'), 'sha256'), 'hex'),
  '  ADOPT-STRANDED@PHANTOMS-TEST.EXAMPLE  ')::text$$,
  'the join link reserves the address instead of failing');
SELECT is((SELECT value::jsonb ->> 'adopt_auth_user_id' FROM phantoms_test.vars WHERE key = 'adoption_claim'),
          phantoms_test.uid('adopt-stranded')::text,
          'the reservation reports the stranded identity for adoption');
SELECT ok((SELECT value::jsonb ->> 'expected_auth_user_id' FROM phantoms_test.vars WHERE key = 'adoption_claim') IS NULL,
          'adoption never fabricates an invitation-bound Auth id');
SELECT is((SELECT value::jsonb ->> 'email' FROM phantoms_test.vars WHERE key = 'adoption_claim'),
          'adopt-stranded@phantoms-test.example', 'the recipient email is normalized and bound to the link');
SELECT is((SELECT status FROM public.member_password_invitations WHERE note = 'adoption join'),
          'reserved', 'the join link is reserved for the adopted identity');

SELECT is((public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('t', 64), 'UTF8'), 'sha256'), 'hex'),
  'adopt-bound@phantoms-test.example') ->> 'status'), 'identity_conflict',
  'an address that already belongs to a member is never adopted');
SELECT is((SELECT status FROM public.member_password_invitations WHERE note = 'adoption bound join'),
          'pending', 'the rejected address leaves the join link pending for another recipient');

-- The Auth password write is accepted only through the reserved join claim.
RESET ROLE;
SELECT lives_ok($$UPDATE auth.users
SET encrypted_password = 'adopted-fixture-hash', updated_at = now()
WHERE id = phantoms_test.uid('adopt-stranded')$$,
  'the guarded Auth write accepts the adoption update');
SELECT is((SELECT auth_write_user_id FROM public.member_password_invitations WHERE note = 'adoption join'),
          phantoms_test.uid('adopt-stranded'), 'the Auth write is recorded against the join claim');

SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE note = 'adoption join'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'adoption_claim') ->> 'claim_id')::uuid,
  phantoms_test.uid('adopt-stranded'),
  '{"fullName":"Adopted Stranded Member","phone":"+201112223344","residence":"Alexandria","workConditions":"Remote","bio":"Adopted identity","device":"هاتف محمول","gender":"أنثى","academicNumber":"445566","academicGroup":"ADOPT-1","specialization":"software","linkedinUrl":"https://www.linkedin.com/in/adopted-stranded","portfolioUrl":"https://github.com/adopted-stranded"}'::jsonb)$$,
  'profile completion binds the adopted identity to a new membership');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'adopt-stranded@phantoms-test.example'), 1,
          'adoption creates exactly one member for the address');
SELECT is((SELECT work_status FROM public.members WHERE email = 'adopt-stranded@phantoms-test.example'), 'inactive',
          'the adopted membership stays inactive pending Admin review');
SELECT is((SELECT b.auth_user_id FROM public.member_auth_bindings AS b
           JOIN public.members AS m ON m.id = b.member_id
           WHERE m.email = 'adopt-stranded@phantoms-test.example'),
          phantoms_test.uid('adopt-stranded'),
          'the adopted identity keeps its original Auth UUID');
SELECT is((SELECT status FROM public.member_password_invitations WHERE note = 'adoption join'), 'complete',
          'the adopted join link reaches a terminal completed state');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'adopt-bound@phantoms-test.example'), 1,
          'a conflicting address still has exactly one member');

RESET ROLE;
SELECT finish();
ROLLBACK;
