-- Round 38 — صلاحيات لوحة الفريق + خطة الفريق المكتوبة.
--
-- 1) لوحة الفريق (console) مكانتش للمالك بس. بقى ليها:
--    - قراءة: المالك، أو Admin عنده صلاحية dashboard، أو Head/Monitor متعيّن على الفريق.
--    - كتابة (خطة الأداء + خطة الفريق): المالك، أو Admin عنده dashboard، أو Head/Monitor
--      عنده صلاحية dashboard على نفس الفريق.
-- 2) خطة الفريق المكتوبة بتتخزن في team_profiles (plan) مع طابع وقت ومين عدّل.
-- كل الوصول لسه عبر SECURITY DEFINER ومفيش أي grants مباشرة على الجداول.
BEGIN;

/* ------------------------------------------------------------------ */
/* مساعدات الصلاحية                                                    */
/* ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.can_view_team_console(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_team_id IS NOT NULL
    AND (
      public.is_owner()
      OR public.has_admin_permission('dashboard')
      OR EXISTS (
        SELECT 1
        FROM public.team_admin_assignments AS a
        JOIN public.teams AS t ON t.id = a.team_id AND t.is_active
        JOIN auth.users AS u ON u.id = a.user_id
        WHERE a.team_id = p_team_id
          AND a.user_id = auth.uid()
          AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= now())
      )
    );
$$;
REVOKE ALL ON FUNCTION public.can_view_team_console(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_team_console(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_team_console(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_team_id IS NOT NULL
    AND (
      public.is_owner()
      OR public.has_admin_permission('dashboard')
      OR public.has_team_permission(p_team_id, 'dashboard')
    );
$$;
REVOKE ALL ON FUNCTION public.can_manage_team_console(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_team_console(UUID) TO authenticated;

/* ------------------------------------------------------------------ */
/* لوحة الفريق: القراءة بقت للمالك + الأدمن + Head/Monitor             */
/* ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.owner_team_console(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_view_team_console(p_team_id) THEN RAISE EXCEPTION 'TEAM_ACCESS_DENIED'; END IF;
  SELECT * INTO v_team FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'team', pg_catalog.jsonb_build_object(
      'team_id', v_team.id, 'slug', v_team.slug, 'name', v_team.name,
      'is_active', v_team.is_active, 'created_at', v_team.created_at
    ),
    'members', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'member_id', m.id,
        'full_name', m.full_name,
        'email', m.email,
        'membership_status', tm.status,
        'team_bonus', COALESCE(mt.bonus_points, 0),
        'main_bonus', COALESCE((
          SELECT pg_catalog.sum((pg_catalog.regexp_match(n.text, '\[B:([+-]?[0-9]{1,9})\]'))[1]::BIGINT)
          FROM public.notes AS n
          WHERE n.target_member_id = m.id AND n.text ~ '\[B:'
        ), 0),
        'evaluation_count', (
          SELECT pg_catalog.count(*) FROM public.member_evaluations AS e
          WHERE e.team_id = p_team_id AND e.member_id = m.id
        )
      ) ORDER BY m.full_name)
      FROM public.team_memberships AS tm
      JOIN public.members AS m ON m.id = tm.member_id
      LEFT JOIN public.team_member_metrics AS mt
        ON mt.team_id = tm.team_id AND mt.member_id = tm.member_id
      WHERE tm.team_id = p_team_id AND tm.status = 'active'
    ), '[]'::JSONB),
    'tasks', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'has_deadline', t.has_deadline,
        'deadline_date', t.deadline_date,
        'bonus_points', COALESCE(t.bonus_points, 0),
        'assigned_all', t.assigned_to = pg_catalog.to_jsonb('ALL'::TEXT),
        'assignees', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'member_id', tm2.member_id,
            'full_name', m2.full_name,
            'status', COALESCE(t.tracking -> tm2.member_id::TEXT ->> 'status', 'pending')
          ) ORDER BY m2.full_name)
          FROM public.team_memberships AS tm2
          JOIN public.members AS m2 ON m2.id = tm2.member_id
          WHERE tm2.team_id = t.team_id AND tm2.status = 'active'
            AND (t.assigned_to = pg_catalog.to_jsonb('ALL'::TEXT) OR t.assigned_to ? tm2.member_id::TEXT)
        ), '[]'::JSONB),
        'state', CASE
          WHEN pg_catalog.jsonb_typeof(t.tracking) <> 'object' OR t.tracking = '{}'::JSONB THEN 'open'
          WHEN EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(t.tracking) AS e WHERE e.value ->> 'status' = 'revision') THEN 'revision'
          WHEN EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(t.tracking) AS e WHERE e.value ->> 'status' = 'under_review') THEN 'review'
          WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(t.tracking) AS e WHERE COALESCE(e.value ->> 'status', '') <> 'approved') THEN 'approved'
          ELSE 'open'
        END,
        'created_at', t.created_at
      ) ORDER BY t.created_at DESC, t.id DESC)
      FROM public.tasks AS t WHERE t.team_id = p_team_id
    ), '[]'::JSONB),
    'evaluations', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', e.id,
        'member_id', e.member_id,
        'member_name', m.full_name,
        'title', e.title,
        'grade', e.grade,
        'points', e.points,
        'feedback', e.feedback,
        'created_at', e.created_at
      ) ORDER BY e.created_at DESC, e.id DESC)
      FROM public.member_evaluations AS e
      JOIN public.members AS m ON m.id = e.member_id
      WHERE e.team_id = p_team_id
    ), '[]'::JSONB),
    'goals', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', g.id,
        'title', g.title,
        'metric', g.metric,
        'target_value', g.target_value,
        'current_value', g.current_value,
        'due_date', g.due_date,
        'status', g.status,
        'updated_at', g.updated_at
      ) ORDER BY g.status, g.due_date NULLS LAST, g.id)
      FROM public.team_performance_goals AS g
      WHERE g.team_id = p_team_id
    ), '[]'::JSONB),
    'references', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'url', r.url,
        'description', r.description,
        'category', r.category,
        'team_scoped', r.team_id IS NOT NULL,
        'created_at', r.created_at
      ) ORDER BY r.team_id NULLS FIRST, r.created_at DESC)
      FROM public.reference_links AS r
      WHERE r.team_id = p_team_id OR r.team_id IS NULL
    ), '[]'::JSONB),
    'project_tasks', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', pt.id,
        'project_id', pt.project_id,
        'project_name', p.name,
        'title', pt.title,
        'status', pt.status,
        'priority', pt.priority,
        'due_date', pt.due_date
      ) ORDER BY pt.due_date NULLS LAST, pt.created_at DESC)
      FROM (
        SELECT t.* FROM public.web_project_tasks AS t
        WHERE t.project_id IN (
          SELECT wpm.project_id FROM public.web_project_members AS wpm
          JOIN public.team_memberships AS tm ON tm.member_id = wpm.member_id
          WHERE tm.team_id = p_team_id AND tm.status = 'active'
        )
        ORDER BY t.created_at DESC LIMIT 120
      ) AS pt
      JOIN public.web_projects AS p ON p.id = pt.project_id
    ), '[]'::JSONB),
    'project_reports', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', r.id,
        'project_id', r.project_id,
        'project_name', p.name,
        'member_name', m.full_name,
        'period_start', r.period_start,
        'period_end', r.period_end,
        'completed_this_week', r.completed_this_week,
        'status', r.status,
        'blockers', r.blockers,
        'created_at', r.created_at
      ) ORDER BY r.period_start DESC NULLS LAST, r.created_at DESC)
      FROM (
        SELECT rep.* FROM public.web_project_member_reports AS rep
        WHERE rep.member_id IN (
          SELECT tm.member_id FROM public.team_memberships AS tm
          WHERE tm.team_id = p_team_id AND tm.status = 'active'
        )
        ORDER BY rep.created_at DESC LIMIT 60
      ) AS r
      JOIN public.web_projects AS p ON p.id = r.project_id
      JOIN public.members AS m ON m.id = r.member_id
    ), '[]'::JSONB),
    'resources', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', res.id,
        'title', res.title,
        'category', res.category,
        'description', res.description,
        'external_url', res.external_url,
        'preview_url', res.preview_url,
        'project_name', p.name,
        'access_status', res.access_status,
        'created_at', res.created_at
      ) ORDER BY res.created_at DESC)
      FROM (
        SELECT r.* FROM public.web_resources AS r
        WHERE r.project_id IN (
          SELECT wpm.project_id FROM public.web_project_members AS wpm
          JOIN public.team_memberships AS tm ON tm.member_id = wpm.member_id
          WHERE tm.team_id = p_team_id AND tm.status = 'active'
        )
        ORDER BY r.created_at DESC LIMIT 80
      ) AS res
      JOIN public.web_projects AS p ON p.id = res.project_id
    ), '[]'::JSONB)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_team_goal_save(
  p_team_id UUID,
  p_goal_id BIGINT,
  p_title TEXT,
  p_metric TEXT,
  p_target_value INTEGER,
  p_current_value INTEGER,
  p_due_date DATE,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_status TEXT := COALESCE(NULLIF(btrim(COALESCE(p_status, '')), ''), 'active');
  v_goal_id BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_manage_team_console(p_team_id) THEN RAISE EXCEPTION 'TEAM_ACCESS_DENIED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'INVALID_GOAL_TITLE';
  END IF;
  IF p_target_value IS NULL OR p_target_value NOT BETWEEN 1 AND 1000000
     OR p_current_value IS NULL OR p_current_value NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'INVALID_GOAL_VALUES';
  END IF;
  IF v_status NOT IN ('active', 'done', 'paused') THEN RAISE EXCEPTION 'INVALID_GOAL_STATUS'; END IF;

  IF p_goal_id IS NULL THEN
    INSERT INTO public.team_performance_goals (
      team_id, title, metric, target_value, current_value, due_date, status, created_by
    ) VALUES (
      p_team_id, btrim(p_title), btrim(COALESCE(p_metric, '')), p_target_value, p_current_value,
      p_due_date, v_status, v_uid
    ) RETURNING id INTO v_goal_id;
  ELSE
    UPDATE public.team_performance_goals AS g
      SET title = btrim(p_title),
          metric = btrim(COALESCE(p_metric, '')),
          target_value = p_target_value,
          current_value = p_current_value,
          due_date = p_due_date,
          status = v_status,
          updated_at = now()
      WHERE g.id = p_goal_id AND g.team_id = p_team_id
      RETURNING g.id INTO v_goal_id;
    IF v_goal_id IS NULL THEN RAISE EXCEPTION 'GOAL_NOT_FOUND'; END IF;
  END IF;

  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'id', g.id, 'title', g.title, 'metric', g.metric,
      'target_value', g.target_value, 'current_value', g.current_value,
      'due_date', g.due_date, 'status', g.status, 'updated_at', g.updated_at
    )
    FROM public.team_performance_goals AS g WHERE g.id = v_goal_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_team_goal_delete(p_team_id UUID, p_goal_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_manage_team_console(p_team_id) THEN RAISE EXCEPTION 'TEAM_ACCESS_DENIED'; END IF;
  DELETE FROM public.team_performance_goals AS g
    WHERE g.id = p_goal_id AND g.team_id = p_team_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

/* ------------------------------------------------------------------ */
/* خطة الفريق المكتوبة                                                */
/* ------------------------------------------------------------------ */
ALTER TABLE public.team_profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.team_profiles
  DROP CONSTRAINT IF EXISTS team_profiles_plan_len;
ALTER TABLE public.team_profiles
  ADD CONSTRAINT team_profiles_plan_len CHECK (char_length(plan) <= 6000);

CREATE OR REPLACE FUNCTION public.team_plan_get(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team public.teams%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_view_team_console(p_team_id) THEN RAISE EXCEPTION 'TEAM_ACCESS_DENIED'; END IF;
  SELECT * INTO v_team FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'team_id', v_team.id,
      'plan', COALESCE(p.plan, ''),
      'updated_at', p.plan_updated_at,
      'can_edit', public.can_manage_team_console(v_team.id)
    )
    FROM (SELECT 1) AS one
    LEFT JOIN public.team_profiles AS p ON p.team_id = v_team.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.team_plan_save(p_team_id UUID, p_plan TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan TEXT := btrim(COALESCE(p_plan, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_manage_team_console(p_team_id) THEN RAISE EXCEPTION 'TEAM_ACCESS_DENIED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = p_team_id) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND';
  END IF;
  IF char_length(v_plan) > 6000 THEN RAISE EXCEPTION 'PLAN_TOO_LONG'; END IF;

  INSERT INTO public.team_profiles AS tp (team_id, plan, plan_updated_at, plan_updated_by, updated_at, updated_by)
  VALUES (p_team_id, v_plan, now(), v_uid, now(), v_uid)
  ON CONFLICT (team_id) DO UPDATE
    SET plan = EXCLUDED.plan,
        plan_updated_at = now(),
        plan_updated_by = EXCLUDED.plan_updated_by
    WHERE tp.team_id = EXCLUDED.team_id;

  RETURN public.team_plan_get(p_team_id);
END;
$$;

REVOKE ALL ON FUNCTION public.team_plan_get(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_plan_save(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_plan_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_plan_save(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_team_goal_save(UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_team_goal_delete(UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_team_console(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_team_goal_save(UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_team_goal_delete(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_team_console(UUID) TO authenticated;

COMMIT;
