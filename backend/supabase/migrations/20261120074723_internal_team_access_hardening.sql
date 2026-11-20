-- Local forward-only hardening. Does not grant any global privilege to team roles.
BEGIN;

CREATE FUNCTION public.guard_team_admin_global_identity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Every Owner RPC, including direct calls and atomic seat replacement, passes
  -- through this gate. The canonical Auth identity is not created or modified.
  PERFORM 1 FROM auth.users WHERE id = NEW.user_id FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.admin_accounts WHERE user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'TEAM_ADMIN_REQUIRES_NON_GLOBAL_ACCOUNT';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_team_admin_global_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER team_admin_global_identity_guard
BEFORE INSERT OR UPDATE ON public.team_admin_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_team_admin_global_identity();

CREATE OR REPLACE FUNCTION public.team_review_member(p_team_id UUID, p_member_id BIGINT, p_decision TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status TEXT;
BEGIN
  IF p_team_id IS NULL OR p_member_id IS NULL OR p_member_id <= 0
     OR p_decision IS NULL OR p_decision NOT IN ('approve','suspend','remove') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF auth.uid() IS NULL OR NOT (
    public.is_owner() OR public.has_admin_permission('members')
    OR public.has_team_permission(p_team_id, 'members')
  ) THEN RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED'; END IF;
  PERFORM 1 FROM public.teams WHERE id = p_team_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_auth_bindings b
             WHERE b.member_id = p_member_id AND b.auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN';
  END IF;
  IF p_decision = 'approve' AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE id = p_member_id AND work_status = 'active'
  ) THEN RAISE EXCEPTION 'MEMBER_INACTIVE'; END IF;
  UPDATE public.team_memberships
  SET status = CASE p_decision WHEN 'approve' THEN 'active' WHEN 'suspend' THEN 'suspended' ELSE 'removed' END,
      updated_at = now(),
      approved_at = CASE WHEN p_decision = 'approve' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN p_decision = 'approve' THEN auth.uid() ELSE approved_by END
  WHERE team_id = p_team_id AND member_id = p_member_id
    AND (p_decision <> 'approve' OR status = 'pending')
  RETURNING status INTO v_status;
  IF v_status IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND_OR_STATE_INVALID'; END IF;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, member_id, action, details)
  VALUES (auth.uid(), p_team_id, p_member_id,
    CASE p_decision WHEN 'approve' THEN 'membership_approved'
      WHEN 'suspend' THEN 'membership_suspended' ELSE 'membership_removed' END,
    jsonb_build_object('status', v_status));
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.team_review_member(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_review_member(UUID, BIGINT, TEXT) TO authenticated;

COMMIT;
