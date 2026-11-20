-- Team-scoped operational records. Historical NULL-scoped rows remain global-only.
-- All writes go through narrow RPCs; no team-only table-wide policies are added.
BEGIN;

CREATE FUNCTION public.team_list_notes(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('notes')
          OR public.has_team_permission(p_team_id, 'notes')) THEN
    RAISE EXCEPTION 'NOTES_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id,
      'text', n.text,
      'target_member_id', n.target_member_id,
      'target_name', m.full_name,
      'created_at', n.created_at
    ) ORDER BY n.created_at DESC, n.id DESC)
    FROM public.notes AS n
    LEFT JOIN public.members AS m ON m.id = n.target_member_id AND m.work_status = 'active'
    WHERE n.team_id = p_team_id
      AND (n.target_member_id IS NULL OR EXISTS (
        SELECT 1 FROM public.team_memberships AS tm
        WHERE tm.team_id = p_team_id AND tm.member_id = n.target_member_id
          AND tm.status = 'active'
      ))
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_notes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_list_notes(UUID) TO authenticated;

CREATE FUNCTION public.team_create_note(
  p_team_id UUID,
  p_text TEXT,
  p_target_member_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
  v_target_name TEXT;
  v_note_id BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('notes')
          OR public.has_team_permission(p_team_id, 'notes')) THEN
    RAISE EXCEPTION 'NOTES_PERMISSION_REQUIRED';
  END IF;
  IF p_text IS NULL OR char_length(btrim(p_text)) NOT BETWEEN 1 AND 5000
     OR position('[B:' IN upper(p_text)) > 0 THEN
    RAISE EXCEPTION 'INVALID_TEAM_NOTE';
  END IF;

  IF p_target_member_id IS NOT NULL THEN
    IF p_target_member_id <= 0 THEN RAISE EXCEPTION 'INVALID_TEAM_MEMBER'; END IF;
    SELECT m.full_name INTO v_target_name
    FROM public.team_memberships AS tm
    JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
    WHERE tm.team_id = p_team_id AND tm.member_id = p_target_member_id
      AND tm.status = 'active'
    FOR SHARE OF tm, m;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_MEMBER_NOT_ACTIVE'; END IF;
  END IF;

  INSERT INTO public.notes (
    text, author, author_role, date, target_member_id, target_name, team_id
  ) VALUES (
    btrim(p_text), 'Team administration', 'team_admin', to_char(now(), 'YYYY-MM-DD'),
    p_target_member_id, v_target_name, p_team_id
  ) RETURNING id INTO v_note_id;
  RETURN v_note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_create_note(UUID, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_create_note(UUID, TEXT, BIGINT) TO authenticated;

CREATE FUNCTION public.team_delete_note(p_team_id UUID, p_note_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('notes')
          OR public.has_team_permission(p_team_id, 'notes')) THEN
    RAISE EXCEPTION 'NOTES_PERMISSION_REQUIRED';
  END IF;
  IF p_note_id IS NULL OR p_note_id <= 0 THEN RAISE EXCEPTION 'INVALID_TEAM_NOTE'; END IF;

  DELETE FROM public.notes AS n
  WHERE n.id = p_note_id AND n.team_id = p_team_id
    AND (n.target_member_id IS NULL OR EXISTS (
      SELECT 1 FROM public.team_memberships AS tm
      JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
      WHERE tm.team_id = p_team_id AND tm.member_id = n.target_member_id
        AND tm.status = 'active'
    ));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.team_delete_note(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_delete_note(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.team_list_evaluations(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('ranking')
          OR public.has_team_permission(p_team_id, 'ranking')) THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id,
      'member_id', e.member_id,
      'member_name', m.full_name,
      'title', e.title,
      'grade', e.grade,
      'points', e.points,
      'feedback', e.feedback,
      'evaluator_name', e.evaluator_name,
      'created_at', e.created_at,
      'viewed_at', e.viewed_at,
      'read_at', e.read_at
    ) ORDER BY e.created_at DESC, e.id DESC)
    FROM public.member_evaluations AS e
    JOIN public.team_memberships AS tm
      ON tm.team_id = e.team_id AND tm.member_id = e.member_id AND tm.status = 'active'
    JOIN public.members AS m ON m.id = e.member_id AND m.work_status = 'active'
    WHERE e.team_id = p_team_id
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_evaluations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_list_evaluations(UUID) TO authenticated;

CREATE FUNCTION public.team_create_evaluation(
  p_team_id UUID,
  p_member_id BIGINT,
  p_title TEXT,
  p_grade TEXT,
  p_points INT,
  p_feedback TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
  v_evaluation_id BIGINT;
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

  PERFORM 1
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

  -- Positive evaluation points are team bonus awards. Negative evaluation
  -- points remain feedback, because bonus_points is a nonnegative award balance.
  -- The atomic upsert preserves any task-awarded balance already on this row.
  IF p_points > 0 THEN
    INSERT INTO public.team_member_metrics (team_id, member_id, bonus_points, updated_by)
    VALUES (p_team_id, p_member_id, p_points::BIGINT, auth.uid())
    ON CONFLICT (team_id, member_id) DO UPDATE
      SET bonus_points = public.team_member_metrics.bonus_points + EXCLUDED.bonus_points,
          updated_at = now(), updated_by = auth.uid();
  END IF;
  RETURN v_evaluation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_create_evaluation(UUID, BIGINT, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_create_evaluation(UUID, BIGINT, TEXT, TEXT, INT, TEXT) TO authenticated;

CREATE FUNCTION public.team_delete_evaluation(p_team_id UUID, p_evaluation_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
  v_member_id BIGINT;
  v_points INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('ranking')
          OR public.has_team_permission(p_team_id, 'ranking')) THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED';
  END IF;
  IF p_evaluation_id IS NULL OR p_evaluation_id <= 0 THEN RAISE EXCEPTION 'INVALID_TEAM_EVALUATION'; END IF;

  SELECT e.member_id, e.points INTO v_member_id, v_points
  FROM public.member_evaluations AS e
  JOIN public.team_memberships AS tm
    ON tm.team_id = e.team_id AND tm.member_id = e.member_id AND tm.status = 'active'
  JOIN public.members AS m ON m.id = e.member_id AND m.work_status = 'active'
  WHERE e.team_id = p_team_id AND e.id = p_evaluation_id
  FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  DELETE FROM public.member_evaluations AS e
  WHERE e.team_id = p_team_id AND e.id = p_evaluation_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Reverse only a positive evaluation award. Refuse a stale reversal rather
  -- than underflowing or consuming unrelated task-awarded points. An exception
  -- rolls back the evaluation deletion and metric change together.
  IF v_points > 0 THEN
    UPDATE public.team_member_metrics
    SET bonus_points = bonus_points - v_points::BIGINT,
        updated_at = now(), updated_by = auth.uid()
    WHERE team_id = p_team_id AND member_id = v_member_id
      AND bonus_points >= v_points::BIGINT;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_METRIC_REVERSAL_BLOCKED'; END IF;
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.team_delete_evaluation(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_delete_evaluation(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.team_list_ranking(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('ranking')
          OR public.has_team_permission(p_team_id, 'ranking')) THEN
    RAISE EXCEPTION 'RANKING_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'member_id', m.id,
      'full_name', m.full_name,
      'completion_rank', COALESCE(mm.completion_rank, 0),
      'bonus_infinite', COALESCE(mm.bonus_infinite, FALSE),
      'bonus_points', COALESCE(mm.bonus_points, 0),
      'updated_at', mm.updated_at
    ) ORDER BY COALESCE(mm.bonus_infinite, FALSE) DESC,
               COALESCE(mm.bonus_points, 0) DESC,
               COALESCE(mm.completion_rank, 0) DESC,
               m.full_name, m.id)
    FROM public.team_memberships AS tm
    JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
    LEFT JOIN public.team_member_metrics AS mm
      ON mm.team_id = tm.team_id AND mm.member_id = tm.member_id
    WHERE tm.team_id = p_team_id AND tm.status = 'active'
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_ranking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_list_ranking(UUID) TO authenticated;

CREATE FUNCTION public.team_list_custom_fields(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'label', f.label, 'field_type', f.field_type,
      'options', f.options, 'sort_order', f.sort_order, 'created_at', f.created_at
    ) ORDER BY f.sort_order, f.id)
    FROM public.member_custom_fields AS f
    WHERE f.team_id = p_team_id AND f.is_active
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_custom_fields(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_list_custom_fields(UUID) TO authenticated;

CREATE FUNCTION public.team_create_custom_field(
  p_team_id UUID,
  p_label TEXT,
  p_field_type TEXT,
  p_options JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
  v_field_id BIGINT;
  v_label TEXT := btrim(COALESCE(p_label, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;
  IF char_length(v_label) NOT BETWEEN 1 AND 120
     OR p_field_type IS NULL
     OR p_field_type <> ALL (ARRAY['short_text','long_text','number','date','yes_no','select']::TEXT[])
     OR p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD';
  END IF;
  IF p_field_type = 'select' THEN
    IF jsonb_array_length(p_options) NOT BETWEEN 1 AND 100
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_options) AS option_item(value)
         WHERE jsonb_typeof(option_item.value) <> 'string'
           OR char_length(btrim(option_item.value #>> '{}')) NOT BETWEEN 1 AND 120
       )
       OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_options) AS options(value))
          <> jsonb_array_length(p_options) THEN
      RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_OPTIONS';
    END IF;
  ELSIF p_options <> '[]'::jsonb THEN
    RAISE EXCEPTION 'OPTIONS_ONLY_ALLOWED_FOR_SELECT';
  END IF;

  INSERT INTO public.member_custom_fields (
    label, field_type, options, is_active, sort_order, created_by, team_id
  ) VALUES (
    v_label, p_field_type, p_options, TRUE, 0, auth.uid(), p_team_id
  ) RETURNING id INTO v_field_id;
  RETURN v_field_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_create_custom_field(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_create_custom_field(UUID, TEXT, TEXT, JSONB) TO authenticated;

CREATE FUNCTION public.team_set_custom_field_value(
  p_team_id UUID,
  p_member_id BIGINT,
  p_field_id BIGINT,
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
  v_field public.member_custom_fields%ROWTYPE;
  v_value_type TEXT;
  v_value_text TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR p_field_id IS NULL OR p_field_id <= 0
     OR p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
  END IF;

  PERFORM 1
  FROM public.team_memberships AS tm
  JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
  WHERE tm.team_id = p_team_id AND tm.member_id = p_member_id AND tm.status = 'active'
  FOR SHARE OF tm, m;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_MEMBER_NOT_ACTIVE'; END IF;

  SELECT f.* INTO v_field
  FROM public.member_custom_fields AS f
  WHERE f.id = p_field_id AND f.team_id = p_team_id AND f.is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_CUSTOM_FIELD_NOT_FOUND'; END IF;

  v_value_type := jsonb_typeof(p_value);
  v_value_text := p_value #>> '{}';
  CASE v_field.field_type
    WHEN 'short_text' THEN
      IF v_value_type <> 'string' OR char_length(v_value_text) > 500 THEN
        RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
      END IF;
    WHEN 'long_text' THEN
      IF v_value_type <> 'string' OR char_length(v_value_text) > 3000 THEN
        RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
      END IF;
    WHEN 'number' THEN
      IF v_value_type <> 'number' THEN RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE'; END IF;
    WHEN 'date' THEN
      IF v_value_type <> 'string' OR v_value_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
      END IF;
      BEGIN
        IF to_char(v_value_text::DATE, 'YYYY-MM-DD') <> v_value_text THEN
          RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE';
      END;
    WHEN 'yes_no' THEN
      IF v_value_type <> 'boolean' THEN RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE'; END IF;
    WHEN 'select' THEN
      IF v_value_type <> 'string' OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_field.options) AS option_value(value)
        WHERE option_value.value = v_value_text
      ) THEN RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_VALUE'; END IF;
    ELSE
      RAISE EXCEPTION 'INVALID_TEAM_CUSTOM_FIELD_TYPE';
  END CASE;

  INSERT INTO public.team_member_custom_field_values (
    team_id, member_id, field_id, value, updated_at, updated_by
  ) VALUES (
    p_team_id, p_member_id, p_field_id, p_value, now(), auth.uid()
  )
  ON CONFLICT (team_id, member_id, field_id) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.team_set_custom_field_value(UUID, BIGINT, BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_set_custom_field_value(UUID, BIGINT, BIGINT, JSONB) TO authenticated;

CREATE FUNCTION public.team_list_custom_field_values(p_team_id UUID, p_member_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_team_active BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT t.is_active INTO v_team_active FROM public.teams AS t WHERE t.id = p_team_id;
  IF NOT FOUND OR NOT v_team_active THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.is_owner() OR public.has_admin_permission('members')
          OR public.has_team_permission(p_team_id, 'members')) THEN
    RAISE EXCEPTION 'MEMBERS_PERMISSION_REQUIRED';
  END IF;
  IF p_member_id IS NULL OR p_member_id <= 0 OR NOT EXISTS (
    SELECT 1
    FROM public.team_memberships AS tm
    JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
    WHERE tm.team_id = p_team_id AND tm.member_id = p_member_id AND tm.status = 'active'
  ) THEN RAISE EXCEPTION 'TEAM_MEMBER_NOT_ACTIVE'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'field_id', f.id,
      'label', f.label,
      'field_type', f.field_type,
      'options', f.options,
      'value', v.value,
      'updated_at', v.updated_at
    ) ORDER BY f.sort_order, f.id)
    FROM public.member_custom_fields AS f
    LEFT JOIN public.team_member_custom_field_values AS v
      ON v.team_id = f.team_id AND v.member_id = p_member_id AND v.field_id = f.id
    WHERE f.team_id = p_team_id AND f.is_active
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_custom_field_values(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_list_custom_field_values(UUID, BIGINT) TO authenticated;

-- Preserve legacy global evaluations in the member portal, but do not expose or
-- acknowledge a team evaluation unless this same member still has active
-- membership in that evaluation's active team.
CREATE OR REPLACE FUNCTION public.get_member_evaluations(
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMPTZ,
  member_id BIGINT,
  title TEXT,
  grade TEXT,
  points INT,
  feedback TEXT,
  evaluator_name TEXT,
  viewed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  UPDATE public.member_evaluations AS e
  SET viewed_at = COALESCE(e.viewed_at, now())
  WHERE e.member_id = p_member_id
    AND e.viewed_at IS NULL
    AND (e.team_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.team_memberships AS tm
      JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
      JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
      WHERE tm.team_id = e.team_id AND tm.member_id = e.member_id
        AND tm.status = 'active'
    ));

  RETURN QUERY
  SELECT e.id, e.created_at, e.member_id, e.title, e.grade, e.points,
         e.feedback, e.evaluator_name, e.viewed_at, e.read_at
  FROM public.member_evaluations AS e
  WHERE e.member_id = p_member_id
    AND (e.team_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.team_memberships AS tm
      JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
      JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
      WHERE tm.team_id = e.team_id AND tm.member_id = e.member_id
        AND tm.status = 'active'
    ))
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_evaluations(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_evaluations(BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_member_evaluation_read(
  p_evaluation_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.assert_member_device(p_member_id, p_device_token);

  UPDATE public.member_evaluations AS e
  SET viewed_at = COALESCE(e.viewed_at, now()),
      read_at = COALESCE(e.read_at, now())
  WHERE e.id = p_evaluation_id
    AND e.member_id = p_member_id
    AND (e.team_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.team_memberships AS tm
      JOIN public.teams AS t ON t.id = tm.team_id AND t.is_active
      JOIN public.members AS m ON m.id = tm.member_id AND m.work_status = 'active'
      WHERE tm.team_id = e.team_id AND tm.member_id = e.member_id
        AND tm.status = 'active'
    ));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_member_evaluation_read(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_member_evaluation_read(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
