-- Forward-only member self-service onboarding.
-- An authorized Admin may issue a one-use join link for an email that has no
-- member/Auth identity. The recipient supplies only their own allowlisted
-- profile fields and password. New rows are always inactive pending Admin review.
-- No public signup, email automation, magic-link login, or production operation
-- is introduced by this migration.
BEGIN;

ALTER TABLE public.member_password_invitations
  ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE public.member_password_invitations
  DROP CONSTRAINT IF EXISTS member_password_invitations_purpose_check;
ALTER TABLE public.member_password_invitations
  ADD CONSTRAINT member_password_invitations_purpose_check
  CHECK (purpose IN ('enroll', 'reset', 'join'));

-- A join invitation has no member_id until the recipient finishes the guarded
-- Auth write and profile completion. Keep one active join per normalized email.
CREATE UNIQUE INDEX IF NOT EXISTS member_password_one_active_join_per_email
  ON public.member_password_invitations (normalized_email)
  WHERE purpose = 'join' AND status IN ('pending', 'reserved', 'review_required');

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
  v_expected_auth_user_id UUID := p_expected_auth_user_id;
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
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR pg_catalog.char_length(v_email) > 254
     OR p_purpose IS NULL OR p_purpose NOT IN ('enroll', 'reset', 'join')
     OR p_expires_in_hours IS NULL OR p_expires_in_hours < 1 OR p_expires_in_hours > 2160
     OR pg_catalog.char_length(COALESCE(p_note, '')) > 500 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_association_evidence IS NOT NULL AND pg_catalog.char_length(p_association_evidence) > 2000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF (p_purpose = 'join' AND (p_member_id IS NOT NULL OR v_expected_auth_user_id IS NOT NULL
       OR NULLIF(pg_catalog.btrim(COALESCE(p_association_evidence, '')), '') IS NOT NULL))
     OR (p_purpose <> 'join' AND (p_member_id IS NULL OR p_member_id <= 0)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- Serialize issuance against Admin member inserts/updates for this normalized
  -- email. The same lock is used by the member-table guard and completion RPC.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || v_email, 0)
  );

  IF p_purpose = 'join' THEN
    -- Expired pending links may be replaced; uncertain/reserved attempts never
    -- expire into a reusable state and require explicit human reconciliation.
    WITH expired AS (
      UPDATE public.member_password_invitations AS i
      SET status = 'expired', expired_at = pg_catalog.clock_timestamp()
      WHERE i.normalized_email = v_email AND i.purpose = 'join'
        AND i.status = 'pending' AND i.expires_at <= pg_catalog.clock_timestamp()
      RETURNING i.id, i.member_id
    )
    INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
    SELECT expired.id, expired.member_id, 'expired', p_actor_user_id, '{}'::jsonb FROM expired;

    IF EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email)
       OR EXISTS (SELECT 1 FROM auth.users AS u WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF EXISTS (SELECT 1 FROM public.member_password_invitations AS i
               WHERE i.normalized_email = v_email AND i.purpose = 'join'
                 AND i.status IN ('pending', 'reserved', 'review_required')) THEN
      RAISE EXCEPTION 'REVIEW_REQUIRED';
    END IF;
  ELSE
    SELECT * INTO v_member FROM public.members WHERE id = p_member_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
    IF pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_email THEN RAISE EXCEPTION 'WRONG_EMAIL'; END IF;
    IF (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_email) <> 1 THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF COALESCE(v_member.work_status, '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_DISABLED'; END IF;

    SELECT * INTO v_mapping FROM public.member_auth_bindings WHERE member_id = p_member_id FOR UPDATE;
    IF FOUND THEN
      -- Existing exact DB binding is authoritative. Admins need not copy an
      -- Auth UUID into the UI for a normal enrollment or reset.
      IF v_expected_auth_user_id IS NULL THEN v_expected_auth_user_id := v_mapping.auth_user_id; END IF;
      IF v_expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id
         OR v_mapping.normalized_email IS DISTINCT FROM v_email THEN
        RAISE EXCEPTION 'IDENTITY_CONFLICT';
      END IF;
    END IF;

    SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_email;
    IF v_identity_matches > 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    SELECT u.* INTO v_identity FROM auth.users AS u WHERE pg_catalog.lower(COALESCE(u.email, '')) = v_email;
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = v_identity.id)
         OR v_identity.deleted_at IS NOT NULL OR v_identity.banned_until IS NOT NULL
         OR COALESCE(v_identity.is_sso_user, false)
         OR NOT (COALESCE(v_identity.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
        RAISE EXCEPTION 'IDENTITY_CONFLICT';
      END IF;
      IF v_expected_auth_user_id IS NULL OR v_expected_auth_user_id IS DISTINCT FROM v_identity.id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
      IF p_purpose = 'enroll' AND COALESCE(v_identity.encrypted_password, '') <> '' THEN RAISE EXCEPTION 'PASSWORD_ALREADY_SET'; END IF;
    ELSIF v_expected_auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;

    IF p_purpose = 'reset' AND (v_mapping.member_id IS NULL OR v_expected_auth_user_id IS DISTINCT FROM v_mapping.auth_user_id) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF v_mapping.member_id IS NULL AND v_expected_auth_user_id IS NOT NULL
       AND NULLIF(pg_catalog.btrim(COALESCE(p_association_evidence, '')), '') IS NULL THEN
      RAISE EXCEPTION 'REVIEW_REQUIRED';
    END IF;
  END IF;

  v_expires := pg_catalog.now() + pg_catalog.make_interval(hours => p_expires_in_hours);
  v_evidence_hash := CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_association_evidence, '')), '') IS NULL THEN NULL
    ELSE pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_association_evidence), 'UTF8'), 'sha256'), 'hex') END;
  INSERT INTO public.member_password_invitations (
    token_hash, member_id, normalized_email, purpose, expires_at, note, created_by,
    expected_auth_user_id, association_evidence_hash
  ) VALUES (
    p_token_hash, p_member_id, v_email, p_purpose, v_expires,
    pg_catalog.btrim(COALESCE(p_note, '')), p_actor_user_id, v_expected_auth_user_id, v_evidence_hash
  ) RETURNING id INTO v_id;

  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_id, p_member_id, 'issued', p_actor_user_id,
          pg_catalog.jsonb_build_object('purpose', p_purpose, 'evidence_present', v_evidence_hash IS NOT NULL));
  RETURN pg_catalog.jsonb_build_object('id', v_id, 'member_id', p_member_id, 'email', v_email,
    'purpose', p_purpose, 'note', pg_catalog.btrim(COALESCE(p_note, '')), 'expires_at', v_expires);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'REVIEW_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_issue_invitation(TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_issue_invitation(TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_reserve(p_token_hash TEXT, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hash TEXT := p_token_hash;
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_lock_email TEXT;
  v_inv public.member_password_invitations;
  v_member public.members;
  v_mapping public.member_auth_bindings;
  v_identity auth.users;
  v_claim UUID := extensions.gen_random_uuid();
  v_identity_matches INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  SELECT i.normalized_email INTO v_lock_email FROM public.member_password_invitations AS i WHERE i.token_hash = v_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || v_lock_email, 0)
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
  IF v_inv.normalized_email <> v_email THEN RAISE EXCEPTION 'WRONG_EMAIL'; END IF;

  IF v_inv.purpose = 'join' THEN
    IF v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    IF EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email)
       OR EXISTS (SELECT 1 FROM auth.users AS u WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_inv.normalized_email) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
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
  SET status = 'reserved', claim_id = v_claim, claimed_at = pg_catalog.clock_timestamp()
  WHERE id = v_inv.id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, details)
  VALUES (v_inv.id, v_inv.member_id, 'reserved', pg_catalog.jsonb_build_object('purpose', v_inv.purpose));
  RETURN pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'claim_id', v_claim,
    'member_id', v_inv.member_id, 'email', v_inv.normalized_email, 'purpose', v_inv.purpose,
    'expected_auth_user_id', v_inv.expected_auth_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_reserve(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_reserve(TEXT, TEXT) TO service_role;

-- New join Auth INSERTs are still invitation-bound, one-use, confirmed email
-- identities. Existing enrollment/reset gates remain exact and unchanged.
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
        AND i.purpose = 'enroll' AND i.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.email, '')))))
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
    IF TG_OP <> 'INSERT' OR v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL
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
DROP TRIGGER IF EXISTS trg_guard_member_password_write ON auth.users;
CREATE TRIGGER trg_guard_member_password_write
BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.guard_member_password_write();

-- Reserve a join email against a concurrent Admin-created member. Only the
-- exact service-role completion after the trigger-authenticated Auth INSERT may
-- create the inactive row while a live join invitation exists.
CREATE OR REPLACE FUNCTION public.guard_member_registration_member_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
  v_old_email TEXT;
  v_inv public.member_password_invitations;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.email, '')));
    IF v_email = v_old_email THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || v_email, 0)
  );
  SELECT * INTO v_inv
  FROM public.member_password_invitations AS i
  WHERE i.normalized_email = v_email AND i.purpose = 'join'
    AND i.status IN ('pending', 'reserved', 'review_required')
    AND (i.status <> 'pending' OR i.expires_at > pg_catalog.clock_timestamp())
  ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC
  LIMIT 1 FOR UPDATE;
  IF v_inv.id IS NULL THEN RETURN NEW; END IF;

  IF auth.role() = 'service_role' AND TG_OP = 'INSERT'
     AND v_inv.status = 'reserved' AND v_inv.member_id IS NULL
     AND v_inv.expected_auth_user_id IS NULL
     AND v_inv.auth_write_completed_at IS NOT NULL AND v_inv.auth_write_user_id IS NOT NULL
     AND COALESCE(NEW.work_status, '') = 'inactive'
     AND EXISTS (
       SELECT 1 FROM auth.users AS u
       WHERE u.id = v_inv.auth_write_user_id
         AND pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_email
         AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.encrypted_password, '') <> ''
         AND u.banned_until IS NULL AND u.deleted_at IS NULL AND NOT COALESCE(u.is_sso_user, false)
         AND COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
         AND NOT EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = u.id)
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'REGISTRATION_IN_PROGRESS';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_member_registration_member_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_member_registration_member_write ON public.members;
CREATE TRIGGER trg_guard_member_registration_member_write
BEFORE INSERT OR UPDATE OF email ON public.members
FOR EACH ROW EXECUTE FUNCTION public.guard_member_registration_member_write();

-- Atomically applies allowlisted self-entered profile fields, binds Auth, and
-- completes either an existing-member invitation or a new inactive join.
CREATE OR REPLACE FUNCTION public.member_password_complete_profile(
  p_invitation_id UUID,
  p_claim_id UUID,
  p_auth_user_id UUID,
  p_profile JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lock_email TEXT;
  v_inv public.member_password_invitations;
  v_member public.members;
  v_binding public.member_auth_bindings;
  v_user auth.users;
  v_identity_matches INTEGER;
  v_member_id BIGINT;
  v_full_name TEXT;
  v_phone TEXT;
  v_residence TEXT;
  v_work_conditions TEXT;
  v_bio TEXT;
  v_device TEXT;
  v_gender TEXT;
  v_membership TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT i.normalized_email INTO v_lock_email FROM public.member_password_invitations AS i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phantoms-member-registration:' || v_lock_email, 0)
  );
  SELECT * INTO v_inv FROM public.member_password_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'reserved' OR v_inv.claim_id IS DISTINCT FROM p_claim_id
     OR v_inv.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_completed_at IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  IF v_inv.auth_write_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  IF v_inv.purpose = 'reset' AND p_profile IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  ELSIF p_profile IS NULL THEN
    IF v_inv.purpose <> 'reset' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSE
  IF pg_catalog.jsonb_typeof(p_profile) <> 'object'
     OR NOT (p_profile ? 'fullName')
     OR (p_profile - ARRAY['fullName', 'phone', 'residence', 'workConditions', 'bio', 'device', 'gender']::text[]) <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(p_profile -> 'fullName') <> 'string'
     OR ((p_profile ? 'phone') AND pg_catalog.jsonb_typeof(p_profile -> 'phone') NOT IN ('string', 'null'))
     OR ((p_profile ? 'residence') AND pg_catalog.jsonb_typeof(p_profile -> 'residence') NOT IN ('string', 'null'))
     OR ((p_profile ? 'workConditions') AND pg_catalog.jsonb_typeof(p_profile -> 'workConditions') NOT IN ('string', 'null'))
     OR ((p_profile ? 'bio') AND pg_catalog.jsonb_typeof(p_profile -> 'bio') NOT IN ('string', 'null'))
     OR ((p_profile ? 'device') AND pg_catalog.jsonb_typeof(p_profile -> 'device') NOT IN ('string', 'null'))
     OR ((p_profile ? 'gender') AND pg_catalog.jsonb_typeof(p_profile -> 'gender') NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_full_name := pg_catalog.btrim(p_profile ->> 'fullName');
  v_phone := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'phone', '')), '');
  v_residence := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'residence', '')), '');
  v_work_conditions := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'workConditions', '')), '');
  v_bio := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'bio', '')), '');
  v_device := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'device', '')), '');
  v_gender := NULLIF(pg_catalog.btrim(COALESCE(p_profile ->> 'gender', '')), '');
  IF v_full_name = '' OR pg_catalog.char_length(v_full_name) > 160 OR v_full_name ~ '[[:cntrl:]]'
     OR (v_phone IS NOT NULL AND (pg_catalog.char_length(v_phone) > 32 OR v_phone !~ '^\+?[0-9 ()-]{7,32}$'))
     OR (v_residence IS NOT NULL AND (pg_catalog.char_length(v_residence) > 160 OR v_residence ~ '[[:cntrl:]]'))
     OR (v_work_conditions IS NOT NULL AND (pg_catalog.char_length(v_work_conditions) > 2000 OR v_work_conditions ~ '[[:cntrl:]]'))
     OR (v_bio IS NOT NULL AND (pg_catalog.char_length(v_bio) > 4000 OR v_bio ~ '[[:cntrl:]]'))
     OR (v_device IS NOT NULL AND v_device NOT IN ('لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول', 'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول'))
     OR (v_gender IS NOT NULL AND v_gender NOT IN ('ذكر', 'أنثى')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  END IF;

  SELECT count(*)::integer INTO v_identity_matches FROM auth.users AS u WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))) = v_inv.normalized_email;
  IF v_identity_matches <> 1 THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  SELECT * INTO v_user FROM auth.users AS u WHERE u.id = p_auth_user_id;
  IF NOT FOUND OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_user.email, ''))) <> v_inv.normalized_email
     OR v_user.encrypted_password IS NULL OR pg_catalog.btrim(v_user.encrypted_password) = ''
     OR v_user.email_confirmed_at IS NULL OR v_user.banned_until IS NOT NULL OR v_user.deleted_at IS NOT NULL
     OR COALESCE(v_user.is_sso_user, false)
     OR NOT (COALESCE(v_user.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email') THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts AS a WHERE a.user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
  IF v_inv.expected_auth_user_id IS NOT NULL AND v_inv.expected_auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;

  IF v_inv.purpose = 'join' THEN
    IF v_inv.member_id IS NOT NULL OR v_inv.expected_auth_user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email)
       OR EXISTS (SELECT 1 FROM public.member_auth_bindings AS b WHERE b.auth_user_id = p_auth_user_id) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    INSERT INTO public.members (
      email, full_name, completion_rank, residence, work_conditions, bio, phone, device, gender, work_status
    ) VALUES (
      v_inv.normalized_email, v_full_name, 0, v_residence, v_work_conditions, v_bio, v_phone, v_device, v_gender, 'inactive'
    ) RETURNING id INTO v_member_id;
    INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
    VALUES (v_member_id, p_auth_user_id, v_inv.normalized_email, true);
    v_membership := 'pending_review';
  ELSE
    IF v_inv.member_id IS NULL OR v_inv.purpose NOT IN ('enroll', 'reset') THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
    SELECT * INTO v_member FROM public.members WHERE id = v_inv.member_id FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_member.work_status, '') <> 'active'
       OR pg_catalog.lower(pg_catalog.btrim(v_member.email)) <> v_inv.normalized_email
       OR (SELECT count(*) FROM public.members AS m WHERE pg_catalog.lower(pg_catalog.btrim(m.email)) = v_inv.normalized_email) <> 1 THEN
      RAISE EXCEPTION 'MEMBER_DISABLED';
    END IF;
    v_member_id := v_member.id;
    IF p_profile IS NOT NULL THEN
      UPDATE public.members
      SET full_name = v_full_name, phone = v_phone, residence = v_residence,
          work_conditions = v_work_conditions, bio = v_bio, device = v_device, gender = v_gender
      WHERE id = v_member_id;
    END IF;

    SELECT * INTO v_binding FROM public.member_auth_bindings WHERE member_id = v_member_id FOR UPDATE;
    IF FOUND AND (v_binding.auth_user_id IS DISTINCT FROM p_auth_user_id
        OR v_binding.normalized_email IS DISTINCT FROM v_inv.normalized_email) THEN
      RAISE EXCEPTION 'IDENTITY_CONFLICT';
    END IF;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.member_auth_bindings WHERE auth_user_id = p_auth_user_id) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT'; END IF;
      INSERT INTO public.member_auth_bindings (member_id, auth_user_id, normalized_email, password_ready)
      VALUES (v_member_id, p_auth_user_id, v_inv.normalized_email, true);
    ELSE
      UPDATE public.member_auth_bindings
      SET normalized_email = v_inv.normalized_email, password_ready = true, updated_at = pg_catalog.now()
      WHERE member_id = v_member_id;
    END IF;
    v_membership := 'active';
  END IF;

  UPDATE public.member_password_invitations
  SET member_id = v_member_id, status = 'complete', auth_user_id = p_auth_user_id,
      completed_at = pg_catalog.clock_timestamp(), used_at = pg_catalog.clock_timestamp()
  WHERE id = v_inv.id AND status = 'reserved' AND claim_id = p_claim_id
    AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_inv.id, v_member_id, 'completed', p_auth_user_id,
          pg_catalog.jsonb_build_object('purpose', v_inv.purpose, 'membership', v_membership));
  RETURN pg_catalog.jsonb_build_object('ok', true, 'membership', v_membership);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_complete_profile(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_complete_profile(UUID, UUID, UUID, JSONB) TO service_role;

-- Return a status-only signal to the authenticated owner of a newly-created
-- inactive member account. No member ID or profile fields are exposed. This lets
-- the login UI explain that Admin activation is pending instead of saying the
-- password is wrong; live Auth session and exact binding are still required.
CREATE OR REPLACE FUNCTION public.get_member_pending_review()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NULL; END IF;
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

COMMIT;
