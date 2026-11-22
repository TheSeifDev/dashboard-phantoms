-- 30 — admin_task_audience_groups(): مجموعات الإسناد الجماعي للمهام.
-- يثبت: الدالة SECURITY DEFINER ومقفولة على anon، محتاجة is_admin أو صلاحية tasks،
-- بترجع قادة مشاريع الويب النشطين (بدون المشاريع المؤرشفة/المرفوضة) ورؤساء
-- ومراقبي التيمات النشطة فقط، وبتستبعد الأعضاء غير النشطين.
BEGIN;
\ir _helpers.psql
SELECT plan(10);

-- Fixtures -------------------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user('head_user');
  PERFORM phantoms_test.create_user('monitor_user');
  PERFORM phantoms_test.create_user('admin_user');
  PERFORM phantoms_test.create_user('plain_user');
  PERFORM phantoms_test.create_member('owner_member');
  PERFORM phantoms_test.create_member('lead_a');
  PERFORM phantoms_test.create_member('lead_archived');
  PERFORM phantoms_test.create_member('lead_inactive');
  PERFORM phantoms_test.create_member('head_member', 'head_user@phantoms-test.example');
  PERFORM phantoms_test.create_member('monitor_member', 'monitor_user@phantoms-test.example');

  UPDATE public.members SET work_status = 'inactive' WHERE id = phantoms_test.mid('lead_inactive');

  INSERT INTO public.web_projects (slug, name, owner_member_id, lead_member_id, status)
  VALUES ('live-project', 'Live Project', phantoms_test.mid('owner_member'), phantoms_test.mid('lead_a'), 'active');
  INSERT INTO public.web_projects (slug, name, owner_member_id, lead_member_id, status)
  VALUES ('archived-project', 'Archived Project', phantoms_test.mid('owner_member'), phantoms_test.mid('lead_archived'), 'archived');
  INSERT INTO public.web_projects (slug, name, owner_member_id, lead_member_id, status)
  VALUES ('inactive-lead-project', 'Inactive Lead Project', phantoms_test.mid('owner_member'), phantoms_test.mid('lead_inactive'), 'planning');

  INSERT INTO public.team_admin_assignments (team_id, user_id, role)
  SELECT t.id, phantoms_test.uid('head_user'), 'head' FROM public.teams AS t WHERE t.slug = 'ai';
  INSERT INTO public.team_admin_assignments (team_id, user_id, role)
  SELECT t.id, phantoms_test.uid('monitor_user'), 'monitor' FROM public.teams AS t WHERE t.slug = 'software';

  INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
  VALUES (phantoms_test.mid('head_member'), phantoms_test.uid('head_user'), 'head_user@phantoms-test.example', true);
  INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
  VALUES (phantoms_test.mid('monitor_member'), phantoms_test.uid('monitor_user'), 'monitor_user@phantoms-test.example', true);

  PERFORM phantoms_test.grant_admin('admin_user', 'admin');
END $$;

-- Function posture -----------------------------------------------------------
SELECT has_function('public', 'admin_task_audience_groups', ARRAY[]::name[],
  'admin_task_audience_groups() exists with no arguments');
SELECT is(
  (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.admin_task_audience_groups()'::regprocedure),
  true,
  'admin_task_audience_groups runs as SECURITY DEFINER (tasks-only admins cannot read web_projects directly)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc
          WHERE oid = 'public.admin_task_audience_groups()'::regprocedure
            AND proconfig::text LIKE '%search_path=%'),
  'admin_task_audience_groups pins its own search_path');

-- anon cannot execute at all.
SELECT throws_ok(
  'SELECT public.admin_task_audience_groups()',
  '42501',
  NULL,
  'anon has no EXECUTE grant on the audience RPC');

-- A signed-in member with no admin seat is rejected by the guard.
RESET ROLE;
SELECT phantoms_test.login_as('plain_user');
SELECT throws_ok(
  'SELECT public.admin_task_audience_groups()',
  'P0001',
  'TASKS_PERMISSION_REQUIRED',
  'a plain authenticated user is rejected by the tasks-permission guard');

-- Admin with tasks permission gets the resolved groups.
RESET ROLE;
SELECT phantoms_test.login_as('admin_user');
SELECT is(
  (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(public.admin_task_audience_groups() -> 'leads')),
  jsonb_build_array(phantoms_test.mid('lead_a')),
  'only the active lead of a live web project is returned (archived and inactive excluded)');
SELECT is(
  (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(public.admin_task_audience_groups() -> 'heads')),
  jsonb_build_array(phantoms_test.mid('head_member'), phantoms_test.mid('monitor_member')),
  'team heads and monitors resolve to their member ids');
SELECT is(
  jsonb_array_length(public.admin_task_audience_groups() -> 'leads'),
  1,
  'the leads group holds exactly one member');
SELECT is(
  jsonb_typeof(public.admin_task_audience_groups() -> 'heads'),
  'array',
  'the heads group is always a JSON array');

-- A tasks-only admin (not a global admin) keeps access to the groups.
RESET ROLE;
DO $$
BEGIN
  PERFORM phantoms_test.grant_admin('plain_user', 'admin', phantoms_test.perms('tasks'));
END $$;
SELECT phantoms_test.login_as('plain_user');
SELECT is(
  jsonb_array_length(public.admin_task_audience_groups() -> 'leads'),
  1,
  'an admin holding only the tasks permission can load the groups');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;