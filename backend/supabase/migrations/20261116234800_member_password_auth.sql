-- PHANTOMS member password authentication migration.
-- Local-only until independently reviewed. No production migration is implied.
-- Auth writes remain outside PostgreSQL; reservations are durable and never expire,
-- release, or retry automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS public.member_auth_bindings (
  member_id BIGINT PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  normalized_email TEXT NOT NULL CHECK (normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))),
  password_ready BOOLEAN NOT NULL DEFAULT false,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_auth_bindings_email_key
  ON public.member_auth_bindings (normalized_email);

ALTER TABLE public.member_auth_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_auth_bindings FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.member_password_invitations (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  normalized_email TEXT NOT NULL CHECK (normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))),
  purpose TEXT NOT NULL CHECK (purpose IN ('enroll', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (pg_catalog.char_length(note) <= 500),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expected_auth_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  association_evidence_hash TEXT CHECK (association_evidence_hash IS NULL OR association_evidence_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reserved', 'complete', 'review_required', 'revoked', 'expired')),
  claim_id UUID UNIQUE,
  claimed_at TIMESTAMPTZ,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  auth_write_completed_at TIMESTAMPTZ,
  auth_write_user_id UUID,
  completed_at TIMESTAMPTZ,
  review_required_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.member_password_invitations ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
-- No FK here: a BEFORE INSERT Auth trigger records NEW.id before auth.users
-- contains that row. Completion validates the actual, unique Auth row.
ALTER TABLE public.member_password_invitations ADD COLUMN IF NOT EXISTS auth_write_user_id UUID;
ALTER TABLE public.member_password_invitations DROP CONSTRAINT IF EXISTS member_password_invitation_auth_write_check;
ALTER TABLE public.member_password_invitations ADD CONSTRAINT member_password_invitation_auth_write_check
  CHECK ((auth_write_user_id IS NULL) = (auth_write_completed_at IS NULL));
ALTER TABLE public.member_password_invitations DROP CONSTRAINT IF EXISTS member_password_invitations_check;
ALTER TABLE public.member_password_invitations DROP CONSTRAINT IF EXISTS member_password_invitations_lifecycle_check;
ALTER TABLE public.member_password_invitations ADD CONSTRAINT member_password_invitations_lifecycle_check CHECK (
  (status = 'pending' AND claim_id IS NULL AND claimed_at IS NULL AND auth_user_id IS NULL AND auth_write_completed_at IS NULL AND completed_at IS NULL AND review_required_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL AND used_at IS NULL)
  OR (status = 'reserved' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL AND auth_user_id IS NULL AND completed_at IS NULL AND review_required_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL AND used_at IS NULL)
  OR (status = 'complete' AND claim_id IS NOT NULL AND auth_user_id IS NOT NULL AND auth_write_completed_at IS NOT NULL AND completed_at IS NOT NULL AND used_at IS NOT NULL AND revoked_at IS NULL AND expired_at IS NULL)
  OR (status = 'review_required' AND claim_id IS NOT NULL AND review_required_at IS NOT NULL AND revoked_at IS NULL AND expired_at IS NULL)
  OR (status = 'revoked' AND revoked_at IS NOT NULL AND expired_at IS NULL AND claim_id IS NULL AND claimed_at IS NULL AND auth_user_id IS NULL AND auth_write_completed_at IS NULL AND completed_at IS NULL AND review_required_at IS NULL AND used_at IS NULL)
  OR (status = 'expired' AND expired_at IS NOT NULL AND revoked_at IS NULL AND claim_id IS NULL AND claimed_at IS NULL AND auth_user_id IS NULL AND auth_write_completed_at IS NULL AND completed_at IS NULL AND review_required_at IS NULL AND used_at IS NULL)
);

CREATE INDEX IF NOT EXISTS member_password_invitations_member_status_idx
  ON public.member_password_invitations (member_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS member_password_invitations_pending_expiry_idx
  ON public.member_password_invitations (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS member_password_one_active_per_member
  ON public.member_password_invitations (member_id)
  WHERE status IN ('pending', 'reserved', 'review_required');

ALTER TABLE public.member_password_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_password_invitations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.member_password_audit (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  invitation_id UUID REFERENCES public.member_password_invitations(id) ON DELETE SET NULL,
  member_id BIGINT REFERENCES public.members(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('issued', 'reserved', 'completed', 'review_required', 'revoked', 'expired')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.member_password_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_password_audit FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.member_password_rate_limits (
  key_hash TEXT PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.member_password_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_password_rate_limits FROM PUBLIC, anon, authenticated;

-- Legacy invitation rows remain for audit/history, but no longer have creation,
-- context, or registration authority for any member or password flow. Parameter
-- names intentionally match the historical definitions: PostgreSQL does not
-- permit CREATE OR REPLACE to rename input parameters.
REVOKE ALL ON TABLE public.member_registration_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.member_registration_invites_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_member_invite(
  p_token TEXT,
  p_note TEXT DEFAULT '',
  p_expires_in_hours INT DEFAULT 168
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'MIGRATION_REQUIRED';
END;
$$;
CREATE OR REPLACE FUNCTION public.get_member_invite_context(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'MIGRATION_REQUIRED';
END;
$$;
CREATE OR REPLACE FUNCTION public.submit_member_registration_invite(p_token TEXT, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'MIGRATION_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION public.create_member_invite(TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_member_invite_context(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_member_registration_invite(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_password_service_health()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  PERFORM 1 FROM public.member_password_invitations LIMIT 1;
  PERFORM 1 FROM public.member_auth_bindings LIMIT 1;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_service_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_service_health() TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_check_rate_limit(
  p_key_hash TEXT,
  p_max_attempts INTEGER DEFAULT 8,
  p_window_seconds INTEGER DEFAULT 900,
  p_block_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.member_password_rate_limits;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_attempts < 1 OR p_max_attempts > 1000
     OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_block_seconds < 1 OR p_block_seconds > 86400 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_KEY';
  END IF;
  INSERT INTO public.member_password_rate_limits (key_hash, window_started_at, attempts, blocked_until, updated_at)
  VALUES (p_key_hash, v_now, 1, NULL, v_now)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE WHEN public.member_password_rate_limits.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now THEN v_now ELSE public.member_password_rate_limits.window_started_at END,
    attempts = CASE WHEN public.member_password_rate_limits.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now THEN 1 ELSE public.member_password_rate_limits.attempts + 1 END,
    blocked_until = CASE
      WHEN public.member_password_rate_limits.blocked_until IS NOT NULL AND public.member_password_rate_limits.blocked_until > v_now THEN public.member_password_rate_limits.blocked_until
      WHEN public.member_password_rate_limits.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now THEN NULL
      WHEN public.member_password_rate_limits.attempts + 1 >= p_max_attempts THEN v_now + pg_catalog.make_interval(secs => p_block_seconds)
      ELSE NULL END,
    updated_at = v_now
  RETURNING * INTO v_row;
  RETURN COALESCE(v_row.blocked_until > v_now, false) AND v_row.attempts >= p_max_attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

-- Return only boolean password state; never return or log encrypted_password.
CREATE OR REPLACE FUNCTION public.member_password_identity_by_email(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_user auth.users;
  v_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT count(*)::integer INTO v_matches FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email;
  IF v_matches = 0 THEN RETURN jsonb_build_object('exists', false); END IF;
  IF v_matches <> 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT u.* INTO v_user FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email;
  RETURN jsonb_build_object(
    'exists', true,
    'auth_user_id', v_user.id,
    'email', pg_catalog.lower(COALESCE(v_user.email, '')),
    'has_password', COALESCE(v_user.encrypted_password, '') <> '',
    'email_confirmed', v_user.email_confirmed_at IS NOT NULL,
    'usable', v_user.banned_until IS NULL AND v_user.deleted_at IS NULL AND NOT COALESCE(v_user.is_sso_user, false)
      AND COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email',
    'is_admin', EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user.id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_identity_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_identity_by_email(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_identity_state(p_auth_user_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user auth.users;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT count(*)::integer INTO v_matches FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email;
  IF v_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT u.* INTO v_user FROM auth.users AS u WHERE u.id = p_auth_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  RETURN jsonb_build_object(
    'exists', true,
    'auth_user_id', v_user.id,
    'email', pg_catalog.lower(COALESCE(v_user.email, '')),
    'email_matches', pg_catalog.lower(COALESCE(v_user.email, '')) = v_email,
    'has_password', COALESCE(v_user.encrypted_password, '') <> '',
    'email_confirmed', v_user.email_confirmed_at IS NOT NULL,
    'usable', v_user.banned_until IS NULL AND v_user.deleted_at IS NULL AND NOT COALESCE(v_user.is_sso_user, false)
      AND COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email',
    'is_admin', EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user.id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_identity_state(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_identity_state(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_issue_invitation(
  p_token_hash TEXT,
  p_member_id BIGINT,
  p_email TEXT,
  p_purpose TEXT,
  p_expected_auth_user_id UUID DEFAULT NULL,
  p_association_evidence TEXT DEFAULT NULL,
  p_expires_in_hours INTEGER DEFAULT 168,
  p_note TEXT DEFAULT '',
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_member public.members;
  v_mapping public.member_auth_bindings;
  v_identity auth.users;
  v_actor auth.users;
  v_id UUID;
  v_expires TIMESTAMPTZ;
  v_evidence_hash TEXT;
  v_identity_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT u.* INTO v_actor FROM auth.users AS u WHERE u.id = p_actor_user_id;
  IF NOT FOUND OR v_actor.deleted_at IS NOT NULL OR v_actor.banned_until IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.admin_accounts AS a
       WHERE a.user_id = p_actor_user_id
         AND (a.role = 'owner' OR (a.role = 'admin' AND COALESCE(a.permissions ->> 'members', 'false') = 'true'))
     ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_member_id IS NULL OR p_member_id <= 0
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR pg_catalog.char_length(v_email) > 254
     OR p_purpose NOT IN ('enroll', 'reset')
     OR p_expires_in_hours IS NULL OR p_expires_in_hours < 1 OR p_expires_in_hours > 2160
     OR pg_catalog.char_length(COALESCE(p_note, '')) > 500 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_association_evidence IS NOT NULL AND pg_catalog.char_length(p_association_evidence) > 2000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  SELECT * INTO v_member FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_email THEN RAISE EXCEPTION 'WRONG_EMAIL'; END IF;
  IF (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email) <> 1 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;

  SELECT * INTO v_mapping FROM public.member_auth_bindings WHERE member_id = p_member_id FOR UPDATE;
  IF FOUND AND (p_expected_auth_user_id IS NULL OR p_expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id
      OR v_mapping.normalized_email IS DISTINCT FROM v_email) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email;
  IF v_identity_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT u.* INTO v_identity FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_email;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_identity.id)
       OR v_identity.deleted_at IS NOT NULL OR v_identity.banned_until IS NOT NULL
       OR COALESCE(v_identity.is_sso_user, false)
       OR NOT (COALESCE(v_identity.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF p_expected_auth_user_id IS NULL OR p_expected_auth_user_id IS DISTINCT FROM v_identity.id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    IF p_purpose = 'enroll' AND COALESCE(v_identity.encrypted_password, '') <> '' THEN RAISE EXCEPTION 'PASSWORD_ALREADY_SET'; END IF;
  ELSIF p_expected_auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  IF p_purpose = 'reset' AND (NOT FOUND OR v_mapping.member_id IS NULL OR p_expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF v_mapping.member_id IS NULL AND p_expected_auth_user_id IS NOT NULL
     AND NULLIF(pg_catalog.btrim(COALESCE(p_association_evidence, '')), '') IS NULL THEN
    RAISE EXCEPTION 'REVIEW_REQUIRED';
  END IF;

  v_expires := pg_catalog.now() + pg_catalog.make_interval(hours => p_expires_in_hours);
  v_evidence_hash := CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_association_evidence, '')), '') IS NULL THEN NULL
    ELSE pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_association_evidence), 'UTF8'), 'sha256'), 'hex') END;
  INSERT INTO public.member_password_invitations (
    token_hash, member_id, normalized_email, purpose, expires_at, note, created_by,
    expected_auth_user_id, association_evidence_hash
  ) VALUES (
    p_token_hash, p_member_id, v_email, p_purpose, v_expires,
    pg_catalog.btrim(COALESCE(p_note, '')), p_actor_user_id, p_expected_auth_user_id, v_evidence_hash
  ) RETURNING id INTO v_id;

  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_id, p_member_id, 'issued', p_actor_user_id, jsonb_build_object('purpose', p_purpose, 'evidence_present', v_evidence_hash IS NOT NULL));
  RETURN jsonb_build_object('id', v_id, 'member_id', p_member_id, 'email', v_email, 'purpose', p_purpose, 'note', pg_catalog.btrim(COALESCE(p_note, '')), 'expires_at', v_expires);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'REVIEW_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_issue_invitation(TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_issue_invitation(TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_list_invitations(p_actor_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_accounts AS a JOIN auth.users AS u ON u.id = a.user_id
    WHERE a.user_id = p_actor_user_id AND u.deleted_at IS NULL AND u.banned_until IS NULL
      AND (a.role = 'owner' OR (a.role = 'admin' AND COALESCE(a.permissions ->> 'members', 'false') = 'true'))
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', q.id, 'member_id', q.member_id, 'email', q.normalized_email,
      'purpose', q.purpose, 'status', q.status, 'note', q.note,
      'expires_at', q.expires_at, 'created_at', q.created_at
    ) ORDER BY q.created_at DESC)
    FROM (
      SELECT i.id, i.member_id, i.normalized_email, i.purpose, i.status, i.note, i.expires_at, i.created_at
      FROM public.member_password_invitations AS i
      WHERE i.status IN ('pending', 'reserved', 'review_required')
      ORDER BY i.created_at DESC
      LIMIT 100
    ) AS q
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_list_invitations(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_list_invitations(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_revoke_invitation(p_invitation_id UUID, p_actor_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.member_password_invitations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_accounts AS a JOIN auth.users AS u ON u.id = a.user_id
    WHERE a.user_id = p_actor_user_id AND u.deleted_at IS NULL AND u.banned_until IS NULL
      AND (a.role = 'owner' OR (a.role = 'admin' AND COALESCE(a.permissions ->> 'members', 'false') = 'true'))
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_inv.status IN ('complete', 'review_required', 'reserved') THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.status IN ('revoked', 'expired') THEN RETURN TRUE; END IF;
  UPDATE public.member_password_invitations
  SET status = 'revoked', claim_id = NULL, claimed_at = NULL, auth_user_id = NULL,
      auth_write_completed_at = NULL, completed_at = NULL, review_required_at = NULL,
      revoked_at = pg_catalog.now(), expired_at = NULL, used_at = NULL
  WHERE id = p_invitation_id;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id)
  VALUES (v_inv.id, v_inv.member_id, 'revoked', p_actor_user_id);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_revoke_invitation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_revoke_invitation(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_reserve(p_token_hash TEXT, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hash TEXT := p_token_hash;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_inv public.member_password_invitations;
  v_member public.members;
  v_mapping public.member_auth_bindings;
  v_identity auth.users;
  v_claim UUID := extensions.gen_random_uuid();
  v_identity_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE token_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  IF v_inv.status = 'revoked' THEN RAISE EXCEPTION 'REVOKED'; END IF;
  IF v_inv.status = 'expired' THEN
    RETURN jsonb_build_object('status', 'expired', 'invitation_id', v_inv.id);
  END IF;
  IF v_inv.status = 'pending' AND v_inv.expires_at <= pg_catalog.now() THEN
    UPDATE public.member_password_invitations
    SET status = 'expired', claim_id = NULL, claimed_at = NULL, auth_user_id = NULL,
        auth_write_completed_at = NULL, completed_at = NULL, review_required_at = NULL,
        revoked_at = NULL, expired_at = pg_catalog.now(), used_at = NULL
    WHERE id = v_inv.id AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    INSERT INTO public.member_password_audit (invitation_id, member_id, action, details) VALUES (v_inv.id, v_inv.member_id, 'expired', '{}'::jsonb);
    RETURN jsonb_build_object('status', 'expired', 'invitation_id', v_inv.id);
  END IF;
  IF v_inv.status = 'complete' THEN RAISE EXCEPTION 'ALREADY_USED'; END IF;
  IF v_inv.status IN ('reserved', 'review_required') THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.normalized_email <> v_email THEN RAISE EXCEPTION 'WRONG_EMAIL'; END IF;

  SELECT * INTO v_member FROM public.members WHERE id = v_inv.member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_inv.normalized_email THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  IF (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email) <> 1 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;
  SELECT * INTO v_mapping FROM public.member_auth_bindings WHERE member_id = v_inv.member_id FOR UPDATE;
  IF FOUND AND (v_mapping.auth_user_id IS DISTINCT FROM v_inv.expected_auth_user_id
      OR v_mapping.normalized_email IS DISTINCT FROM v_inv.normalized_email) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_inv.normalized_email;
  IF v_identity_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT u.* INTO v_identity FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_inv.normalized_email;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_identity.id)
       OR v_identity.deleted_at IS NOT NULL OR v_identity.banned_until IS NOT NULL
       OR COALESCE(v_identity.is_sso_user, false)
       OR NOT (COALESCE(v_identity.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF v_inv.expected_auth_user_id IS NULL OR v_inv.expected_auth_user_id IS DISTINCT FROM v_identity.id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    IF v_inv.purpose = 'enroll' AND COALESCE(v_identity.encrypted_password, '') <> '' THEN RAISE EXCEPTION 'PASSWORD_ALREADY_SET'; END IF;
  ELSIF v_inv.expected_auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF v_inv.purpose = 'reset' AND (NOT FOUND OR v_mapping.member_id IS NULL OR v_inv.expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  UPDATE public.member_password_invitations
  SET status = 'reserved', claim_id = v_claim, claimed_at = pg_catalog.now()
  WHERE id = v_inv.id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
  VALUES (v_inv.id, v_inv.member_id, 'reserved', jsonb_build_object('purpose', v_inv.purpose));
  RETURN jsonb_build_object('invitation_id', v_inv.id, 'claim_id', v_claim, 'member_id', v_inv.member_id,
    'email', v_inv.normalized_email, 'purpose', v_inv.purpose, 'expected_auth_user_id', v_inv.expected_auth_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_reserve(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_reserve(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_complete(p_invitation_id UUID, p_claim_id UUID, p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv public.member_password_invitations;
  v_member public.members;
  v_binding public.member_auth_bindings;
  v_user auth.users;
  v_identity_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'reserved' OR v_inv.claim_id IS DISTINCT FROM p_claim_id THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_completed_at IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT * INTO v_member FROM public.members WHERE id = v_inv.member_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active' OR pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_inv.normalized_email THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(u.email) = v_inv.normalized_email;
  IF v_identity_matches <> 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT * INTO v_user FROM auth.users AS u WHERE u.id = p_auth_user_id;
  IF NOT FOUND OR pg_catalog.lower(COALESCE(v_user.email, '')) <> v_inv.normalized_email
     OR v_user.encrypted_password IS NULL OR pg_catalog.btrim(v_user.encrypted_password) = ''
     OR v_user.email_confirmed_at IS NULL OR v_user.banned_until IS NOT NULL OR v_user.deleted_at IS NOT NULL
     OR COALESCE(v_user.is_sso_user, false)
     OR NOT (COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  IF v_inv.expected_auth_user_id IS NOT NULL AND v_inv.expected_auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  SELECT * INTO v_binding FROM public.member_auth_bindings WHERE member_id = v_inv.member_id FOR UPDATE;
  IF FOUND AND (v_binding.auth_user_id IS DISTINCT FROM p_auth_user_id
      OR v_binding.normalized_email IS DISTINCT FROM v_inv.normalized_email) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.member_auth_bindings WHERE auth_user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
    VALUES (v_inv.member_id, p_auth_user_id, v_inv.normalized_email, true);
  ELSE
    UPDATE public.member_auth_bindings SET normalized_email = v_inv.normalized_email, password_ready = true, updated_at = pg_catalog.now() WHERE member_id = v_inv.member_id;
  END IF;

  UPDATE public.member_password_invitations
  SET status = 'complete', auth_user_id = p_auth_user_id, completed_at = pg_catalog.now(), used_at = pg_catalog.now()
  WHERE id = v_inv.id AND status = 'reserved' AND claim_id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_inv.id, v_inv.member_id, 'completed', p_auth_user_id, jsonb_build_object('purpose', v_inv.purpose));
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_complete(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_complete(UUID, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_mark_review_required(p_invitation_id UUID, p_claim_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.member_password_invitations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_inv.claim_id IS DISTINCT FROM p_claim_id OR v_inv.status NOT IN ('reserved', 'complete') THEN RETURN FALSE; END IF;
  UPDATE public.member_password_invitations SET status = 'review_required', review_required_at = pg_catalog.now() WHERE id = v_inv.id;
  IF v_inv.status = 'complete' THEN
    UPDATE public.member_auth_bindings SET password_ready = false, updated_at = pg_catalog.now()
    WHERE member_id = v_inv.member_id AND (v_inv.auth_user_id IS NULL OR auth_user_id = v_inv.auth_user_id);
  END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
  VALUES (v_inv.id, v_inv.member_id, 'review_required', jsonb_build_object('purpose', v_inv.purpose));
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_mark_review_required(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_mark_review_required(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_member_password_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NULL; END IF;
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

-- Member-only device operations require the mapped, active, password-ready
-- Auth identity. Existing admin behavior is left available to admins.
CREATE OR REPLACE FUNCTION public.assert_member_device(p_member_id BIGINT, p_device_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token_hash TEXT; v_auth_user_id UUID; v_ready BOOLEAN; v_status TEXT;
BEGIN
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_device_token IS NULL OR pg_catalog.btrim(p_device_token) = '' OR pg_catalog.char_length(p_device_token) > 128 THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  IF NOT public.is_admin() THEN
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
  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.member_id = v_member_id AND b.auth_user_id = auth.uid() AND b.password_ready IS TRUE AND COALESCE(m.work_status, '') = 'active'
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
      AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
      AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
  ) THEN RAISE EXCEPTION 'MEMBER_PASSWORD_REQUIRED'; END IF;
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
  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.member_auth_bindings AS b JOIN public.members AS m ON m.id = b.member_id JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE b.member_id = v_member_id AND b.auth_user_id = auth.uid() AND b.password_ready IS TRUE AND COALESCE(m.work_status, '') = 'active'
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(m.email))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
      AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
      AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
      AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
  ) THEN RETURN; END IF;
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

-- GoTrue's remote password write is outside the reservation transaction. This
-- trigger validates the actual identity and atomically marks the reservation's
-- one permitted Auth write in the same Auth transaction. It compares only the
-- boolean old-password state and never returns or logs a password hash.
CREATE OR REPLACE FUNCTION public.guard_member_password_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv public.member_password_invitations;
  v_binding public.member_auth_bindings;
  v_member public.members;
  v_claimed BOOLEAN;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
  v_auth_matches INTEGER;
BEGIN
  -- INSERT is only guarded for a reserved, new-member enrollment. Unrelated
  -- Auth/admin inserts retain their existing behavior.
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.encrypted_password, '') = '' THEN RETURN NEW; END IF;
    SELECT * INTO v_inv FROM public.member_password_invitations AS i
    WHERE i.normalized_email = v_email AND i.expected_auth_user_id IS NULL
      AND i.purpose = 'enroll' AND i.status IN ('reserved', 'review_required')
    ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1;
    IF v_inv.id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN RETURN NEW; END IF;
    SELECT * INTO v_inv FROM public.member_password_invitations AS i
    WHERE (i.expected_auth_user_id = NEW.id OR (i.expected_auth_user_id IS NULL
      AND i.purpose = 'enroll' AND i.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.email, '')))))
      AND i.status IN ('reserved', 'review_required')
    ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1;
    IF v_inv.id IS NULL THEN RETURN NEW; END IF;
  END IF;

  IF v_inv.status = 'review_required' THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = NEW.id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, ''))) <> v_inv.normalized_email
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
  SET auth_write_completed_at = pg_catalog.now(), auth_write_user_id = NEW.id
  WHERE id = v_inv.id AND status = 'reserved' AND auth_write_completed_at IS NULL
  RETURNING TRUE INTO v_claimed;
  IF COALESCE(v_claimed, false) IS NOT TRUE THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_member_password_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_member_password_write ON auth.users;
CREATE TRIGGER trg_guard_member_password_write
BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.guard_member_password_write();

COMMIT;
