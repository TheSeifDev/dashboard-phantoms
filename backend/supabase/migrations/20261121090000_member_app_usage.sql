-- Minimal, client-reported app-use evidence for active password-bound Members.
-- This is not an install proof, device inventory, hardware identifier, or attestation.
-- The Android/platform value and evidence classification are deliberately explicit;
-- client reports remain spoofable by design.
BEGIN;

CREATE TABLE public.member_app_usage (
  member_id BIGINT PRIMARY KEY REFERENCES public.members(id) ON DELETE RESTRICT,
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_app_version TEXT NOT NULL,
  last_app_build TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform = 'android'),
  evidence_classification TEXT NOT NULL DEFAULT 'client_reported'
    CHECK (evidence_classification = 'client_reported'),
  CONSTRAINT member_app_usage_time_order_check CHECK (first_used_at <= last_used_at),
  CONSTRAINT member_app_usage_version_check CHECK (
    last_app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
  ),
  CONSTRAINT member_app_usage_build_check CHECK (
    last_app_build ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
  )
);

CREATE INDEX member_app_usage_last_used_idx
  ON public.member_app_usage (last_used_at DESC, member_id);

ALTER TABLE public.member_app_usage ENABLE ROW LEVEL SECURITY;
-- Browser roles receive no direct table access. All reads/writes below are narrow
-- SECURITY DEFINER RPCs with empty search paths and fresh identity checks.
REVOKE ALL ON TABLE public.member_app_usage FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.member_app_usage IS
  'One-row-per-member, client-reported Android app-use evidence; not install proof, device inventory, hardware IDs, or attestation.';
COMMENT ON COLUMN public.member_app_usage.platform IS
  'Current accepted platform is android only; the client report is spoofable.';
COMMENT ON COLUMN public.member_app_usage.evidence_classification IS
  'Explicitly client_reported; never interpreted as verified installation or attestation.';

CREATE OR REPLACE FUNCTION public.member_record_app_usage(
  p_device_token TEXT,
  p_app_version TEXT,
  p_app_build TEXT
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
  -- Global Admins, including an Admin/Member overlap, never enter the Member path.
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
  IF v_version IS NULL OR v_build IS NULL
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
    v_member_id, v_now, v_now, v_version, v_build, 'android', 'client_reported'
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
      platform = 'android',
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

REVOKE ALL ON FUNCTION public.member_record_app_usage(TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_record_app_usage(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_member_app_usage(p_member_ids BIGINT[])
RETURNS TABLE (
  member_id BIGINT,
  first_used_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_app_version TEXT,
  last_app_build TEXT
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
         u.last_app_version, u.last_app_build
  FROM public.member_app_usage AS u
  WHERE u.member_id = ANY (p_member_ids)
  ORDER BY pg_catalog.array_position(p_member_ids, u.member_id);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_member_app_usage(BIGINT[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_app_usage(BIGINT[]) TO authenticated;

COMMIT;
