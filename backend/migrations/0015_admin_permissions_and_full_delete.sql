-- 0015 — صلاحيات أقسام قابلة للتعديل وحذف حساب المشرف بالكامل
BEGIN;

ALTER TABLE public.admin_accounts
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb;

ALTER TABLE public.admin_accounts
  DROP CONSTRAINT IF EXISTS admin_accounts_permissions_valid;
ALTER TABLE public.admin_accounts
  ADD CONSTRAINT admin_accounts_permissions_valid CHECK (
    jsonb_typeof(permissions) = 'object'
    AND jsonb_typeof(permissions -> 'dashboard') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'members') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'tasks') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ranking') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'notes') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'announcements') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'whatsapp') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ai_assistant') IS NOT DISTINCT FROM 'boolean'
    AND permissions - ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant']::text[] = '{}'::jsonb
  );

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permission = ANY (ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant'])
    THEN coalesce(auth.uid() = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid, false)
      OR EXISTS (
        SELECT 1
        FROM public.admin_accounts AS a
        WHERE a.user_id = auth.uid()
          AND a.role = 'admin'
          AND a.permissions @> jsonb_build_object(p_permission, true)
      )
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.has_admin_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_role TEXT;
  v_permissions JSONB;
  v_all_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'role', NULL, 'email', NULL, 'permissions', '{}'::jsonb);
  END IF;

  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  IF v_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    v_role := 'owner';
    v_permissions := v_all_permissions;
  ELSE
    SELECT a.role, a.permissions INTO v_role, v_permissions
    FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', coalesce(v_role IN ('owner', 'admin'), false),
    'is_owner', coalesce(v_role = 'owner', false),
    'role', v_role,
    'email', v_email,
    'permissions', coalesce(v_permissions, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

DROP FUNCTION public.admin_list_accounts();
CREATE FUNCTION public.admin_list_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  created_by UUID,
  permissions JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: إدارة الحسابات متاحة للمالك فقط.';
  END IF;

  RETURN QUERY
  SELECT a.user_id, u.email::text, a.role, a.created_at, a.created_by, a.permissions
  FROM public.admin_accounts AS a
  JOIN auth.users AS u ON u.id = a.user_id
  ORDER BY CASE WHEN a.role = 'owner' THEN 0 ELSE 1 END, lower(u.email);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_account(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_user_id UUID;
  v_created_at TIMESTAMPTZ;
  v_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين متاحة للمالك فقط.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;

  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.';
  END IF;
  IF v_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid
     OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ALREADY_ADMIN: الحساب مضاف للإدارة بالفعل.';
  END IF;

  INSERT INTO public.admin_accounts (user_id, role, created_by, permissions)
  VALUES (v_user_id, 'admin', auth.uid(), v_permissions)
  RETURNING created_at INTO v_created_at;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'role', 'admin',
    'created_at', v_created_at,
    'created_by', auth.uid(),
    'permissions', v_permissions
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_account(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_permissions(p_user_id UUID, p_permissions JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed UUID;
  v_keys CONSTANT TEXT[] := ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant'];
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: تعديل الصلاحيات متاح للمالك فقط.';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_IMMUTABLE: صلاحيات مالك النظام ثابتة.';
  END IF;
  IF p_permissions IS NULL
     OR jsonb_typeof(p_permissions) <> 'object'
     OR NOT (p_permissions ?& v_keys)
     OR p_permissions - v_keys <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM unnest(v_keys) AS k WHERE jsonb_typeof(p_permissions -> k) <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_PERMISSIONS: اختر صلاحية صحيحة لكل قسم.';
  END IF;

  UPDATE public.admin_accounts AS a
  SET permissions = p_permissions
  WHERE a.user_id = p_user_id AND a.role = 'admin'
  RETURNING a.user_id INTO v_changed;
  IF v_changed IS NULL THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_permissions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_permissions(UUID, JSONB) TO authenticated;

-- RLS يميز بين قراءة الأقسام وكتابتها. قسم واحد لا يمنح تعديل الأقسام الأخرى.
DROP POLICY IF EXISTS "Admins full access to members" ON public.members;
DROP POLICY IF EXISTS "Admin read members by feature" ON public.members;
DROP POLICY IF EXISTS "Admin insert members" ON public.members;
DROP POLICY IF EXISTS "Admin update members" ON public.members;
DROP POLICY IF EXISTS "Admin delete members" ON public.members;
CREATE POLICY "Admin read members by feature" ON public.members FOR SELECT TO authenticated
USING (
  public.has_admin_permission('dashboard') OR public.has_admin_permission('members')
  OR public.has_admin_permission('tasks') OR public.has_admin_permission('ranking')
  OR public.has_admin_permission('notes') OR public.has_admin_permission('announcements')
  OR public.has_admin_permission('whatsapp') OR public.has_admin_permission('ai_assistant')
);
CREATE POLICY "Admin insert members" ON public.members FOR INSERT TO authenticated
WITH CHECK (public.has_admin_permission('members'));
CREATE POLICY "Admin update members" ON public.members FOR UPDATE TO authenticated
USING (public.has_admin_permission('members')) WITH CHECK (public.has_admin_permission('members'));
CREATE POLICY "Admin delete members" ON public.members FOR DELETE TO authenticated
USING (public.has_admin_permission('members'));

DROP POLICY IF EXISTS "Admins full access to tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admin read tasks by feature" ON public.tasks;
DROP POLICY IF EXISTS "Admin insert tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admin update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admin delete tasks" ON public.tasks;
CREATE POLICY "Admin read tasks by feature" ON public.tasks FOR SELECT TO authenticated
USING (
  public.has_admin_permission('dashboard') OR public.has_admin_permission('tasks')
  OR public.has_admin_permission('whatsapp') OR public.has_admin_permission('ai_assistant')
);
CREATE POLICY "Admin insert tasks" ON public.tasks FOR INSERT TO authenticated
WITH CHECK (public.has_admin_permission('tasks'));
CREATE POLICY "Admin update tasks" ON public.tasks FOR UPDATE TO authenticated
USING (public.has_admin_permission('tasks')) WITH CHECK (public.has_admin_permission('tasks'));
CREATE POLICY "Admin delete tasks" ON public.tasks FOR DELETE TO authenticated
USING (public.has_admin_permission('tasks'));

DROP POLICY IF EXISTS "Admins full access to notes" ON public.notes;
DROP POLICY IF EXISTS "Admin read notes by feature" ON public.notes;
DROP POLICY IF EXISTS "Admin insert notes" ON public.notes;
DROP POLICY IF EXISTS "Admin update notes" ON public.notes;
DROP POLICY IF EXISTS "Admin delete notes" ON public.notes;
CREATE POLICY "Admin read notes by feature" ON public.notes FOR SELECT TO authenticated
USING (
  public.has_admin_permission('dashboard') OR public.has_admin_permission('notes')
  OR public.has_admin_permission('ranking') OR public.has_admin_permission('ai_assistant')
);
CREATE POLICY "Admin insert notes" ON public.notes FOR INSERT TO authenticated
WITH CHECK (public.has_admin_permission('notes'));
CREATE POLICY "Admin update notes" ON public.notes FOR UPDATE TO authenticated
USING (public.has_admin_permission('notes')) WITH CHECK (public.has_admin_permission('notes'));
CREATE POLICY "Admin delete notes" ON public.notes FOR DELETE TO authenticated
USING (public.has_admin_permission('notes'));

DROP POLICY IF EXISTS "Admins full access to announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin read announcements by feature" ON public.announcements;
DROP POLICY IF EXISTS "Admin insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin delete announcements" ON public.announcements;
CREATE POLICY "Admin read announcements by feature" ON public.announcements FOR SELECT TO authenticated
USING (public.has_admin_permission('dashboard') OR public.has_admin_permission('announcements'));
CREATE POLICY "Admin insert announcements" ON public.announcements FOR INSERT TO authenticated
WITH CHECK (public.has_admin_permission('announcements'));
CREATE POLICY "Admin update announcements" ON public.announcements FOR UPDATE TO authenticated
USING (public.has_admin_permission('announcements')) WITH CHECK (public.has_admin_permission('announcements'));
CREATE POLICY "Admin delete announcements" ON public.announcements FOR DELETE TO authenticated
USING (public.has_admin_permission('announcements'));

-- بوابة إرسال حالة التسليم تقبل أعضاء anon برمز الجهاز، والمشرفين فقط عند امتلاك tasks.
DO $$
DECLARE
  v_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef('public.submit_task_status(bigint,bigint,text,text,text,text)'::regprocedure);
  IF position('public.is_admin()' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected admin guard not found in submit_task_status.';
  END IF;
  v_definition := replace(v_definition, 'public.is_admin()', 'public.has_admin_permission(''tasks'')');
  v_definition := replace(v_definition, 'v_is_admin := true;', 'v_is_admin := false;');
  v_definition := replace(v_definition, ' SET search_path TO ' || quote_literal('public'), ' SET search_path TO ' || quote_literal(''));
  EXECUTE v_definition;
END;
$$;

-- صلاحية خاصة للإجراء الذري الذي يحدّث المهمة وترتيب العضو معاً.
DO $$
DECLARE
  v_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef('public.approve_task_submission(bigint,bigint,integer)'::regprocedure);
  IF position('public.is_admin()' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected admin guard not found in approve_task_submission.';
  END IF;
  v_definition := replace(v_definition, 'public.is_admin()', 'public.has_admin_permission(''tasks'')');
  v_definition := replace(v_definition, 'v_is_admin := true;', 'v_is_admin := false;');
  v_definition := replace(v_definition, ' LANGUAGE plpgsql', ' LANGUAGE plpgsql SECURITY DEFINER');
  v_definition := replace(v_definition, ' SET search_path TO ' || quote_literal('public'), ' SET search_path TO ' || quote_literal(''));
  EXECUTE v_definition;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_submission(BIGINT, BIGINT, INTEGER) TO authenticated;

DO $$
DECLARE
  v_definition TEXT;
  v_name TEXT;
  v_permission TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['get_announcement_details', 'get_announcement_stats'] LOOP
    v_permission := 'announcements';
    IF v_name = 'get_announcement_details' THEN
      v_definition := pg_get_functiondef('public.get_announcement_details(bigint)'::regprocedure);
    ELSE
      v_definition := pg_get_functiondef('public.get_announcement_stats(bigint)'::regprocedure);
    END IF;
    IF position('public.is_admin()' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Expected admin guard not found in %.', v_name;
    END IF;
    v_definition := replace(v_definition, 'public.is_admin()', format('public.has_admin_permission(''%s'')', v_permission));
    v_definition := replace(v_definition, 'v_is_admin := true;', 'v_is_admin := false;');
    v_definition := replace(v_definition, ' SET search_path TO ' || quote_literal('public'), ' SET search_path TO ' || quote_literal(''));
    EXECUTE v_definition;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_announcement_details(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_details(BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_announcement_stats(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_announcement_stats(BIGINT) TO authenticated;

-- لا تترك واجهة تحذف دور المشرف وحده؛ حذف الحساب يتم عبر Edge Function
-- يستخدم Service Role ويحذف مستخدم Auth فيسقط admin_accounts عبر FK.
DROP FUNCTION IF EXISTS public.admin_remove_account(UUID);

COMMIT;
