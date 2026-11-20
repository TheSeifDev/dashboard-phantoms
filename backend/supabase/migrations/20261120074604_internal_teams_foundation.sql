-- Internal teams foundation: separate team-scoped access from global admin_accounts.
-- This migration intentionally leaves all historical operational rows unassigned.
-- No team roles are added to admin_accounts and no operational table is opened
-- to team-only users until every feature path has a corresponding scoped guard.
BEGIN;

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_name_lower_unique ON public.teams (lower(name));

-- The requested example teams are provisioned empty; no existing member or
-- record is assigned to any of them by this migration.
INSERT INTO public.teams (slug, name) VALUES
  ('software', 'Software'),
  ('hardware', 'Hardware'),
  ('ai', 'AI')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.team_memberships (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, member_id)
);
CREATE INDEX team_memberships_member_status_idx
  ON public.team_memberships (member_id, status, team_id);
CREATE INDEX team_memberships_team_status_idx
  ON public.team_memberships (team_id, status, member_id);

CREATE TABLE public.team_admin_assignments (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('head', 'monitor')),
  permissions JSONB NOT NULL DEFAULT
    '{"dashboard":false,"members":false,"tasks":false,"ranking":false,"notes":false,"announcements":false,"whatsapp":false,"ai_assistant":false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT team_admin_permissions_valid CHECK (
    jsonb_typeof(permissions) = 'object'
    AND jsonb_typeof(permissions -> 'dashboard') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'members') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'tasks') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ranking') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'notes') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'announcements') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'whatsapp') IS NOT DISTINCT FROM 'boolean'
    AND jsonb_typeof(permissions -> 'ai_assistant') IS NOT DISTINCT FROM 'boolean'
    AND permissions - ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']::TEXT[] = '{}'::jsonb
  ),
  CONSTRAINT team_admin_user_once_per_team UNIQUE (team_id, user_id),
  CONSTRAINT team_admin_assignment_id_team_unique UNIQUE (id, team_id)
);
CREATE UNIQUE INDEX team_admin_one_seat_per_role
  ON public.team_admin_assignments (team_id, role);
CREATE INDEX team_admin_assignments_user_team_idx
  ON public.team_admin_assignments (user_id, team_id);

CREATE TABLE public.team_access_audit (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'team_created', 'team_enabled', 'team_disabled', 'admin_assigned',
    'admin_permissions_changed', 'admin_revoked', 'member_added',
    'membership_approved', 'membership_suspended', 'membership_removed'
  )),
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  member_id BIGINT REFERENCES public.members(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX team_access_audit_team_time_idx ON public.team_access_audit (team_id, occurred_at DESC);

-- Each operational row gets a nullable team scope. NULL is deliberately
-- retained for every historical row and remains global-admin-only until an
-- Owner explicitly classifies that specific row in a separately audited flow.
ALTER TABLE public.tasks ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.notes ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_evaluations ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.announcements ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_custom_fields ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.task_contribution_events ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_infinite_bonus_events ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_registration_invites ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_password_invitations ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;
ALTER TABLE public.member_password_audit ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE RESTRICT;

CREATE INDEX tasks_team_created_idx ON public.tasks (team_id, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX notes_team_created_idx ON public.notes (team_id, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX member_evaluations_team_member_idx
  ON public.member_evaluations (team_id, member_id, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX announcements_team_active_idx
  ON public.announcements (team_id, is_active, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX member_custom_fields_team_order_idx
  ON public.member_custom_fields (team_id, is_active, sort_order, id) WHERE team_id IS NOT NULL;
CREATE INDEX task_contribution_events_team_date_idx
  ON public.task_contribution_events (team_id, occurred_at, member_id) WHERE team_id IS NOT NULL;
CREATE INDEX member_password_invitations_team_idx
  ON public.member_password_invitations (team_id, created_at DESC) WHERE team_id IS NOT NULL;

-- Team-specific scores do not write the existing global member rank/bonus fields.
CREATE TABLE public.team_member_metrics (
  team_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  completion_rank INT NOT NULL DEFAULT 0 CHECK (completion_rank BETWEEN 0 AND 100),
  bonus_infinite BOOLEAN NOT NULL DEFAULT FALSE,
  bonus_points BIGINT NOT NULL DEFAULT 0 CHECK (bonus_points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, member_id),
  FOREIGN KEY (team_id, member_id)
    REFERENCES public.team_memberships(team_id, member_id) ON DELETE RESTRICT
);

-- Team-scoped custom fields; legacy definitions and members.custom_fields remain
-- NULL/global legacy data and are not surfaced to team-only roles.
ALTER TABLE public.member_custom_fields
  ADD CONSTRAINT member_custom_fields_id_team_unique UNIQUE (id, team_id);
CREATE TABLE public.team_member_custom_field_values (
  team_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  field_id BIGINT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, member_id, field_id),
  FOREIGN KEY (team_id, member_id)
    REFERENCES public.team_memberships(team_id, member_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_id, team_id)
    REFERENCES public.member_custom_fields(id, team_id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(value) IN ('string', 'number', 'boolean', 'null', 'array', 'object'))
);

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_id_team_unique UNIQUE (id, team_id);
CREATE TABLE public.announcement_recipients (
  announcement_id BIGINT NOT NULL,
  team_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (announcement_id, member_id),
  FOREIGN KEY (announcement_id, team_id)
    REFERENCES public.announcements(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, member_id)
    REFERENCES public.team_memberships(team_id, member_id) ON DELETE RESTRICT
);
CREATE INDEX announcement_recipients_member_idx
  ON public.announcement_recipients (member_id, created_at DESC);

-- Private assignment/membership change log. It contains identifiers and scoped
-- action metadata only; no email, token, note text, or provider secret.
CREATE FUNCTION public.prevent_team_access_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'TEAM_ACCESS_AUDIT_APPEND_ONLY';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_team_access_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER team_access_audit_no_mutation
BEFORE UPDATE OR DELETE ON public.team_access_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_team_access_audit_mutation();
CREATE TRIGGER team_access_audit_no_truncate
BEFORE TRUNCATE ON public.team_access_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_team_access_audit_mutation();

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_admin_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.teams, public.team_memberships, public.team_admin_assignments,
  public.team_access_audit, public.team_member_metrics, public.team_member_custom_field_values,
  public.announcement_recipients FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.team_access_audit_event_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.teams, public.team_memberships, public.team_admin_assignments TO authenticated;

CREATE FUNCTION public.has_team_permission(p_team_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_team_id IS NULL OR p_permission <> ALL (
      ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']::TEXT[]
    ) OR auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      WHERE a.team_id = p_team_id
        AND a.user_id = auth.uid()
        AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND a.permissions @> jsonb_build_object(p_permission, TRUE)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.has_team_permission(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_team_permission(UUID, TEXT) TO authenticated;

CREATE FUNCTION public.has_team_membership(p_team_id UUID, p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_team_id IS NOT NULL AND p_member_id IS NOT NULL
    AND (public.is_owner() OR public.has_admin_permission('members')
      OR public.has_team_permission(p_team_id, 'members')
      OR EXISTS (SELECT 1 FROM public.member_auth_bindings b
                 WHERE b.member_id=p_member_id AND b.auth_user_id=auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.team_memberships AS tm
      JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
      WHERE tm.team_id = p_team_id AND tm.member_id = p_member_id AND tm.status = 'active'
    );
$$;
REVOKE ALL ON FUNCTION public.has_team_membership(UUID, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_team_membership(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.has_team_member_identity(p_team_id UUID, p_member_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND p_team_id IS NOT NULL AND p_member_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.team_memberships AS tm
    JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
    JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
    JOIN public.member_auth_bindings AS b ON b.member_id = tm.member_id AND b.auth_user_id = auth.uid()
    JOIN auth.users AS u ON u.id = b.auth_user_id
    WHERE tm.team_id = p_team_id AND tm.member_id = p_member_id AND tm.status = 'active'
      AND b.password_ready IS TRUE
      AND u.email_confirmed_at IS NOT NULL
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_team_member_identity(UUID, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_team_member_identity(UUID, BIGINT) TO authenticated;

CREATE POLICY teams_read_global_admin_only ON public.teams FOR SELECT TO authenticated
USING (public.is_admin());
CREATE POLICY team_memberships_read_authorized ON public.team_memberships FOR SELECT TO authenticated
USING (public.has_admin_permission('members') OR public.has_team_permission(team_id, 'members'));
CREATE POLICY team_admin_assignments_read_self_or_owner ON public.team_admin_assignments FOR SELECT TO authenticated
USING (public.is_owner() OR user_id = auth.uid());
-- No direct INSERT/UPDATE/DELETE policy is intentionally created. All writes are
-- performed by the Owner/member-management RPCs below.

CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_role TEXT;
  v_permissions JSONB;
  v_all_permissions CONSTANT JSONB :=
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true}'::jsonb;
  v_teams JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'is_team_admin', false,
      'role', NULL, 'email', NULL, 'permissions', '{}'::jsonb, 'teams', '[]'::jsonb);
  END IF;
  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  SELECT a.role, a.permissions INTO v_role, v_permissions
  FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;
  IF v_role = 'owner' THEN v_permissions := v_all_permissions; END IF;

  IF v_role IN ('owner', 'admin') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name,
      'role', NULL, 'permissions', v_permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams FROM public.teams AS t WHERE t.is_active;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name,
      'role', a.role, 'permissions', a.permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams
    FROM public.team_admin_assignments AS a
    JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
    JOIN auth.users AS u ON u.id = a.user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    WHERE a.user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', coalesce(v_role IN ('owner', 'admin'), false),
    'is_owner', coalesce(v_role = 'owner', false),
    'is_team_admin', EXISTS (
      SELECT 1 FROM public.team_admin_assignments a
      JOIN public.teams t ON t.id=a.team_id AND t.is_active
      JOIN auth.users u ON u.id=a.user_id
      WHERE a.user_id=v_user_id AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= now())
    ),
    'role', v_role,
    'email', v_email,
    'permissions', coalesce(v_permissions, '{}'::jsonb),
    'teams', v_teams
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

CREATE FUNCTION public.owner_list_team_admin_candidates()
RETURNS TABLE (user_id UUID, email TEXT, member_id BIGINT, member_name TEXT, global_role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::TEXT, m.id, m.full_name, aa.role
  FROM auth.users AS u
  LEFT JOIN public.member_auth_bindings AS b ON b.auth_user_id = u.id
  LEFT JOIN public.members AS m ON m.id = b.member_id
  LEFT JOIN public.admin_accounts AS aa ON aa.user_id = u.id
  WHERE u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND NOT COALESCE(u.is_sso_user, FALSE)
  ORDER BY lower(u.email), u.id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_list_team_admin_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_team_admin_candidates() TO authenticated;

CREATE FUNCTION public.owner_list_teams()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'is_active', t.is_active,
      'member_count', (SELECT count(*) FROM public.team_memberships tm WHERE tm.team_id=t.id AND tm.status='active'),
      'assignments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'email', u.email, 'role', a.role,
        'permissions', a.permissions, 'created_at', a.created_at
      ) ORDER BY a.role)
      FROM public.team_admin_assignments a JOIN auth.users u ON u.id=a.user_id
      WHERE a.team_id=t.id), '[]'::jsonb)
    ) ORDER BY t.name)
    FROM public.teams t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_list_teams() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_teams() TO authenticated;

CREATE FUNCTION public.owner_create_team(p_slug TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'
    OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'INVALID_TEAM';
  END IF;
  INSERT INTO public.teams (slug, name, created_by)
  VALUES (lower(btrim(p_slug)), btrim(p_name), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, action, details)
  VALUES (auth.uid(), v_id, 'team_created', jsonb_build_object('slug', lower(btrim(p_slug))));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_create_team(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_create_team(TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.owner_set_team_active(p_team_id UUID, p_is_active BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old BOOLEAN;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_team_id IS NULL OR p_is_active IS NULL THEN RAISE EXCEPTION 'INVALID_TEAM'; END IF;
  SELECT is_active INTO v_old FROM public.teams WHERE id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
  UPDATE public.teams SET is_active=p_is_active, updated_at=now() WHERE id=p_team_id;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, action, details)
  VALUES (auth.uid(), p_team_id, CASE WHEN p_is_active THEN 'team_enabled' ELSE 'team_disabled' END,
          jsonb_build_object('previous', v_old, 'current', p_is_active));
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_set_team_active(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_team_active(UUID, BOOLEAN) TO authenticated;

CREATE FUNCTION public.owner_assign_team_admin(
  p_team_id UUID, p_user_id UUID, p_role TEXT, p_permissions JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_assignment_id UUID;
  v_previous JSONB;
  v_keys CONSTANT TEXT[] := ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant'];
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_team_id IS NULL OR p_user_id IS NULL OR p_role IS NULL OR p_role NOT IN ('head','monitor')
     OR p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object'
     OR NOT (p_permissions ?& v_keys) OR p_permissions - v_keys <> '{}'::jsonb
     OR EXISTS (SELECT 1 FROM unnest(v_keys) AS k WHERE jsonb_typeof(p_permissions -> k) <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_TEAM_ASSIGNMENT';
  END IF;
  PERFORM 1 FROM public.teams WHERE id=p_team_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL
    AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until <= now()) AND NOT COALESCE(is_sso_user, FALSE);
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_ADMIN_USER_NOT_ELIGIBLE'; END IF;
  SELECT jsonb_build_object('role', role, 'permissions', permissions) INTO v_previous
    FROM public.team_admin_assignments WHERE team_id=p_team_id AND user_id=p_user_id FOR UPDATE;
  INSERT INTO public.team_admin_assignments(team_id, user_id, role, permissions, created_by)
  VALUES (p_team_id, p_user_id, p_role, p_permissions, auth.uid())
  ON CONFLICT (team_id, user_id) DO UPDATE
    SET role=EXCLUDED.role, permissions=EXCLUDED.permissions, created_at=now(), created_by=auth.uid()
  RETURNING id INTO v_assignment_id;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, subject_user_id, action, details)
  VALUES (auth.uid(), p_team_id, p_user_id,
    CASE WHEN v_previous IS NULL THEN 'admin_assigned' ELSE 'admin_permissions_changed' END,
    jsonb_build_object('previous', COALESCE(v_previous, '{}'::jsonb),
      'current', jsonb_build_object('role', p_role, 'permissions', p_permissions)));
  RETURN v_assignment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_assign_team_admin(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_assign_team_admin(UUID, UUID, TEXT, JSONB) TO authenticated;

CREATE FUNCTION public.owner_revoke_team_admin(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assignment public.team_admin_assignments;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  SELECT * INTO v_assignment FROM public.team_admin_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, subject_user_id, action, details)
  VALUES (auth.uid(), v_assignment.team_id, v_assignment.user_id, 'admin_revoked',
    jsonb_build_object('assignment_id', v_assignment.id, 'role', v_assignment.role,
      'permissions', v_assignment.permissions));
  DELETE FROM public.team_admin_assignments WHERE id=p_assignment_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_revoke_team_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_revoke_team_admin(UUID) TO authenticated;

CREATE FUNCTION public.team_add_member(p_team_id UUID, p_member_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status TEXT;
BEGIN
  IF p_team_id IS NULL OR p_member_id IS NULL OR p_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id=p_team_id AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.members WHERE id=p_member_id AND work_status='active') THEN
    RAISE EXCEPTION 'TEAM_OR_MEMBER_NOT_FOUND';
  END IF;
  v_status := CASE WHEN public.is_owner() OR public.has_admin_permission('members') THEN 'active' ELSE 'pending' END;
  INSERT INTO public.team_memberships(team_id, member_id, status, created_by,
    approved_at, approved_by)
  VALUES (p_team_id, p_member_id, v_status, auth.uid(),
    CASE WHEN v_status='active' THEN now() END,
    CASE WHEN v_status='active' THEN auth.uid() END)
  ON CONFLICT (team_id, member_id) DO UPDATE
    SET status=EXCLUDED.status, updated_at=now(),
        approved_at=EXCLUDED.approved_at, approved_by=EXCLUDED.approved_by
  WHERE public.team_memberships.status IN ('removed','suspended','pending')
  RETURNING status INTO v_status;
  IF v_status IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_ALREADY_ACTIVE'; END IF;
  INSERT INTO public.team_access_audit(actor_user_id, team_id, member_id, action, details)
  VALUES (auth.uid(), p_team_id, p_member_id, 'member_added', jsonb_build_object('status', v_status));
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.team_add_member(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_add_member(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.team_review_member(p_team_id UUID, p_member_id BIGINT, p_decision TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status TEXT;
BEGIN
  IF p_team_id IS NULL OR p_member_id IS NULL OR p_member_id <= 0
     OR p_decision NOT IN ('approve','suspend','remove') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_auth_bindings b
             WHERE b.member_id=p_member_id AND b.auth_user_id=auth.uid()) THEN
    RAISE EXCEPTION 'SELF_REVIEW_FORBIDDEN';
  END IF;
  IF p_decision='approve' AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE id=p_member_id AND work_status='active'
  ) THEN RAISE EXCEPTION 'MEMBER_INACTIVE'; END IF;
  UPDATE public.team_memberships
  SET status=CASE p_decision WHEN 'approve' THEN 'active' WHEN 'suspend' THEN 'suspended' ELSE 'removed' END,
      updated_at=now(),
      approved_at=CASE WHEN p_decision='approve' THEN now() ELSE approved_at END,
      approved_by=CASE WHEN p_decision='approve' THEN auth.uid() ELSE approved_by END
  WHERE team_id=p_team_id AND member_id=p_member_id
    AND (p_decision <> 'approve' OR status='pending')
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

CREATE FUNCTION public.owner_list_team_members(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams WHERE id=p_team_id AND is_active) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'full_name',m.full_name,
      'email',m.email,'phone',m.phone,'work_status',m.work_status,
      'membership_status',tm.status,'created_at',tm.created_at)
      ORDER BY m.full_name, m.id)
    FROM public.team_memberships tm JOIN public.members m ON m.id=tm.member_id
    WHERE tm.team_id=p_team_id
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_list_team_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_team_members(UUID) TO authenticated;

COMMIT;
