-- =====================================================
-- سجل استخدام التطبيق: دعم iOS + تسجيل حسابات الأدمن
-- =====================================================
-- قبل كده:
--   * العمود platform كان مسموح له 'android' بس، والـ RPC كان بيكتب 'android'
--     ثابت، والتطبيق نفسه كان بيبعت من أندرويد فقط.
--   * أي حساب أدمن (مالك أو أدمن) كان بيترفض من member_record_app_usage،
--     فمكانش بيتسجل إنه نزّل التطبيق أصلًا.
-- بعد كده:
--   * platform يقبل 'android' و 'ios'.
--   * member_record_app_usage بقى بياخد platform (افتراضي android للنسخ القديمة).
--   * admin_record_app_usage جديد: بيسجل استخدام الأدمن لنفسه عبر ربط العضوية.
--   * owner_member_app_usage بيرجّع platform كمان عشان الواجهة تعرض نوع الجهاز.
-- =====================================================

-- 1) platform: android أو ios ------------------------------------------------
ALTER TABLE public.member_app_usage DROP CONSTRAINT IF EXISTS member_app_usage_platform_check;
ALTER TABLE public.member_app_usage
  ADD CONSTRAINT member_app_usage_platform_check CHECK (platform IN ('android', 'ios'));

-- 2) تسجيل استخدام العضو (مع platform) --------------------------------------
DROP FUNCTION IF EXISTS public.member_record_app_usage(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.member_record_app_usage(
  p_device_token TEXT,
  p_app_version TEXT,
  p_app_build TEXT,
  p_platform TEXT DEFAULT 'android'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access JSONB;
  v_member_id BIGINT;
  v_version TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_app_version, '')), '');
  v_build TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_app_build, '')), '');
  v_platform TEXT := pg_catalog.lower(NULLIF(pg_catalog.btrim(COALESCE(p_platform, '')), ''));
  v_now TIMESTAMPTZ;
  v_usage public.member_app_usage;
  v_amr JSONB := CASE
    WHEN pg_catalog.jsonb_typeof(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) = 'array'
      THEN COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  -- Global Admins, including an Admin/Member overlap, never enter the Member path;
  -- they report through admin_record_app_usage instead.
  IF public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  -- Recovery sessions are for isolated password reset only, never ordinary Member use.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_amr) AS claim
    WHERE pg_catalog.lower(COALESCE(claim ->> 'method', '')) = 'recovery'
  ) OR EXISTS (
    SELECT 1
    FROM auth.mfa_amr_claims AS c
    WHERE c.session_id::TEXT = COALESCE(auth.jwt() ->> 'session_id', '')
      AND c.authentication_method = 'recovery'
      AND c.updated_at >= pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
  ) THEN
    RAISE EXCEPTION 'RECOVERY_SESSION_FORBIDDEN';
  END IF;
  IF v_version IS NULL OR v_build IS NULL OR v_platform IS NULL
     OR v_platform NOT IN ('android', 'ios')
     OR v_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
     OR v_build !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- This is the canonical exact Member eligibility gate: live session, exact
  -- Auth/member binding and email, confirmed email/password, active Member,
  -- non-banned/non-deleted/non-SSO Auth identity, and no pending review state.
  v_access := public.get_member_password_access();
  IF v_access IS NULL OR NOT (v_access ? 'member_id') THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  v_member_id := (v_access ->> 'member_id')::BIGINT;
  -- The token is checked only by the existing private device guard; no token,
  -- member id, or timestamp is caller-authoritative.
  PERFORM public.assert_member_device(v_member_id, p_device_token);
  PERFORM 1 FROM public.members WHERE id = v_member_id FOR UPDATE;
  IF NOT FOUND OR public.get_member_password_access() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  -- Timestamp only after serializing this member, not before a lock wait.
  v_now := pg_catalog.clock_timestamp();

  INSERT INTO public.member_app_usage AS u (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build,
    platform, evidence_classification
  ) VALUES (
    v_member_id, v_now, v_now, v_version, v_build, v_platform, 'client_reported'
  )
  ON CONFLICT (member_id) DO UPDATE
  SET last_used_at = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN GREATEST(u.last_used_at, EXCLUDED.last_used_at)
        ELSE u.last_used_at
      END,
      last_app_version = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN EXCLUDED.last_app_version
        ELSE u.last_app_version
      END,
      last_app_build = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN EXCLUDED.last_app_build
        ELSE u.last_app_build
      END,
      platform = EXCLUDED.platform,
      evidence_classification = 'client_reported';

  SELECT u.* INTO v_usage
  FROM public.member_app_usage AS u
  WHERE u.member_id = v_member_id;

  RETURN pg_catalog.jsonb_build_object(
    'member_id', v_usage.member_id,
    'first_used_at', v_usage.first_used_at,
    'last_used_at', v_usage.last_used_at,
    'last_app_version', v_usage.last_app_version,
    'last_app_build', v_usage.last_app_build,
    'platform', v_usage.platform,
    'evidence_classification', v_usage.evidence_classification
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_record_app_usage(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_record_app_usage(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 3) تسجيل استخدام حساب أدمن (مالك أو أدمن) --------------------------------
-- الأدمن بيدخل من بوابة الإدارة، فمش بيمر على مسار العضو. الدالة دي بتسجل
-- استخدامه لنفسه عن طريق ربط عضويته بحساب الدخول، من غير ما تسمح له يسجل
-- استخدام عضو تاني: المعرّف بيتحدد من auth.uid() نفسه.
CREATE OR REPLACE FUNCTION public.admin_record_app_usage(
  p_app_version TEXT,
  p_app_build TEXT,
  p_platform TEXT DEFAULT 'android'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_app_version, '')), '');
  v_build TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_app_build, '')), '');
  v_platform TEXT := pg_catalog.lower(NULLIF(pg_catalog.btrim(COALESCE(p_platform, '')), ''));
  v_member_id BIGINT;
  v_binding_count INT;
  v_now TIMESTAMPTZ;
  v_usage public.member_app_usage;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF NOT (public.is_admin() OR public.is_owner()) THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF v_version IS NULL OR v_build IS NULL OR v_platform IS NULL
     OR v_platform NOT IN ('android', 'ios')
     OR v_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
     OR v_build !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT count(*), min(b.member_id) INTO v_binding_count, v_member_id
  FROM public.member_auth_bindings AS b
  WHERE b.auth_user_id = auth.uid();
  IF v_binding_count = 0 THEN
    RAISE EXCEPTION 'MEMBER_NOT_LINKED';
  END IF;
  IF v_binding_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_BINDING';
  END IF;

  PERFORM 1 FROM public.members WHERE id = v_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND';
  END IF;
  v_now := pg_catalog.clock_timestamp();

  INSERT INTO public.member_app_usage AS u (
    member_id, first_used_at, last_used_at, last_app_version, last_app_build,
    platform, evidence_classification
  ) VALUES (
    v_member_id, v_now, v_now, v_version, v_build, v_platform, 'client_reported'
  )
  ON CONFLICT (member_id) DO UPDATE
  SET last_used_at = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN GREATEST(u.last_used_at, EXCLUDED.last_used_at)
        ELSE u.last_used_at
      END,
      last_app_version = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN EXCLUDED.last_app_version
        ELSE u.last_app_version
      END,
      last_app_build = CASE
        WHEN u.last_used_at <= EXCLUDED.last_used_at - INTERVAL '1 minute'
          OR u.last_app_version IS DISTINCT FROM EXCLUDED.last_app_version
          OR u.last_app_build IS DISTINCT FROM EXCLUDED.last_app_build
        THEN EXCLUDED.last_app_build
        ELSE u.last_app_build
      END,
      platform = EXCLUDED.platform,
      evidence_classification = 'client_reported';

  SELECT u.* INTO v_usage FROM public.member_app_usage AS u WHERE u.member_id = v_member_id;

  RETURN pg_catalog.jsonb_build_object(
    'member_id', v_usage.member_id,
    'first_used_at', v_usage.first_used_at,
    'last_used_at', v_usage.last_used_at,
    'last_app_version', v_usage.last_app_version,
    'last_app_build', v_usage.last_app_build,
    'platform', v_usage.platform,
    'evidence_classification', v_usage.evidence_classification
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_app_usage(TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_app_usage(TEXT, TEXT, TEXT) TO authenticated;

-- 4) قراءة المالك: نرجّع platform كذلك ---------------------------------------
DROP FUNCTION IF EXISTS public.owner_member_app_usage(BIGINT[]);

CREATE OR REPLACE FUNCTION public.owner_member_app_usage(p_member_ids BIGINT[])
RETURNS TABLE (
  member_id BIGINT,
  first_used_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_app_version TEXT,
  last_app_build TEXT,
  platform TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_amr JSONB := CASE
    WHEN pg_catalog.jsonb_typeof(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) = 'array'
      THEN COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
     OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'OWNER_ONLY';
  END IF;
  PERFORM public.assert_member_live_auth_session();
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_amr) AS claim
    WHERE pg_catalog.lower(COALESCE(claim ->> 'method', '')) = 'recovery'
  ) OR EXISTS (
    SELECT 1 FROM auth.mfa_amr_claims AS c
    WHERE c.session_id::TEXT = COALESCE(auth.jwt() ->> 'session_id', '')
      AND c.authentication_method = 'recovery'
      AND c.updated_at >= pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
  ) THEN RAISE EXCEPTION 'RECOVERY_SESSION_FORBIDDEN'; END IF;
  IF p_member_ids IS NULL OR pg_catalog.cardinality(p_member_ids) > 100
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(p_member_ids) AS requested_id
       WHERE requested_id IS NULL OR requested_id <= 0
     ) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  RETURN QUERY
  SELECT u.member_id, u.first_used_at, u.last_used_at,
         u.last_app_version, u.last_app_build, u.platform
  FROM public.member_app_usage AS u
  WHERE u.member_id = ANY (p_member_ids)
  ORDER BY pg_catalog.array_position(p_member_ids, u.member_id);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_member_app_usage(BIGINT[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_app_usage(BIGINT[]) TO authenticated;
