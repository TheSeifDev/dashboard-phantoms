-- ==========================================================
-- 20261122160000_task_audience_groups.sql
-- مجموعات إسناد المهام: قادة مشاريع الويب + رؤساء ومراقبي التيمات
-- يعيد معرّفات الأعضاء النشطين فقط، ولا يفتح أي جدول جديد للقراءة المباشرة.
-- ==========================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_task_audience_groups()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_leads JSONB;
  v_heads JSONB;
BEGIN
  IF NOT (public.is_admin() OR public.has_admin_permission('tasks')) THEN
    RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED';
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT wp.lead_member_id), '[]'::jsonb)
  INTO v_leads
  FROM public.web_projects AS wp
  JOIN public.members AS m ON m.id = wp.lead_member_id AND m.work_status = 'active'
  WHERE wp.lead_member_id IS NOT NULL
    AND wp.status NOT IN ('archived', 'rejected');

  SELECT COALESCE(jsonb_agg(DISTINCT b.member_id), '[]'::jsonb)
  INTO v_heads
  FROM public.team_admin_assignments AS a
  JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
  JOIN public.member_auth_bindings AS b ON b.auth_user_id = a.user_id
  JOIN public.members AS m ON m.id = b.member_id AND m.work_status = 'active';

  RETURN jsonb_build_object(
    'leads', v_leads,
    'heads', v_heads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_task_audience_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_task_audience_groups() TO authenticated;

COMMIT;