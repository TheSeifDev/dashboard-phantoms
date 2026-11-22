-- Self-service join used to end in a permanent IDENTITY_CONFLICT whenever the
-- submitted email already had an Auth identity, even when that identity was a
-- stranded sign-in account: no member_auth_bindings row, no members row, not an
-- admin. Such an account cannot read or write any member data, and the join link
-- itself never verifies mailbox ownership, so the conflict only blocked real
-- people (the "email matching alone is not enough" banner) with no way forward.
--
-- This migration lets the join flow adopt exactly that shape:
--   * a bound, admin, disabled, SSO, or already-registered identity stays a hard
--     IDENTITY_CONFLICT;
--   * an adopted identity keeps its Auth UUID, receives the new password, and is
--     bound to the newly created pending-review membership by the same triggers.
BEGIN;

-- Read-only classification used by the enrollment endpoint and by reserve().
CREATE OR REPLACE FUNCTION public.member_password_stranded_identity(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_user auth.users;
  v_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF v_email = '' THEN RETURN pg_catalog.jsonb_build_object('exists', false, 'adoptable', false); END IF;
  SELECT count(*)::integer INTO v_matches
  FROM auth.users AS u
  WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email;
  IF v_matches = 0 THEN RETURN pg_catalog.jsonb_build_object('exists', false, 'adoptable', false); END IF;
  IF v_matches <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('exists', true, 'adoptable', false, 'auth_user_id', NULL);
  END IF;
  SELECT u.* INTO v_user
  FROM auth.users AS u
  WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email;
  RETURN pg_catalog.jsonb_build_object(
    'exists', true,
    'auth_user_id', v_user.id,
    'adoptable', (
      v_user.deleted_at IS NULL
      AND v_user.banned_until IS NULL
      AND NOT COALESCE(v_user.is_sso_user, false)
      AND COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
      AND NOT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_user.id)
      AND NOT EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = v_user.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.members AS m
        WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email
      )
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_stranded_identity(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_stranded_identity(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_reserve(p_token_hash TEXT, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hash TEXT := p_token_hash;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_lock_email TEXT;
  v_was_unbound_join BOOLEAN := false;
  v_inv public.member_password_invitations;
  v_member public.members;
  v_mapping public.member_auth_bindings;
  v_identity auth.users;
  v_claim UUID := extensions.gen_random_uuid();
  v_identity_matches INTEGER;
  v_stranded JSONB := NULL;
  v_adopt_auth_user_id UUID := NULL;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$'
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR pg_catalog.char_length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  SELECT i.normalized_email INTO v_lock_email FROM public.member_password_invitations AS i WHERE i.token_hash = v_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  -- NULL-email join links lock on the recipient's submitted normalized email.
  -- Acquire this shared registration lock before locking/re-reading the invite.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || COALESCE(v_lock_email, v_email), 0)
  );
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE token_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  IF v_inv.status = 'revoked' THEN RAISE EXCEPTION 'REVOKED'; END IF;
  IF v_inv.status = 'expired' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'expired', 'invitation_id', v_inv.id);
  END IF;
  IF v_inv.status = 'pending' AND v_inv.expires_at <= pg_catalog.clock_timestamp() THEN
    UPDATE public.member_password_invitations
    SET status = 'expired', claim_id = NULL, claimed_at = NULL, auth_user_id = NULL,
        auth_write_completed_at = NULL, auth_write_user_id = NULL, completed_at = NULL,
        review_required_at = NULL, revoked_at = NULL, expired_at = pg_catalog.clock_timestamp(), used_at = NULL
    WHERE id = v_inv.id AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
    VALUES (v_inv.id, v_inv.member_id, 'expired', '{}'::jsonb);
    RETURN pg_catalog.jsonb_build_object('status', 'expired', 'invitation_id', v_inv.id);
  END IF;
  IF v_inv.status = 'complete' THEN RAISE EXCEPTION 'ALREADY_USED'; END IF;
  IF v_inv.status IN ('reserved', 'review_required') THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.normalized_email IS NOT NULL AND v_inv.normalized_email <> v_email THEN RAISE EXCEPTION 'WRONG_EMAIL'; END IF;

  IF v_inv.purpose = 'join' THEN
    IF v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    v_was_unbound_join := v_inv.normalized_email IS NULL;
    IF EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email) THEN
      -- A member row already owns this address; the join must not create a second one.
      RETURN pg_catalog.jsonb_build_object('status', 'identity_conflict');
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users AS u WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email) THEN
      -- Only a stranded sign-in identity (no binding, no member row, not an admin)
      -- may be adopted; everything else stays a hard conflict.
      v_stranded := public.member_password_stranded_identity(v_email);
      IF (v_stranded ->> 'adoptable') IS DISTINCT FROM 'true' THEN
        -- Return normally so the pending link remains usable with another address.
        RETURN pg_catalog.jsonb_build_object('status', 'identity_conflict');
      END IF;
      v_adopt_auth_user_id := (v_stranded ->> 'auth_user_id')::UUID;
    END IF;
    IF EXISTS (SELECT 1 FROM public.member_password_invitations AS i
               WHERE i.id <> v_inv.id AND i.normalized_email = v_email AND i.purpose = 'join'
                 AND i.status IN ('pending', 'reserved', 'review_required')
                 AND (i.status <> 'pending' OR i.expires_at > pg_catalog.clock_timestamp())) THEN
      RETURN pg_catalog.jsonb_build_object('status', 'identity_conflict');
    END IF;
    IF v_was_unbound_join THEN
      -- Expire stale email-bound join links while holding the same email lock;
      -- their audit rows and this new binding commit together.
      WITH expired AS (
        UPDATE public.member_password_invitations AS i
        SET status = 'expired', expired_at = pg_catalog.clock_timestamp()
        WHERE i.id <> v_inv.id AND i.normalized_email = v_email AND i.purpose = 'join'
          AND i.status = 'pending' AND i.expires_at <= pg_catalog.clock_timestamp()
        RETURNING i.id, i.member_id
      )
      INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
      SELECT expired.id, expired.member_id, 'expired', '{}'::jsonb FROM expired;
      UPDATE public.member_password_invitations
      SET normalized_email = v_email
      WHERE id = v_inv.id AND status = 'pending' AND normalized_email IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
      v_inv.normalized_email := v_email;
    END IF;
  ELSE
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

    SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_inv.normalized_email;
    IF v_identity_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    SELECT u.* INTO v_identity FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_inv.normalized_email;
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
    IF v_inv.purpose = 'reset' AND (v_mapping.member_id IS NULL OR v_inv.expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
  END IF;

  UPDATE public.member_password_invitations
  SET normalized_email = v_email, status = 'reserved', claim_id = v_claim, claimed_at = pg_catalog.clock_timestamp()
  WHERE id = v_inv.id AND status = 'pending'
    AND normalized_email IS NOT DISTINCT FROM v_inv.normalized_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
  VALUES (v_inv.id, v_inv.member_id, 'reserved', pg_catalog.jsonb_build_object(
    'purpose', v_inv.purpose,
    'identity_adopted', v_adopt_auth_user_id IS NOT NULL
  ));
  RETURN pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'claim_id', v_claim,
    'member_id', v_inv.member_id, 'email', v_email, 'purpose', v_inv.purpose,
    'expected_auth_user_id', v_inv.expected_auth_user_id,
    'adopt_auth_user_id', v_adopt_auth_user_id);
EXCEPTION WHEN unique_violation THEN
  IF v_was_unbound_join THEN
    RETURN pg_catalog.jsonb_build_object('status', 'identity_conflict');
  END IF;
  RAISE EXCEPTION 'REVIEW_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_reserve(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_reserve(TEXT, TEXT) TO service_role;

-- The Auth write guard must accept the adoption UPDATE: the same reserved join
-- invitation now proves the write, and the adopted identity must still be
-- stranded (no binding, no member row) before the password change is recorded.
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
      AND i.purpose IN ('enroll', 'join') AND i.status IN ('reserved', 'review_required')
    ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1 FOR UPDATE;
    IF v_inv.id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = NEW.id) THEN RETURN NEW; END IF;
    SELECT b.* INTO v_binding FROM public.member_auth_bindings AS b WHERE b.auth_user_id = NEW.id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_inv FROM public.member_password_invitations AS i
      WHERE i.expected_auth_user_id = NEW.id AND i.status IN ('reserved', 'review_required')
      ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1 FOR UPDATE;
      IF v_inv.id IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    ELSE
      SELECT * INTO v_inv FROM public.member_password_invitations AS i
      WHERE (i.expected_auth_user_id = NEW.id OR (i.expected_auth_user_id IS NULL
        AND i.purpose IN ('enroll', 'join')
        AND i.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.email, '')))))
        AND i.status IN ('reserved', 'review_required')
      ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1 FOR UPDATE;
      IF v_inv.id IS NULL THEN RETURN NEW; END IF;
    END IF;
  END IF;

  IF v_inv.status = 'review_required' OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = NEW.id) THEN RETURN NEW; END IF;
  IF v_email <> v_inv.normalized_email
     OR pg_catalog.btrim(COALESCE(NEW.encrypted_password, '')) = ''
     OR (NEW.email_confirmed_at IS NULL AND NOT (
       TG_OP = 'INSERT' AND v_inv.purpose IN ('enroll', 'join')
       AND v_inv.expected_auth_user_id IS NULL AND v_inv.status = 'reserved'
       AND v_inv.auth_write_completed_at IS NULL
     )) OR NEW.banned_until IS NOT NULL OR NEW.deleted_at IS NOT NULL
     OR COALESCE(NEW.is_sso_user, false) OR NOT (COALESCE(NEW.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF (SELECT count(*) FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_inv.normalized_email
      AND (TG_OP = 'INSERT' OR u.id <> NEW.id)) > 0 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;

  IF v_inv.purpose = 'join' THEN
    -- INSERT creates a fresh identity; UPDATE adopts a stranded one. Both must
    -- arrive with no existing binding and no member row for the address.
    IF v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email)
       OR EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = NEW.id) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
  ELSE
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
