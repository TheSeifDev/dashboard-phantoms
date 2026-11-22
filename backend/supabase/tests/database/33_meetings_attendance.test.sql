-- 33 — الاجتماعات والحضور: الجمهور المستهدف، سكان الـQR، صلاحيات الإدارة والعضو.
-- يثبت: الجداول مقفولة (RLS + revoke) والوصول عبر RPCs فقط، الإدارة بس تقدر
-- تنشئ/تعدّل، سكان الرقم الأكاديمي بيتطبّع وبيتمنع التكرار، والعضو بيشوف
-- اجتماعات جمهوره هو بس.
--
-- ملاحظة: الاجتماعات مقفولة على authenticated، فكل قراءة مباشرة للجدول هنا
-- بتحصل بعد RESET ROLE (superuser) — زي ما بيعمل الـRPC نفسه.
BEGIN;
\ir _helpers.psql
SELECT plan(35);
-- Fixtures -------------------------------------------------------------------
DO $$
DECLARE
  v_software UUID;
BEGIN
  PERFORM phantoms_test.create_user('meet_admin');
  PERFORM phantoms_test.grant_admin('meet_admin', 'admin');
  PERFORM phantoms_test.create_member('meet_a', NULL, true);
  PERFORM phantoms_test.create_member('meet_b');
  PERFORM phantoms_test.create_member('meet_c');
  PERFORM phantoms_test.create_member('meet_lead', NULL, true);
  -- الرقم الأكاديمي بيتخزن بشكل حر؛ السكان بيطبّعه قبل المقارنة.
  UPDATE public.members SET academic_number = ' AI-1001 ' WHERE id = phantoms_test.mid('meet_a');
  UPDATE public.members SET academic_number = 'sw 2002' WHERE id = phantoms_test.mid('meet_b');
  UPDATE public.members SET academic_number = 'HW3003' WHERE id = phantoms_test.mid('meet_c');
  SELECT id INTO v_software FROM public.teams WHERE slug = 'software';
  INSERT INTO public.team_memberships (team_id, member_id, status)
  VALUES (v_software, phantoms_test.mid('meet_a'), 'active'),
         (v_software, phantoms_test.mid('meet_c'), 'suspended');
  INSERT INTO public.team_admin_assignments (team_id, user_id, role)
  VALUES (v_software, phantoms_test.uid('meet_lead'), 'head');
END $$;
-- Posture --------------------------------------------------------------------
SELECT has_function('public', 'admin_mark_attendance', ARRAY['bigint', 'text']::name[],
  'admin_mark_attendance(bigint, text) exists');
SELECT has_function('public', 'member_meetings', ARRAY[]::name[],
  'member_meetings() exists');
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.admin_mark_attendance(bigint, text)'::regprocedure),
  'admin_mark_attendance runs as SECURITY DEFINER (clients cannot read meetings directly)');
SELECT ok(
  (SELECT proconfig::text LIKE '%search_path=%' FROM pg_catalog.pg_proc WHERE oid = 'public.admin_save_meeting(jsonb)'::regprocedure),
  'admin_save_meeting pins its own search_path');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.meetings'::regclass),
  'meetings has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.meeting_attendance'::regclass),
  'meeting_attendance has RLS enabled');
SELECT ok(NOT has_function_privilege('anon', 'public.member_meetings()', 'EXECUTE'),
  'anonymous role cannot execute member_meetings');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_list_meetings(integer, integer)', 'EXECUTE'),
  'anonymous role cannot execute admin_list_meetings');
SELECT ok(NOT has_function_privilege('authenticated', 'public.meeting_audience_members(jsonb)', 'EXECUTE'),
  'the audience resolver is not callable by clients');
-- Tables are readable by no client role, even an authenticated admin.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('meet_admin');
SELECT throws_ok('SELECT count(*) FROM public.meetings', '42501', NULL,
  'authenticated clients cannot select meetings directly');
SELECT throws_ok('SELECT count(*) FROM public.meeting_attendance', '42501', NULL,
  'authenticated clients cannot select the attendance table directly');
-- Admin: create + audience resolution ----------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_save_meeting(jsonb_build_object(
       'title', 'Software sync',
       'mode', 'offline',
       'starts_at', (now() + interval '1 day')::text,
       'duration_minutes', 90,
       'location', 'قاعة الكلية',
       'audience', '{"type":"teams","teams":["software"]}'::jsonb
     )) $$,
  'an admin with the members permission can create a meeting');
SELECT is(
  (public.admin_list_meetings() -> 'meetings' -> 0 ->> 'expected')::int, 1,
  'the software audience resolves to the single active member only');
SELECT throws_ok(
  $$ SELECT public.admin_save_meeting(jsonb_build_object(
       'title', 'Online without link', 'mode', 'online',
       'starts_at', (now() + interval '2 days')::text,
       'audience', '{"type":"all"}'::jsonb)) $$,
  'P0001', 'MISSING_URL: الاجتماع الأونلاين محتاج رابط.',
  'an online meeting without a link is rejected');
SELECT throws_ok(
  $$ SELECT public.admin_save_meeting(jsonb_build_object(
       'title', 'Bad audience', 'mode', 'offline',
       'starts_at', (now() + interval '2 days')::text,
       'location', 'مكان',
       'audience', '{"type":"teams","teams":[]}'::jsonb)) $$,
  'P0001', 'INVALID_AUDIENCE: اختار تيم واحد على الأقل.',
  'an empty team audience is rejected');
-- Scan ----------------------------------------------------------------------
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), 'ai-1001') ->> 'status',
  'marked',
  'scanning the normalized academic number marks the member present');
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), 'AI 1001') ->> 'status',
  'duplicate',
  'scanning the same member twice does not duplicate the attendance row');
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), 'NOPE-999') ->> 'status',
  'not_found',
  'an unknown code resolves to not_found');
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), '   ') ->> 'status',
  'empty',
  'a blank scan is rejected as empty');
SELECT is(
  public.admin_meeting_roster((SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
    WHERE entry ->> 'title' = 'Software sync')) ->> 'present',
  '1',
  'the roster counts the scanned member as present');
SELECT is(
  (public.admin_meeting_roster((SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
    WHERE entry ->> 'title' = 'Software sync')) -> 'members' -> 0 ->> 'method'),
  'scan',
  'the roster records the scan method');
SELECT is(
  public.admin_set_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'),
    phantoms_test.mid('meet_a'), false),
  true,
  'an admin can clear a check-in manually');
SELECT is(
  public.admin_meeting_roster((SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
    WHERE entry ->> 'title' = 'Software sync')) ->> 'present',
  '0',
  'clearing the check-in updates the roster count');
-- A scanned member outside the audience is still recorded, flagged as unexpected.
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), 'SW2002') ->> 'expected',
  'false',
  'a member outside the audience can be checked in but is flagged as unexpected');
-- Leaders audience ----------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_save_meeting(jsonb_build_object(
       'title', 'Leads standup', 'mode', 'online',
       'starts_at', (now() + interval '3 days')::text,
       'online_url', 'https://meet.example.com/leads',
       'audience', '{"type":"leaders"}'::jsonb)) $$,
  'the leaders audience is accepted');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is(
  (SELECT count(*)::int FROM public.meeting_audience_members('{"type":"leaders"}'::jsonb)), 1,
  'the leaders audience resolves to members with a bound head/monitor assignment');
-- Member scope --------------------------------------------------------------
SELECT phantoms_test.login_as('meet_a');
SELECT is(
  jsonb_array_length(public.member_meetings() -> 'upcoming'), 1,
  'a member sees only meetings whose audience includes them');
SELECT is(
  public.member_meetings() -> 'member' ->> 'academic_number', ' AI-1001 ',
  'the member payload exposes the stored academic number for the QR code');
SELECT is(
  (public.member_meetings() -> 'stats' ->> 'total')::int, 0,
  'future meetings are not counted in the attendance history stats');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('meet_lead');
SELECT is(
  jsonb_array_length(public.member_meetings() -> 'upcoming'), 1,
  'a head sees the leaders meeting but not the software team meeting');
-- A signed-in account without a member binding is rejected.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.create_user('meet_outsider');
SELECT phantoms_test.login_as('meet_outsider');
SELECT throws_ok('SELECT public.member_meetings()', 'P0001',
  'MEMBER_SCOPE_REQUIRED: سجل الاجتماعات متاح لأعضاء الفريق فقط.',
  'an authenticated account without a member binding cannot read member meetings');
-- Cancelled meetings refuse check-ins; deletion cascades attendance.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('meet_admin');
SELECT public.admin_save_meeting(jsonb_build_object(
  'id', (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
         WHERE entry ->> 'title' = 'Software sync'),
  'title', 'Software sync', 'mode', 'offline',
  'starts_at', (now() + interval '1 day')::text, 'duration_minutes', 90,
  'location', 'قاعة الكلية', 'status', 'cancelled',
  'audience', '{"type":"teams","teams":["software"]}'::jsonb));
SELECT is(
  public.admin_mark_attendance(
    (SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
      WHERE entry ->> 'title' = 'Software sync'), 'AI-1001') ->> 'status',
  'cancelled',
  'a cancelled meeting refuses new check-ins');
SELECT is(
  public.admin_delete_meeting((SELECT (entry ->> 'id')::bigint FROM jsonb_array_elements(public.admin_list_meetings() -> 'meetings') AS entry
    WHERE entry ->> 'title' = 'Software sync')),
  true,
  'deleting a meeting succeeds for an admin');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.meetings), 1,
  'only the untouched meeting remains after the delete');
SELECT is((SELECT count(*)::int FROM public.meeting_attendance), 0,
  'deleting a meeting cascades its attendance rows');
SELECT * FROM finish();
ROLLBACK;