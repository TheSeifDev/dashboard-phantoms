-- Forward-only correction: member_password_audit.action is constrained to the
-- invitation lifecycle vocabulary (issued, reserved, completed, review_required,
-- revoked, expired, admin_approved). The direct-reset entry point introduced a
-- new label ('direct_reset_started'), so every call failed on the check
-- constraint after the invitation row had already been inserted. The claim is a
-- reservation, so record it as 'reserved' and keep the direct-reset detail in
-- the details object. Nothing else about the claim changes.
BEGIN;

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

  -- A previous link or abandoned claim must never shadow the claim the guard
  -- will pick up for the upcoming Auth write.
  WITH closed AS (
    UPDATE public.member_password_invitations AS i
    SET status = 'revoked', revoked_at = pg_catalog.clock_timestamp()
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
