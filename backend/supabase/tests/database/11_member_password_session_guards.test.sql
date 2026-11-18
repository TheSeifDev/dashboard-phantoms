-- 11 — Live GoTrue session guards and bound-member Auth write regressions.
-- All Auth/member/session rows are synthetic and transaction-local.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

-- Build a bound member, an independent identity for session-owner mismatch,
-- and a member whose binding has no password yet.
SELECT phantoms_test.create_user('session-member');
SELECT phantoms_test.create_user('session-other');
SELECT phantoms_test.create_member('session-member');
SELECT phantoms_test.create_member('first-bound');
SELECT phantoms_test.create_user('first-bound');
UPDATE auth.users SET encrypted_password = 'session-member-fixture-hash'
WHERE id = phantoms_test.uid('session-member');
INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
VALUES (phantoms_test.mid('session-member'), phantoms_test.uid('session-member'), 'session-member@phantoms-test.example', true);
INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
VALUES (phantoms_test.mid('first-bound'), phantoms_test.uid('first-bound'), 'first-bound@phantoms-test.example', false);
SELECT phantoms_test.bind_device('session-member');

-- login_as creates one disposable auth.sessions row and signs its exact id.
SELECT phantoms_test.login_as('session-member');
INSERT INTO phantoms_test.vars(key, value) VALUES ('old-session-id', auth.jwt() ->> 'session_id');
RESET ROLE;
DELETE FROM auth.sessions WHERE id = phantoms_test.var('old-session-id')::uuid;
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok($$SELECT public.get_member_password_access()$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'deleted old session cannot read member portal access');
SELECT throws_ok($$SELECT public.bind_member_device_session('session-member@phantoms-test.example', 'device-token-session-member-0123456789abcdef')$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'deleted old session cannot bind a device');
SELECT throws_ok($$SELECT count(*) FROM public.lookup_member_by_email('session-member@phantoms-test.example', 'device-token-session-member-0123456789abcdef')$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'deleted old session cannot refetch member profile');
SELECT throws_ok($$SELECT public.get_member_bonus_total(phantoms_test.mid('session-member'), 'device-token-session-member-0123456789abcdef')$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'deleted old session cannot assert a device through the member gate');

-- A fresh live session permits all four member gates.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('session-member');
SELECT ok(public.get_member_password_access() ->> 'auth_user_id' = phantoms_test.uid('session-member')::text, 'fresh live session reads exact member access');
SELECT lives_ok($$SELECT public.bind_member_device_session('session-member@phantoms-test.example', 'device-token-session-member-0123456789abcdef')$$, 'fresh live session can bind its device');
SELECT is((SELECT count(*)::integer FROM public.lookup_member_by_email('session-member@phantoms-test.example', 'device-token-session-member-0123456789abcdef')), 1, 'fresh live session can refetch its profile');
SELECT lives_ok($$SELECT public.get_member_bonus_total(phantoms_test.mid('session-member'), 'device-token-session-member-0123456789abcdef')$$, 'fresh live session can assert its device through the member gate');

-- The signed session id must belong to the exact auth.uid(), not merely exist.
RESET ROLE;
UPDATE auth.sessions SET user_id = phantoms_test.uid('session-other')
WHERE id = (auth.jwt() ->> 'session_id')::uuid;
SELECT set_config('role', 'authenticated', true);
SELECT throws_ok($$SELECT public.get_member_password_access()$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'session owned by another UUID is rejected');

-- A missing session_id claim is rejected even when sub/email are otherwise valid.
RESET ROLE;
SELECT set_config('request.jwt.claim', json_build_object('sub', phantoms_test.uid('session-member'), 'email', 'session-member@phantoms-test.example', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', phantoms_test.uid('session-member'), 'email', 'session-member@phantoms-test.example', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', phantoms_test.uid('session-member')::text, true);
SELECT set_config('request.jwt.claim.email', 'session-member@phantoms-test.example', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.session_id', '', true);
SELECT set_config('role', 'authenticated', true);
SELECT throws_ok($$SELECT public.get_member_password_access()$$, 'P0001', 'MEMBER_SESSION_REQUIRED', 'missing session_id claim is rejected');

-- Admin behavior remains unchanged: no member live-session gate is applied.
RESET ROLE;
SELECT set_config('request.jwt.claim', '{}', true);
SELECT set_config('request.jwt.claims', '{}', true);
SELECT phantoms_test.create_user('session-admin');
SELECT phantoms_test.create_member('admin-target');
SELECT phantoms_test.grant_admin('session-admin', 'owner');
SELECT set_config('request.jwt.claims', json_build_object('sub', phantoms_test.uid('session-admin'), 'email', 'session-admin@phantoms-test.example', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim', json_build_object('sub', phantoms_test.uid('session-admin'), 'email', 'session-admin@phantoms-test.example', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', phantoms_test.uid('session-admin')::text, true);
SELECT set_config('request.jwt.claim.email', 'session-admin@phantoms-test.example', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.session_id', '', true);
SELECT set_config('role', 'authenticated', true);
SELECT lives_ok($$SELECT public.bind_member_device_session('admin-target@phantoms-test.example', 'admin-device-token-0123456789abcdef')$$, 'admin can bind without a member session claim');
SELECT is((SELECT count(*)::integer FROM public.lookup_member_by_email('admin-target@phantoms-test.example')), 1, 'admin can lookup without a member session claim');
SELECT lives_ok($$SELECT public.get_member_bonus_total(phantoms_test.mid('admin-target'), 'admin-device-token-0123456789abcdef')$$, 'admin can assert without a member session claim');

-- The helper is private to SECURITY DEFINER callers.
SELECT ok(NOT has_function_privilege('authenticated', 'public.assert_member_live_auth_session()', 'EXECUTE'), 'authenticated cannot execute private live-session helper');
SELECT ok(NOT has_function_privilege('anon', 'public.assert_member_live_auth_session()', 'EXECUTE'), 'anon cannot execute private live-session helper');

-- A bound non-admin cannot write a first password without a reservation.
RESET ROLE;
SELECT throws_ok($$UPDATE auth.users SET encrypted_password = 'first-bound-password' WHERE id = phantoms_test.uid('first-bound')$$, 'P0001', 'REVIEW_REQUIRED', 'bound first-password write requires a reservation');

-- A bound non-admin reset succeeds only with the exact active reservation.
SELECT set_config('request.jwt.claim', json_build_object('role', 'service_role')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.email', '', true);
SELECT set_config('request.jwt.claim.session_id', '', true);
SET LOCAL ROLE service_role;
SELECT public.member_password_issue_invitation(repeat('a', 64), phantoms_test.mid('session-member'), 'session-member@phantoms-test.example', 'reset', phantoms_test.uid('session-member'), NULL, 24, '', phantoms_test.uid('session-admin'));
SELECT public.member_password_reserve(repeat('a', 64), 'session-member@phantoms-test.example');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'session-member-reset-fixture-hash' WHERE id = phantoms_test.uid('session-member')$$, 'bound reset write succeeds with exact reservation');

-- An Admin/Member overlap remains an ordinary Admin Auth operation.
SELECT phantoms_test.create_user('admin-overlap');
SELECT phantoms_test.create_member('admin-overlap');
INSERT INTO public.member_auth_bindings(member_id, auth_user_id, normalized_email, password_ready)
VALUES (phantoms_test.mid('admin-overlap'), phantoms_test.uid('admin-overlap'), 'admin-overlap@phantoms-test.example', true);
SELECT phantoms_test.grant_admin('admin-overlap', 'admin');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'admin-overlap-password' WHERE id = phantoms_test.uid('admin-overlap')$$, 'Admin/Member overlap keeps ordinary Admin Auth update behavior');

-- Invitation rows must be locked before the member row, preserving the fixed
-- lock ordering that prevents reservation/write deadlocks.
SELECT is((SELECT count(*)::integer FROM regexp_matches(
  pg_get_functiondef('public.guard_member_password_write()'::regprocedure),
  'LIMIT 1 FOR UPDATE', 'g')), 3, 'all password-guard invitation lookups retain row locks');
SELECT ok((SELECT strpos(pg_get_functiondef('public.guard_member_password_write()'::regprocedure), 'LIMIT 1 FOR UPDATE')
                  < strpos(pg_get_functiondef('public.guard_member_password_write()'::regprocedure), 'SELECT * INTO v_member')),
  'invitation lock appears before member-row lock in the password guard');

RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_like($$SELECT public.bind_member_device_session('unknown-session@phantoms-test.example', 'unknown-device-token-0123456789')$$,
  '%MEMBER_PASSWORD_REQUIRED%', 'anonymous unknown-email binding is indistinguishable from an existing member');
SELECT is((SELECT count(*)::integer FROM public.lookup_member_by_email('unknown-session@phantoms-test.example', 'unknown-device-token-0123456789')), 0,
  'anonymous unknown profile remains empty');
RESET ROLE;
SELECT phantoms_test.login_as('session-other');
SELECT throws_like($$SELECT public.bind_member_device_session('session-member@phantoms-test.example', 'unknown-device-token-0123456789')$$,
  '%MEMBER_PASSWORD_REQUIRED%', 'unassociated authenticated identity cannot probe existing-member binding');
SELECT throws_like($$SELECT public.bind_member_device_session('unknown-session@phantoms-test.example', 'unknown-device-token-0123456789')$$,
  '%MEMBER_PASSWORD_REQUIRED%', 'unassociated authenticated unknown-member binding has the same denial');
SELECT * FROM finish();
ROLLBACK;
