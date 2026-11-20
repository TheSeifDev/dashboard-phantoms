-- Scoped team task operations. Historical NULL-team task rows keep their
-- existing global behavior; new team task work is mediated by narrow RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.team_list_roster(p_team_id UUID, p_feature TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR p_feature IS NULL OR p_feature <> ALL (
    ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']::TEXT[]
  ) THEN RAISE EXCEPTION 'INVALID_TEAM_OR_FEATURE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
  END IF;
  IF NOT (public.has_admin_permission(p_feature) OR public.has_team_permission(p_team_id,p_feature)) THEN
    RAISE EXCEPTION 'TEAM_FEATURE_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'member_id',m.id,
      'full_name',m.full_name,
      'membership_status',tm.status
    ) ORDER BY m.full_name,m.id)
    FROM public.team_memberships AS tm
    JOIN public.members AS m ON m.id=tm.member_id
    WHERE tm.team_id=p_team_id AND tm.status='active' AND m.work_status='active'
  ),'[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_roster(UUID,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_list_roster(UUID,TEXT) TO authenticated;

-- All direct writes to a team-scoped task require the matching narrow RPC's
-- transaction-local operation marker. Global NULL-team task rows are untouched.
CREATE FUNCTION public.guard_team_task_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context TEXT := COALESCE(current_setting('phantoms.internal_team_task_operation',TRUE),'');
  v_team_id UUID;
  v_task_id BIGINT;
  v_member_id BIGINT;
  v_action TEXT;
  v_expected_key TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.team_id IS NULL THEN RETURN NEW; END IF;
    IF auth.uid() IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=NEW.team_id AND t.is_active)
       OR NOT (public.has_admin_permission('tasks') OR public.has_team_permission(NEW.team_id,'tasks'))
       OR v_context IS DISTINCT FROM 'create:'||NEW.team_id::TEXT THEN
      RAISE EXCEPTION 'TEAM_TASK_WRITE_FORBIDDEN';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF OLD.team_id IS NULL THEN RETURN OLD; END IF;
    IF auth.uid() IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=OLD.team_id AND t.is_active)
       OR NOT (public.has_admin_permission('tasks') OR public.has_team_permission(OLD.team_id,'tasks'))
       OR v_context IS DISTINCT FROM 'delete:'||OLD.id::TEXT||':'||OLD.team_id::TEXT THEN
      RAISE EXCEPTION 'TEAM_TASK_USE_SCOPED_DELETE_RPC';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.team_id IS NULL AND NEW.team_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.team_id IS NULL OR NEW.team_id IS NULL OR OLD.team_id IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'TEAM_TASK_SCOPE_IMMUTABLE';
  END IF;
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=NEW.team_id AND t.is_active)
     OR (to_jsonb(OLD)-'tracking') IS DISTINCT FROM (to_jsonb(NEW)-'tracking') THEN
    RAISE EXCEPTION 'TEAM_TASK_WRITE_FORBIDDEN';
  END IF;

  IF v_context LIKE 'review:'||OLD.id::TEXT||':%' THEN
    IF NOT (public.has_admin_permission('tasks') OR public.has_team_permission(NEW.team_id,'tasks'))
       OR split_part(v_context,':',3) !~ '^[1-9][0-9]{0,18}$'
       OR split_part(v_context,':',4) NOT IN ('approve','revoke','revision') THEN
      RAISE EXCEPTION 'TEAM_TASK_WRITE_FORBIDDEN';
    END IF;
    v_task_id := split_part(v_context,':',2)::BIGINT;
    v_member_id := split_part(v_context,':',3)::BIGINT;
    v_action := split_part(v_context,':',4);
    v_expected_key := v_member_id::TEXT;
    IF v_task_id IS DISTINCT FROM OLD.id
       OR (COALESCE(OLD.tracking,'{}'::JSONB)-v_expected_key)
          IS DISTINCT FROM (COALESCE(NEW.tracking,'{}'::JSONB)-v_expected_key) THEN
      RAISE EXCEPTION 'TEAM_TASK_WRITE_FORBIDDEN';
    END IF;
    RETURN NEW;
  ELSIF v_context LIKE 'member_submit:'||OLD.id::TEXT||':%' THEN
    IF split_part(v_context,':',3) !~ '^[1-9][0-9]{0,18}$' THEN
      RAISE EXCEPTION 'TEAM_TASK_WRITE_FORBIDDEN';
    END IF;
    v_task_id := split_part(v_context,':',2)::BIGINT;
    v_member_id := split_part(v_context,':',3)::BIGINT;
    v_expected_key := v_member_id::TEXT;
    IF v_task_id IS DISTINCT FROM OLD.id
       OR (COALESCE(OLD.tracking,'{}'::JSONB)-v_expected_key)
          IS DISTINCT FROM (COALESCE(NEW.tracking,'{}'::JSONB)-v_expected_key)
       OR NOT public.has_team_member_identity(NEW.team_id,v_member_id) THEN
      RAISE EXCEPTION 'TEAM_TASK_MEMBER_SUBMISSION_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'TEAM_TASK_USE_SCOPED_REVIEW_RPC';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_team_task_mutation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS tasks_guard_team_task_mutation ON public.tasks;
CREATE TRIGGER tasks_guard_team_task_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_team_task_mutation();

CREATE OR REPLACE FUNCTION public.team_list_tasks(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.has_admin_permission('tasks') OR public.has_team_permission(p_team_id,'tasks')) THEN
    RAISE EXCEPTION 'TEAM_TASKS_PERMISSION_REQUIRED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',t.id,
      'title',t.title,
      'description',t.description,
      'team_id',t.team_id,
      'has_deadline',t.has_deadline,
      'deadline_date',t.deadline_date,
      'assigned_to',t.assigned_to,
      'tracking',COALESCE((
        SELECT jsonb_object_agg(entry.key,entry.value)
        FROM jsonb_each(CASE WHEN jsonb_typeof(t.tracking)='object' THEN t.tracking ELSE '{}'::JSONB END) AS entry(key,value)
        WHERE entry.key ~ '^[1-9][0-9]{0,18}$'
          AND EXISTS (
            SELECT 1 FROM public.team_memberships AS tm
            JOIN public.members AS m ON m.id=tm.member_id AND m.work_status='active'
            WHERE tm.team_id=t.team_id AND tm.status='active' AND tm.member_id::TEXT=entry.key
          )
      ),'{}'::JSONB),
      'bonus_points',COALESCE(t.bonus_points,0)
    ) ORDER BY t.created_at DESC,t.id DESC)
    FROM public.tasks AS t WHERE t.team_id=p_team_id
  ),'[]'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.team_list_tasks(UUID) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_list_tasks(UUID) TO authenticated;

CREATE FUNCTION public.team_create_task(
  p_team_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_assigned_to JSONB,
  p_has_deadline BOOLEAN,
  p_deadline_date TIMESTAMPTZ,
  p_bonus_points INT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task_id BIGINT;
  v_element JSONB;
  v_target_text TEXT;
  v_target_id BIGINT;
  v_target_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_normalized_targets JSONB := '[]'::JSONB;
  v_deadline_text TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.has_admin_permission('tasks') OR public.has_team_permission(p_team_id,'tasks')) THEN
    RAISE EXCEPTION 'TEAM_TASKS_PERMISSION_REQUIRED';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NOT NULL AND char_length(p_description)>10000
     OR p_has_deadline IS NULL OR p_bonus_points IS NULL OR p_bonus_points NOT BETWEEN 0 AND 50
     OR (p_has_deadline AND p_deadline_date IS NULL)
     OR (NOT p_has_deadline AND p_deadline_date IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_TEAM_TASK';
  END IF;

  IF p_assigned_to=to_jsonb('ALL'::TEXT) THEN
    v_normalized_targets := to_jsonb('ALL'::TEXT);
  ELSE
    IF p_assigned_to IS NULL OR jsonb_typeof(p_assigned_to)<>'array'
       OR jsonb_array_length(p_assigned_to)=0 OR jsonb_array_length(p_assigned_to)>500 THEN
      RAISE EXCEPTION 'INVALID_TEAM_TASK_TARGETS';
    END IF;
    FOR v_element IN SELECT value FROM jsonb_array_elements(p_assigned_to) AS e(value) LOOP
      IF jsonb_typeof(v_element) NOT IN ('string','number') THEN RAISE EXCEPTION 'INVALID_TEAM_TASK_TARGETS'; END IF;
      v_target_text := v_element #>> '{}';
      IF v_target_text !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'INVALID_TEAM_TASK_TARGETS'; END IF;
      BEGIN
        v_target_id := v_target_text::BIGINT;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'INVALID_TEAM_TASK_TARGETS';
      END;
      IF v_target_id<=0 OR v_target_id=ANY(v_target_ids) THEN RAISE EXCEPTION 'INVALID_TEAM_TASK_TARGETS'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.team_memberships AS tm
        JOIN public.members AS m ON m.id=tm.member_id
        WHERE tm.team_id=p_team_id AND tm.member_id=v_target_id
          AND tm.status='active' AND m.work_status='active'
      ) THEN RAISE EXCEPTION 'TEAM_TASK_TARGET_NOT_ACTIVE_MEMBER'; END IF;
      v_target_ids := array_append(v_target_ids,v_target_id);
      v_normalized_targets := v_normalized_targets || to_jsonb(v_target_id::TEXT);
    END LOOP;
  END IF;

  IF p_has_deadline THEN
    v_deadline_text := to_char(p_deadline_date AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;
  PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','create:'||p_team_id::TEXT,TRUE);
  INSERT INTO public.tasks(title,description,has_deadline,deadline_date,assigned_to,tracking,bonus_points,team_id)
  VALUES (btrim(p_title),p_description,p_has_deadline,v_deadline_text,v_normalized_targets,'{}'::JSONB,p_bonus_points,p_team_id)
  RETURNING id INTO v_task_id;
  PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','',TRUE);
  RETURN v_task_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_create_task(UUID,TEXT,TEXT,JSONB,BOOLEAN,TIMESTAMPTZ,INT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_create_task(UUID,TEXT,TEXT,JSONB,BOOLEAN,TIMESTAMPTZ,INT) TO authenticated;

CREATE FUNCTION public.team_delete_task(p_team_id UUID,p_task_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.has_admin_permission('tasks') OR public.has_team_permission(p_team_id,'tasks')) THEN
    RAISE EXCEPTION 'TEAM_TASKS_PERMISSION_REQUIRED';
  END IF;
  IF p_task_id IS NULL OR p_task_id<=0 THEN RAISE EXCEPTION 'INVALID_TASK_ID'; END IF;

  SELECT t.tracking INTO v_tracking FROM public.tasks AS t
  WHERE t.id=p_task_id AND t.team_id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.task_contribution_events AS e WHERE e.task_id=p_task_id)
     OR EXISTS (
       SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(v_tracking)='object' THEN v_tracking ELSE '{}'::JSONB END) AS entry(key,value)
       WHERE entry.value ->> 'status'='approved'
     ) THEN
    RAISE EXCEPTION 'TASK_CONTRIBUTION_HISTORY_BLOCKS_DELETE';
  END IF;

  PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','delete:'||p_task_id::TEXT||':'||p_team_id::TEXT,TRUE);
  DELETE FROM public.tasks WHERE id=p_task_id AND team_id=p_team_id;
  PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','',TRUE);
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.team_delete_task(UUID,BIGINT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_delete_task(UUID,BIGINT) TO authenticated;

-- Preserve the global ledger contract; team transitions add their scope only
-- after the narrow review RPC has validated its actor, action, and active target.
CREATE OR REPLACE FUNCTION public.capture_task_contribution_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_tracking JSONB := CASE WHEN jsonb_typeof(OLD.tracking)='object' THEN OLD.tracking ELSE '{}'::JSONB END;
  v_new_tracking JSONB := CASE WHEN jsonb_typeof(NEW.tracking)='object' THEN NEW.tracking ELSE '{}'::JSONB END;
  v_member_key TEXT;
  v_member_id BIGINT;
  v_old_entry JSONB;
  v_new_entry JSONB;
  v_event_type TEXT;
  v_actor UUID := auth.uid();
  v_context TEXT := COALESCE(current_setting('phantoms.internal_team_task_operation',TRUE),'');
  v_expected_action TEXT;
BEGIN
  IF v_old_tracking IS NOT DISTINCT FROM v_new_tracking THEN RETURN NEW; END IF;

  FOR v_member_key IN
    SELECT changed.member_key FROM (
      SELECT jsonb_object_keys(v_old_tracking) AS member_key
      UNION SELECT jsonb_object_keys(v_new_tracking) AS member_key
    ) AS changed ORDER BY changed.member_key
  LOOP
    v_old_entry := v_old_tracking -> v_member_key;
    v_new_entry := v_new_tracking -> v_member_key;
    v_event_type := NULL;
    IF v_old_entry ->> 'status' IS DISTINCT FROM 'approved' AND v_new_entry ->> 'status'='approved' THEN
      v_event_type := 'approved';
      v_expected_action := 'approve';
    ELSIF v_old_entry ->> 'status'='approved' AND v_new_entry ->> 'status' IS DISTINCT FROM 'approved' THEN
      v_event_type := 'reversed';
      v_expected_action := 'revoke';
    END IF;
    IF v_event_type IS NULL THEN CONTINUE; END IF;

    IF v_member_key !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'INVALID_TRACKING_MEMBER_KEY'; END IF;
    BEGIN
      v_member_id := v_member_key::BIGINT;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION 'INVALID_TRACKING_MEMBER_KEY';
    END;
    IF v_member_id<=0 OR v_actor IS NULL THEN RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED'; END IF;

    IF NEW.team_id IS NULL THEN
      IF NOT public.has_admin_permission('tasks') THEN RAISE EXCEPTION 'TASKS_PERMISSION_REQUIRED'; END IF;
    ELSE
      IF OLD.team_id IS DISTINCT FROM NEW.team_id
         OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=NEW.team_id AND t.is_active)
         OR NOT (public.has_admin_permission('tasks') OR public.has_team_permission(NEW.team_id,'tasks'))
         OR v_context IS DISTINCT FROM format('review:%s:%s:%s',NEW.id,v_member_id,v_expected_action)
         OR NOT EXISTS (
           SELECT 1 FROM public.team_memberships AS tm
           JOIN public.members AS m ON m.id=tm.member_id AND m.work_status='active'
           WHERE tm.team_id=NEW.team_id AND tm.member_id=v_member_id AND tm.status='active'
         ) THEN
        RAISE EXCEPTION 'TEAM_TASK_TRANSITION_FORBIDDEN';
      END IF;
    END IF;

    INSERT INTO public.task_contribution_events(
      task_id,member_id,event_type,occurred_at,actor_user_id,provenance,team_id
    ) VALUES (NEW.id,v_member_id,v_event_type,clock_timestamp(),v_actor,'live_transition',NEW.team_id);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_task_contribution_transition() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.team_review_task(
  p_team_id UUID,
  p_task_id BIGINT,
  p_member_id BIGINT,
  p_action TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tracking JSONB;
  v_assigned JSONB;
  v_entry JSONB;
  v_old_rank INT;
  v_new_rank INT;
  v_rank_delta INT;
  v_bonus_delta INT;
  v_bonus_points INT;
  v_metric_rank INT;
  v_metric_bonus BIGINT;
  v_status TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active
  ) THEN RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED'; END IF;
  IF NOT (public.has_admin_permission('tasks') OR public.has_team_permission(p_team_id,'tasks')) THEN
    RAISE EXCEPTION 'TEAM_TASKS_PERMISSION_REQUIRED';
  END IF;
  IF p_task_id IS NULL OR p_task_id<=0 OR p_member_id IS NULL OR p_member_id<=0
     OR p_action IS NULL OR p_action NOT IN ('approve','revoke','revision') THEN RAISE EXCEPTION 'INVALID_TEAM_TASK_REVIEW'; END IF;
  IF char_length(v_reason)>1000 OR (p_action IN ('revoke','revision') AND char_length(v_reason)<3) THEN
    RAISE EXCEPTION 'TEAM_TASK_REVIEW_REASON_REQUIRED';
  END IF;

  SELECT t.tracking,t.assigned_to,COALESCE(t.bonus_points,0)
    INTO v_tracking,v_assigned,v_bonus_points
  FROM public.tasks AS t WHERE t.id=p_task_id AND t.team_id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_TASK_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_memberships AS tm
    JOIN public.members AS m ON m.id=tm.member_id
    WHERE tm.team_id=p_team_id AND tm.member_id=p_member_id
      AND tm.status='active' AND m.work_status='active'
  ) THEN RAISE EXCEPTION 'TEAM_TASK_TARGET_NOT_ACTIVE_MEMBER'; END IF;
  IF v_assigned IS DISTINCT FROM to_jsonb('ALL'::TEXT)
     AND NOT (jsonb_typeof(v_assigned)='array'
       AND (v_assigned ? p_member_id::TEXT OR v_assigned @> to_jsonb(p_member_id) OR v_assigned @> to_jsonb(p_member_id::TEXT))) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED';
  END IF;

  v_tracking := CASE WHEN jsonb_typeof(v_tracking)='object' THEN v_tracking ELSE '{}'::JSONB END;
  v_entry := v_tracking -> p_member_id::TEXT;
  IF v_entry IS NULL OR jsonb_typeof(v_entry)<>'object' THEN RAISE EXCEPTION 'TEAM_TASK_SUBMISSION_NOT_FOUND'; END IF;
  v_status := v_entry ->> 'status';

  IF p_action='approve' THEN
    IF v_status IS DISTINCT FROM 'under_review' THEN RAISE EXCEPTION 'TEAM_TASK_APPROVAL_REQUIRES_UNDER_REVIEW'; END IF;
    INSERT INTO public.team_member_metrics(team_id,member_id,updated_by)
    VALUES (p_team_id,p_member_id,auth.uid()) ON CONFLICT (team_id,member_id) DO NOTHING;
    SELECT mm.completion_rank,mm.bonus_points INTO v_old_rank,v_metric_bonus
    FROM public.team_member_metrics AS mm WHERE mm.team_id=p_team_id AND mm.member_id=p_member_id FOR UPDATE;
    v_new_rank := LEAST(100,v_old_rank+5+v_bonus_points);
    v_rank_delta := v_new_rank-v_old_rank;
    v_bonus_delta := v_bonus_points;
    UPDATE public.team_member_metrics AS mm
    SET completion_rank=v_new_rank,bonus_points=mm.bonus_points+v_bonus_delta,
        updated_at=now(),updated_by=auth.uid()
    WHERE mm.team_id=p_team_id AND mm.member_id=p_member_id
    RETURNING mm.bonus_points INTO v_metric_bonus;
    v_entry := v_entry || jsonb_build_object(
      'status','approved','updated_at',now(),'bonus_awarded',v_bonus_delta,
      'rank_awarded',v_rank_delta,'approval_reversal_reason',NULL,
      'approval_reversed_at',NULL,'approval_reversed_by',NULL
    );
  ELSIF p_action='revoke' THEN
    IF v_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'TEAM_TASK_NOT_APPROVED'; END IF;
    v_bonus_delta := LEAST(50,GREATEST(0,COALESCE(NULLIF(v_entry ->> 'bonus_awarded','')::INT,v_bonus_points)));
    v_rank_delta := LEAST(100,GREATEST(0,COALESCE(NULLIF(v_entry ->> 'rank_awarded','')::INT,5+v_bonus_delta)));
    INSERT INTO public.team_member_metrics(team_id,member_id,updated_by)
    VALUES (p_team_id,p_member_id,auth.uid()) ON CONFLICT (team_id,member_id) DO NOTHING;
    SELECT mm.completion_rank,mm.bonus_points INTO v_old_rank,v_metric_bonus
    FROM public.team_member_metrics AS mm WHERE mm.team_id=p_team_id AND mm.member_id=p_member_id FOR UPDATE;
    v_new_rank := GREATEST(0,v_old_rank-v_rank_delta);
    UPDATE public.team_member_metrics AS mm
    SET completion_rank=v_new_rank,bonus_points=GREATEST(0,mm.bonus_points-v_bonus_delta),
        updated_at=now(),updated_by=auth.uid()
    WHERE mm.team_id=p_team_id AND mm.member_id=p_member_id
    RETURNING mm.bonus_points INTO v_metric_bonus;
    v_entry := v_entry || jsonb_build_object(
      'status','revision_requested','note',format('Approval revoked: %s',v_reason),
      'updated_at',now(),'bonus_awarded',0,'rank_awarded',0,
      'approval_reversal_reason',v_reason,'approval_reversed_at',now(),
      'approval_reversed_by',auth.uid()
    );
  ELSE
    IF v_status IS DISTINCT FROM 'under_review' THEN RAISE EXCEPTION 'TEAM_TASK_REVISION_REQUIRES_UNDER_REVIEW'; END IF;
    v_new_rank := NULL;
    v_entry := v_entry || jsonb_build_object('status','revision_requested','note',v_reason,'updated_at',now());
  END IF;

  v_tracking := jsonb_set(v_tracking,ARRAY[p_member_id::TEXT],v_entry,TRUE);
  PERFORM pg_catalog.set_config(
    'phantoms.internal_team_task_operation',
    format('review:%s:%s:%s',p_task_id,p_member_id,p_action),TRUE
  );
  UPDATE public.tasks SET tracking=v_tracking WHERE id=p_task_id AND team_id=p_team_id;
  PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','',TRUE);

  RETURN jsonb_build_object(
    'task_id',p_task_id,'member_id',p_member_id,'status',v_entry ->> 'status',
    'completion_rank',v_new_rank,'rank_awarded',CASE WHEN p_action='approve' THEN v_rank_delta WHEN p_action='revoke' THEN -v_rank_delta END,
    'bonus_awarded',CASE WHEN p_action='approve' THEN v_bonus_delta WHEN p_action='revoke' THEN -v_bonus_delta END,
    'reason',CASE WHEN p_action IN ('revoke','revision') THEN v_reason ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.team_review_task(UUID,BIGINT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_review_task(UUID,BIGINT,BIGINT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_member_tasks(p_member_id BIGINT,p_device_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tasks JSONB;
BEGIN
  PERFORM public.assert_member_device(p_member_id,p_device_token);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',t.id,'created_at',t.created_at,'title',t.title,'description',t.description,
    'has_deadline',t.has_deadline,'deadline_date',t.deadline_date,
    'assigned_to',jsonb_build_array(p_member_id::TEXT),
    'tracking',CASE WHEN COALESCE(t.tracking,'{}'::JSONB) ? p_member_id::TEXT
      THEN jsonb_build_object(p_member_id::TEXT,t.tracking -> p_member_id::TEXT) ELSE '{}'::JSONB END,
    'bonus_points',COALESCE(t.bonus_points,0)
  ) ORDER BY t.created_at DESC,t.id DESC),'[]'::JSONB)
  INTO v_tasks
  FROM public.tasks AS t
  WHERE (t.team_id IS NULL OR public.has_team_member_identity(t.team_id,p_member_id))
    AND (t.assigned_to=to_jsonb('ALL'::TEXT)
      OR CASE WHEN jsonb_typeof(t.assigned_to)='array' THEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(t.assigned_to) AS assigned(member_id)
        WHERE assigned.member_id=p_member_id::TEXT
      ) ELSE FALSE END);
  RETURN v_tasks;
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_tasks(BIGINT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_tasks(BIGINT,TEXT) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_task_status(
  p_task_id BIGINT,
  p_member_id BIGINT,
  p_device_token TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'under_review',
  p_note TEXT DEFAULT '',
  p_submission_url TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT := current_setting('role',TRUE);
  v_is_admin BOOLEAN := FALSE;
  v_tracking JSONB;
  v_assigned JSONB;
  v_team_id UUID;
  v_entry JSONB;
  v_old_status TEXT;
  v_note TEXT := COALESCE(p_note,'');
  v_url TEXT := COALESCE(p_submission_url,'');
BEGIN
  IF p_task_id IS NULL OR p_task_id<=0 OR p_task_id>2147483647 THEN RAISE EXCEPTION 'INVALID_TASK_ID'; END IF;
  IF p_member_id IS NULL OR p_member_id<=0 OR p_member_id>2147483647 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending','in_progress','under_review','revision_requested') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF char_length(v_note)>2000 THEN RAISE EXCEPTION 'INVALID_NOTE'; END IF;
  IF v_url<>'' AND (char_length(v_url)>2048 OR v_url !~* '^https?://') THEN RAISE EXCEPTION 'INVALID_URL'; END IF;

  IF v_role='authenticated' THEN
    BEGIN
      SELECT public.is_admin() AND public.has_admin_permission('tasks') INTO v_is_admin;
    EXCEPTION WHEN undefined_function OR undefined_table THEN
      v_is_admin := TRUE;
    END;
  END IF;
  IF NOT COALESCE(v_is_admin,FALSE) THEN PERFORM public.assert_member_device(p_member_id,p_device_token); END IF;

  SELECT t.tracking,t.assigned_to,t.team_id INTO v_tracking,v_assigned,v_team_id
  FROM public.tasks AS t WHERE t.id=p_task_id FOR UPDATE;
  IF v_tracking IS NULL AND NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  v_tracking := COALESCE(v_tracking,'{}'::JSONB);

  IF v_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=v_team_id AND t.is_active) THEN
      RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.team_memberships AS tm JOIN public.members AS m ON m.id=tm.member_id
      WHERE tm.team_id=v_team_id AND tm.member_id=p_member_id AND tm.status='active' AND m.work_status='active'
    ) THEN RAISE EXCEPTION 'TEAM_MEMBERSHIP_REQUIRED'; END IF;
    IF NOT COALESCE(v_is_admin,FALSE) AND NOT public.has_team_member_identity(v_team_id,p_member_id) THEN
      RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_REQUIRED';
    END IF;
    IF v_assigned IS DISTINCT FROM to_jsonb('ALL'::TEXT)
       AND NOT (jsonb_typeof(v_assigned)='array'
         AND (v_assigned ? p_member_id::TEXT OR v_assigned @> to_jsonb(p_member_id) OR v_assigned @> to_jsonb(p_member_id::TEXT))) THEN
      RAISE EXCEPTION 'NOT_ASSIGNED';
    END IF;
  ELSIF NOT COALESCE(v_is_admin,FALSE) THEN
    IF v_assigned=to_jsonb('ALL'::TEXT) THEN
      NULL;
    ELSIF jsonb_typeof(COALESCE(v_assigned,'[]'::JSONB))='array'
      AND (v_assigned ? p_member_id::TEXT OR v_assigned @> to_jsonb(p_member_id)) THEN
      NULL;
    ELSE RAISE EXCEPTION 'NOT_ASSIGNED'; END IF;
  END IF;

  v_entry := COALESCE(v_tracking -> p_member_id::TEXT,'{}'::JSONB);
  v_old_status := v_entry ->> 'status';
  IF p_status='approved' OR v_old_status='approved' THEN RAISE EXCEPTION 'ADMIN_APPROVAL_FORBIDDEN'; END IF;
  v_entry := v_entry || jsonb_build_object('status',p_status,'note',v_note,'submission_url',v_url,'updated_at',now());
  v_tracking := jsonb_set(v_tracking,ARRAY[p_member_id::TEXT],v_entry,TRUE);
  IF v_team_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation',format('member_submit:%s:%s',p_task_id,p_member_id),TRUE);
  END IF;
  UPDATE public.tasks SET tracking=v_tracking WHERE id=p_task_id;
  IF v_team_id IS NOT NULL THEN PERFORM pg_catalog.set_config('phantoms.internal_team_task_operation','',TRUE); END IF;
  RETURN jsonb_build_object('task_id',p_task_id,'member_id',p_member_id,'status',p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_task_status(BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task_status(BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT) TO anon,authenticated;

CREATE FUNCTION public.get_team_task_contributions(
  p_team_id UUID,
  p_year INT,
  p_member_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := timezone('Africa/Cairo',statement_timestamp())::DATE;
  v_current_year INT;
  v_year_start TIMESTAMPTZ;
  v_year_end TIMESTAMPTZ;
  v_tracking_started_at TIMESTAMPTZ;
  v_history_complete_since TIMESTAMPTZ;
  v_days JSONB;
  v_total_approvals BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams AS t WHERE t.id=p_team_id AND t.is_active) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND_OR_DISABLED';
  END IF;
  IF NOT (public.has_admin_permission('dashboard') OR public.has_team_permission(p_team_id,'dashboard')) THEN
    RAISE EXCEPTION 'TEAM_DASHBOARD_PERMISSION_REQUIRED';
  END IF;
  v_current_year := EXTRACT(YEAR FROM v_today)::INT;
  IF p_year IS NULL OR p_year<2000 OR p_year>v_current_year THEN RAISE EXCEPTION 'INVALID_YEAR'; END IF;
  IF p_member_id IS NOT NULL AND p_member_id<=0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  IF p_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_memberships AS tm JOIN public.members AS m ON m.id=tm.member_id
    WHERE tm.team_id=p_team_id AND tm.member_id=p_member_id AND tm.status='active' AND m.work_status='active'
  ) THEN RAISE EXCEPTION 'TEAM_TASK_TARGET_NOT_ACTIVE_MEMBER'; END IF;

  v_year_start := make_date(p_year,1,1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  v_year_end := make_date(p_year+1,1,1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  SELECT c.tracking_started_at,c.history_complete_since INTO v_tracking_started_at,v_history_complete_since
  FROM public.task_contribution_ledger_config AS c WHERE c.singleton=TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_CONTRIBUTION_LEDGER_UNAVAILABLE'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date',daily.activity_date,'count',daily.approval_count)
      ORDER BY daily.activity_date),'[]'::JSONB),COALESCE(SUM(daily.approval_count),0)::BIGINT
    INTO v_days,v_total_approvals
  FROM (
    SELECT timezone('Africa/Cairo',e.occurred_at)::DATE AS activity_date,COUNT(*)::BIGINT AS approval_count
    FROM public.task_contribution_events AS e
    WHERE e.team_id=p_team_id AND e.event_type='approved'
      AND e.occurred_at>=v_year_start AND e.occurred_at<v_year_end
      AND e.occurred_at<=statement_timestamp()
      AND (p_member_id IS NULL OR e.member_id=p_member_id)
    GROUP BY timezone('Africa/Cairo',e.occurred_at)::DATE
    ORDER BY timezone('Africa/Cairo',e.occurred_at)::DATE LIMIT 366
  ) AS daily;
  RETURN jsonb_build_object(
    'timezone','Africa/Cairo','tracking_started_at',v_tracking_started_at,
    'today',v_today,'year',p_year,'history_complete_since',v_history_complete_since,
    'days',v_days,'total_approvals',v_total_approvals
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_team_task_contributions(UUID,INT,BIGINT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_team_task_contributions(UUID,INT,BIGINT) TO authenticated;

-- Preserve global-only activity without rewriting the applied ledger migration.
CREATE OR REPLACE FUNCTION public.get_task_contributions(
  p_year INTEGER,
  p_member_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (timezone('Africa/Cairo', statement_timestamp()))::DATE;
  v_current_year INTEGER;
  v_year_start TIMESTAMPTZ;
  v_year_end TIMESTAMPTZ;
  v_tracking_started_at TIMESTAMPTZ;
  v_history_complete_since TIMESTAMPTZ;
  v_days JSONB;
  v_total_approvals BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('dashboard') THEN
    RAISE EXCEPTION 'DASHBOARD_PERMISSION_REQUIRED: يلزم امتلاك صلاحية لوحة التحكم لقراءة ملخص الإنجاز.';
  END IF;

  v_current_year := EXTRACT(YEAR FROM v_today)::INTEGER;
  IF p_year IS NULL OR p_year < 2000 OR p_year > v_current_year THEN
    RAISE EXCEPTION 'INVALID_YEAR: السنة المطلوبة خارج النطاق المسموح.';
  END IF;
  IF p_member_id IS NOT NULL AND p_member_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ID: معرّف العضو غير صالح.';
  END IF;

  v_year_start := make_date(p_year, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
  v_year_end := make_date(p_year + 1, 1, 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo';

  SELECT c.tracking_started_at, c.history_complete_since
    INTO v_tracking_started_at, v_history_complete_since
  FROM public.task_contribution_ledger_config AS c
  WHERE c.singleton = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_CONTRIBUTION_LEDGER_UNAVAILABLE';
  END IF;

  -- Heatmap activity counts approval events only. Reversal rows remain in the
  -- private audit ledger but never erase the historical approval contribution.
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('date', daily.activity_date, 'count', daily.approval_count)
                     ORDER BY daily.activity_date),
           '[]'::jsonb
         ),
         COALESCE(SUM(daily.approval_count), 0)::BIGINT
    INTO v_days, v_total_approvals
  FROM (
    SELECT timezone('Africa/Cairo', e.occurred_at)::DATE AS activity_date,
           COUNT(*)::BIGINT AS approval_count
    FROM public.task_contribution_events AS e
    WHERE e.event_type = 'approved'
      AND e.team_id IS NULL
      AND e.occurred_at >= v_year_start
      AND e.occurred_at < v_year_end
      AND e.occurred_at <= statement_timestamp()
      AND (p_member_id IS NULL OR e.member_id = p_member_id)
    GROUP BY timezone('Africa/Cairo', e.occurred_at)::DATE
    ORDER BY timezone('Africa/Cairo', e.occurred_at)::DATE
    LIMIT 366
  ) AS daily;

  RETURN jsonb_build_object(
    'timezone', 'Africa/Cairo',
    'tracking_started_at', v_tracking_started_at,
    'today', v_today,
    'year', p_year,
    'history_complete_since', v_history_complete_since,
    'days', v_days,
    'total_approvals', v_total_approvals
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_task_contributions(INTEGER, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_task_contributions(INTEGER, BIGINT) TO authenticated;

COMMIT;
