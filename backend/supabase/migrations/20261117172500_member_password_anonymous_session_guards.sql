-- Forward-only correction: reproduce the session-era anonymous denial
-- behavior through a registered migration, without editing migration 28.
-- Exact live sessions remain mandatory for authenticated Member access.
-- Non-admin binding/profile calls authorize identity before member lookup.
BEGIN;

CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id BIGINT, p_device_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token_hash TEXT; v_auth_user_id UUID; v_ready BOOLEAN; v_status TEXT;
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_device_token IS NULL OR pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  IF NOT public.is_admin() THEN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_member_live_auth_session(); END IF;
    SELECT b.auth_user_id, b.password_ready, m.work_status INTO v_auth_user_id, v_ready, v_status
    FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.member_id = p_member_id
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
      AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
      AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email';
    IF v_auth_user_id IS NULL OR v_auth_user_id IS DISTINCT FROM auth.uid() OR NOT COALESCE(v_ready, false)
       OR COALESCE(v_status, '') <> 'active'
       OR EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = p_member_id AND status IN ('reserved', 'review_required')) THEN
      RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED';
    END IF;
  END IF;
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
  UPDATE public.member_device_sessions SET last_seen_at = pg_catalog.now()
  WHERE member_id = p_member_id AND token_hash = v_token_hash AND last_seen_at >= pg_catalog.now() - INTERVAL '90 days';
  IF FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  RAISE EXCEPTION 'DEVICE_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION public.assert_member_device(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bind_member_device_session(p_email TEXT, p_device_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id BIGINT; v_token_hash TEXT; v_is_admin BOOLEAN := public.is_admin();
BEGIN
  IF p_email IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_email)) = 0 OR pg_catalog.char_length(p_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF p_device_token IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_device_token)) < 16 OR pg_catalog.char_length(p_device_token) > 128 THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  -- Do not expose member existence to anonymous or cross-member callers.
  IF NOT v_is_admin AND (auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.member_auth_bindings AS b
    WHERE b.auth_user_id = auth.uid()
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(p_email))
  )) THEN RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED'; END IF;
  SELECT count(*)::BIGINT INTO v_member_id FROM public.members WHERE pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_member_id = 0 THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF v_member_id > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT id INTO v_member_id FROM public.members WHERE pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = v_member_id AND status IN ('reserved', 'review_required')) THEN RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED'; END IF;
  IF NOT v_is_admin THEN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_member_live_auth_session(); END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id JOIN auth.users AS u ON u.id = b.auth_user_id
      WHERE b.member_id = v_member_id AND b.auth_user_id = auth.uid() AND b.password_ready IS TRUE AND COALESCE(m.work_status, '') = 'active'
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
        AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
        AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
        AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
    ) THEN RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED'; END IF;
  END IF;
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.member_device_sessions (member_id, token_hash, created_at, last_seen_at)
  VALUES (v_member_id, v_token_hash, pg_catalog.now(), pg_catalog.now())
  ON CONFLICT (member_id, token_hash) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.bind_member_device_session(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_member_device_session(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_member_by_email(p_email TEXT, p_device_token TEXT DEFAULT NULL)
RETURNS TABLE (id BIGINT, created_at TIMESTAMPTZ, email TEXT, full_name TEXT, completion_rank INT, bio TEXT, device TEXT, meeting_attendance TEXT, work_status TEXT, can_go_alexandria BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id BIGINT; v_token_hash TEXT; v_is_admin BOOLEAN := public.is_admin(); v_bound BOOLEAN := false;
BEGIN
  IF p_email IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_email)) = 0 OR pg_catalog.char_length(p_email) > 254 THEN RETURN; END IF;
  IF NOT v_is_admin AND (auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.member_auth_bindings AS b
    WHERE b.auth_user_id = auth.uid()
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(p_email))
  )) THEN RETURN; END IF;
  SELECT count(*)::BIGINT INTO v_member_id FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_member_id = 0 THEN RETURN; END IF;
  IF v_member_id > 1 THEN RETURN; END IF;
  SELECT m.id INTO v_member_id FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = v_member_id AND status IN ('reserved', 'review_required')) THEN RETURN; END IF;
  IF NOT v_is_admin THEN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_member_live_auth_session(); END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id JOIN auth.users AS u ON u.id = b.auth_user_id
      WHERE b.member_id = v_member_id AND b.auth_user_id = auth.uid() AND b.password_ready IS TRUE AND COALESCE(m.work_status, '') = 'active'
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
        AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
        AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
        AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
        AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
    ) THEN RETURN; END IF;
  END IF;
  IF p_device_token IS NOT NULL AND pg_catalog.btrim(p_device_token) <> '' AND pg_catalog.char_length(p_device_token) <= 128 THEN
    v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
    IF EXISTS (SELECT 1 FROM public.member_device_sessions WHERE member_id = v_member_id AND token_hash = v_token_hash AND last_seen_at >= pg_catalog.now() - INTERVAL '90 days') THEN
      v_bound := true;
    ELSE
      v_bound := false;
    END IF;
    IF v_bound IS NOT TRUE AND NOT v_is_admin THEN RETURN; END IF;
    IF v_bound IS TRUE THEN UPDATE public.member_device_sessions SET last_seen_at = pg_catalog.now() WHERE member_id = v_member_id AND token_hash = v_token_hash; END IF;
  END IF;
  IF v_bound OR v_is_admin THEN
    RETURN QUERY SELECT m.id, m.created_at, m.email, m.full_name, m.completion_rank, m.bio, m.device, m.meeting_attendance, m.work_status, m.can_go_alexandria
    FROM public.members AS m WHERE m.id = v_member_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_member_by_email(TEXT, TEXT) TO anon, authenticated;

COMMIT;
