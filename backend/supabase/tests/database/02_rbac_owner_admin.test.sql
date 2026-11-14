-- 02 — Owner/Admin RBAC: single-owner invariant, eight-key permissions,
-- has_admin_permission semantics, and owner-only account management RPCs.
BEGIN;
\ir _helpers.psql

SELECT plan(42);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner','full_admin','tasks_admin','noperm_admin','outsider','newcomer','second_owner']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('full_admin', 'admin');
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.grant_admin('noperm_admin', 'admin', phantoms_test.perms());
END $$;

-- Table-level invariants ----------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.admin_accounts (user_id, role) VALUES (phantoms_test.uid('second_owner'), 'owner')$$,
  '23505', NULL, 'a second owner row is rejected by admin_accounts_single_owner');
SELECT throws_ok(
  $$INSERT INTO public.admin_accounts (user_id, role) VALUES (phantoms_test.uid('second_owner'), 'superadmin')$$,
  '23514', NULL, 'roles other than owner/admin are rejected');
SELECT throws_ok(
  $$INSERT INTO public.admin_accounts (user_id, role, permissions)
    VALUES (phantoms_test.uid('second_owner'), 'admin', phantoms_test.perms('tasks') || '{"member_info":true}')$$,
  '23514', NULL, 'the retired member_info key is rejected by the permissions CHECK');
SELECT throws_ok(
  $$INSERT INTO public.admin_accounts (user_id, role, permissions)
    VALUES (phantoms_test.uid('second_owner'), 'admin', phantoms_test.perms('tasks') - 'ai_assistant')$$,
  '23514', NULL, 'a permissions object missing one of the eight keys is rejected');
SELECT throws_ok(
  $$INSERT INTO public.admin_accounts (user_id, role, permissions)
    VALUES (phantoms_test.uid('second_owner'), 'admin', jsonb_set(phantoms_test.perms(), '{tasks}', '"yes"'))$$,
  '23514', NULL, 'non-boolean permission values are rejected');
SELECT lives_ok(
  $$INSERT INTO public.admin_accounts (user_id, role, permissions)
    VALUES (phantoms_test.uid('second_owner'), 'admin', phantoms_test.perms('notes'))$$,
  'an admin row with exactly the eight boolean keys is accepted');
DELETE FROM public.admin_accounts WHERE user_id = phantoms_test.uid('second_owner');
SELECT is((SELECT permissions FROM public.admin_accounts WHERE user_id = phantoms_test.uid('full_admin')),
  phantoms_test.perms('dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant'),
  'column default grants all eight keys');

-- Direct table access is closed --------------------------------------------
SELECT phantoms_test.login_as('owner');
SELECT throws_ok($$SELECT count(*) FROM public.admin_accounts$$, '42501', NULL,
  'even the owner cannot read admin_accounts directly (RPC-only)');
SELECT throws_ok($$UPDATE public.admin_accounts SET role = 'owner'$$, '42501', NULL,
  'authenticated cannot UPDATE admin_accounts directly');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT count(*) FROM public.admin_accounts$$, '42501', NULL,
  'anon cannot read admin_accounts');
SELECT throws_ok($$SELECT public.admin_add_account('x@phantoms-test.example')$$, '42501', NULL,
  'anon cannot execute admin_add_account');
SELECT throws_ok($$SELECT public.admin_update_permissions(gen_random_uuid(), '{}'::jsonb)$$, '42501', NULL,
  'anon cannot execute admin_update_permissions');
SELECT is((SELECT public.get_member_invite_context(NULL) ->> 'valid'), 'false',
  'sanity: anon still reaches public invite RPCs');
RESET ROLE;

-- has_admin_permission / is_admin / is_owner -------------------------------
SELECT phantoms_test.login_as('owner');
SELECT ok((SELECT bool_and(public.has_admin_permission(k))
             FROM unnest(ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']) AS k),
  'owner holds all eight permissions dynamically');
SELECT is(public.has_admin_permission('member_info'), false, 'owner does not hold the retired member_info key');
SELECT is(public.has_admin_permission('anything_else'), false, 'unknown permission keys are always false');
SELECT ok(public.is_owner() AND public.is_admin(), 'owner: is_owner() and is_admin() are true');
SELECT is(public.get_admin_access() ->> 'is_owner', 'true', 'get_admin_access reports is_owner for the owner');
RESET ROLE;

SELECT phantoms_test.login_as('tasks_admin');
SELECT is(public.has_admin_permission('tasks'), true, 'tasks-only admin holds tasks');
SELECT is(public.has_admin_permission('members'), false, 'tasks-only admin lacks members');
SELECT ok(public.is_admin() AND NOT public.is_owner(), 'tasks-only admin: is_admin() true, is_owner() false');
RESET ROLE;

SELECT phantoms_test.login_as('noperm_admin');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']) AS k
            WHERE public.has_admin_permission(k)), 0, 'admin with all-false permissions holds none');
RESET ROLE;

SELECT phantoms_test.login_as('outsider');
SELECT ok(NOT public.is_admin() AND NOT public.is_owner() AND NOT public.has_admin_permission('dashboard'),
  'authenticated user without an admin_accounts row has no admin rights');
SELECT is(public.get_admin_access() ->> 'is_admin', 'false', 'get_admin_access reports is_admin=false for outsiders');
RESET ROLE;

SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.has_admin_permission('dashboard')$$, '42501', NULL,
  'anon cannot even execute has_admin_permission (admin policies are TO authenticated only)');
RESET ROLE;

-- Owner-only account management --------------------------------------------
SELECT phantoms_test.login_as('full_admin');
SELECT throws_like($$SELECT * FROM public.admin_list_accounts()$$, '%OWNER_ONLY%',
  'a full-permission admin cannot list admin accounts');
SELECT throws_like($$SELECT public.admin_add_account((SELECT email FROM phantoms_test.users WHERE name = 'newcomer'))$$,
  '%OWNER_ONLY%', 'a full-permission admin cannot add admins');
SELECT throws_like($$SELECT public.admin_update_permissions(phantoms_test.uid('tasks_admin'), phantoms_test.perms())$$,
  '%OWNER_ONLY%', 'a full-permission admin cannot change permissions');
RESET ROLE;

SELECT phantoms_test.login_as('owner');
SELECT is((SELECT count(*)::int FROM public.admin_list_accounts()), 4, 'owner lists all four admin accounts');
SELECT is((SELECT role FROM public.admin_list_accounts() LIMIT 1), 'owner', 'owner is listed first');
SELECT throws_like($$SELECT public.admin_add_account('not-an-email')$$, '%INVALID_EMAIL%',
  'admin_add_account validates email format');
SELECT throws_like($$SELECT public.admin_add_account('nobody@phantoms-test.example')$$, '%ADMIN_USER_NOT_FOUND%',
  'admin_add_account requires an existing Auth user');
SELECT is((public.admin_add_account(upper((SELECT email FROM phantoms_test.users WHERE name = 'newcomer'))) ->> 'role'), 'admin',
  'owner can add an existing Auth user as admin (email matched case-insensitively)');
SELECT throws_like($$SELECT public.admin_add_account((SELECT email FROM phantoms_test.users WHERE name = 'newcomer'))$$,
  '%ALREADY_ADMIN%', 'adding the same account twice is rejected');
SELECT throws_like($$SELECT public.admin_add_account((SELECT email FROM phantoms_test.users WHERE name = 'owner'))$$,
  '%ALREADY_ADMIN%', 'admin_add_account cannot downgrade/overwrite the owner row');
SELECT ok(public.admin_update_permissions(phantoms_test.uid('newcomer'), phantoms_test.perms('notes', 'ranking')),
  'owner can set an admin''s permissions with the exact eight-key object');
SELECT throws_like($$SELECT public.admin_update_permissions(phantoms_test.uid('newcomer'), phantoms_test.perms('notes') || '{"member_info":true}')$$,
  '%INVALID_PERMISSIONS%', 'admin_update_permissions rejects the retired member_info key');
SELECT throws_like($$SELECT public.admin_update_permissions(phantoms_test.uid('newcomer'), phantoms_test.perms('notes') - 'whatsapp')$$,
  '%INVALID_PERMISSIONS%', 'admin_update_permissions rejects a missing key');
SELECT throws_like($$SELECT public.admin_update_permissions(phantoms_test.uid('owner'), phantoms_test.perms())$$,
  '%OWNER_IMMUTABLE%', 'owner permissions cannot be edited');
SELECT throws_like($$SELECT public.admin_update_permissions(phantoms_test.uid('outsider'), phantoms_test.perms())$$,
  '%ADMIN_NOT_FOUND%', 'permissions can only be set on existing admin rows');
RESET ROLE;
SELECT phantoms_test.clear_auth();

SELECT phantoms_test.login_as('newcomer');
SELECT ok(public.has_admin_permission('notes') AND NOT public.has_admin_permission('tasks'),
  'updated permissions take effect immediately for the affected admin');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.admin_accounts WHERE role = 'owner'), 1,
  'exactly one owner exists at the end of the RBAC scenario');

SELECT * FROM finish();
ROLLBACK;
