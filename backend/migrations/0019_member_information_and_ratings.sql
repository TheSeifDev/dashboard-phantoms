-- 0019 — نماذج معلومات مرنة للأعضاء ومراجعتها وتقييمها من لوحة الإدارة.
BEGIN;

ALTER TABLE public.admin_accounts
  ALTER COLUMN permissions SET DEFAULT
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"member_info":true}'::jsonb;

ALTER TABLE public.admin_accounts
  DROP CONSTRAINT IF EXISTS admin_accounts_permissions_valid;
UPDATE public.admin_accounts
SET permissions = permissions || jsonb_build_object('member_info', COALESCE((permissions ->> 'members')::boolean, false));

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
    AND jsonb_typeof(permissions -> 'member_info') IS NOT DISTINCT FROM 'boolean'
    AND permissions - ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant', 'member_info']::text[] = '{}'::jsonb
  );

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permission = ANY (ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant', 'member_info'])
    THEN coalesce(auth.uid() = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid, false)
      OR EXISTS (
        SELECT 1 FROM public.admin_accounts AS a
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
  v_all_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"member_info":true}'::jsonb;
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
    'role', v_role, 'email', v_email,
    'permissions', coalesce(v_permissions, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

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
  v_permissions CONSTANT JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"member_info":true}'::jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: إضافة المشرفين متاحة للمالك فقط.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: اكتب بريد إلكتروني صحيح.';
  END IF;
  SELECT u.id INTO v_user_id FROM auth.users AS u WHERE lower(u.email) = v_email LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'ADMIN_USER_NOT_FOUND: لازم الحساب يسجل في النظام أولاً قبل إضافته كمشرف.'; END IF;
  IF v_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid
     OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user_id) THEN
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
  v_keys CONSTANT TEXT[] := ARRAY['dashboard', 'members', 'tasks', 'ranking', 'notes', 'announcements', 'whatsapp', 'ai_assistant', 'member_info'];
BEGIN
  IF auth.uid() IS DISTINCT FROM '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
    RAISE EXCEPTION 'OWNER_ONLY: تعديل الصلاحيات متاح للمالك فقط.';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '8ce17aae-84c1-4c89-a020-8b683a0dbabb'::uuid THEN
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

DROP POLICY IF EXISTS "Admin read members by feature" ON public.members;
CREATE POLICY "Admin read members by feature" ON public.members FOR SELECT TO authenticated
USING (
  public.has_admin_permission('dashboard') OR public.has_admin_permission('members')
  OR public.has_admin_permission('tasks') OR public.has_admin_permission('ranking')
  OR public.has_admin_permission('notes') OR public.has_admin_permission('announcements')
  OR public.has_admin_permission('whatsapp') OR public.has_admin_permission('ai_assistant')
  OR public.has_admin_permission('member_info')
);

CREATE TABLE IF NOT EXISTS public.member_info_fields (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  help_text TEXT NOT NULL DEFAULT '' CHECK (char_length(help_text) <= 300),
  field_type TEXT NOT NULL CHECK (field_type IN ('short_text', 'long_text', 'number', 'date', 'email', 'url', 'yes_no', 'select', 'multi_select', 'json')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_info_fields_active_order_idx
  ON public.member_info_fields (is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS public.member_info_submissions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  "values" JSONB NOT NULL CHECK (jsonb_typeof("values") = 'object'),
  field_labels JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_labels) = 'object'),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  rating_comment TEXT CHECK (rating_comment IS NULL OR char_length(rating_comment) <= 1000),
  rated_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  rated_at TIMESTAMPTZ,
  CHECK ((rating IS NULL AND rated_at IS NULL) OR (rating IS NOT NULL AND rated_at IS NOT NULL))
);
ALTER TABLE public.member_info_submissions
  ADD COLUMN IF NOT EXISTS field_labels JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(field_labels) = 'object');
CREATE INDEX IF NOT EXISTS member_info_submissions_member_time_idx
  ON public.member_info_submissions (member_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS member_info_submissions_time_idx
  ON public.member_info_submissions (submitted_at DESC);

ALTER TABLE public.member_info_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_info_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_info_fields FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_info_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.member_info_fields TO authenticated;
REVOKE ALL ON SEQUENCE public.member_info_fields_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.member_info_fields_id_seq TO authenticated;
GRANT SELECT ON TABLE public.member_info_submissions TO authenticated;

DROP POLICY IF EXISTS "Admin manage member info fields" ON public.member_info_fields;
CREATE POLICY "Admin read member info fields" ON public.member_info_fields FOR SELECT TO authenticated
USING (public.has_admin_permission('member_info'));
CREATE POLICY "Admin insert member info fields" ON public.member_info_fields FOR INSERT TO authenticated
WITH CHECK (public.has_admin_permission('member_info'));
CREATE POLICY "Admin update member info fields" ON public.member_info_fields FOR UPDATE TO authenticated
USING (public.has_admin_permission('member_info')) WITH CHECK (public.has_admin_permission('member_info'));

CREATE POLICY "Admin read member info submissions" ON public.member_info_submissions FOR SELECT TO authenticated
USING (public.has_admin_permission('member_info'));

CREATE OR REPLACE FUNCTION public.get_member_info_form(p_member_id BIGINT, p_device_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fields JSONB;
  v_field_labels JSONB;
  v_submissions JSONB;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id, 'label', f.label, 'help_text', f.help_text,
    'field_type', f.field_type, 'options', f.options,
    'is_required', f.is_required, 'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.id), '[]'::jsonb)
  INTO v_fields
  FROM public.member_info_fields AS f
  WHERE f.is_active;

  SELECT COALESCE(jsonb_object_agg(f.id::TEXT, f.label), '{}'::jsonb)
  INTO v_field_labels
  FROM public.member_info_fields AS f;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'submitted_at', s.submitted_at, 'values', s."values",
    'field_labels', s.field_labels,
    'rating', s.rating, 'rating_comment', s.rating_comment, 'rated_at', s.rated_at
  ) ORDER BY s.submitted_at DESC, s.id DESC), '[]'::jsonb)
  INTO v_submissions
  FROM (
    SELECT * FROM public.member_info_submissions
    WHERE member_id = p_member_id
    ORDER BY submitted_at DESC, id DESC LIMIT 20
  ) AS s;

  RETURN jsonb_build_object('fields', v_fields, 'field_labels', v_field_labels, 'submissions', v_submissions);
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_info_form(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_info_form(BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_member_info(p_member_id BIGINT, p_device_token TEXT, p_values JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id BIGINT;
  v_field RECORD;
  v_field_labels JSONB;
  v_value JSONB;
  v_key TEXT;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_MEMBER_INFO: البيانات المدخلة غير صالحة.';
  END IF;
  IF jsonb_object_length(p_values) > 100 OR pg_catalog.octet_length(p_values::text) > 65536 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_INFO: البيانات المدخلة غير صالحة أو أكبر من الحد المسموح.';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    IF v_key !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'UNKNOWN_MEMBER_INFO_FIELD: بعض الحقول لم تعد متاحة.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.member_info_fields AS f
      WHERE f.id = v_key::BIGINT AND f.is_active
    ) THEN
      RAISE EXCEPTION 'UNKNOWN_MEMBER_INFO_FIELD: بعض الحقول لم تعد متاحة.';
    END IF;
  END LOOP;

  FOR v_field IN SELECT f.id, f.label, f.field_type, f.options, f.is_required
                 FROM public.member_info_fields AS f WHERE f.is_active LOOP
    v_value := p_values -> v_field.id::text;
    IF v_field.is_required AND (
      v_value IS NULL OR v_value = 'null'::jsonb
      OR (jsonb_typeof(v_value) = 'string' AND char_length(btrim(v_value #>> '{}')) = 0)
      OR v_value = '[]'::jsonb
    ) THEN
      RAISE EXCEPTION 'REQUIRED_MEMBER_INFO_MISSING: أكمل الحقول المطلوبة.';
    END IF;
    IF v_value IS NULL OR v_value = 'null'::jsonb THEN CONTINUE; END IF;

    IF (CASE v_field.field_type
      WHEN 'short_text' THEN jsonb_typeof(v_value) <> 'string' OR char_length(v_value #>> '{}') > 500
      WHEN 'long_text' THEN jsonb_typeof(v_value) <> 'string' OR char_length(v_value #>> '{}') > 10000
      WHEN 'number' THEN jsonb_typeof(v_value) <> 'number'
      WHEN 'date' THEN jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
      WHEN 'email' THEN jsonb_typeof(v_value) <> 'string' OR char_length(v_value #>> '{}') > 254 OR (v_value #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      WHEN 'url' THEN jsonb_typeof(v_value) <> 'string' OR char_length(v_value #>> '{}') > 2048 OR (v_value #>> '{}') !~* '^https?://'
      WHEN 'yes_no' THEN jsonb_typeof(v_value) <> 'boolean'
      WHEN 'select' THEN jsonb_typeof(v_value) <> 'string' OR NOT (v_field.options ? (v_value #>> '{}'))
      WHEN 'multi_select' THEN CASE
        WHEN jsonb_typeof(v_value) <> 'array' THEN true
        ELSE EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_value) AS selected(value)
          WHERE jsonb_typeof(selected.value) <> 'string' OR NOT (v_field.options ? (selected.value #>> '{}'))
        )
      END
      WHEN 'json' THEN false
      ELSE true
    END) THEN
      RAISE EXCEPTION 'INVALID_MEMBER_INFO_VALUE: قيمة الحقل «%» غير صالحة.', v_field.label;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(f.id::TEXT, f.label), '{}'::jsonb)
    INTO v_field_labels
  FROM public.member_info_fields AS f
  WHERE f.is_active AND p_values ? f.id::TEXT;

  INSERT INTO public.member_info_submissions (member_id, "values", field_labels)
  VALUES (p_member_id, p_values, v_field_labels)
  RETURNING id INTO v_submission_id;
  RETURN v_submission_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_member_info(BIGINT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_member_info(BIGINT, TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_rate_member_info_submission(p_submission_id BIGINT, p_rating SMALLINT, p_comment TEXT DEFAULT '')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated BIGINT;
  v_comment TEXT := pg_catalog.btrim(COALESCE(p_comment, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('member_info') THEN
    RAISE EXCEPTION 'MEMBER_INFO_PERMISSION_REQUIRED: يلزم امتلاك صلاحية بيانات الأعضاء لتقييم الرد.';
  END IF;
  IF p_submission_id IS NULL OR p_submission_id <= 0 OR p_rating IS NULL OR p_rating < 1 OR p_rating > 5
     OR pg_catalog.char_length(v_comment) > 1000 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_INFO_RATING: بيانات التقييم غير صالحة.';
  END IF;
  UPDATE public.member_info_submissions
  SET rating = p_rating, rating_comment = NULLIF(v_comment, ''), rated_by = auth.uid(), rated_at = now()
  WHERE id = p_submission_id
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN RAISE EXCEPTION 'SUBMISSION_NOT_FOUND: الرد غير موجود.'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_rate_member_info_submission(BIGINT, SMALLINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rate_member_info_submission(BIGINT, SMALLINT, TEXT) TO authenticated;

COMMENT ON TABLE public.member_info_fields IS 'Admin-configurable, typed fields shown in the member portal.';
COMMENT ON TABLE public.member_info_submissions IS 'Member-provided JSON data and its private admin rating.';

COMMIT;
