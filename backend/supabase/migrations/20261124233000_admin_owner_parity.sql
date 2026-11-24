-- Round 35 — المشرف بياخد نفس صلاحيات المالك، والمالك هو اللي بيتحكم فيها.
--
-- الفكرة:
--   * القدرات (capabilities) بقت تقدر تكون **دائمة**: منحة من غير تاريخ انتهاء.
--   * كل المشرفين الحاليين والجدد بياخدوا full_owner + app_usage دائمين، يعني
--     بيشوفوا نفس اللي المالك بيشوفه (مين نزّل التطبيق، مين ربط تلجرام، الفرق
--     الداخلية، الحذف النهائي...) وبنفس التعاملات.
--   * المالك بس هو اللي بيقدر يمنح أو يسحب أي قدرة لأي مشرف، من غير طلبات ولا
--     مدة. إدارة حسابات المشرفين نفسها (إضافة/إزالة/تغيير الدور) بتفضل للمالك
--     الحقيقي عشان محدش يقدر يزوّد صلاحياته بنفسه.
--   * get_admin_access بيرجّع owner_authority عشان الواجهة تفتح للمشرف نفس
--     مسارات المالك بدل ما تكون مربوطة بدور owner.
BEGIN;

-- 1) منح دائمة ----------------------------------------------------------------
ALTER TABLE public.admin_capability_grants
  ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN public.admin_capability_grants.expires_at IS
  'NULL means the grant is permanent until the owner revokes it.';

CREATE OR REPLACE FUNCTION public.user_has_capability(p_user_id UUID, p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN public.is_owner_role(p_user_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.admin_capability_grants AS g
      WHERE g.user_id = p_user_id
        AND g.capability = p_capability
        AND (g.expires_at IS NULL OR g.expires_at > pg_catalog.now())
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.user_has_capability(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_capability(UUID, TEXT) TO authenticated, service_role;

-- 2) بيانات الوصول: owner_authority للواجهة ----------------------------------
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
  v_all_permissions CONSTANT JSONB :=
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
  v_teams JSONB := '[]'::jsonb;
  v_owner_until TIMESTAMPTZ;
  v_owner_permanent BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'is_team_admin', false,
      'owner_authority', false, 'owner_authority_until', NULL, 'owner_authority_permanent', false,
      'role', NULL, 'email', NULL, 'permissions', '{}'::jsonb, 'teams', '[]'::jsonb);
  END IF;
  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  SELECT a.role, a.permissions INTO v_role, v_permissions
  FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;
  IF v_role = 'owner' THEN
    v_permissions := v_all_permissions;
  ELSIF v_role = 'admin' THEN
    v_permissions := COALESCE(v_permissions, '{}'::jsonb) ||
      jsonb_build_object('web_projects', COALESCE((v_permissions ->> 'web_projects')::boolean, false));
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', NULL, 'permissions', v_permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams FROM public.teams AS t WHERE t.is_active;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', a.role, 'permissions', a.permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams
    FROM public.team_admin_assignments AS a
    JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
    JOIN auth.users AS u ON u.id = a.user_id AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
    WHERE a.user_id = v_user_id;
  END IF;
  -- نافذة صلاحيات المالك (منحة full_owner) — دائمة أو مؤقتة.
  SELECT max(g.expires_at), COALESCE(bool_or(g.expires_at IS NULL), false)
  INTO v_owner_until, v_owner_permanent
  FROM public.admin_capability_grants AS g
  WHERE g.user_id = v_user_id AND g.capability = 'full_owner'
    AND (g.expires_at IS NULL OR g.expires_at > pg_catalog.now());
  IF v_role = 'owner' THEN v_owner_permanent := true; END IF;
  RETURN jsonb_build_object(
    'is_admin', COALESCE(v_role IN ('owner','admin'), false),
    'is_owner', COALESCE(v_role = 'owner', false),
    -- سلطة المالك الفعلية: المالك الحقيقي أو مشرف عنده full_owner سارية.
    'owner_authority', COALESCE(public.user_has_capability(v_user_id, 'full_owner'), false),
    'owner_authority_until', v_owner_until,
    'owner_authority_permanent', COALESCE(v_owner_permanent, false),
    'is_team_admin', EXISTS (
      SELECT 1 FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      WHERE a.user_id = v_user_id AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
    ),
    'role', v_role, 'email', v_email, 'permissions', COALESCE(v_permissions, '{}'::jsonb), 'teams', v_teams
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

-- 3) المالك بيمنح/بيسحب قدرة لأي مشرف، دائمًا --------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_capability(
  p_user_id UUID,
  p_capability TEXT,
  p_granted BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_granted BOOLEAN;
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner_role(v_uid) THEN
    RAISE EXCEPTION 'OWNER_ONLY: منح الصلاحيات للمالك بس.';
  END IF;
  IF p_user_id IS NULL OR p_granted IS NULL OR NOT public.is_capability_key(p_capability) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  SELECT a.role INTO v_role FROM public.admin_accounts AS a WHERE a.user_id = p_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION 'ADMIN_NOT_FOUND'; END IF;
  IF v_role = 'owner' THEN RAISE EXCEPTION 'OWNER_IMMUTABLE: صلاحيات المالك ثابتة.'; END IF;
  -- المنح السابقة (مؤقتة أو دائمة) بتتشال قبل الكتابة عشان مفيش تعارض.
  DELETE FROM public.admin_capability_grants AS g
  WHERE g.user_id = p_user_id AND g.capability = p_capability;
  IF p_granted THEN
    INSERT INTO public.admin_capability_grants (user_id, capability, granted_by, expires_at)
    VALUES (p_user_id, p_capability, v_uid, NULL);
  END IF;
  v_granted := public.user_has_capability(p_user_id, p_capability);
  RETURN pg_catalog.jsonb_build_object(
    'user_id', p_user_id, 'capability', p_capability, 'granted', v_granted
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_capability(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_capability(UUID, TEXT, BOOLEAN) TO authenticated;

-- 4) مصفوفة القدرات لكل المشرفين (للمالك) ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_capability_matrix()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner_role(v_uid) THEN
    RAISE EXCEPTION 'OWNER_ONLY: مصفوفة الصلاحيات بتظهر للمالك بس.';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'user_id', a.user_id,
    'email', u.email,
    'role', a.role,
    'permissions', COALESCE(a.permissions, '{}'::jsonb),
    'capabilities', (
      SELECT COALESCE(pg_catalog.jsonb_object_agg(k.key, pg_catalog.jsonb_build_object(
        'allowed', CASE WHEN a.role = 'owner' THEN true
                        ELSE public.user_has_capability(a.user_id, k.key) END,
        'permanent', CASE WHEN a.role = 'owner' THEN true
                          ELSE EXISTS (
                            SELECT 1 FROM public.admin_capability_grants AS g
                            WHERE g.user_id = a.user_id AND g.capability = k.key
                              AND g.expires_at IS NULL
                          ) END,
        'granted_until', (
          SELECT g.expires_at FROM public.admin_capability_grants AS g
          WHERE g.user_id = a.user_id AND g.capability = k.key
            AND (g.expires_at IS NULL OR g.expires_at > pg_catalog.now())
          ORDER BY g.expires_at DESC NULLS FIRST LIMIT 1
        )
      )), '{}'::jsonb)
      FROM (SELECT unnest(ARRAY['full_owner','admin_accounts','admin_password_reset','strikes','app_usage']) AS key) AS k
    )
  ) ORDER BY (a.role = 'owner') DESC, u.email), '[]'::jsonb)
  INTO v_rows
  FROM public.admin_accounts AS a
  JOIN auth.users AS u ON u.id = a.user_id;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_capability_matrix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_capability_matrix() TO authenticated;

-- 5) صندوق المالك: يقرأ المنح الدائمة كذلك -----------------------------------
CREATE OR REPLACE FUNCTION public.admin_capability_inbox()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_requests JSONB;
  v_grants JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner_role(v_uid) THEN
    RAISE EXCEPTION 'OWNER_ONLY: طلبات الصلاحيات بتظهر للمالك بس.';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', r.id,
    'user_id', r.user_id,
    'email', u.email,
    'capability', r.capability,
    'note', r.note,
    'status', r.status,
    'requested_at', r.requested_at,
    'decided_at', r.decided_at,
    'decided_note', r.decided_note,
    'duration_minutes', r.duration_minutes,
    'expires_at', r.expires_at
  ) ORDER BY r.requested_at DESC), '[]'::jsonb)
  INTO v_requests
  FROM public.admin_capability_requests AS r
  JOIN auth.users AS u ON u.id = r.user_id
  WHERE r.requested_at > pg_catalog.now() - INTERVAL '30 days';
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', g.id,
    'user_id', g.user_id,
    'email', u.email,
    'capability', g.capability,
    'granted_at', g.granted_at,
    'expires_at', g.expires_at,
    'permanent', g.expires_at IS NULL
  ) ORDER BY g.expires_at NULLS LAST, g.granted_at DESC), '[]'::jsonb)
  INTO v_grants
  FROM public.admin_capability_grants AS g
  JOIN auth.users AS u ON u.id = g.user_id
  WHERE g.expires_at IS NULL OR g.expires_at > pg_catalog.now();
  RETURN pg_catalog.jsonb_build_object('requests', v_requests, 'grants', v_grants);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_capability_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_capability_inbox() TO authenticated;

-- 6) الموافقة على طلب: p_minutes NULL = منحة دائمة ----------------------------
CREATE OR REPLACE FUNCTION public.admin_decide_capability_request(
  p_request_id BIGINT,
  p_approve BOOLEAN,
  p_minutes INTEGER DEFAULT 1440,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request public.admin_capability_requests;
  v_minutes INTEGER;
  v_grant_id BIGINT;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner_role(v_uid) THEN
    RAISE EXCEPTION 'OWNER_ONLY: الموافقة على الصلاحيات للمالك بس.';
  END IF;
  IF p_request_id IS NULL OR p_approve IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO v_request FROM public.admin_capability_requests AS r
  WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF p_approve THEN
    IF p_minutes IS NULL THEN
      v_expires := NULL; -- منحة دائمة لحد ما المالك يسحبها
    ELSE
      v_minutes := GREATEST(15, LEAST(p_minutes, 43200)); -- 15 دقيقة .. 30 يوم
      v_expires := pg_catalog.now() + (v_minutes || ' minutes')::INTERVAL;
    END IF;
    DELETE FROM public.admin_capability_grants AS g
    WHERE g.user_id = v_request.user_id AND g.capability = v_request.capability;
    INSERT INTO public.admin_capability_grants (user_id, capability, request_id, granted_by, expires_at)
    VALUES (v_request.user_id, v_request.capability, v_request.id, v_uid, v_expires)
    RETURNING id INTO v_grant_id;
  END IF;
  UPDATE public.admin_capability_requests AS r
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decided_at = pg_catalog.now(),
      decided_by = v_uid,
      decided_note = NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), ''),
      duration_minutes = CASE WHEN p_approve THEN v_minutes ELSE NULL END,
      expires_at = v_expires
  WHERE r.id = p_request_id;
  RETURN pg_catalog.jsonb_build_object(
    'id', p_request_id,
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'grant_id', v_grant_id,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_decide_capability_request(BIGINT, BOOLEAN, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_capability_request(BIGINT, BOOLEAN, INTEGER, TEXT) TO authenticated;

-- 7) المشرف الجديد بيبدأ بكل الصلاحيات (full_owner + app_usage دائمين) --------
CREATE OR REPLACE FUNCTION public.admin_add_account(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_user_id UUID;
  v_created_at TIMESTAMPTZ;
  v_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
BEGIN
  IF NOT public.has_capability('admin_accounts') THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين محتاجة موافقة المالك.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;
  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
    RAISE EXCEPTION 'ALREADY_ADMIN: الحساب مضاف للإدارة بالفعل.';
  END IF;
  INSERT INTO public.admin_accounts (user_id, role, created_by, permissions)
  VALUES (v_user_id, 'admin', auth.uid(), v_permissions)
  RETURNING created_at INTO v_created_at;
  -- المشرف بياخد سلطة المالك وقدرة استخدام التطبيق دائمًا، والمالك يقدر يسحبها.
  INSERT INTO public.admin_capability_grants (user_id, capability, granted_by, expires_at)
  VALUES (v_user_id, 'full_owner', auth.uid(), NULL),
         (v_user_id, 'app_usage', auth.uid(), NULL)
  ON CONFLICT DO NOTHING;
  RETURN pg_catalog.jsonb_build_object(
    'user_id', v_user_id, 'email', v_email, 'role', 'admin',
    'created_at', v_created_at, 'created_by', auth.uid(), 'permissions', v_permissions
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_account(TEXT) TO authenticated;

-- 8) المشرفين الموجودين حاليًا بياخدوا نفس الصلاحيات --------------------------
INSERT INTO public.admin_capability_grants (user_id, capability, granted_by, expires_at)
SELECT a.user_id, c.capability, a.user_id, NULL
FROM public.admin_accounts AS a
CROSS JOIN (VALUES ('full_owner'), ('app_usage')) AS c(capability)
WHERE a.role = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_capability_grants AS g
    WHERE g.user_id = a.user_id AND g.capability = c.capability
      AND (g.expires_at IS NULL OR g.expires_at > pg_catalog.now())
  );

COMMIT;
