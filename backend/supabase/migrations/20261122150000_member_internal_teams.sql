-- 20261122150000 — الفرق الداخلية اللي العضو عضو فيها (AI / Software / Hardware)
-- الأعضاء مش عندهم صلاحية قراءة teams أو team_memberships مباشرة (RLS للإدارة فقط)،
-- فبنوفّر RPC محصورة على صاحب الجلسة نفسه: بترجع فرقه المعتمدة فقط، ومفيش أي
-- بيانات عن أعضاء تانيين ولا عن فرق مش عضو فيها.
BEGIN;

CREATE OR REPLACE FUNCTION public.member_internal_teams()
RETURNS TABLE (
  team_id UUID,
  slug TEXT,
  name TEXT,
  status TEXT,
  approved_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT t.id, t.slug, t.name, m.status, m.approved_at
  FROM public.member_auth_bindings AS b
  JOIN public.team_memberships AS m ON m.member_id = b.member_id
  JOIN public.teams AS t ON t.id = m.team_id
  WHERE b.auth_user_id = auth.uid()
    AND t.is_active IS TRUE
    AND COALESCE(m.status, '') <> 'rejected'
  ORDER BY t.name;
$$;

REVOKE ALL ON FUNCTION public.member_internal_teams() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_internal_teams() TO authenticated;

COMMIT;