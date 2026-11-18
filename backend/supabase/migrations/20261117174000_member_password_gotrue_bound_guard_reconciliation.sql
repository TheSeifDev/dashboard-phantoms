-- Forward-only reconciliation: preserve the proven GoTrue INSERT compatibility
-- AND the strict bound-member reservation requirement/Admin overlap behavior.
-- Migration 31 accidentally selected the older UPDATE branch. All earlier
-- migration bytes remain immutable; this records the correction in the ledger.
BEGIN;

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
    ORDER BY CASE WHEN i.status = 'reserved' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 1 FOR UPDATE;
    IF v_inv.id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN RETURN NEW; END IF;
    -- An Admin/Member overlap remains an ordinary Admin Auth operation.
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
       TG_OP = 'INSERT' AND v_inv.purpose = 'enroll'
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
