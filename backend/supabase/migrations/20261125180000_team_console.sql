-- Round 37 — لوحة مستقلة لكل فريق.
--
-- 1) تقييمات الفريق بتتحسب في إجمالي العضو الأساسي: كل تقييم بيكتب كمان سطر في
--    public.notes بالوسم [B:±n] وبنفس team_id، فالإجمالي (اللي بيتحسب من notes)
--    بيشمل بونص الفريق، والبونص العام بيظهر في لوحة الفريق ضمن إجمالي العضو.
-- 2) خطة أداء الفريق: جدول أهداف بمؤشرات وقيم مستهدفة.
-- 3) owner_team_console: قراءة واحدة لكل بيانات اللوحة (مهام، تقييمات، أهداف،
--    مصادر، مهام/تقارير/موارد المشروعات المرتبطة بأعضاء الفريق) للمالك فقط.
BEGIN;

/* ------------------------------------------------------------------ */
/* خطة أداء الفريق                                                    */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS public.team_performance_goals (
  id BIGSERIAL PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '',
  target_value INTEGER NOT NULL DEFAULT 100,
  current_value INTEGER NOT NULL DEFAULT 0,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_goals_title_len CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT team_goals_metric_len CHECK (char_length(metric) <= 80),
  CONSTRAINT team_goals_target_range CHECK (target_value BETWEEN 1 AND 1000000),
  CONSTRAINT team_goals_current_range CHECK (current_value BETWEEN 0 AND 1000000),
  CONSTRAINT team_goals_status_check CHECK (status IN ('active', 'done', 'paused'))
);

CREATE INDEX IF NOT EXISTS team_performance_goals_team_idx
  ON public.team_performance_goals (team_id, status, due_date);

COMMENT ON TABLE public.team_performance_goals IS 'أهداف خطة أداء كل فريق. الوصول عبر owner_team_console و owner_team_goal_* فقط.';

ALTER TABLE public.team_performance_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_performance_goals FROM anon, authenticated;

/* ------------------------------------------------------------------ */
/* تقييم الفريق → الإجمالي الأساسي                                    */
/* ------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.team_create_evaluation(
  p_team_id UUID,
  p_member_id BIGINT,
  p_title TEXT,
  p_grade TEXT,
  p_points INTEGER,
  p_feedback TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_active BOOLEAN;
  v_member_name TEXT;
  v_evaluation_id BIGINT;
  v_tag TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('ranking')
          OR public.has_team_permission(p_team_id, 'ranking')) THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0
     OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_grade IS NULL OR p_grade NOT IN ('excellent', 'very_good', 'good', 'needs_improvement', 'warning')
     OR p_points IS NULL OR p_points NOT BETWEEN -10 AND 20
     OR p_feedback IS NULL OR char_length(btrim(p_feedback)) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'INVALID_TEAM_EVALUATION';
  END IF;

  SELECT m.full_name INTO v_member_name
  FROM public.team_memberships AS tm
  JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
  WHERE tm.team_id = p_team_id AND tm.member_id = p_member_id AND tm.status = 'active'
  FOR SHARE OF tm, m;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_MEMBER_NOT_ACTIVE'; END IF;

  INSERT INTO public.member_evaluations (
    member_id, title, grade, points, feedback, evaluator_name,
    bonus_note_id, created_by, team_id
  ) VALUES (
    p_member_id, btrim(p_title), p_grade, p_points, btrim(p_feedback),
    'Team administration', NULL, auth.uid(), p_team_id
  ) RETURNING id INTO v_evaluation_id;

  IF p_points > 0 THEN
    INSERT INTO public.team_member_metrics (team_id, member_id, bonus_points, updated_by)
    VALUES (p_team_id, p_member_id, p_points::BIGINT, auth.uid())
    ON CONFLICT (team_id, member_id) DO UPDATE
      SET bonus_points = public.team_member_metrics.bonus_points + EXCLUDED.bonus_points,
          updated_at = now(), updated_by = auth.uid();
  END IF;

  -- نفس التقييم بيتسجل في سجل البونص الأساسي، فإجمالي العضو (اللي بيتحسب من
  -- notes) بيشمل بونص الفريق، والسطر بيحمل team_id عشان يظهر في لوحة الفريق.
  IF p_points <> 0 THEN
    v_tag := CASE WHEN p_points > 0 THEN '[B:+' ELSE '[B:-' END
      || pg_catalog.abs(p_points)::TEXT || ']';
    INSERT INTO public.notes (text, author, author_role, date, target_member_id, target_name, team_id)
    VALUES (
      pg_catalog.left(
        v_tag || ' تقييم فريق (' || p_grade || ') — ' || btrim(p_title) || ': '
          || btrim(p_feedback),
        950
      ),
      'Team administration',
      'Team',
      pg_catalog.to_char((now() AT TIME ZONE 'Africa/Cairo')::DATE, 'YYYY-MM-DD'),
      p_member_id,
      v_member_name,
      p_team_id
    );
  END IF;

  RETURN v_evaluation_id;
END;
$$;

/* ------------------------------------------------------------------ */
/* خطة الأداء: حفظ/حذف                                                */
/* ------------------------------------------------------------------ */
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
  IF v_uid IS NULL OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
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
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  DELETE FROM public.team_performance_goals AS g
    WHERE g.id = p_goal_id AND g.team_id = p_team_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

/* ------------------------------------------------------------------ */
/* لوحة الفريق: قراءة واحدة لكل الأقسام                               */
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
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
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

REVOKE ALL ON FUNCTION public.owner_team_goal_save(UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_team_goal_delete(UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_team_console(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_team_goal_save(UUID, BIGINT, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_team_goal_delete(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_team_console(UUID) TO authenticated;

COMMIT;
