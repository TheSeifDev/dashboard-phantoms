-- 0017 — امنع قراءة بيانات الأعضاء والمهام والملاحظات مباشرة من جلسة anon
BEGIN;

REVOKE ALL ON TABLE public.members FROM PUBLIC, anon;
REVOKE SELECT (id, created_at, email, full_name, bio, device, meeting_attendance, work_status, completion_rank, can_go_alexandria)
  ON TABLE public.members FROM anon;
DROP POLICY IF EXISTS "Anon read members by email" ON public.members;
DROP POLICY IF EXISTS "Anon members login lookup" ON public.members;

REVOKE ALL ON TABLE public.notes FROM PUBLIC, anon;
DROP POLICY IF EXISTS "Anon read notes" ON public.notes;
REVOKE ALL ON TABLE public.tasks FROM PUBLIC, anon;
DROP POLICY IF EXISTS "Anon read tasks" ON public.tasks;

CREATE OR REPLACE FUNCTION public.get_member_tasks(
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tasks JSONB;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'created_at', t.created_at,
      'title', t.title,
      'description', t.description,
      'has_deadline', t.has_deadline,
      'deadline_date', t.deadline_date,
      'assigned_to', jsonb_build_array(p_member_id::TEXT),
      'tracking', CASE
        WHEN COALESCE(t.tracking, '{}'::jsonb) ? p_member_id::TEXT
        THEN jsonb_build_object(p_member_id::TEXT, t.tracking -> p_member_id::TEXT)
        ELSE '{}'::jsonb
      END,
      'bonus_points', COALESCE(t.bonus_points, 0)
    ) ORDER BY t.created_at DESC, t.id DESC
  ), '[]'::jsonb)
  INTO v_tasks
  FROM public.tasks AS t
  WHERE t.assigned_to = pg_catalog.to_jsonb('ALL'::TEXT)
    OR CASE
      WHEN jsonb_typeof(t.assigned_to) = 'array' THEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(t.assigned_to) AS assigned(member_id)
        WHERE assigned.member_id = p_member_id::TEXT
      )
      ELSE false
    END;

  RETURN v_tasks;
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_tasks(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_tasks(BIGINT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_member_tasks(BIGINT, TEXT) IS
  'Returns only this verified member’s assigned tasks and their own tracking entry.';

CREATE OR REPLACE FUNCTION public.get_member_bonus_total(
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  SELECT COALESCE(
    SUM(((pg_catalog.regexp_match(n.text, '\[B:([+-]?[0-9]{1,9})\]'))[1])::BIGINT),
    0
  )
  INTO v_total
  FROM public.notes AS n
  WHERE n.target_member_id = p_member_id;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_bonus_total(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_bonus_total(BIGINT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_member_bonus_total(BIGINT, TEXT) IS
  'Returns only the verified member device’s numeric bonus total without exposing the notes table.';

COMMIT;
