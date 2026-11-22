-- 20261122154000 — member_internal_teams(): استبعاد العضويات المرفوضة والمزالة
-- النسخة الأولى كانت بتستبعد 'rejected' بس، فالعضو اللي اتشال من فريق (removed) كان
-- لسه بيظهر له الفريق في البوابة. القيد على team_memberships.status بيسمح بـ
-- pending/active/suspended/removed، فالفلتر الصح هو استبعاد rejected + removed.
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
    AND m.status NOT IN ('rejected', 'removed')
  ORDER BY t.name;
$$;
REVOKE ALL ON FUNCTION public.member_internal_teams() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_internal_teams() TO authenticated;
COMMIT;