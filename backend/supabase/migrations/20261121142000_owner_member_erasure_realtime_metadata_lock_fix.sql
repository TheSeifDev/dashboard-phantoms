-- 20261121142000 — Skip the two Supabase-owned Realtime metadata relations during the identity lock sweep.
-- No application rows are deleted or rewritten by this migration.

CREATE OR REPLACE FUNCTION public.owner_member_erasure_execute_database(p_operation_id UUID,p_member_id BIGINT,p_auth_user_id UUID,p_successor_assignments JSONB,p_preview_token TEXT,p_confirmation TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations; v_fingerprint TEXT; v_member BIGINT; v_auth UUID; v_ids BIGINT[]; v_changed BIGINT; v_deleted BIGINT:=0;
  v_successor BIGINT; v_required INTEGER; v_blockers JSONB; r RECORD; v_found BOOLEAN; v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_operation_id IS NULL OR p_member_id IS NULL OR p_member_id<=0 OR p_auth_user_id IS NULL
     OR p_successor_assignments IS NULL OR pg_catalog.jsonb_typeof(p_successor_assignments)<>'object'
     OR p_preview_token IS NULL OR pg_catalog.char_length(p_preview_token)>2048
     OR p_confirmation IS DISTINCT FROM ('ERASE '||p_member_id::text||' '||pg_catalog.left(p_auth_user_id::text,8)) THEN RAISE EXCEPTION 'INVALID_EXECUTE_INPUT'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.owner_auth_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  IF op.status IN ('database_erased','complete') THEN RETURN op.result; END IF;
  IF op.status<>'previewed' OR op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ERASURE_PREVIEW_EXPIRED_OR_USED'; END IF;
  IF op.preview_token_hash IS DISTINCT FROM pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_preview_token,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'ERASURE_PREVIEW_TOKEN_INVALID'; END IF;
  IF NOT op.storage_manifest_complete OR (SELECT count(*) FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id)<>op.storage_object_count THEN RAISE EXCEPTION 'STORAGE_OWNER_MANIFEST_INCOMPLETE'; END IF;
  IF op.target_member_id IS DISTINCT FROM p_member_id OR op.target_auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'ERASURE_PREVIEW_TARGET_CHANGED'; END IF;
  v_member:=op.target_member_id; v_auth:=op.target_auth_user_id;
  IF v_auth=auth.uid() OR EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id=v_auth AND a.role='owner') THEN RAISE EXCEPTION 'ERASURE_PROTECTED_IDENTITY'; END IF;
  -- Serialize erasure against writes in all known identity-bearing tables.
  LOCK TABLE public.members,public.member_auth_bindings,public.member_password_invitations,public.member_password_audit,
    public.member_password_recovery_sessions,public.member_app_usage,public.member_registration_invites,
    public.notes,public.tasks,public.announcements,public.team_memberships,public.team_member_metrics,
    public.team_member_custom_field_values,public.announcement_recipients,public.team_access_audit,
    public.task_contribution_events,public.member_infinite_bonus_events,public.web_ideas,public.web_idea_contributors,
    public.web_projects,public.web_project_members,public.web_project_agreement_acceptances,public.web_project_consents,
    public.web_project_activity_logs,public.web_program_admin_audit,public.admin_accounts,public.team_admin_assignments,
    public.web_project_deliverables,public.web_project_tasks,public.web_project_task_assignees,public.web_project_task_comments,
    public.web_project_task_checklist_items,public.web_project_task_attachments,public.web_project_updates,
    public.web_project_member_reports,public.web_project_agreements,public.web_project_milestones,
    public.web_project_milestone_dependencies,public.web_project_sprints,public.web_resources,
    public.web_project_resource_refs,public.web_project_integrations,public.web_idea_reviews,storage.objects
    IN SHARE ROW EXCLUSIVE MODE;
  -- Supabase-owned _realtime.extensions and _realtime.feature_flags are service metadata,
  -- not application identity tables; application/Auth/Storage locks and the sweep remain intact.
  FOR r IN SELECT DISTINCT ns.nspname,rel.relname
    FROM pg_catalog.pg_class rel
    JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid=rel.oid AND att.attnum>0 AND NOT att.attisdropped
    WHERE ns.nspname NOT IN ('auth','information_schema','pg_catalog','extensions','pg_toast')
      AND NOT (ns.nspname='_realtime' AND rel.relname IN ('extensions','feature_flags')) AND rel.relkind IN ('r','p')
      AND (att.atttypid IN ('uuid'::regtype,'jsonb'::regtype) OR att.attname=ANY(ARRAY[
        'member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id',
        'origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id',
        'author_member_id','actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id',
        'reviewed_by_member_id','auth_user_id','user_id','actor_user_id','subject_user_id','created_by',
        'created_by_auth_user_id','updated_by','reviewed_by_auth_user_id','rated_by','approved_by',
        'added_by_auth_user_id','actor_auth_user_id','target_auth_user_id','reviewer_auth_user_id',
        'author_auth_user_id','assigned_by_auth_user_id','updated_by_auth_user_id','auth_write_user_id']))
    ORDER BY ns.nspname,rel.relname
  LOOP
    EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',r.nspname,rel.relname);
  END LOOP;
  IF (SELECT count(*) FROM public.member_auth_bindings b WHERE b.member_id=v_member AND b.auth_user_id=v_auth)<>1
     OR (SELECT count(*) FROM public.member_auth_bindings b WHERE b.auth_user_id=v_auth)<>1 THEN RAISE EXCEPTION 'ERASURE_BINDING_CHANGED'; END IF;
  v_fingerprint:=public.owner_member_erasure_fingerprint(v_member,v_auth);
  IF v_fingerprint IS DISTINCT FROM op.preview_fingerprint THEN RAISE EXCEPTION 'ERASURE_PREVIEW_STALE'; END IF;
  v_blockers:=public.owner_member_erasure_blockers(v_member,v_auth);
  IF jsonb_array_length(v_blockers)>0 THEN RAISE EXCEPTION 'ERASURE_BLOCKED_BY_UNSAFE_REFERENCES'; END IF;
  SELECT count(*) INTO v_required FROM (
    SELECT p.id FROM public.web_projects p WHERE p.owner_member_id=v_member
    UNION ALL SELECT i.id FROM public.web_ideas i WHERE i.submitted_by_member_id=v_member
  ) requirements;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_successor_assignments))<>v_required THEN RAISE EXCEPTION 'SUCCESSOR_ASSIGNMENT_SET_MISMATCH'; END IF;
  IF (SELECT count(*) FROM storage.objects o WHERE o.owner_id=v_auth::text)<>op.storage_object_count
     OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.owner_id=v_auth::text AND NOT EXISTS(
       SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND so.bucket_id=o.bucket_id AND so.object_name=o.name))
     OR EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND NOT EXISTS(
       SELECT 1 FROM storage.objects o WHERE o.owner_id=v_auth::text AND o.bucket_id=so.bucket_id AND o.name=so.object_name)) THEN
    RAISE EXCEPTION 'STORAGE_OWNER_INVENTORY_CHANGED'; END IF;
  UPDATE public.owner_member_erasure_operations SET status='executing' WHERE operation_id=p_operation_id;
  PERFORM pg_catalog.set_config('phantoms.owner_member_erasure_operation',p_operation_id::text,true);

  -- Remove only exact target IDs from JSON identifier stores; keep all unrelated IDs/content.
  UPDATE public.tasks t SET assigned_to=CASE
      WHEN pg_catalog.jsonb_typeof(t.assigned_to)='array' THEN COALESCE((SELECT pg_catalog.jsonb_agg(e.value ORDER BY e.ordinality)
        FROM pg_catalog.jsonb_array_elements(t.assigned_to) WITH ORDINALITY e(value,ordinality)
        WHERE e.value #>> '{}' IS DISTINCT FROM v_member::text), '[]'::jsonb)
      ELSE t.assigned_to END,
    tracking=CASE WHEN pg_catalog.jsonb_typeof(t.tracking)='object' THEN t.tracking-v_member::text ELSE t.tracking END
  WHERE (pg_catalog.jsonb_typeof(t.assigned_to)='array' AND (t.assigned_to @> pg_catalog.jsonb_build_array(v_member) OR t.assigned_to @> pg_catalog.jsonb_build_array(v_member::text)))
     OR (pg_catalog.jsonb_typeof(t.tracking)='object' AND t.tracking ? v_member::text);
  UPDATE public.announcements a SET
    target_audience=CASE WHEN pg_catalog.jsonb_typeof(a.target_audience->'member_ids')='array'
      THEN pg_catalog.jsonb_set(a.target_audience,'{member_ids}',COALESCE((SELECT pg_catalog.jsonb_agg(e.value ORDER BY e.ordinality)
        FROM pg_catalog.jsonb_array_elements(a.target_audience->'member_ids') WITH ORDINALITY e(value,ordinality)
        WHERE e.value #>> '{}' IS DISTINCT FROM v_member::text),'[]'::jsonb),false) ELSE a.target_audience END,
    read_receipts=COALESCE(a.read_receipts,'{}'::jsonb)-v_member::text
  WHERE a.read_receipts ? v_member::text OR (pg_catalog.jsonb_typeof(a.target_audience->'member_ids')='array'
    AND (a.target_audience->'member_ids' @> pg_catalog.jsonb_build_array(v_member) OR a.target_audience->'member_ids' @> pg_catalog.jsonb_build_array(v_member::text)));

  -- Subject-only append-only histories may be deleted. Actor-only references are
  -- anonymized only in nullable ledger columns; otherwise the trigger/FK aborts.
  DELETE FROM public.member_infinite_bonus_events WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.task_contribution_events WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  UPDATE public.task_contribution_events SET actor_user_id=NULL,actor_erased=TRUE WHERE actor_user_id=v_auth;
  UPDATE public.team_access_audit SET actor_user_id=NULL WHERE actor_user_id=v_auth;
  DELETE FROM public.team_access_audit WHERE member_id=v_member OR subject_user_id=v_auth;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  UPDATE public.web_program_admin_audit SET actor_auth_user_id=NULL WHERE actor_auth_user_id=v_auth;
  UPDATE public.web_program_admin_audit SET target_auth_user_id=NULL WHERE target_auth_user_id=v_auth;
  UPDATE public.web_project_activity_logs SET actor_auth_user_id=NULL WHERE actor_auth_user_id=v_auth;
  UPDATE public.web_project_activity_logs SET actor_member_id=NULL WHERE actor_member_id=v_member;
  UPDATE public.web_project_agreements SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_agreement_acceptances SET actor_auth_user_id=NULL WHERE actor_auth_user_id=v_auth;
  UPDATE public.web_project_consents SET actor_auth_user_id=NULL WHERE actor_auth_user_id=v_auth;
  UPDATE public.web_idea_reviews SET reviewer_auth_user_id=NULL WHERE reviewer_auth_user_id=v_auth;
  UPDATE public.web_project_milestones SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_milestone_dependencies SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_sprints SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_tasks SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_task_assignees SET assigned_by_auth_user_id=NULL WHERE assigned_by_auth_user_id=v_auth;
  UPDATE public.web_project_task_comments SET author_auth_user_id=NULL WHERE author_auth_user_id=v_auth;
  UPDATE public.web_resources SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  UPDATE public.web_project_resource_refs SET added_by_auth_user_id=NULL WHERE added_by_auth_user_id=v_auth;
  UPDATE public.web_project_integrations SET created_by_auth_user_id=NULL WHERE created_by_auth_user_id=v_auth;
  DELETE FROM public.web_project_agreement_acceptances WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.web_project_consents WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;

  -- Preserve shared projects, ideas and all shared task/announcement rows. The
  -- following exact not-null parent ownership slots require caller-specified
  -- surviving members; unsupported descendant references are intentionally left
  -- for RESTRICT FKs/residual checks to abort the entire transaction.
  FOR r IN SELECT p.id,p.owner_member_id FROM public.web_projects p WHERE p.owner_member_id=v_member FOR UPDATE LOOP
    IF NOT (p_successor_assignments ? ('web_projects.owner_member_id:'||r.id::text)) THEN RAISE EXCEPTION 'SUCCESSOR_REQUIRED: web_projects.owner_member_id:%',r.id; END IF;
    BEGIN v_ids:=ARRAY[(p_successor_assignments->>('web_projects.owner_member_id:'||r.id::text))::bigint]; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_SUCCESSOR_ASSIGNMENT'; END;
    IF v_ids[1]<=0 OR v_ids[1]=v_member OR NOT EXISTS(SELECT 1 FROM public.web_project_members pm JOIN public.members m ON m.id=pm.member_id
      WHERE pm.project_id=r.id AND pm.member_id=v_ids[1] AND pm.status='active' AND pm.role IN ('lead','contributor') AND m.work_status='active') THEN RAISE EXCEPTION 'INVALID_SUCCESSOR_MEMBER'; END IF;
    UPDATE public.web_projects SET owner_member_id=v_ids[1],updated_at=clock_timestamp() WHERE id=r.id;
  END LOOP;
  FOR r IN SELECT i.id FROM public.web_ideas i WHERE i.submitted_by_member_id=v_member FOR UPDATE LOOP
    IF NOT (p_successor_assignments ? ('web_ideas.submitted_by_member_id:'||r.id::text)) THEN RAISE EXCEPTION 'SUCCESSOR_REQUIRED: web_ideas.submitted_by_member_id:%',r.id; END IF;
    BEGIN v_ids:=ARRAY[(p_successor_assignments->>('web_ideas.submitted_by_member_id:'||r.id::text))::bigint]; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_SUCCESSOR_ASSIGNMENT'; END;
    IF v_ids[1]<=0 OR v_ids[1]=v_member OR NOT EXISTS(SELECT 1 FROM public.web_idea_contributors c JOIN public.members m ON m.id=c.member_id
      WHERE c.idea_id=r.id AND c.member_id=v_ids[1] AND m.work_status='active') THEN RAISE EXCEPTION 'INVALID_SUCCESSOR_MEMBER'; END IF;
    UPDATE public.web_ideas SET submitted_by_member_id=v_ids[1] WHERE id=r.id;
  END LOOP;
  UPDATE public.web_projects SET lead_member_id=NULL WHERE lead_member_id=v_member;
  UPDATE public.web_projects SET origin_submitter_member_id=NULL WHERE origin_submitter_member_id=v_member;
  UPDATE public.web_ideas SET suggested_leader_member_id=NULL WHERE suggested_leader_member_id=v_member;

  -- Target-only invitations and normalized team/profile rows; shared parent rows survive.
  UPDATE public.member_password_invitations SET created_by=NULL WHERE created_by=v_auth AND member_id<>v_member;
  UPDATE public.member_registration_invites SET created_by=NULL WHERE created_by=v_auth;
  UPDATE public.member_registration_invites SET registered_member_id=NULL WHERE registered_member_id=v_member;
  UPDATE public.member_password_audit SET actor_user_id=NULL WHERE actor_user_id=v_auth;
  DELETE FROM public.member_password_audit WHERE member_id=v_member OR invitation_id IN
    (SELECT id FROM public.member_password_invitations WHERE member_id=v_member);
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.member_password_recovery_sessions WHERE invitation_id IN
    (SELECT id FROM public.member_password_invitations WHERE member_id=v_member);
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.member_password_invitations WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.team_member_metrics WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.team_member_custom_field_values WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.announcement_recipients WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.team_memberships WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.team_admin_assignments WHERE user_id=v_auth;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.admin_accounts WHERE user_id=v_auth;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  UPDATE public.notes SET target_member_id=NULL,target_name=NULL WHERE target_member_id=v_member;
  DELETE FROM public.web_idea_contributors WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.web_project_task_assignees WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  UPDATE public.web_project_task_comments SET author_member_id=NULL,author_auth_user_id=NULL
    WHERE author_member_id=v_member OR author_auth_user_id=v_auth;
  DELETE FROM public.web_project_members WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.member_app_usage WHERE member_id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.member_auth_bindings WHERE member_id=v_member AND auth_user_id=v_auth;
  GET DIAGNOSTICS v_changed=ROW_COUNT; v_deleted:=v_deleted+v_changed;
  DELETE FROM public.members WHERE id=v_member;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed=0 THEN RAISE EXCEPTION 'MEMBER_ERASURE_DELETE_FAILED'; END IF;
  v_deleted:=v_deleted+v_changed;

  -- Only the explicit reviewed updates above may detach Auth references.
  -- Unknown references remain untouched until the fail-closed residual scan.
  IF EXISTS (SELECT 1 FROM public.member_auth_bindings b WHERE b.auth_user_id=v_auth)
     OR EXISTS (SELECT 1 FROM public.members m WHERE m.id=v_member)
     OR EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id=v_auth) THEN RAISE EXCEPTION 'ERASURE_IDENTITY_RESIDUAL'; END IF;
  -- Final check across every FK to either canonical identity. This catches newly
  -- added/previously unknown schema dependencies without broadening this procedure.
  -- Fail closed on any scalar identifier column still naming the target. This
  -- catches unreviewed FK and non-FK stores without fuzzy name/email matching.
  FOR r IN SELECT c.table_schema,c.table_name,c.column_name,c.data_type
    FROM information_schema.columns c JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND c.table_name<>'owner_member_erasure_operations'
      AND cl.relkind IN ('r','p') AND c.column_name=ANY(ARRAY[
        'member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id',
        'origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id','author_member_id',
        'actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id','reviewed_by_member_id',
        'auth_user_id','user_id','actor_user_id','subject_user_id','created_by','created_by_auth_user_id','updated_by',
        'reviewed_by_auth_user_id','rated_by','approved_by','added_by_auth_user_id','actor_auth_user_id','target_auth_user_id',
        'reviewer_auth_user_id','author_auth_user_id','assigned_by_auth_user_id','updated_by_auth_user_id'
      ]) AND (((c.data_type='bigint' OR c.data_type='integer') AND c.column_name IN ('member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id','origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id','author_member_id','actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id','reviewed_by_member_id')) OR (c.data_type='uuid' AND c.column_name NOT IN ('member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id','origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id','author_member_id','actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id','reviewed_by_member_id')))
  LOOP
  IF r.data_type IN ('bigint','integer') THEN EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',r.table_schema,r.table_name,r.column_name) INTO v_found USING v_member;
    ELSE EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',r.table_schema,r.table_name,r.column_name) INTO v_found USING v_auth; END IF;
    IF v_found THEN RAISE EXCEPTION 'ERASURE_IDENTIFIER_RESIDUAL: %.%.%',r.table_schema,r.table_name,r.column_name; END IF;
  END LOOP;
  FOR r IN SELECT c.table_schema,c.table_name,c.column_name,c.data_type FROM information_schema.columns c
    JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND c.table_name<>'owner_member_erasure_operations' AND cl.relkind IN ('r','p')
      AND c.data_type='uuid'
  LOOP
    EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',r.table_schema,r.table_name,r.column_name) INTO v_found USING v_auth;
    IF v_found THEN RAISE EXCEPTION 'ERASURE_AUTH_UUID_RESIDUAL: %.%.%',r.table_schema,r.table_name,r.column_name; END IF;
  END LOOP;
  FOR r IN SELECT c.table_schema,c.table_name,c.column_name FROM information_schema.columns c
    JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND c.table_name<>'owner_member_erasure_operations' AND cl.relkind IN ('r','p')
      AND c.data_type='jsonb'
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I t WHERE public.owner_member_erasure_json_has_identity(t.%I,$1,$2)',r.table_schema,r.table_name,r.column_name)
      INTO v_changed USING v_member,v_auth;
    IF v_changed>0 THEN RAISE EXCEPTION 'ERASURE_JSON_IDENTITY_RESIDUAL: %.%.%',r.table_schema,r.table_name,r.column_name; END IF;
  END LOOP;
  v_result:=pg_catalog.jsonb_build_object('operation_id',p_operation_id,'member_id_erased',true,'auth_binding_erased',true,'auth_user_deletion_required',true,'shared_parents_preserved',true);
  UPDATE public.owner_member_erasure_operations SET status='database_erased',deleted_database_rows=v_deleted,result=v_result WHERE operation_id=p_operation_id;
  PERFORM pg_catalog.set_config('phantoms.owner_member_erasure_operation','',true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_execute_database(UUID,BIGINT,UUID,JSONB,TEXT,TEXT) TO authenticated;
