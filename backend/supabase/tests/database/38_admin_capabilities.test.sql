-- 38 — صلاحيات المشرفين: قدرات حساسة للمالك، وطلبات مؤقتة بموافقة المالك بمدة.
BEGIN;
\ir _helpers.psql
SELECT no_plan();

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user('cap_owner');
  PERFORM phantoms_test.grant_admin('cap_owner', 'owner');
  PERFORM phantoms_test.create_user('cap_admin');
  PERFORM phantoms_test.grant_admin('cap_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.create_user('cap_admin2');
  PERFORM phantoms_test.grant_admin('cap_admin2', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.create_member('cap_member', NULL, true);
END $$;

-- Posture --------------------------------------------------------------------
SELECT has_table('public', 'admin_capability_requests', 'capability requests table exists');
SELECT has_table('public', 'admin_capability_grants', 'capability grants table exists');
SELECT has_function('public', 'has_capability', ARRAY['text']::name[], 'has_capability(text) exists');
SELECT has_function('public', 'user_has_capability', ARRAY['uuid', 'text']::name[], 'user_has_capability(uuid,text) exists');
SELECT has_function('public', 'admin_capability_state', ARRAY[]::name[], 'admin_capability_state() exists');
SELECT has_function('public', 'admin_request_capability', ARRAY['text', 'text']::name[], 'admin_request_capability(text,text) exists');
SELECT has_function('public', 'admin_decide_capability_request',
  ARRAY['bigint', 'boolean', 'integer', 'text']::name[], 'admin_decide_capability_request exists');

-- المشرف الجديد بياخد كل صلاحيات الأقسام افتراضيًا ---------------------------
SELECT ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.admin_add_account(text)'::regprocedure), '"web_projects":true') > 0,
  'admin_add_account grants every section, including web projects');

-- المالك دايمًا عنده القدرات ------------------------------------------------
SELECT phantoms_test.login_as('cap_owner');
SELECT ok(public.is_owner(), 'the owner keeps full owner authority');
SELECT ok(public.has_capability('admin_accounts'), 'the owner holds admin_accounts');
SELECT ok(public.has_capability('full_owner'), 'the owner holds full_owner');
SELECT is((public.admin_capability_state() ->> 'is_owner')::boolean, true,
  'capability state reports the owner flag');
SELECT is(jsonb_array_length(public.admin_capability_inbox() -> 'requests'), 0,
  'the owner inbox starts empty');

-- المشرف من غير منحة --------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(NOT public.is_owner(), 'an administrator is not the owner without a grant');
SELECT ok(NOT public.has_capability('admin_accounts'),
  'an administrator cannot manage accounts without a grant');
SELECT is((public.admin_capability_state() #>> '{capabilities,admin_accounts,allowed}')::boolean, false,
  'capability state reports the missing capability');
SELECT throws_ok(
  $$ SELECT public.admin_list_accounts() $$,
  'P0001', 'OWNER_ONLY: إدارة الحسابات محتاجة موافقة المالك.',
  'listing administrator accounts is blocked without a grant');
SELECT throws_ok(
  $$ SELECT public.admin_capability_inbox() $$,
  'P0001', 'OWNER_ONLY: طلبات الصلاحيات بتظهر للمالك بس.',
  'the owner inbox is closed to administrators');
SELECT throws_ok(
  $$ SELECT public.admin_decide_capability_request(1, true, 60, NULL) $$,
  'P0001', 'OWNER_ONLY: الموافقة على الصلاحيات للمالك بس.',
  'an administrator cannot approve their own request');

-- المشرف بيطلب --------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_request_capability('admin_accounts', 'محتاج أضيف مشرف') $$,
  'an administrator can request a capability');
SELECT throws_ok(
  $$ SELECT public.admin_request_capability('admin_accounts', NULL) $$,
  'P0001', 'REQUEST_ALREADY_PENDING',
  'a second pending request for the same capability is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_request_capability('nope', NULL) $$,
  'P0001', 'INVALID_CAPABILITY',
  'unknown capability keys are rejected');
SELECT is((public.admin_capability_state() #>> '{capabilities,admin_accounts,request,status}'), 'pending',
  'the request is visible in the administrator state');

-- المالك بيوافق بمدة ---------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_owner');
SELECT is(jsonb_array_length(public.admin_capability_inbox() -> 'requests'), 1,
  'the owner sees the pending request');
SELECT lives_ok(
  $$ SELECT public.admin_decide_capability_request(
       (SELECT (entry ->> 'id')::bigint
        FROM jsonb_array_elements(public.admin_capability_inbox() -> 'requests') AS entry
        WHERE entry ->> 'status' = 'pending' LIMIT 1),
       true, 60, 'ساعة واحدة') $$,
  'the owner approves the request for 60 minutes');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is(
  (SELECT count(*)::int FROM public.admin_capability_grants AS g
   WHERE g.capability = 'admin_accounts' AND g.expires_at > pg_catalog.now()),
  1, 'approval created one live grant');

-- المشرف بقى عنده القدرة -----------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(public.has_capability('admin_accounts'), 'the grant opens admin_accounts');
SELECT lives_ok($$ SELECT public.admin_list_accounts() $$,
  'the administrator can list accounts while the grant is live');
SELECT ok(NOT public.has_capability('strikes'), 'other capabilities stay closed');
SELECT ok(NOT public.is_owner(), 'a capability grant does not make them the owner');

-- انتهاء المدة بيقفل الصلاحية -------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
UPDATE public.admin_capability_grants
   SET expires_at = pg_catalog.now() - INTERVAL '1 minute'
 WHERE capability = 'admin_accounts';
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(NOT public.has_capability('admin_accounts'), 'the grant expires on its own');
SELECT throws_ok($$ SELECT public.admin_list_accounts() $$,
  'P0001', 'OWNER_ONLY: إدارة الحسابات محتاجة موافقة المالك.',
  'the expired grant closes the page again');

-- منحة full_owner بتفتح مسارات المالك ----------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT lives_ok(
  $$ INSERT INTO public.admin_capability_grants (user_id, capability, granted_by, expires_at)
     VALUES (phantoms_test.uid('cap_admin'), 'full_owner', phantoms_test.uid('cap_owner'),
             pg_catalog.now() + INTERVAL '30 minutes') $$,
  'the owner can grant full owner authority for a limited window');
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(public.is_owner(), 'a live full_owner grant satisfies is_owner()');
SELECT is((public.get_admin_access() ->> 'is_owner')::boolean, false,
  'the access payload still reports the real role as administrator');
SELECT ok((public.get_admin_access() ->> 'owner_authority_until') IS NOT NULL,
  'the access payload exposes the temporary owner window');

-- سحب المنحة ----------------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT set_config('phantoms_test.revoke_grant_id',
  (SELECT g.id::text FROM public.admin_capability_grants AS g
   WHERE g.capability = 'full_owner' ORDER BY g.id DESC LIMIT 1), false);
SELECT phantoms_test.login_as('cap_owner');
SELECT lives_ok(
  $$ SELECT public.admin_revoke_capability_grant(
       current_setting('phantoms_test.revoke_grant_id')::bigint) $$,
  'the owner can revoke a live grant');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(NOT public.is_owner(), 'revoking removes the owner authority immediately');

-- العضو العادي مالوش دعوة ----------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_member');
SELECT throws_ok(
  $$ SELECT public.admin_capability_state() $$,
  'P0001', 'UNAUTHORIZED',
  'a plain member has no capability state');
SELECT throws_ok(
  $$ SELECT public.admin_request_capability('admin_accounts', NULL) $$,
  'P0001', 'UNAUTHORIZED',
  'a plain member cannot request capabilities');


-- منحة دائمة يديرها المالك مباشرة (admin_set_capability) ----------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT throws_ok(
  $$ SELECT public.admin_set_capability(phantoms_test.uid('cap_admin'), 'full_owner', true) $$,
  'P0001', 'OWNER_ONLY: منح الصلاحيات للمالك بس.',
  'an administrator cannot grant capabilities, not even to themselves');
SELECT throws_ok(
  $$ SELECT public.admin_capability_matrix() $$,
  'P0001', 'OWNER_ONLY: مصفوفة الصلاحيات بتظهر للمالك بس.',
  'the capability matrix is owner-only');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_owner');
SELECT is((public.admin_set_capability(phantoms_test.uid('cap_admin'), 'full_owner', true) ->> 'granted')::boolean,
  true, 'the owner grants full owner authority permanently');
SELECT is((public.admin_set_capability(phantoms_test.uid('cap_admin'), 'app_usage', true) ->> 'granted')::boolean,
  true, 'the owner grants the app usage report permanently');
SELECT throws_ok(
  $$ SELECT public.admin_set_capability(phantoms_test.uid('cap_owner'), 'full_owner', false) $$,
  'P0001', 'OWNER_IMMUTABLE: صلاحيات المالك ثابتة.',
  'owner capabilities cannot be changed');
SELECT throws_ok(
  $$ SELECT public.admin_set_capability(phantoms_test.uid('cap_member'), 'app_usage', true) $$,
  'P0001', 'ADMIN_NOT_FOUND', 'capabilities only apply to existing administrators');
SELECT throws_ok(
  $$ SELECT public.admin_set_capability(phantoms_test.uid('cap_admin'), 'not_a_capability', true) $$,
  'P0001', 'INVALID_INPUT', 'unknown capability keys are rejected');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.admin_capability_matrix()) AS row
           WHERE (row ->> 'email') = (SELECT email FROM phantoms_test.users WHERE name = 'cap_admin')
             AND (row #>> '{capabilities,full_owner,permanent}')::boolean), 1,
  'the owner matrix marks the grant as permanent');

-- المشرف بقى عنده سلطة المالك في الواجهة والقراءة -----------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(public.is_owner(), 'a permanent full_owner grant satisfies is_owner()');
SELECT is((public.get_admin_access() ->> 'owner_authority')::boolean, true,
  'the access payload opens owner authority for the administrator');
SELECT is((public.get_admin_access() ->> 'owner_authority_permanent')::boolean, true,
  'the access payload reports the permanent owner authority');
SELECT is((public.get_admin_access() ->> 'is_owner')::boolean, false,
  'the real owner flag stays false for the administrator');

-- سحب دائم بيمنع فورًا --------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_owner');
SELECT is((public.admin_set_capability(phantoms_test.uid('cap_admin'), 'full_owner', false) ->> 'granted')::boolean,
  false, 'the owner revokes full owner authority permanently');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('cap_admin');
SELECT ok(NOT public.is_owner(), 'the revoked administrator loses owner authority');
SELECT is((public.get_admin_access() ->> 'owner_authority')::boolean, false,
  'the access payload closes owner authority after the revoke');

SELECT * FROM finish();
ROLLBACK;
