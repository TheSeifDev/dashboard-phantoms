-- Owner controls for atomic Head/Monitor seat replacement and explicit
-- member-to-team assignment. These functions reveal no Auth/provider secrets.
BEGIN;

CREATE FUNCTION public.owner_set_team_admin_seat(
  p_team_id UUID,
  p_role TEXT,
  p_user_id UUID,
  p_permissions JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old public.team_admin_assignments;
  v_new_id UUID;
  v_keys CONSTANT TEXT[] := ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant'];
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_team_id IS NULL OR p_role IS NULL OR p_role NOT IN ('head','monitor') THEN RAISE EXCEPTION 'INVALID_TEAM_SEAT'; END IF;
  IF p_user_id IS NOT NULL AND (
    p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object'
    OR NOT (p_permissions ?& v_keys) OR p_permissions - v_keys <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM unnest(v_keys) AS k WHERE jsonb_typeof(p_permissions -> k) <> 'boolean')
  ) THEN RAISE EXCEPTION 'INVALID_PERMISSIONS'; END IF;

  PERFORM 1 FROM public.teams WHERE id=p_team_id AND (is_active OR p_user_id IS NULL) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL
      AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until <= now()) AND NOT COALESCE(is_sso_user,FALSE)
  ) THEN RAISE EXCEPTION 'TEAM_ADMIN_USER_NOT_ELIGIBLE'; END IF;

  SELECT * INTO v_old FROM public.team_admin_assignments
  WHERE team_id=p_team_id AND role=p_role FOR UPDATE;

  IF p_user_id IS NULL THEN
    IF FOUND THEN
      INSERT INTO public.team_access_audit(actor_user_id,team_id,subject_user_id,action,details)
      VALUES (auth.uid(),p_team_id,v_old.user_id,'admin_revoked',
        jsonb_build_object('assignment_id',v_old.id,'role',v_old.role,'permissions',v_old.permissions));
      DELETE FROM public.team_admin_assignments WHERE id=v_old.id;
    END IF;
    RETURN NULL;
  END IF;

  -- A person occupies at most one of the two seats inside a single team, but
  -- may hold assignments in any number of different teams.
  IF EXISTS (SELECT 1 FROM public.team_admin_assignments
             WHERE team_id=p_team_id AND user_id=p_user_id AND role<>p_role) THEN
    RAISE EXCEPTION 'TEAM_ADMIN_ALREADY_HAS_OTHER_SEAT';
  END IF;

  IF v_old.id IS NOT NULL AND v_old.user_id IS DISTINCT FROM p_user_id THEN
    INSERT INTO public.team_access_audit(actor_user_id,team_id,subject_user_id,action,details)
    VALUES (auth.uid(),p_team_id,v_old.user_id,'admin_revoked',
      jsonb_build_object('assignment_id',v_old.id,'role',v_old.role,'permissions',v_old.permissions,
                         'replaced_by',p_user_id));
    DELETE FROM public.team_admin_assignments WHERE id=v_old.id;
    v_old := NULL;
  END IF;

  IF v_old.id IS NOT NULL THEN
    UPDATE public.team_admin_assignments SET permissions=p_permissions
    WHERE id=v_old.id RETURNING id INTO v_new_id;
    INSERT INTO public.team_access_audit(actor_user_id,team_id,subject_user_id,action,details)
    VALUES (auth.uid(),p_team_id,p_user_id,'admin_permissions_changed',
      jsonb_build_object('role',p_role,'permissions',p_permissions));
  ELSE
    INSERT INTO public.team_admin_assignments(team_id,user_id,role,permissions,created_by)
    VALUES (p_team_id,p_user_id,p_role,p_permissions,auth.uid())
    RETURNING id INTO v_new_id;
    INSERT INTO public.team_access_audit(actor_user_id,team_id,subject_user_id,action,details)
    VALUES (auth.uid(),p_team_id,p_user_id,'admin_assigned',
      jsonb_build_object('role',p_role,'permissions',p_permissions));
  END IF;
  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_set_team_admin_seat(UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_set_team_admin_seat(UUID,TEXT,UUID,JSONB) TO authenticated;

CREATE FUNCTION public.owner_list_team_member_candidates(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams WHERE id=p_team_id) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'member_id',m.id,'full_name',m.full_name,'email',m.email,'phone',m.phone,
      'work_status',m.work_status,'membership_status',tm.status
    ) ORDER BY m.full_name,m.id)
    FROM public.members m
    LEFT JOIN public.team_memberships tm ON tm.team_id=p_team_id AND tm.member_id=m.id
  ),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_list_team_member_candidates(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_list_team_member_candidates(UUID) TO authenticated;

COMMIT;
