-- ==========================================================
-- 0022 — تحرير مالك النظام من المعرف الثابت وتأمين جلسات الأعضاء
--
-- 1) إزالة المعرّف الثابت ('8ce17aae-84c1-4c89-a020-8b683a0dbabb')
--    والاعتماد الديناميكي على جدول public.admin_accounts (role = 'owner').
-- 2) تأمين دخول الأعضاء ومنع تزييف الهوية (SEC-CRIT-02):
--    - حظر ربط الأجهزة الجديدة تلقائياً للمتصلين المجهولين (anon).
--    - السماح للأجهزة المرتبطة سابقاً بمتابعة الجلسة تلقائياً.
--    - إلزام ربط الأجهزة الجديدة بتوثيق البريد (Supabase Auth OTP / Magic Link)
--      أو اعتماد الإدارة.
-- ==========================================================
BEGIN;

-- ----------------------------------------------------------
-- 1) دوال فحص الإدارة والمالك الديناميكية
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND a.role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND a.role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

-- ----------------------------------------------------------
-- 2) فحص صلاحيات الأقسام ديناميكياً
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permission = ANY (ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant'])
    THEN EXISTS (
      SELECT 1 FROM public.admin_accounts AS a
      WHERE a.user_id = auth.uid()
        AND (
          a.role = 'owner'
          OR (a.role = 'admin' AND a.permissions @> jsonb_build_object(p_permission, true))
        )
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.has_admin_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(TEXT) TO authenticated;

-- ----------------------------------------------------------
-- 3) بيانات وصول الإدارة
-- ----------------------------------------------------------

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
  SELECT a.role, a.permissions INTO v_role, v_permissions
  FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;

  IF v_role = 'owner' THEN
    v_permissions := v_all_permissions;
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

-- ----------------------------------------------------------
-- 4) إدارة الحسابات للمالك فقط (ديناميكياً)
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_accounts()
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
  IF NOT public.is_owner() THEN
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
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين متاحة للمالك فقط.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;
  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ALREADY_ADMIN: الحساب مضاف للإدارة بالفعل.';
  END IF;
  INSERT INTO public.admin_accounts (user_id, role, created_by, permissions)
  VALUES (v_user_id, 'admin', auth.uid(), v_permissions)
  RETURNING created_at INTO v_created_at;
  RETURN jsonb_build_object('user_id', v_user_id, 'email', v_email, 'role', 'admin', 'created_at', v_created_at, 'created_by', auth.uid(), 'permissions', v_permissions);
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
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'OWNER_ONLY: تعديل الصلاحيات متاح للمالك فقط.';
  END IF;
  IF p_user_id IS NULL OR EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = p_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_IMMUTABLE: صلاحيات مالك النظام ثابتة.';
  END IF;
  IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object'
     OR NOT (p_permissions ?& v_keys) OR p_permissions - v_keys <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM unnest(v_keys) AS k WHERE jsonb_typeof(p_permissions -> k) <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_PERMISSIONS: اختر صلاحية صحيحة لكل قسم.';
  END IF;
  UPDATE public.admin_accounts AS a SET permissions = p_permissions
  WHERE a.user_id = p_user_id AND a.role = 'admin'
  RETURNING a.user_id INTO v_changed;
  IF v_changed IS NULL THEN RAISE EXCEPTION 'ADMIN_NOT_FOUND: حساب المشرف ده مش موجود.'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_permissions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_permissions(UUID, JSONB) TO authenticated;

-- ----------------------------------------------------------
-- 5) تأمين مصادقة الأعضاء وربط الأجهزة (SEC-CRIT-02)
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bind_member_device_session(
  p_email TEXT,
  p_device_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT;
  v_token_hash TEXT;
  v_caller_email TEXT;
BEGIN
  IF p_email IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_email)) = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL: البريد الإلكتروني مطلوب.';
  END IF;
  IF p_device_token IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_device_token)) < 16 OR pg_catalog.char_length(p_device_token) > 128 THEN
    RAISE EXCEPTION 'DEVICE_REQUIRED: رمز الجهاز غير صالح.';
  END IF;

  SELECT m.id INTO v_member_id
  FROM public.members AS m
  WHERE m.email = pg_catalog.lower(pg_catalog.btrim(p_email));

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود في قاعدة البيانات.';
  END IF;

  -- التوثيق إما عبر مستخدم Auth موثق بنفس البريد، أو مشرف نظام
  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF NOT (
    (v_caller_email <> '' AND v_caller_email = pg_catalog.lower(pg_catalog.btrim(p_email)))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: يلزم التحقق من البريد الإلكتروني عبر رمز الدخول أو تأكيد الإدارة.';
  END IF;

  v_token_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.member_device_sessions (member_id, token_hash, created_at, last_seen_at)
  VALUES (v_member_id, v_token_hash, pg_catalog.now(), pg_catalog.now())
  ON CONFLICT (member_id, token_hash)
  DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_member_device_session(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_member_device_session(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_member_by_email(
  p_email TEXT,
  p_device_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMPTZ,
  email TEXT,
  full_name TEXT,
  completion_rank INT,
  bio TEXT,
  device TEXT,
  meeting_attendance TEXT,
  work_status TEXT,
  can_go_alexandria BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT;
  v_token_hash TEXT;
  v_caller_email TEXT;
  v_is_bound BOOLEAN := FALSE;
BEGIN
  IF p_email IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_email)) = 0 OR pg_catalog.char_length(p_email) > 254 THEN
    RETURN;
  END IF;

  SELECT m.id INTO v_member_id
  FROM public.members AS m
  WHERE m.email = pg_catalog.lower(pg_catalog.btrim(p_email));

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  IF p_device_token IS NOT NULL AND pg_catalog.btrim(p_device_token) <> '' AND pg_catalog.char_length(p_device_token) <= 128 THEN
    v_token_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'),
      'hex'
    );

    -- تحقق مما إذا كان هذا الجهاز موثقاً ومرتبطاً بالفعل
    SELECT TRUE INTO v_is_bound
    FROM public.member_device_sessions AS s
    WHERE s.member_id = v_member_id
      AND s.token_hash = v_token_hash
      AND s.last_seen_at >= pg_catalog.now() - INTERVAL '90 days';

    IF v_is_bound THEN
      UPDATE public.member_device_sessions AS s
      SET last_seen_at = pg_catalog.now()
      WHERE s.member_id = v_member_id AND s.token_hash = v_token_hash;
    ELSE
      -- إن لم يكن مربوطاً: لا يُربط إلا إذا كان المتصل موثقاً بالبريد أو إدارياً
      v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(auth.jwt() ->> 'email', '')));
      IF (v_caller_email <> '' AND v_caller_email = pg_catalog.lower(pg_catalog.btrim(p_email))) OR public.is_admin() THEN
        INSERT INTO public.member_device_sessions (member_id, token_hash, created_at, last_seen_at)
        VALUES (v_member_id, v_token_hash, pg_catalog.now(), pg_catalog.now())
        ON CONFLICT (member_id, token_hash)
        DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
        v_is_bound := TRUE;
      END IF;
    END IF;
  END IF;

  -- إرجاع بيانات العضو فقط إذا كان الجهاز موثقاً أو كان المستدعي مشرفاً
  IF v_is_bound OR public.is_admin() THEN
    RETURN QUERY
    SELECT m.id, m.created_at, m.email, m.full_name,
           m.completion_rank, m.bio, m.device, m.meeting_attendance,
           m.work_status, m.can_go_alexandria
    FROM public.members AS m
    WHERE m.id = v_member_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) TO anon, authenticated;

COMMIT;

