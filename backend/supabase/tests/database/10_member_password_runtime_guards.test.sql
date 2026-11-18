-- Additional runtime guard regressions. Synthetic Auth rows; rollback-only.
BEGIN;
\ir _helpers.psql
GRANT INSERT ON phantoms_test.vars TO service_role;
SELECT plan(8);
SELECT phantoms_test.create_user('runtime-operator');
SELECT phantoms_test.grant_admin('runtime-operator', 'owner');
SELECT phantoms_test.create_member('runtime-expired');
SELECT phantoms_test.create_user('runtime-expired');
SELECT set_config('request.jwt.claim', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO phantoms_test.vars(key, value)
SELECT 'runtime-invitation', (public.member_password_issue_invitation(
  repeat('e',64), phantoms_test.mid('runtime-expired'), 'runtime-expired@phantoms-test.example',
  'enroll', phantoms_test.uid('runtime-expired'), 'disposable reviewed UUID', 24, '', phantoms_test.uid('runtime-operator')
)->>'id');
INSERT INTO phantoms_test.vars(key, value)
SELECT 'runtime-claim', public.member_password_reserve(repeat('e',64), 'runtime-expired@phantoms-test.example')->>'claim_id';
RESET ROLE;
SELECT phantoms_test.clear_auth();
UPDATE public.member_password_invitations SET expires_at = clock_timestamp() - interval '1 second'
WHERE id = phantoms_test.var('runtime-invitation')::uuid;
SELECT throws_ok(
  $$UPDATE auth.users SET encrypted_password = 'synthetic-expired-write' WHERE id = phantoms_test.uid('runtime-expired')$$,
  'P0001', 'REVIEW_REQUIRED', 'expired reservation blocks the actual password trigger');
SELECT is((SELECT count(*)::integer FROM public.member_password_invitations WHERE id = phantoms_test.var('runtime-invitation')::uuid AND auth_write_completed_at IS NOT NULL), 0, 'expired reservation has no authorized-write marker');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.member_password_complete(phantoms_test.var('runtime-invitation')::uuid, phantoms_test.var('runtime-claim')::uuid, phantoms_test.uid('runtime-expired'))$$,
  'P0001', 'REVIEW_REQUIRED', 'expired reservation cannot be completed');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT status FROM public.member_password_invitations WHERE id = phantoms_test.var('runtime-invitation')::uuid), 'reserved', 'expiry does not automatically release an ambiguous reservation');
SELECT is((SELECT count(*)::integer FROM public.member_auth_bindings WHERE member_id = phantoms_test.mid('runtime-expired')), 0, 'expired reservation creates no usable binding');
SELECT lives_ok($$INSERT INTO auth.users(id, email, encrypted_password, email_confirmed_at, raw_app_meta_data) VALUES ('70000000-0000-4000-8000-000000000001', 'runtime-unrelated@phantoms-test.example', 'synthetic-unrelated-password', now(), '{"providers":["email"]}')$$, 'unrelated Auth password provisioning remains allowed');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'synthetic-unrelated-updated' WHERE id = '70000000-0000-4000-8000-000000000001'$$, 'unrelated Auth password update remains allowed');
SELECT ok(NOT has_function_privilege('authenticated', 'public.guard_member_password_write()', 'EXECUTE'), 'browser roles cannot invoke the password-write trigger function');
SELECT * FROM finish();
ROLLBACK;
