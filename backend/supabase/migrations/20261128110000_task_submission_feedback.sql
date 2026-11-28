-- Additive task delivery metadata for global/internal tasks and Web Projects.
-- Client-provided identity and timestamps are never trusted.

CREATE FUNCTION public.submit_task_delivery(
  p_task_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT,
  p_description TEXT,
  p_notes TEXT,
  p_usefulness_stars INTEGER,
  p_difficulty TEXT,
  p_links JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT := current_setting('role', TRUE);
  v_is_admin BOOLEAN := FALSE;
  v_tracking JSONB;
  v_assigned JSONB;
  v_team_id UUID;
  v_entry JSONB;
  v_old_status TEXT;
  v_link JSONB;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_task_id IS NULL OR p_task_id <= 0 OR p_task_id > 2147483647
     OR p_member_id IS NULL OR p_member_id <= 0 OR p_member_id > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_TASK_OR_MEMBER_ID';
  END IF;
  IF p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 1 AND 4000
     OR p_notes IS NULL OR char_length(p_notes) > 2000
     OR p_usefulness_stars IS NULL OR p_usefulness_stars NOT BETWEEN 1 AND 5
     OR p_difficulty IS NULL OR p_difficulty NOT IN ('easy','medium','hard')
     OR p_links IS NULL OR jsonb_typeof(p_links) <> 'array'
     OR jsonb_array_length(p_links) > 10 THEN
    RAISE EXCEPTION 'INVALID_TASK_DELIVERY';
  END IF;
  FOR v_link IN SELECT value FROM jsonb_array_elements(p_links) AS links(value) LOOP
    IF jsonb_typeof(v_link) <> 'object'
       OR jsonb_typeof(v_link -> 'label') <> 'string'
       OR char_length(btrim(v_link ->> 'label')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_link -> 'url') <> 'string'
       OR char_length(v_link ->> 'url') NOT BETWEEN 9 AND 2048
       OR (v_link ->> 'url') !~* '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'INVALID_TASK_DELIVERY_LINK';
    END IF;
  END LOOP;

  IF v_role = 'authenticated' THEN
    SELECT public.is_admin() AND public.has_admin_permission('tasks') INTO v_is_admin;
  END IF;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    PERFORM public.assert_member_device(p_member_id, p_device_token);
  END IF;

  SELECT t.tracking, t.assigned_to, t.team_id
    INTO v_tracking, v_assigned, v_team_id
    FROM public.tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  v_tracking := CASE WHEN jsonb_typeof(v_tracking) = 'object' THEN v_tracking ELSE '{}'::JSONB END;

  IF v_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id = v_team_id AND t.is_active) THEN
      RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.team_memberships AS tm
      JOIN public.members AS m ON m.id = tm.member_id
      WHERE tm.team_id = v_team_id AND tm.member_id = p_member_id
        AND tm.status = 'active' AND m.work_status = 'active'
    ) THEN RAISE EXCEPTION 'TEAM_MEMBERSHIP_REQUIRED'; END IF;
    IF NOT COALESCE(v_is_admin, FALSE) AND NOT public.has_team_member_identity(v_team_id, p_member_id) THEN
      RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_REQUIRED';
    END IF;
  END IF;
  IF v_assigned IS DISTINCT FROM to_jsonb('ALL'::TEXT)
     AND NOT (jsonb_typeof(COALESCE(v_assigned, '[]'::JSONB)) = 'array'
       AND (v_assigned ? p_member_id::TEXT OR v_assigned @> to_jsonb(p_member_id)
            OR v_assigned @> to_jsonb(p_member_id::TEXT))) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED';
  END IF;

  v_entry := COALESCE(v_tracking -> p_member_id::TEXT, '{}'::JSONB);
  v_old_status := v_entry ->> 'status';
  IF v_old_status = 'approved' THEN RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN'; END IF;
  IF v_old_status = 'under_review' THEN RAISE EXCEPTION 'SUBMISSION_ALREADY_UNDER_REVIEW'; END IF;
  v_entry := v_entry || jsonb_build_object(
    'status', 'under_review',
    'submission_description', btrim(p_description),
    'submission_notes', btrim(p_notes),
    'note', btrim(p_notes),
    'usefulness_stars', p_usefulness_stars,
    'difficulty', p_difficulty,
    'submission_links', p_links,
    'submission_url', COALESCE(p_links -> 0 ->> 'url', ''),
    'submitted_at', v_now,
    'updated_at', v_now
  );
  v_tracking := jsonb_set(v_tracking, ARRAY[p_member_id::TEXT], v_entry, TRUE);
  IF v_team_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation', format('member_submit:%s:%s', p_task_id, p_member_id), TRUE);
  END IF;
  UPDATE public.tasks SET tracking = v_tracking WHERE id = p_task_id;
  IF v_team_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation', '', TRUE);
  END IF;
  RETURN jsonb_build_object('task_id', p_task_id, 'member_id', p_member_id, 'status', 'under_review', 'submitted_at', v_now);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_task_delivery(BIGINT,BIGINT,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.submit_task_delivery(BIGINT,BIGINT,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB) TO anon, authenticated;

CREATE TABLE public.web_project_task_submissions (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  member_id BIGINT NOT NULL,
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  usefulness_stars SMALLINT NOT NULL CHECK (usefulness_stars BETWEEN 1 AND 5),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  links JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 10),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (project_id, task_id) REFERENCES public.web_project_tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, member_id) REFERENCES public.web_project_members(project_id, member_id) ON DELETE RESTRICT,
  UNIQUE (project_id, task_id, member_id),
  UNIQUE (project_id, id)
);
CREATE INDEX web_project_task_submissions_member_idx
  ON public.web_project_task_submissions (member_id, project_id, submitted_at DESC);
ALTER TABLE public.web_project_task_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_project_task_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.web_project_task_submissions TO authenticated;
CREATE POLICY web_project_task_submissions_read ON public.web_project_task_submissions
  FOR SELECT TO authenticated
  USING (
    public.web_is_program_admin()
    OR public.web_is_project_lead(project_id)
    OR member_id = public.web_current_member_id()
  );

CREATE FUNCTION public.web_submit_project_task(
  p_task_id UUID,
  p_description TEXT,
  p_notes TEXT,
  p_usefulness_stars INTEGER,
  p_difficulty TEXT,
  p_links JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id BIGINT := public.web_current_member_id();
  v_task public.web_project_tasks%ROWTYPE;
  v_link JSONB;
  v_submission_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR v_member_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_task_id IS NULL OR p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 1 AND 4000
     OR p_notes IS NULL OR char_length(p_notes) > 2000
     OR p_usefulness_stars IS NULL OR p_usefulness_stars NOT BETWEEN 1 AND 5
     OR p_difficulty IS NULL OR p_difficulty NOT IN ('easy','medium','hard')
     OR p_links IS NULL OR jsonb_typeof(p_links) <> 'array' OR jsonb_array_length(p_links) > 10 THEN
    RAISE EXCEPTION 'INVALID_WEB_PROJECT_TASK_SUBMISSION';
  END IF;
  FOR v_link IN SELECT value FROM jsonb_array_elements(p_links) AS links(value) LOOP
    IF jsonb_typeof(v_link) <> 'object'
       OR jsonb_typeof(v_link -> 'label') <> 'string'
       OR char_length(btrim(v_link ->> 'label')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_link -> 'url') <> 'string'
       OR char_length(btrim(v_link ->> 'url')) NOT BETWEEN 9 AND 2048
       OR (v_link ->> 'url') !~* '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'INVALID_WEB_PROJECT_TASK_SUBMISSION_LINK';
    END IF;
  END LOOP;

  SELECT * INTO v_task FROM public.web_project_tasks AS task WHERE task.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEB_PROJECT_TASK_NOT_FOUND'; END IF;
  IF NOT public.web_is_project_contributor(v_task.project_id)
     OR NOT public.web_is_task_assignee(v_task.project_id, v_task.id)
     OR NOT EXISTS (
       SELECT 1 FROM public.web_project_members AS member
       WHERE member.project_id = v_task.project_id AND member.member_id = v_member_id
         AND member.status = 'active' AND member.role IN ('lead','contributor')
         AND member.accepted_agreement_version = (SELECT project.current_agreement_version FROM public.web_projects AS project WHERE project.id = v_task.project_id)
     ) THEN
    RAISE EXCEPTION 'WEB_PROJECT_TASK_ASSIGNEE_OR_ACCEPTED_CONTRIBUTOR_REQUIRED';
  END IF;
  IF v_task.status NOT IN ('in_progress') THEN
    RAISE EXCEPTION 'WEB_PROJECT_TASK_MUST_BE_IN_PROGRESS';
  END IF;

  INSERT INTO public.web_project_task_submissions (
    project_id, task_id, member_id, description, notes, usefulness_stars, difficulty, links, submitted_at, updated_at
  ) VALUES (
    v_task.project_id, v_task.id, v_member_id, btrim(p_description), btrim(p_notes),
    p_usefulness_stars, p_difficulty, p_links, v_now, v_now
  )
  ON CONFLICT (project_id, task_id, member_id) DO UPDATE SET
    description = EXCLUDED.description,
    notes = EXCLUDED.notes,
    usefulness_stars = EXCLUDED.usefulness_stars,
    difficulty = EXCLUDED.difficulty,
    links = EXCLUDED.links,
    submitted_at = EXCLUDED.submitted_at,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_submission_id;

  UPDATE public.web_project_tasks
  SET status = 'in_review', completed_at = NULL, updated_at = v_now
  WHERE id = v_task.id;
  RETURN v_submission_id;
END;
$$;
REVOKE ALL ON FUNCTION public.web_submit_project_task(UUID,TEXT,TEXT,INTEGER,TEXT,JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.web_submit_project_task(UUID,TEXT,TEXT,INTEGER,TEXT,JSONB) TO authenticated;
