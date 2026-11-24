-- 43 — الحذف النهائي لسجل العضو من طرف المالك: بينضّف الدعوات والمراجع
-- المرتبطة (RESTRICT) ويمسح السجل، ومحدش غير المالك يقدر ينفّذه.
BEGIN;
\ir _helpers.psql
SELECT plan(11);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['hd_owner', 'hd_admin', 'hd_target', 'hd_self']) AS n;
  PERFORM phantoms_test.grant_admin('hd_owner', 'owner');
  PERFORM phantoms_test.grant_admin('hd_admin', 'admin');
END $$;

INSERT INTO public.members (email, full_name, academic_number, phone)
VALUES ('hd-target@phantoms-test.example', 'Hard Delete Target', 'HD-001', '01000000001'),
       ('hd-self@phantoms-test.example', 'Hard Delete Self', 'HD-002', '01000000002'),
       ('hd-owner@phantoms-test.example', 'Hard Delete Owner', 'HD-003', '01000000003')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
SELECT m.id,
       CASE m.email
         WHEN 'hd-target@phantoms-test.example' THEN phantoms_test.uid('hd_target')
         WHEN 'hd-owner@phantoms-test.example' THEN phantoms_test.uid('hd_owner')
         ELSE phantoms_test.uid('hd_self')
       END,
       m.email,
       true
FROM public.members AS m
WHERE m.email IN ('hd-target@phantoms-test.example', 'hd-self@phantoms-test.example', 'hd-owner@phantoms-test.example')
ON CONFLICT DO NOTHING;

INSERT INTO public.member_password_invitations (token_hash, purpose, expires_at, member_id, normalized_email)
SELECT repeat('b', 64), 'reset', now() + INTERVAL '1 day', m.id, m.email
FROM public.members AS m
WHERE m.email = 'hd-target@phantoms-test.example';

-- بنلتقط الأكواد وإحنا superuser قبل أي تبديل للدور
SELECT (SELECT id FROM public.members WHERE email = 'hd-target@phantoms-test.example') AS target_member_id,
       (SELECT b.member_id FROM public.member_auth_bindings AS b WHERE b.auth_user_id = phantoms_test.uid('hd_owner')) AS owner_member_id
\gset

-- 1) الصلاحيات ---------------------------------------------------------------
SELECT ok(has_function_privilege('authenticated', 'public.owner_delete_member(bigint)', 'EXECUTE'),
  'authenticated may call the owner delete RPC (it re-checks ownership)');
SELECT ok(NOT has_function_privilege('anon', 'public.owner_delete_member(bigint)', 'EXECUTE'),
  'anon cannot call the owner delete RPC');

SELECT phantoms_test.login_as('hd_target');
SELECT throws_ok($$SELECT public.owner_delete_member(999999)$$,
  'P0001', NULL, 'a plain member cannot delete a member record');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('hd_admin');
SELECT throws_ok($$SELECT public.owner_delete_member(999999)$$,
  'P0001', NULL, 'an admin without the owner role is refused');

-- 2) حراسة الحذف الذاتي ------------------------------------------------------
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('hd_owner');
SELECT throws_ok(format('SELECT public.owner_delete_member(%s)', :owner_member_id),
  'P0001', NULL, 'the owner cannot delete the record bound to their own account');
SELECT throws_ok($$SELECT public.owner_delete_member(-1)$$,
  'P0001', NULL, 'a missing member is refused');

-- 3) الحذف النهائي -----------------------------------------------------------
SELECT is((public.owner_delete_member(:target_member_id) ->> 'ok')::boolean, true,
  'the owner permanently deletes a member that still has an invitation');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'hd-target@phantoms-test.example'), 0,
  'the member record is gone');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
            WHERE normalized_email = 'hd-target@phantoms-test.example'), 0,
  'the linked password invitations are gone too');

-- العملية لازم تتقفل بـ 'complete' وبـ targets فاضية، وإلا الـ CHECK constraint
-- بيرفض التحديث وكل الحذف بيرجع (وده اللي كان بيخلي الحذف يفشل في production).
SELECT is((SELECT count(*)::int FROM public.owner_member_erasure_operations
            WHERE status = 'complete'
              AND target_member_id IS NULL
              AND target_auth_user_id IS NULL
              AND completed_at IS NOT NULL
              AND result ->> 'member_id' = :'target_member_id'), 1,
  'the erasure operation is closed as complete with its targets cleared');
SELECT is((SELECT count(*)::int FROM public.owner_member_erasure_operations
            WHERE status <> 'complete' AND result ->> 'member_id' = :'target_member_id'), 0,
  'no erasure operation is left open for the deleted member');

SELECT * FROM finish();
ROLLBACK;
