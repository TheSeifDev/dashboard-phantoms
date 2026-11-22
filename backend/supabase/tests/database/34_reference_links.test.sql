-- 34 — المصادر: مراجع Global ومراجع خاصة بتيم، وصلاحيات الإدارة والعضو.
-- يثبت: الجدول مقفول (RLS + revoke) والوصول عبر RPCs فقط، الإدارة بس تقدر
-- تضيف/تعدّل/تحذف، الرابط المكرر في نفس النطاق بيترفض، والعضو بيشوف Global
-- + مصادر تيماته النشطة بس.
--
-- ملاحظة: الجدول مقفول على authenticated، فكل قراءة مباشرة بتحصل بعد RESET ROLE.
BEGIN;
\ir _helpers.psql
SELECT plan(36);
-- Fixtures -------------------------------------------------------------------
DO $$
DECLARE
  v_software UUID;
  v_hardware UUID;
BEGIN
  PERFORM phantoms_test.create_user('ref_admin');
  PERFORM phantoms_test.grant_admin('ref_admin', 'admin');
  PERFORM phantoms_test.create_member('ref_sw', NULL, true);
  PERFORM phantoms_test.create_member('ref_hw', NULL, true);
  PERFORM phantoms_test.create_member('ref_suspended', NULL, true);
  SELECT id INTO v_software FROM public.teams WHERE slug = 'software';
  SELECT id INTO v_hardware FROM public.teams WHERE slug = 'hardware';
  INSERT INTO public.team_memberships (team_id, member_id, status)
  VALUES (v_software, phantoms_test.mid('ref_sw'), 'active'),
         (v_hardware, phantoms_test.mid('ref_hw'), 'active'),
         (v_software, phantoms_test.mid('ref_suspended'), 'suspended');
END $$;
-- Posture --------------------------------------------------------------------
SELECT has_function('public', 'admin_list_references', ARRAY[]::name[],
  'admin_list_references() exists');
SELECT has_function('public', 'admin_save_reference', ARRAY['jsonb']::name[],
  'admin_save_reference(jsonb) exists');
SELECT has_function('public', 'admin_delete_reference', ARRAY['bigint']::name[],
  'admin_delete_reference(bigint) exists');
SELECT has_function('public', 'member_references', ARRAY[]::name[],
  'member_references() exists');
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.admin_save_reference(jsonb)'::regprocedure),
  'admin_save_reference runs as SECURITY DEFINER (clients cannot write the table directly)');
SELECT ok(
  (SELECT proconfig::text LIKE '%search_path=%' FROM pg_catalog.pg_proc WHERE oid = 'public.member_references()'::regprocedure),
  'member_references pins its own search_path');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reference_links'::regclass),
  'reference_links has RLS enabled');
SELECT ok(NOT has_function_privilege('anon', 'public.member_references()', 'EXECUTE'),
  'anonymous role cannot execute member_references');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_save_reference(jsonb)', 'EXECUTE'),
  'anonymous role cannot execute admin_save_reference');
-- The table is readable by no client role, even an authenticated admin.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ref_admin');
SELECT throws_ok('SELECT count(*) FROM public.reference_links', '42501', NULL,
  'authenticated clients cannot select reference_links directly');
-- Admin: create global + team scoped -----------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'React docs',
       'url', 'https://react.dev/reference/react',
       'category', 'docs',
       'description', 'المرجع الرسمي لـReact'
     )) $$,
  'an admin with the members permission can create a global reference');
SELECT is(public.admin_list_references() -> 'total', '1'::jsonb,
  'the admin list counts the new global reference');
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'React docs copy',
       'url', 'HTTPS://React.dev/reference/react',
       'category', 'docs'
     )) $$,
  'P0001', 'DUPLICATE_URL: الرابط ده متسجل بالفعل في نفس النطاق.',
  'the same URL twice inside the global scope is rejected (case-insensitive)');
SELECT lives_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'React docs — Software',
       'url', 'https://react.dev/reference/react',
       'category', 'docs',
       'team_slug', 'software'
     )) $$,
  'the same URL is allowed inside a team scope');
SELECT lives_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'STM32 HAL',
       'url', 'https://www.st.com/en/embedded-software/stm32cube-mcu-mpu-packages.html',
       'category', 'library',
       'team_slug', 'hardware'
     )) $$,
  'an admin can scope a reference to the hardware team');
SELECT is(public.admin_list_references() -> 'total', '3'::jsonb,
  'the admin list sees global and every team scope');
SELECT is(jsonb_array_length(public.admin_list_references() -> 'teams'), 3,
  'the admin payload exposes the active teams for the scope picker');
-- Validation ----------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'x', 'url', 'https://a.example.com', 'category', 'docs')) $$,
  'P0001', 'INVALID_TITLE: عنوان المصدر مطلوب.',
  'a title shorter than two characters is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'FTP link', 'url', 'ftp://a.example.com', 'category', 'docs')) $$,
  'P0001', 'INVALID_URL: الرابط لازم يبدأ بـ http أو https.',
  'a non-http url is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'Weird', 'url', 'https://a.example.com', 'category', 'nope')) $$,
  'P0001', 'INVALID_CATEGORY: نوع المصدر غير معروف.',
  'an unknown category is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'Ghost team', 'url', 'https://ghost.example.com',
       'category', 'docs', 'team_slug', 'ghost')) $$,
  'P0001', 'TEAM_NOT_FOUND: التيم غير موجود.',
  'a reference scoped to an unknown team is rejected');
-- Member identities cannot write or list as admins ---------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ref_sw');
SELECT throws_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'title', 'Member link', 'url', 'https://member.example.com', 'category', 'docs')) $$,
  'P0001', 'ADMIN_SCOPE_REQUIRED: إدارة المصادر متاحة للإدارة فقط.',
  'a member cannot create references');
SELECT throws_ok('SELECT public.admin_list_references()', 'P0001',
  'ADMIN_SCOPE_REQUIRED: المصادر متاحة للإدارة فقط.',
  'a member cannot use the admin reference list');
SELECT throws_ok('SELECT public.admin_delete_reference(1)', 'P0001',
  'ADMIN_SCOPE_REQUIRED: إدارة المصادر متاحة للإدارة فقط.',
  'a member cannot delete references');
-- Member scope --------------------------------------------------------------
SELECT is(jsonb_array_length(public.member_references() -> 'links'), 2,
  'a software member sees the global reference plus the software one only');
SELECT is(jsonb_array_length(public.member_references() -> 'teams'), 1,
  'the member payload lists only the member active teams');
SELECT is((public.member_references() -> 'total')::int, 2,
  'the member total matches the visible links');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ref_hw');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(public.member_references() -> 'links') AS entry
    WHERE entry ->> 'title' = 'STM32 HAL'), 1,
  'a hardware member sees the hardware reference');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(public.member_references() -> 'links') AS entry
    WHERE entry ->> 'team_slug' = 'software'), 0,
  'a hardware member does not see software references');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ref_suspended');
SELECT is(jsonb_array_length(public.member_references() -> 'links'), 1,
  'a suspended membership only exposes the global references');
-- A signed-in account without a member binding is rejected.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.create_user('ref_outsider');
SELECT phantoms_test.login_as('ref_outsider');
SELECT throws_ok('SELECT public.member_references()', 'P0001',
  'MEMBER_SCOPE_REQUIRED: المصادر متاحة لأعضاء الفريق فقط.',
  'an authenticated account without a member binding cannot read references');
-- Update + delete -----------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('ref_admin');
SELECT lives_ok(
  $$ SELECT public.admin_save_reference(jsonb_build_object(
       'id', (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_references() -> 'links') AS entry
              WHERE entry ->> 'title' = 'React docs'),
       'title', 'React documentation',
       'url', 'https://react.dev/reference/react',
       'category', 'docs',
       'description', 'المرجع الرسمي'
     )) $$,
  'an admin can rename and re-scope an existing reference');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(public.admin_list_references() -> 'links') AS entry
    WHERE entry ->> 'title' = 'React documentation'), 1,
  'the renamed reference is persisted in the admin list');
SELECT is(
  public.admin_delete_reference((SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_references() -> 'links') AS entry
    WHERE entry ->> 'title' = 'STM32 HAL')),
  true,
  'deleting a reference succeeds for an admin');
SELECT is(public.admin_list_references() -> 'total', '2'::jsonb,
  'the deleted reference is gone from the admin list');
SELECT is(public.admin_delete_reference(999999), false,
  'deleting an unknown reference returns false');
SELECT * FROM finish();
ROLLBACK;
