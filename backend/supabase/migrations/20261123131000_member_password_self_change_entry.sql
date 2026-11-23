-- The member's own password change is authorised by the verified Auth session,
-- not by a member id supplied by the caller. This entry point resolves the
-- member from the authenticated identity and then reuses the guarded direct
-- reset claim, so the Edge function never has to trust a client-provided id.
BEGIN;

CREATE OR REPLACE FUNCTION public.member_password_begin_self_change(p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_member_id BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  IF p_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT b.member_id INTO v_member_id
  FROM public.member_auth_bindings AS b
  WHERE b.auth_user_id = p_auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  RETURN public.member_password_begin_direct_reset(v_member_id, p_auth_user_id, 'self_change');
END;
$$;
REVOKE ALL ON FUNCTION public.member_password_begin_self_change(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_password_begin_self_change(UUID) TO service_role;

COMMIT;
