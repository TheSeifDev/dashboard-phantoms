-- Forward-only member password session guards.
-- Member portal/device access requires the exact live GoTrue session named by
-- the signed JWT. Admin behavior remains unchanged and is still determined by
-- public.is_admin(); no global sign-out or Auth epoch is introduced.
BEGIN;

CREATE OR REPLACE FUNCTION public.assert_member_live_auth_session()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim TEXT := NULLIF(auth.jwt() ->> 'session_id', '');
  v_session_id UUID;
BEGIN
  IF auth.uid() IS NULL OR v_claim IS NULL
     OR v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'MEMBER_SESSION_REQUIRED';
  END IF;
  BEGIN
    v_session_id := v_claim::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MEMBER_SESSION_REQUIRED';
  END;
  IF NOT EXISTS (
    SELECT 1
    FROM auth.sessions AS s
    WHERE s.id = v_session_id
      AND s.user_id = auth.uid()
      AND (s.not_after IS NULL OR s.not_after > pg_catalog.clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'MEMBER_SESSION_REQUIRED';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_member_live_auth_session() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_member_password_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NULL; END IF;
  PERFORM public.assert_member_live_auth_session();
  SELECT jsonb_build_object('member_id', m.id, 'email', pg_catalog.lower(pg_catalog.btrim(m.email)), 'auth_user_id', b.auth_user_id,
    'active', true, 'password_ready', b.password_ready)
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

CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id BIGINT, p_device_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token_hash TEXT; v_auth_user_id UUID; v_ready BOOLEAN; v_status TEXT;
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_device_token IS NULL OR pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  IF NOT public.is_admin() THEN
    PERFORM public.assert_member_live_auth_session();
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
  SELECT count(*)::BIGINT INTO v_member_id FROM public.members WHERE pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_member_id = 0 THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF v_member_id > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT id INTO v_member_id FROM public.members WHERE pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = v_member_id AND status IN ('reserved', 'review_required')) THEN RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED'; END IF;
  IF NOT v_is_admin THEN
    PERFORM public.assert_member_live_auth_session();
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
  SELECT count(*)::BIGINT INTO v_member_id FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF v_member_id = 0 THEN RETURN; END IF;
  IF v_member_id > 1 THEN RETURN; END IF;
  SELECT m.id INTO v_member_id FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF EXISTS (SELECT 1 FROM public.member_password_invitations WHERE member_id = v_member_id AND status IN ('reserved', 'review_required')) THEN RETURN; END IF;
  IF NOT v_is_admin THEN
    PERFORM public.assert_member_live_auth_session();
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

-- A bound, non-admin identity may change its password only through the exact
-- active reservation for that Auth UUID. Unbound identities and administrators
-- retain existing Auth insert/update behavior.
CREATE OR REPLACE FUNCTION public.guard_member_password_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv public.member_password_invitations;
  v_binding public.member_auth_bindings;
  v_member public.members;
  v_claimed BOOLEAN;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.encrypted_password, '') = '' THEN RETURN NEW; END IF;
    SELECT * INTO v_inv FROM public.member_password_invitations AS i
    WHERE i.normalized_email = v_email AND i.expected_auth_user_id IS NULL
      AND i.purpose = 'enroll' AND i.status IN ('reserved', 'review_required')
    ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1;
    IF v_inv.id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN RETURN NEW; END IF;
    -- An Admin/Member overlap remains an ordinary Admin Auth operation.
    IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = NEW.id) THEN RETURN NEW; END IF;
    SELECT b.* INTO v_binding FROM public.member_auth_bindings AS b WHERE b.auth_user_id = NEW.id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_inv FROM public.member_password_invitations AS i
      WHERE i.expected_auth_user_id = NEW.id AND i.status IN ('reserved', 'review_required')
      ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1;
      IF v_inv.id IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    ELSE
      SELECT * INTO v_inv FROM public.member_password_invitations AS i
      WHERE (i.expected_auth_user_id = NEW.id OR (i.expected_auth_user_id IS NULL
        AND i.purpose = 'enroll' AND i.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.email, '')))))
        AND i.status IN ('reserved', 'review_required')
      ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1;
      IF v_inv.id IS NULL THEN RETURN NEW; END IF;
    END IF;
  END IF;

  IF v_inv.status = 'review_required' OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = NEW.id) THEN RETURN NEW; END IF;
  IF v_email <> v_inv.normalized_email
     OR pg_catalog.btrim(COALESCE(NEW.encrypted_password, '')) = ''
     OR NEW.email_confirmed_at IS NULL OR NEW.banned_until IS NOT NULL OR NEW.deleted_at IS NOT NULL
     OR COALESCE(NEW.is_sso_user, false) OR NOT (COALESCE(NEW.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF (SELECT count(*) FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_inv.normalized_email
      AND (TG_OP = 'INSERT' OR u.id <> NEW.id)) > 0 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  SELECT * INTO v_member FROM public.members AS m WHERE m.id = v_inv.member_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active'
     OR pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_inv.normalized_email
     OR (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email) <> 1 THEN
    RAISE EXCEPTION 'MEMBER_DISABLED';
  END IF;
  IF v_inv.purpose = 'enroll' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.encrypted_password, '') <> '' THEN RAISE EXCEPTION 'PASSWORD_ALREADY_SET'; END IF;
  ELSE
    SELECT * INTO v_binding FROM public.member_auth_bindings AS b WHERE b.member_id = v_inv.member_id FOR UPDATE;
    IF NOT FOUND OR v_binding.auth_user_id IS DISTINCT FROM NEW.id
       OR v_binding.normalized_email IS DISTINCT FROM v_inv.normalized_email OR v_binding.password_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
  END IF;
  UPDATE public.member_password_invitations
  SET auth_write_completed_at = pg_catalog.clock_timestamp(), auth_write_user_id = NEW.id
  WHERE id = v_inv.id AND status = 'reserved' AND auth_write_completed_at IS NULL
    AND expires_at > pg_catalog.clock_timestamp()
  RETURNING TRUE INTO v_claimed;
  IF COALESCE(v_claimed, false) IS NOT TRUE THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_member_password_write() FROM PUBLIC, anon, authenticated;

COMMIT;
