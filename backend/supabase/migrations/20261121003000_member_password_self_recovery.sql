-- Native Auth recovery -> isolated, one-use member password reset.
-- The existing Auth password-write trigger remains the only password-write guard.
BEGIN;

CREATE TABLE IF NOT EXISTS public.member_password_recovery_sessions (
  session_id UUID PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  invitation_id UUID NOT NULL UNIQUE REFERENCES public.member_password_invitations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.member_password_recovery_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_password_recovery_sessions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.member_password_recovery_eligible(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_domain TEXT := pg_catalog.split_part(v_email, '@', 2);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR pg_catalog.char_length(v_email) > 254 THEN
    RETURN FALSE;
  END IF;

  -- Local/test and reserved synthetic identities must never receive a native
  -- recovery message, even when a fixture happens to satisfy the join below.
  IF v_domain IN (
    'phantoms.app', 'phantoms-test.example', 'example.com', 'example.net',
    'example.org', 'localhost', 'test'
  ) OR v_domain LIKE '%.example' THEN
    RETURN FALSE;
  END IF;

  RETURN (
    SELECT count(*) = 1
    FROM public.members AS m
    JOIN public.member_auth_bindings AS b ON b.member_id = m.id
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email
      AND b.normalized_email = v_email
      AND COALESCE(m.work_status, '') = 'active'
      AND b.password_ready IS TRUE
      AND pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email
      AND u.email_confirmed_at IS NOT NULL
      AND pg_catalog.btrim(COALESCE(u.encrypted_password, '')) <> ''
      AND u.banned_until IS NULL
      AND u.deleted_at IS NULL
      AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
      AND NOT EXISTS (
        SELECT 1
        FROM public.admin_accounts AS a
        WHERE a.user_id = u.id
      )
      -- Pending invitations are included here because the existing unique
      -- active-invitation invariant makes them non-replaceable as well.
      AND NOT EXISTS (
        SELECT 1
        FROM public.member_password_invitations AS i
        WHERE i.member_id = m.id
          AND i.status IN ('pending', 'reserved', 'review_required')
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_recovery_eligible(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_recovery_eligible(TEXT) TO service_role;

-- Shared proof for the isolated callback and the prepare RPC. It returns only
-- a boolean and is not executable by browser roles directly.
CREATE OR REPLACE FUNCTION public.member_password_recovery_access_proof()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim TEXT := NULLIF(auth.jwt() ->> 'session_id', '');
  v_session_id UUID;
  v_access JSONB;
  v_member_id BIGINT;
  v_auth_user_id UUID;
  v_email TEXT;
  v_amr JSONB := CASE
    WHEN jsonb_typeof(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) = 'array'
      THEN COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
     OR v_claim IS NULL
     OR v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  BEGIN
    v_session_id := v_claim::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = auth.uid())
     OR EXISTS (
       SELECT 1 FROM public.member_password_recovery_sessions AS r
       WHERE r.session_id = v_session_id
     ) THEN
    RETURN FALSE;
  END IF;

  PERFORM public.assert_member_live_auth_session();
  v_access := public.get_member_password_access();
  IF v_access IS NULL THEN RETURN FALSE; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_amr) AS claim
    WHERE pg_catalog.lower(COALESCE(claim ->> 'method', '')) = 'recovery'
  ) OR NOT EXISTS (
    SELECT 1
    FROM auth.mfa_amr_claims AS c
    WHERE c.session_id = v_session_id
      AND c.authentication_method = 'recovery'
      AND c.updated_at >= pg_catalog.clock_timestamp() - INTERVAL '30 minutes'
  ) THEN
    RETURN FALSE;
  END IF;

  v_member_id := (v_access ->> 'member_id')::BIGINT;
  v_auth_user_id := (v_access ->> 'auth_user_id')::UUID;
  v_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_access ->> 'email', '')));
  RETURN EXISTS (
    SELECT 1
    FROM public.members AS m
    JOIN public.member_auth_bindings AS b ON b.member_id = m.id
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE m.id = v_member_id
      AND b.auth_user_id = v_auth_user_id
      AND b.auth_user_id = auth.uid()
      AND pg_catalog.lower(pg_catalog.btrim(COALESCE(m.email, ''))) = v_email
      AND b.normalized_email = v_email
      AND COALESCE(m.work_status, '') = 'active'
      AND b.password_ready IS TRUE
      AND pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email
      AND u.email_confirmed_at IS NOT NULL
      AND pg_catalog.btrim(COALESCE(u.encrypted_password, '')) <> ''
      AND u.banned_until IS NULL
      AND u.deleted_at IS NULL
      AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
      AND NOT EXISTS (
        SELECT 1 FROM public.member_password_invitations AS i
        WHERE i.member_id = m.id
          AND i.status IN ('pending', 'reserved', 'review_required')
      )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_recovery_access_proof() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.member_password_self_recovery_access()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.member_password_recovery_access_proof();
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_self_recovery_access() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_password_self_recovery_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.member_password_prepare_self_recovery(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim TEXT := NULLIF(auth.jwt() ->> 'session_id', '');
  v_session_id UUID;
  v_access JSONB;
  v_member_id BIGINT;
  v_auth_user_id UUID;
  v_email TEXT;
  v_member public.members;
  v_binding public.member_auth_bindings;
  v_user auth.users;
  v_invitation_id UUID;
  v_amr JSONB := CASE
    WHEN jsonb_typeof(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) = 'array'
      THEN COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_claim IS NULL OR v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'RECOVERY_SESSION_REQUIRED';
  END IF;
  BEGIN
    v_session_id := v_claim::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'RECOVERY_SESSION_REQUIRED';
  END;

  -- An Admin or an arbitrary authenticated session can never mint this reset
  -- invitation. The access RPC also proves the exact live session, binding,
  -- member email, and current Auth identity.
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  PERFORM public.assert_member_live_auth_session();
  v_access := public.get_member_password_access();
  IF v_access IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- Native GoTrue recovery must be present in both the signed JWT and the
  -- server-side session AMR record. URL/query values are never consulted.
  IF NOT public.member_password_recovery_access_proof() THEN
    RAISE EXCEPTION 'RECOVERY_PROOF_REQUIRED';
  END IF;

  v_member_id := (v_access ->> 'member_id')::BIGINT;
  v_auth_user_id := (v_access ->> 'auth_user_id')::UUID;
  v_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_access ->> 'email', '')));
  IF v_member_id IS NULL OR v_auth_user_id IS DISTINCT FROM auth.uid()
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  -- Re-lock and re-check every identity input after the proof checks. The
  -- client supplies no member or Auth identifier.
  SELECT * INTO v_member FROM public.members AS m WHERE m.id = v_member_id FOR UPDATE;
  SELECT * INTO v_binding FROM public.member_auth_bindings AS b WHERE b.member_id = v_member_id FOR UPDATE;
  SELECT * INTO v_user FROM auth.users AS u WHERE u.id = v_auth_user_id FOR UPDATE;
  IF NOT FOUND OR v_member.id IS NULL OR v_binding.member_id IS NULL OR v_user.id IS NULL
     OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_member.email, ''))) IS DISTINCT FROM v_email
     OR COALESCE(v_member.work_status, '') IS DISTINCT FROM 'active'
     OR v_binding.auth_user_id IS DISTINCT FROM v_auth_user_id
     OR v_binding.normalized_email IS DISTINCT FROM v_email
     OR v_binding.password_ready IS NOT TRUE
     OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.email, ''))) IS DISTINCT FROM v_email
     OR v_user.email_confirmed_at IS NULL
     OR pg_catalog.btrim(COALESCE(v_user.encrypted_password, '')) = ''
     OR v_user.banned_until IS NOT NULL
     OR v_user.deleted_at IS NOT NULL
     OR COALESCE(v_user.is_sso_user, false)
     OR NOT (COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email')
     OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_auth_user_id)
     OR EXISTS (
       SELECT 1
       FROM public.member_password_invitations AS i
       WHERE i.member_id = v_member_id
         AND i.status IN ('pending', 'reserved', 'review_required')
     ) THEN
    RAISE EXCEPTION 'REVIEW_REQUIRED';
  END IF;

  -- The invitation and its session redemption marker are one transaction.
  -- No existing operation is expired, released, or overwritten.
  INSERT INTO public.member_password_invitations (
    token_hash, member_id, normalized_email, purpose, expires_at, note,
    created_by, expected_auth_user_id
  ) VALUES (
    p_token_hash, v_member_id, v_email, 'reset',
    pg_catalog.clock_timestamp() + INTERVAL '15 minutes',
    'native recovery', auth.uid(), v_auth_user_id
  ) RETURNING id INTO v_invitation_id;

  INSERT INTO public.member_password_recovery_sessions (session_id, invitation_id)
  VALUES (v_session_id, v_invitation_id);

  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (
    v_invitation_id, v_member_id, 'issued', auth.uid(),
    pg_catalog.jsonb_build_object('purpose', 'reset', 'source', 'native_recovery')
  );

  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'REVIEW_REQUIRED';
END;
$$;

REVOKE ALL ON FUNCTION public.member_password_prepare_self_recovery(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_password_prepare_self_recovery(TEXT) TO authenticated;

COMMIT;
