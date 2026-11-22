-- 20261122070000 — هوية عضو للمالك (Owner) داخل بوابة الأعضاء
-- المالك كان مستبعداً من مسار الأعضاء بسبب شرط public.is_admin() داخل
-- get_member_password_access / get_member_pending_review، فكان لا يستطيع الدخول
-- إلى بوابة الأعضاء رغم امتلاكه حساب Auth صحيح.
--
-- التغييرات:
--   1) get_member_password_access(): إزالة استبعاد المشرفين. الشرط الحقيقي هو
--      وجود صف في member_auth_bindings يربط حساب Auth بعضو فعلي.
--   2) get_member_pending_review(): نفس المعالجة (بدون استبعاد المشرفين).
--   3) ensure_owner_member_identity(): RPC جديد محمي بـ public.is_owner() ينشئ
--      (أو يربط) سجل عضو للمالك ثم يثبّت الربط مع password_ready = true.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_member_password_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
  -- An Admin/Owner account is allowed through the member path only when it has a
  -- real member binding; the binding itself is the identity proof.
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  PERFORM public.assert_member_live_auth_session();
  SELECT pg_catalog.jsonb_build_object(
    'member_id', m.id,
    'email', pg_catalog.lower(pg_catalog.btrim(m.email)),
    'auth_user_id', b.auth_user_id,
    'active', true,
    'password_ready', b.password_ready
  )
  INTO v_result
  FROM public.member_auth_bindings AS b
  JOIN public.members AS m ON m.id = b.member_id
  JOIN auth.users AS u ON u.id = b.auth_user_id
  WHERE b.auth_user_id = auth.uid()
    AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
    AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
    AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
    AND COALESCE(m.work_status, '') = 'active' AND b.password_ready IS TRUE
    AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
    AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
    AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
    AND NOT EXISTS (SELECT 1 FROM public.member_password_invitations AS i WHERE i.member_id = m.id AND i.status IN ('reserved', 'review_required'));
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_password_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_password_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_member_pending_review()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  PERFORM public.assert_member_live_auth_session();
  IF EXISTS (
    SELECT 1
    FROM public.member_auth_bindings AS b
    JOIN public.members AS m ON m.id = b.member_id
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.auth_user_id = auth.uid() AND b.password_ready IS TRUE
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
      AND COALESCE(m.work_status, '') = 'inactive'
      AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
      AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
      AND NOT EXISTS (SELECT 1 FROM public.member_password_invitations AS i
                      WHERE i.member_id = m.id AND i.status IN ('reserved', 'review_required'))
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending_review');
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_pending_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_pending_review() TO authenticated;

-- Idempotent: gives the platform owner a member identity so the member portal,
-- profile settings, ranking and GitHub contributions work for the owner too.
-- Only the owner account can call it, and only for its own verified email.
CREATE OR REPLACE FUNCTION public.ensure_owner_member_identity()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_confirmed TIMESTAMPTZ;
  v_member_id BIGINT;
  v_full_name TEXT;
  v_matches INTEGER;
  v_created BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))), u.email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users AS u
  WHERE u.id = v_uid;

  IF v_email IS NULL OR v_email = '' OR v_confirmed IS NULL THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF v_email <> COALESCE(pg_catalog.lower(pg_catalog.btrim(auth.jwt() ->> 'email')), '') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  -- Already linked: just make sure the binding is usable, never move it.
  SELECT b.member_id INTO v_member_id
  FROM public.member_auth_bindings AS b
  WHERE b.auth_user_id = v_uid;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.member_auth_bindings
    SET password_ready = true, normalized_email = v_email, updated_at = pg_catalog.now()
    WHERE member_id = v_member_id
      AND (password_ready IS NOT TRUE OR normalized_email IS DISTINCT FROM v_email);
    RETURN pg_catalog.jsonb_build_object('member_id', v_member_id, 'email', v_email, 'created', false);
  END IF;

  SELECT count(*)::INTEGER INTO v_matches
  FROM public.members AS m
  WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email;

  IF v_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  IF v_matches = 0 THEN
    SELECT NULLIF(pg_catalog.btrim(COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
    INTO v_full_name
    FROM auth.users AS u
    WHERE u.id = v_uid;
    IF v_full_name IS NULL THEN v_full_name := pg_catalog.split_part(v_email, '@', 1); END IF;
    v_full_name := pg_catalog.left(v_full_name, 160);

    INSERT INTO public.members (email, full_name, completion_rank, work_status)
    VALUES (v_email, v_full_name, 0, 'active')
    RETURNING id INTO v_member_id;
    v_created := true;
  ELSE
    SELECT m.id INTO v_member_id
    FROM public.members AS m
    WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.member_auth_bindings AS b
    WHERE b.member_id = v_member_id AND b.auth_user_id <> v_uid
  ) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
  VALUES (v_member_id, v_uid, v_email, true)
  ON CONFLICT (member_id) DO UPDATE
  SET auth_user_id = EXCLUDED.auth_user_id,
      normalized_email = EXCLUDED.normalized_email,
      password_ready = true,
      updated_at = pg_catalog.now();

  RETURN pg_catalog.jsonb_build_object('member_id', v_member_id, 'email', v_email, 'created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_owner_member_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_owner_member_identity() TO authenticated;

COMMIT;
