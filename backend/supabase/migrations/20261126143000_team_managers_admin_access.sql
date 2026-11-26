-- Round 36 — Head/Monitor are management accounts, not member-portal accounts.
--
-- Team assignments remain the source of their section permissions.  They now
-- participate in the same admin authorization gates as global administrators,
-- while owner-only governance (admin accounts, teams, full_owner) remains owner-only.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts AS a
    WHERE a.user_id = auth.uid()
      AND a.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1
    FROM public.team_admin_assignments AS a
    JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
    JOIN auth.users AS u ON u.id = a.user_id
    WHERE a.user_id = auth.uid()
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permission = ANY (ARRAY[
      'dashboard','members','tasks','ranking','notes','announcements',
      'whatsapp','ai_assistant','web_projects'
    ]::text[])
    THEN EXISTS (
      SELECT 1
      FROM public.admin_accounts AS a
      WHERE a.user_id = auth.uid()
        AND (a.role = 'owner' OR (a.role = 'admin' AND a.permissions @> jsonb_build_object(p_permission, true)))
    ) OR EXISTS (
      SELECT 1
      FROM public.team_admin_assignments AS a
      JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
      JOIN auth.users AS u ON u.id = a.user_id
      WHERE a.user_id = auth.uid()
        AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
        AND p_permission <> 'web_projects'
        AND a.permissions @> jsonb_build_object(p_permission, true)
    )
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.has_admin_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_access()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_role TEXT;
  v_management_role TEXT;
  v_permissions JSONB;
  v_all_permissions CONSTANT JSONB :=
    '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
  v_teams JSONB := '[]'::jsonb;
  v_owner_until TIMESTAMPTZ;
  v_owner_permanent BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'is_owner', false, 'is_team_admin', false,
      'owner_authority', false, 'owner_authority_until', NULL, 'owner_authority_permanent', false,
      'role', NULL, 'management_role', NULL, 'email', NULL, 'permissions', '{}'::jsonb, 'teams', '[]'::jsonb);
  END IF;

  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;
  SELECT a.role, a.permissions INTO v_role, v_permissions
  FROM public.admin_accounts AS a WHERE a.user_id = v_user_id;

  SELECT CASE
    WHEN bool_or(a.role = 'head') THEN 'head'
    WHEN bool_or(a.role = 'monitor') THEN 'monitor'
    ELSE NULL
  END
  INTO v_management_role
  FROM public.team_admin_assignments AS a
  JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
  JOIN auth.users AS u ON u.id = a.user_id
  WHERE a.user_id = v_user_id
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now());

  IF v_role = 'owner' THEN
    v_permissions := v_all_permissions;
  ELSIF v_role = 'admin' THEN
    v_permissions := COALESCE(v_permissions, '{}'::jsonb) ||
      jsonb_build_object('web_projects', COALESCE((v_permissions ->> 'web_projects')::boolean, false));
  ELSIF v_management_role IS NOT NULL THEN
    SELECT jsonb_object_agg(permission_name, allowed)
    INTO v_permissions
    FROM (
      SELECT permission_name,
        EXISTS (
          SELECT 1
          FROM public.team_admin_assignments AS a
          JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
          JOIN auth.users AS u ON u.id = a.user_id
          WHERE a.user_id = v_user_id
            AND u.deleted_at IS NULL
            AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
            AND a.permissions @> jsonb_build_object(permission_name, true)
        ) AS allowed
      FROM unnest(ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']::text[]) AS permission_name
    ) AS permissions;
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', NULL, 'permissions', v_permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams FROM public.teams AS t WHERE t.is_active;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'slug', t.slug, 'name', t.name, 'role', a.role, 'permissions', a.permissions
    ) ORDER BY t.name), '[]'::jsonb)
    INTO v_teams
    FROM public.team_admin_assignments AS a
    JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
    JOIN auth.users AS u ON u.id = a.user_id AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now())
    WHERE a.user_id = v_user_id;
  END IF;

  SELECT max(g.expires_at), COALESCE(bool_or(g.expires_at IS NULL), false)
  INTO v_owner_until, v_owner_permanent
  FROM public.admin_capability_grants AS g
  WHERE g.user_id = v_user_id AND g.capability = 'full_owner'
    AND (g.expires_at IS NULL OR g.expires_at > pg_catalog.now());
  IF v_role = 'owner' THEN v_owner_permanent := true; END IF;

  RETURN jsonb_build_object(
    'is_admin', COALESCE(v_role IN ('owner','admin'), false) OR v_management_role IS NOT NULL,
    'is_owner', COALESCE(v_role = 'owner', false),
    'owner_authority', COALESCE(public.user_has_capability(v_user_id, 'full_owner'), false),
    'owner_authority_until', v_owner_until,
    'owner_authority_permanent', COALESCE(v_owner_permanent, false),
    'is_team_admin', v_management_role IS NOT NULL,
    'role', v_role,
    'management_role', v_management_role,
    'email', v_email,
    'permissions', COALESCE(v_permissions, '{}'::jsonb),
    'teams', v_teams
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access() TO authenticated;

COMMIT;
