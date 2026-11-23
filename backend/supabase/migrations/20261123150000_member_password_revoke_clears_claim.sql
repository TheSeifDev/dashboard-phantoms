-- Forward-only correction: member_password_invitations_lifecycle_check requires a
-- revoked row to carry no claim at all (claim_id, claimed_at, auth_user_id,
-- auth_write_completed_at, completed_at, review_required_at and used_at must be
-- NULL). Both direct-reset paths revoked a reserved claim by only changing the
-- status, so a second reset for the same member failed on the constraint.
BEGIN;

-- Revoking an abandoned claim now clears every claim column, so the member is
-- left with a working sign-in path and no stale reservation.
CREATE OR REPLACE FUNCTION public.member_password_abandon_direct_reset(
  p_invitation_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv public.member_password_invitations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_invitation_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO v_inv FROM public.member_password_invitations AS i WHERE i.id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'missing'); END IF;
  IF v_inv.status NOT IN ('pending', 'reserved', 'review_required') THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', v_inv.status);
  END IF;
  UPDATE public.member_password_invitations AS i
  SET status = 'revoked',
      revoked_at = pg_catalog.clock_timestamp(),
      claim_id = NULL,
      claimed_at = NULL,
      auth_user_id = NULL,
      auth_write_completed_at = NULL,
      completed_at = NULL,
      review_required_at = NULL,
      used_at = NULL
  WHERE i.id = p_invitation_id;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (p_invitation_id, v_inv.member_id, 'revoked', p_actor_user_id,
          pg_catalog.jsonb_build_object('reason', 'direct_reset_abandoned'));
  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'revoked');
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_abandon_direct_reset(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_abandon_direct_reset(UUID, UUID) TO service_role;

-- Opening a new claim supersedes any older reset invitation for the member. The
-- superseded row must be revoked without its claim columns as well.
CREATE OR REPLACE FUNCTION public.member_password_begin_direct_reset(
  p_member_id BIGINT,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_member public.members;
  v_binding public.member_auth_bindings;
  v_identity auth.users;
  v_email TEXT;
  v_claim UUID := extensions.gen_random_uuid();
  v_invitation UUID;
  v_expires TIMESTAMPTZ := pg_catalog.clock_timestamp() + INTERVAL '15 minutes';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('admin_reset', 'self_change') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  SELECT * INTO v_member FROM public.members AS m WHERE m.id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;
  v_email := pg_catalog.lower(pg_catalog.btrim(v_member.email));
  IF (SELECT count(*) FROM public.members AS m
      WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email) <> 1 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  SELECT * INTO v_binding FROM public.member_auth_bindings AS b WHERE b.member_id = p_member_id FOR UPDATE;
  IF NOT FOUND OR v_binding.password_ready IS NOT TRUE
     OR v_binding.normalized_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF p_reason = 'self_change' AND p_actor_user_id IS DISTINCT FROM v_binding.auth_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_identity FROM auth.users AS u WHERE u.id = v_binding.auth_user_id;
  IF NOT FOUND
     OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_identity.email, ''))) <> v_email
     OR v_identity.deleted_at IS NOT NULL OR v_identity.banned_until IS NOT NULL
     OR COALESCE(v_identity.is_sso_user, false)
     OR NOT (COALESCE(v_identity.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email')
     OR COALESCE(v_identity.encrypted_password, '') = ''
     OR v_identity.email_confirmed_at IS NULL
     OR EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_identity.id) THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  WITH closed AS (
    UPDATE public.member_password_invitations AS i
    SET status = 'revoked',
        revoked_at = pg_catalog.clock_timestamp(),
        claim_id = NULL,
        claimed_at = NULL,
        auth_user_id = NULL,
        auth_write_completed_at = NULL,
        completed_at = NULL,
        review_required_at = NULL,
        used_at = NULL
    WHERE i.member_id = p_member_id AND i.purpose = 'reset'
      AND i.status IN ('pending', 'reserved', 'review_required')
    RETURNING i.id
  )
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  SELECT closed.id, p_member_id, 'revoked', p_actor_user_id,
         pg_catalog.jsonb_build_object('reason', 'superseded_by_direct_reset')
  FROM closed;

  INSERT INTO public.member_password_invitations (
    token_hash, member_id, normalized_email, purpose, expires_at, note, created_by,
    expected_auth_user_id, status, claim_id, claimed_at
  ) VALUES (
    pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'), p_member_id, v_email, 'reset',
    v_expires, 'direct-reset:' || p_reason, p_actor_user_id, v_binding.auth_user_id,
    'reserved', v_claim, pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_invitation;

  IF p_reason = 'admin_reset' THEN
    UPDATE public.member_auth_bindings AS b
    SET must_change_password = true, updated_at = pg_catalog.now()
    WHERE b.member_id = p_member_id;
  END IF;

  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_invitation, p_member_id, 'reserved', p_actor_user_id,
          pg_catalog.jsonb_build_object('reason', p_reason, 'mode', 'direct_reset'));

  RETURN pg_catalog.jsonb_build_object(
    'invitation_id', v_invitation,
    'claim_id', v_claim,
    'member_id', p_member_id,
    'email', v_email,
    'auth_user_id', v_binding.auth_user_id,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_begin_direct_reset(BIGINT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_begin_direct_reset(BIGINT, UUID, TEXT) TO service_role;

COMMIT;
