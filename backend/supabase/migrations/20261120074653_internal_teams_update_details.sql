BEGIN;

ALTER TABLE public.team_access_audit
  DROP CONSTRAINT IF EXISTS team_access_audit_action_check;
ALTER TABLE public.team_access_audit
  ADD CONSTRAINT team_access_audit_action_check CHECK (action IN (
    'team_created', 'team_renamed', 'team_enabled', 'team_disabled', 'admin_assigned',
    'admin_permissions_changed', 'admin_revoked', 'member_added', 'membership_approved',
    'membership_suspended', 'membership_removed'
  ));

CREATE FUNCTION public.owner_update_team_details(p_team_id UUID, p_slug TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_slug TEXT;
  v_old_name TEXT;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_team_id IS NULL OR p_slug IS NULL
     OR p_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'
     OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'INVALID_TEAM';
  END IF;
  SELECT slug, name INTO v_old_slug, v_old_name
  FROM public.teams WHERE id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  UPDATE public.teams
  SET slug=lower(btrim(p_slug)), name=btrim(p_name), updated_at=now()
  WHERE id=p_team_id;

  IF v_old_slug IS DISTINCT FROM lower(btrim(p_slug))
     OR v_old_name IS DISTINCT FROM btrim(p_name) THEN
    INSERT INTO public.team_access_audit(actor_user_id,team_id,action,details)
    VALUES (auth.uid(),p_team_id,'team_renamed',jsonb_build_object(
      'old_slug',v_old_slug,'new_slug',lower(btrim(p_slug)),
      'old_name',v_old_name,'new_name',btrim(p_name)));
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_update_team_details(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_update_team_details(UUID,TEXT,TEXT) TO authenticated;

COMMIT;
