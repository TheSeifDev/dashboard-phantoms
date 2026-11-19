-- Owner/admin review queue for self-service joins.
-- A pending invitation is not a registration; only a completed, verified join
-- with an inactive member appears in the queue. Approval activates atomically.
BEGIN;

ALTER TABLE public.member_password_audit
  DROP CONSTRAINT IF EXISTS member_password_audit_action_check;
ALTER TABLE public.member_password_audit
  ADD CONSTRAINT member_password_audit_action_check
  CHECK (action IN ('issued', 'reserved', 'completed', 'review_required', 'revoked', 'expired', 'admin_approved'));

CREATE INDEX IF NOT EXISTS member_password_join_review_queue_idx
  ON public.member_password_invitations (completed_at DESC, member_id)
  WHERE purpose = 'join' AND status = 'complete';
CREATE UNIQUE INDEX IF NOT EXISTS member_password_audit_admin_approved_member_key
  ON public.member_password_audit (member_id)
  WHERE action = 'admin_approved' AND member_id IS NOT NULL;

-- Prevent the generic Admin members UPDATE endpoint from bypassing review.
-- A trusted service-role approval RPC is required to move a completed,
-- still-unapproved self-service join away from inactive. This also prevents a
-- nullable/intermediate status from being used to bypass the review guard.
CREATE OR REPLACE FUNCTION public.guard_pending_member_join_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.work_status IS DISTINCT FROM NEW.work_status
     AND NEW.work_status IS DISTINCT FROM 'inactive'
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND EXISTS (
       SELECT 1 FROM public.member_password_invitations AS i
       WHERE i.member_id = OLD.id AND i.purpose = 'join' AND i.status = 'complete'
         AND NOT EXISTS (
           SELECT 1 FROM public.member_password_audit AS a
           WHERE a.member_id = OLD.id AND a.action = 'admin_approved'
         )
     ) THEN
    RAISE EXCEPTION 'JOIN_REVIEW_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_pending_member_join_activation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_pending_member_join_activation ON public.members;
CREATE TRIGGER trg_guard_pending_member_join_activation
BEFORE UPDATE OF work_status ON public.members
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_member_join_activation();

DROP FUNCTION IF EXISTS public.member_password_list_join_reviews(UUID);
CREATE OR REPLACE FUNCTION public.member_password_list_join_reviews(
  p_actor_user_id UUID,
  p_before_submitted_at TIMESTAMPTZ DEFAULT NULL,
  p_before_member_id BIGINT DEFAULT NULL,
  p_before_invitation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    JOIN auth.users AS actor ON actor.id = a.user_id
    WHERE a.user_id = p_actor_user_id
      AND actor.deleted_at IS NULL
      AND actor.banned_until IS NULL
      AND (a.role = 'owner' OR (a.role = 'admin' AND COALESCE(a.permissions ->> 'members', 'false') = 'true'))
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF (p_before_submitted_at IS NULL) <> (p_before_member_id IS NULL)
     OR (p_before_member_id IS NULL) <> (p_before_invitation_id IS NULL)
     OR (p_before_member_id IS NOT NULL AND p_before_member_id <= 0) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'invitation_id', q.invitation_id,
      'member_id', q.member_id,
      'full_name', q.full_name,
      'email', q.email,
      'invitation_email', q.invitation_email,
      'email_identity_matches', q.email_identity_matches,
      'phone', q.phone,
      'residence', q.residence,
      'work_conditions', q.work_conditions,
      'bio', q.bio,
      'device', q.device,
      'gender', q.gender,
      'submitted_at', q.submitted_at
    ) ORDER BY q.submitted_at DESC, q.member_id DESC, q.invitation_id DESC)
    FROM (
      SELECT i.id AS invitation_id, m.id AS member_id, m.full_name, m.email,
             m.phone, m.residence, m.work_conditions, m.bio, m.device, m.gender,
             i.normalized_email AS invitation_email,
             COALESCE(
               i.normalized_email = b.normalized_email
               AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(m.email, '')))
               AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(recipient.email, ''))),
               false
             ) AS email_identity_matches,
             i.completed_at AS submitted_at
      FROM public.member_password_invitations AS i
      JOIN public.members AS m ON m.id = i.member_id
      JOIN public.member_auth_bindings AS b ON b.member_id = m.id
      JOIN auth.users AS recipient ON recipient.id = b.auth_user_id
      WHERE i.purpose = 'join'
        AND i.status = 'complete'
        AND i.completed_at IS NOT NULL
        AND i.auth_user_id = b.auth_user_id
        AND m.work_status = 'inactive'
        AND b.password_ready IS TRUE
        AND recipient.email_confirmed_at IS NOT NULL
        AND COALESCE(recipient.encrypted_password, '') <> ''
        AND recipient.deleted_at IS NULL
        AND recipient.banned_until IS NULL
        AND NOT COALESCE(recipient.is_sso_user, false)
        AND COALESCE(recipient.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
        AND NOT EXISTS (
          SELECT 1 FROM public.member_password_audit AS a
          WHERE a.member_id = m.id AND a.action = 'admin_approved'
        )
        AND (
          p_before_submitted_at IS NULL
          OR (i.completed_at, m.id, i.id) < (p_before_submitted_at, p_before_member_id, p_before_invitation_id)
        )
      ORDER BY i.completed_at DESC, m.id DESC, i.id DESC
      LIMIT 100
    ) AS q
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_list_join_reviews(UUID, TIMESTAMPTZ, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_list_join_reviews(UUID, TIMESTAMPTZ, BIGINT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.member_password_approve_join(p_member_id BIGINT, p_actor_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_invitation public.member_password_invitations;
  v_email TEXT;
  v_status TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    JOIN auth.users AS actor ON actor.id = a.user_id
    WHERE a.user_id = p_actor_user_id
      AND actor.deleted_at IS NULL
      AND actor.banned_until IS NULL
      AND (a.role = 'owner' OR (a.role = 'admin' AND COALESCE(a.permissions ->> 'members', 'false') = 'true'))
  ) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  SELECT i.* INTO v_invitation
  FROM public.member_password_invitations AS i
  WHERE i.member_id = p_member_id
    AND i.purpose = 'join'
    AND i.status = 'complete'
  ORDER BY i.completed_at DESC, i.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.member_password_audit AS a
    WHERE a.member_id = p_member_id AND a.action = 'admin_approved'
  ) THEN
    RETURN jsonb_build_object('approved', false, 'status', 'already_approved');
  END IF;

  SELECT m.email, m.work_status INTO v_email, v_status
  FROM public.members AS m
  WHERE m.id = p_member_id
  FOR UPDATE;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'inactive' THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_auth_bindings AS b
    JOIN auth.users AS recipient ON recipient.id = b.auth_user_id
    WHERE b.member_id = p_member_id
      AND b.auth_user_id = v_invitation.auth_user_id
      AND b.password_ready IS TRUE
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(v_email))
      AND b.normalized_email = v_invitation.normalized_email
      AND b.normalized_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(recipient.email, '')))
      AND recipient.email_confirmed_at IS NOT NULL
      AND COALESCE(recipient.encrypted_password, '') <> ''
      AND recipient.deleted_at IS NULL
      AND recipient.banned_until IS NULL
      AND NOT COALESCE(recipient.is_sso_user, false)
      AND COALESCE(recipient.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email'
    FOR UPDATE OF b, recipient
  ) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;

  UPDATE public.members SET work_status = 'active'
  WHERE id = p_member_id AND work_status = 'inactive';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;

  INSERT INTO public.member_password_audit (invitation_id, member_id, action, actor_user_id, details)
  VALUES (v_invitation.id, p_member_id, 'admin_approved', p_actor_user_id,
          jsonb_build_object('purpose', 'join', 'membership', 'active'));

  RETURN jsonb_build_object('approved', true, 'member_id', p_member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_approve_join(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_approve_join(BIGINT, UUID) TO service_role;

COMMIT;
