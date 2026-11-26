-- Keep global admin gates distinct from team assignment gates.
-- Team assignments authorize their own team via has_team_permission(team_id, ...);
-- they must never satisfy global cross-team / aggregate fallbacks.
BEGIN;

CREATE OR REPLACE FUNCTION public.has_global_admin_permission(p_permission TEXT)
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
      SELECT 1 FROM public.admin_accounts AS a
      WHERE a.user_id = auth.uid()
        AND (a.role = 'owner' OR (a.role = 'admin' AND a.permissions @> jsonb_build_object(p_permission, true)))
    )
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.has_global_admin_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_global_admin_permission(TEXT) TO authenticated;

-- Recompile team RPCs that combine a global-admin fallback with a scoped
-- has_team_permission check. Replacing only these function bodies preserves
-- signatures, grants, SECURITY DEFINER settings, and their other safeguards.
DO $migration$
DECLARE
  v_function RECORD;
  v_definition TEXT;
BEGIN
  FOR v_function IN
    SELECT p.oid, n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
           p.prosrc
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc LIKE '%public.has_admin_permission%'
      AND p.prosrc LIKE '%public.has_team_permission%'
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, 'public.has_admin_permission(', 'public.has_global_admin_permission(');
    EXECUTE v_definition;
  END LOOP;

  -- The ledger manager uses a direct assignment check rather than
  -- has_team_permission, so scope its global fallback explicitly as well.
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'team_ledger_can_manage'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_team_id uuid';
  IF v_definition IS NOT NULL THEN
    v_definition := replace(v_definition, 'public.has_admin_permission(', 'public.has_global_admin_permission(');
    EXECUTE v_definition;
  END IF;
END;
$migration$;

-- Membership rows are team-scoped; only the matching assignment or a global
-- member administrator can read them.
DROP POLICY IF EXISTS team_memberships_read_authorized ON public.team_memberships;
CREATE POLICY team_memberships_read_authorized ON public.team_memberships FOR SELECT TO authenticated
USING (public.has_global_admin_permission('members') OR public.has_team_permission(team_id, 'members'));

COMMIT;
