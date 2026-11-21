-- Owner-verified, exact-ID member/Auth erasure. No Auth or Storage API operation is
-- performed here. The caller must finish the Auth-user deletion through GoTrue.
BEGIN;

CREATE TABLE public.owner_member_erasure_operations (
  operation_id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  owner_auth_user_id UUID NOT NULL,
  target_member_id BIGINT,
  target_auth_user_id UUID,
  preview_token_hash TEXT NOT NULL CHECK (preview_token_hash ~ '^[0-9a-f]{64}$'),
  preview_fingerprint TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed','executing','database_erased','complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result)='object'),
  storage_object_count BIGINT NOT NULL DEFAULT 0 CHECK (storage_object_count>=0),
  storage_manifest_complete BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_database_rows BIGINT NOT NULL DEFAULT 0 CHECK (deleted_database_rows>=0),
  deleted_storage_objects BIGINT NOT NULL DEFAULT 0 CHECK (deleted_storage_objects>=0),
  deleted_auth_users BIGINT NOT NULL DEFAULT 0 CHECK (deleted_auth_users BETWEEN 0 AND 1),
  CHECK ((status='complete') = (completed_at IS NOT NULL)),
  CHECK ((status='complete') = (target_member_id IS NULL AND target_auth_user_id IS NULL))
);
ALTER TABLE public.owner_member_erasure_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_member_erasure_operations FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.owner_member_erasure_operations IS
  'Private short-lived exact-ID erase previews and idempotency records. Target IDs are cleared on completion; no client can read or write this table directly.';

CREATE TABLE public.owner_member_erasure_storage_objects (
  operation_id UUID NOT NULL REFERENCES public.owner_member_erasure_operations(operation_id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(operation_id,bucket_id,object_name)
);
ALTER TABLE public.owner_member_erasure_storage_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_member_erasure_storage_objects FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.owner_member_erasure_storage_objects IS 'Private exact Storage owner manifest for the Auth/Storage saga; SQL never deletes storage.objects.';

CREATE FUNCTION public.owner_member_erasure_storage_write_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF EXISTS (SELECT 1 FROM public.owner_member_erasure_operations op
      WHERE op.status IN ('executing','database_erased') AND op.target_auth_user_id IS NOT NULL
        AND (op.target_auth_user_id::text=NEW.owner_id OR op.target_auth_user_id::text=OLD.owner_id)) THEN
      RAISE EXCEPTION 'STORAGE_OWNER_ERASURE_IN_PROGRESS' USING ERRCODE='55000';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.owner_member_erasure_operations op
      WHERE op.status IN ('executing','database_erased') AND op.target_auth_user_id IS NOT NULL
        AND op.target_auth_user_id::text=NEW.owner_id) THEN
    RAISE EXCEPTION 'STORAGE_OWNER_ERASURE_IN_PROGRESS' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_storage_write_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER owner_member_erasure_storage_write_guard
  BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW
  EXECUTE FUNCTION public.owner_member_erasure_storage_write_guard();

-- Fingerprint the full contents of rows carrying an exact Member/Auth identity
-- column. Any row change, not merely a count change, invalidates the preview.
CREATE FUNCTION public.owner_member_erasure_fingerprint(p_member_id BIGINT,p_auth_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; predicate TEXT; piece TEXT; all_pieces TEXT := '';
BEGIN
  FOR r IN
    SELECT c.table_schema,c.table_name,
      pg_catalog.string_agg(
        CASE WHEN c.data_type='bigint' THEN pg_catalog.format('t.%I=$1',c.column_name)
             WHEN c.data_type='uuid' THEN pg_catalog.format('t.%I=$2',c.column_name) END,
        ' OR ' ORDER BY c.ordinal_position) AS where_sql
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name NOT IN ('owner_member_erasure_operations')
      AND ((c.data_type='bigint' AND c.column_name = ANY(ARRAY[
        'member_id','target_member_id','source_member_id','registered_member_id',
        'owner_member_id','lead_member_id','origin_submitter_member_id','suggested_leader_member_id',
        'submitted_by_member_id','reporter_member_id','author_member_id','actor_member_id',
        'created_by_member_id','updated_by_member_id','uploaded_by_member_id','reviewed_by_member_id'
      ]::text[])) OR (c.data_type='uuid' AND c.column_name = ANY(ARRAY[
        'auth_user_id','user_id','actor_user_id','subject_user_id','created_by','created_by_auth_user_id',
        'updated_by','reviewed_by_auth_user_id','rated_by','approved_by','added_by_auth_user_id',
        'actor_auth_user_id','target_auth_user_id','reviewer_auth_user_id','author_auth_user_id',
        'assigned_by_auth_user_id','updated_by_auth_user_id','auth_write_user_id'
      ]::text[])))
    GROUP BY c.table_schema,c.table_name
    ORDER BY c.table_schema,c.table_name
  LOOP
    predicate := r.where_sql;
    EXECUTE pg_catalog.format(
      'SELECT COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, E''\n'' ORDER BY pg_catalog.to_jsonb(t)::text),'''') FROM %I.%I t WHERE %s',
      r.table_schema,r.table_name,predicate
    ) INTO piece USING p_member_id,p_auth_user_id;
    all_pieces := all_pieces || r.table_schema || '.' || r.table_name || E'\n' || piece || E'\n';
  END LOOP;
  -- JSON-only identity stores have no relational member FK.
  SELECT all_pieces || COALESCE(pg_catalog.string_agg('tasks:'||t.id||':'||t.assigned_to::text||':'||t.tracking::text,E'\n' ORDER BY t.id),'')
  INTO all_pieces FROM public.tasks t
  WHERE (pg_catalog.jsonb_typeof(t.tracking)='object' AND t.tracking ? p_member_id::text)
     OR (pg_catalog.jsonb_typeof(t.assigned_to)='array' AND t.assigned_to @> pg_catalog.jsonb_build_array(p_member_id::text))
     OR (pg_catalog.jsonb_typeof(t.assigned_to)='array' AND t.assigned_to @> pg_catalog.jsonb_build_array(p_member_id));
  SELECT all_pieces || COALESCE(pg_catalog.string_agg('announcements:'||a.id||':'||a.target_audience::text||':'||a.read_receipts::text,E'\n' ORDER BY a.id),'')
  INTO all_pieces FROM public.announcements a
  WHERE a.target_audience -> 'member_ids' @> pg_catalog.jsonb_build_array(p_member_id)
     OR a.target_audience -> 'member_ids' @> pg_catalog.jsonb_build_array(p_member_id::text)
     OR a.read_receipts ? p_member_id::text;
  RETURN pg_catalog.encode(extensions.digest(pg_catalog.convert_to(all_pieces,'UTF8'),'sha256'),'hex');
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_fingerprint(BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.team_access_audit ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.web_program_admin_audit ALTER COLUMN actor_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_agreements ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_agreement_acceptances ALTER COLUMN actor_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_consents ALTER COLUMN actor_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_idea_reviews ALTER COLUMN reviewer_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_milestones ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_milestone_dependencies ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_sprints ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_tasks ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_task_assignees ALTER COLUMN assigned_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_task_comments ALTER COLUMN author_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_resources ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_resource_refs ALTER COLUMN added_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.web_project_integrations ALTER COLUMN created_by_auth_user_id DROP NOT NULL;
ALTER TABLE public.member_password_invitations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.task_contribution_events ADD COLUMN actor_erased BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.task_contribution_events DROP CONSTRAINT task_contribution_event_actor_provenance_check;
ALTER TABLE public.task_contribution_events ADD CONSTRAINT task_contribution_event_actor_provenance_check CHECK (
  (provenance='live_transition' AND ((actor_user_id IS NOT NULL AND NOT actor_erased) OR (actor_user_id IS NULL AND actor_erased)))
  OR (provenance='legacy_snapshot' AND actor_user_id IS NULL AND NOT actor_erased));

CREATE FUNCTION public.owner_member_erasure_append_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.owner_member_erasure_operations; ctx UUID; oldj JSONB; newj JSONB; allow_fields TEXT[] := ARRAY[]::text[]; subject_fields TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'APPEND_ONLY_TRUNCATE_FORBIDDEN' USING ERRCODE='55000'; END IF;
  BEGIN ctx := NULLIF(pg_catalog.current_setting('phantoms.owner_member_erasure_operation',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN ctx := NULL; END;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=ctx AND status='executing' FOR SHARE;
  IF NOT FOUND OR op.owner_auth_user_id IS DISTINCT FROM auth.uid() OR NOT public.is_owner()
     OR op.target_member_id IS NULL OR op.target_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY_MUTATION_FORBIDDEN' USING ERRCODE='55000';
  END IF;
  oldj := pg_catalog.to_jsonb(OLD);
  IF TG_TABLE_NAME='team_access_audit' THEN subject_fields:=ARRAY['member_id','subject_user_id']; allow_fields:=ARRAY['actor_user_id'];
  ELSIF TG_TABLE_NAME='member_infinite_bonus_events' THEN subject_fields:=ARRAY['member_id'];
  ELSIF TG_TABLE_NAME='task_contribution_events' THEN subject_fields:=ARRAY['member_id']; allow_fields:=ARRAY['actor_user_id','actor_erased'];
  ELSIF TG_TABLE_NAME='web_program_admin_audit' THEN subject_fields:=ARRAY['target_auth_user_id']; allow_fields:=ARRAY['target_auth_user_id','actor_auth_user_id'];
  ELSIF TG_TABLE_NAME IN ('web_project_agreement_acceptances','web_project_consents') THEN subject_fields:=ARRAY['member_id']; allow_fields:=ARRAY['actor_auth_user_id'];
  ELSIF TG_TABLE_NAME='web_project_activity_logs' THEN allow_fields:=ARRAY['actor_auth_user_id','actor_member_id'];
  ELSIF TG_TABLE_NAME='web_project_agreements' THEN subject_fields:=ARRAY['__no_subject__']; allow_fields:=ARRAY['created_by_auth_user_id'];
  ELSIF TG_TABLE_NAME='web_idea_reviews' THEN subject_fields:=ARRAY['__no_subject__']; allow_fields:=ARRAY['reviewer_auth_user_id'];
  ELSE RAISE EXCEPTION 'APPEND_ONLY_TABLE_NOT_ALLOWLISTED' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN
    IF (oldj ? 'member_id' AND oldj->>'member_id'=op.target_member_id::text)
       OR (oldj ? 'subject_user_id' AND oldj->>'subject_user_id'=op.target_auth_user_id::text)
       OR (oldj ? 'target_auth_user_id' AND oldj->>'target_auth_user_id'=op.target_auth_user_id::text)
       OR (TG_TABLE_NAME IN ('web_project_agreement_acceptances','web_project_consents')
           AND oldj->>'member_id'=op.target_member_id::text) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'APPEND_ONLY_DELETE_NOT_TARGET_SUBJECT' USING ERRCODE='55000';
  END IF;
  newj := pg_catalog.to_jsonb(NEW);
  IF oldj - allow_fields IS DISTINCT FROM newj - allow_fields THEN
    RAISE EXCEPTION 'APPEND_ONLY_UPDATE_CHANGED_NONIDENTITY_DATA' USING ERRCODE='55000';
  END IF;
  IF 'actor_user_id'=ANY(allow_fields) AND oldj->>'actor_user_id'=op.target_auth_user_id::text AND newj->'actor_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='task_contribution_events' AND oldj->>'actor_user_id'=op.target_auth_user_id::text
     AND newj->'actor_user_id'='null'::jsonb AND newj->'actor_erased'='true'::jsonb THEN RETURN NEW; END IF;
  IF 'actor_auth_user_id'=ANY(allow_fields) AND oldj->>'actor_auth_user_id'=op.target_auth_user_id::text AND newj->'actor_auth_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF 'actor_member_id'=ANY(allow_fields) AND oldj->>'actor_member_id'=op.target_member_id::text AND newj->'actor_member_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='web_program_admin_audit' AND oldj->>'target_auth_user_id'=op.target_auth_user_id::text AND newj->'target_auth_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='team_access_audit' AND oldj->>'actor_user_id'=op.target_auth_user_id::text AND newj->'actor_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('web_project_agreement_acceptances','web_project_consents')
     AND oldj->>'actor_auth_user_id'=op.target_auth_user_id::text AND newj->'actor_auth_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='web_project_agreements' AND oldj->>'created_by_auth_user_id'=op.target_auth_user_id::text AND newj->'created_by_auth_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='web_idea_reviews' AND oldj->>'reviewer_auth_user_id'=op.target_auth_user_id::text AND newj->'reviewer_auth_user_id'='null'::jsonb THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'APPEND_ONLY_UPDATE_NOT_TARGET_IDENTIFIER_REMOVAL' USING ERRCODE='55000';
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_append_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Rebind the existing row/statement guards to one trigger-only function.
-- The function permits only exact target-ID removals for an active operation;
-- TRUNCATE always raises. No trigger is disabled or removed.
DROP TRIGGER team_access_audit_no_mutation ON public.team_access_audit;
DROP TRIGGER team_access_audit_no_truncate ON public.team_access_audit;
CREATE TRIGGER team_access_audit_no_mutation BEFORE UPDATE OR DELETE ON public.team_access_audit FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER team_access_audit_no_truncate BEFORE TRUNCATE ON public.team_access_audit FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER task_contribution_events_append_only ON public.task_contribution_events;
DROP TRIGGER task_contribution_events_no_truncate ON public.task_contribution_events;
CREATE TRIGGER task_contribution_events_append_only BEFORE UPDATE OR DELETE ON public.task_contribution_events FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER task_contribution_events_no_truncate BEFORE TRUNCATE ON public.task_contribution_events FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER member_infinite_bonus_events_immutable ON public.member_infinite_bonus_events;
CREATE TRIGGER member_infinite_bonus_events_immutable BEFORE TRUNCATE ON public.member_infinite_bonus_events FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER member_infinite_bonus_events_no_mutation BEFORE UPDATE OR DELETE ON public.member_infinite_bonus_events FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_program_admin_audit_no_mutation ON public.web_program_admin_audit;
DROP TRIGGER web_program_admin_audit_no_truncate ON public.web_program_admin_audit;
CREATE TRIGGER web_program_admin_audit_no_mutation BEFORE UPDATE OR DELETE ON public.web_program_admin_audit FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_program_admin_audit_no_truncate BEFORE TRUNCATE ON public.web_program_admin_audit FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_project_agreements_no_mutation ON public.web_project_agreements;
DROP TRIGGER web_project_agreements_no_truncate ON public.web_project_agreements;
CREATE TRIGGER web_project_agreements_no_mutation BEFORE UPDATE OR DELETE ON public.web_project_agreements FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_project_agreements_no_truncate BEFORE TRUNCATE ON public.web_project_agreements FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_project_acceptances_no_mutation ON public.web_project_agreement_acceptances;
DROP TRIGGER web_project_acceptances_no_truncate ON public.web_project_agreement_acceptances;
CREATE TRIGGER web_project_acceptances_no_mutation BEFORE UPDATE OR DELETE ON public.web_project_agreement_acceptances FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_project_acceptances_no_truncate BEFORE TRUNCATE ON public.web_project_agreement_acceptances FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_project_consents_no_mutation ON public.web_project_consents;
DROP TRIGGER web_project_consents_no_truncate ON public.web_project_consents;
CREATE TRIGGER web_project_consents_no_mutation BEFORE UPDATE OR DELETE ON public.web_project_consents FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_project_consents_no_truncate BEFORE TRUNCATE ON public.web_project_consents FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_project_activity_no_mutation ON public.web_project_activity_logs;
DROP TRIGGER web_project_activity_no_truncate ON public.web_project_activity_logs;
CREATE TRIGGER web_project_activity_no_mutation BEFORE UPDATE OR DELETE ON public.web_project_activity_logs FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_project_activity_no_truncate BEFORE TRUNCATE ON public.web_project_activity_logs FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();
DROP TRIGGER web_idea_reviews_no_mutation ON public.web_idea_reviews;
DROP TRIGGER web_idea_reviews_no_truncate ON public.web_idea_reviews;
CREATE TRIGGER web_idea_reviews_no_mutation BEFORE UPDATE OR DELETE ON public.web_idea_reviews FOR EACH ROW EXECUTE FUNCTION public.owner_member_erasure_append_guard();
CREATE TRIGGER web_idea_reviews_no_truncate BEFORE TRUNCATE ON public.web_idea_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.owner_member_erasure_append_guard();

CREATE FUNCTION public.owner_member_erasure_json_has_identity(p_value JSONB,p_member_id BIGINT,p_auth_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item RECORD; scalar TEXT;
BEGIN
  IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value)='null' THEN RETURN FALSE; END IF;
  IF pg_catalog.jsonb_typeof(p_value)='object' THEN
    FOR item IN SELECT key,value FROM pg_catalog.jsonb_each(p_value) LOOP
      IF item.key IN (p_member_id::text,p_auth_user_id::text)
         OR public.owner_member_erasure_json_has_identity(item.value,p_member_id,p_auth_user_id) THEN RETURN TRUE; END IF;
    END LOOP;
    RETURN FALSE;
  ELSIF pg_catalog.jsonb_typeof(p_value)='array' THEN
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP
      IF public.owner_member_erasure_json_has_identity(item.value,p_member_id,p_auth_user_id) THEN RETURN TRUE; END IF;
    END LOOP;
    RETURN FALSE;
  END IF;
  scalar:=p_value #>> '{}';
  RETURN scalar=p_member_id::text OR scalar=p_auth_user_id::text;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_json_has_identity(JSONB,BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.owner_member_erasure_blockers(p_member_id BIGINT,p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE blockers JSONB:='[]'::jsonb; r RECORD; n BIGINT; sql TEXT;
BEGIN
  -- These project-authored rows contain shared work whose authorship cannot
  -- currently be detached without changing its meaning. Block instead of
  -- deleting the project, task, deliverable, report, checklist or attachment.
  FOR r IN SELECT * FROM (VALUES
    ('web_project_tasks','reporter_member_id'),
    ('web_project_deliverables','submitted_by_member_id'),
    ('web_project_task_checklist_items','created_by_member_id'),
    ('web_project_task_checklist_items','updated_by_member_id'),
    ('web_project_task_attachments','uploaded_by_member_id'),
    ('web_project_updates','author_member_id'),
    ('web_project_member_reports','member_id')
  ) AS x(table_name,column_name) LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I WHERE %I=$1',r.table_name,r.column_name) INTO n USING p_member_id;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','shared_project_attribution','table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  -- Any shared URL/path/attachment/document field may point to an exact
  -- target-owned object. Scan reference-shaped text and JSON columns rather
  -- than assuming only the normalized storage_object_path columns are used.
  -- False positives deliberately block; deleting a referenced object is unsafe.
  FOR r IN SELECT c.table_name,c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name NOT IN ('owner_member_erasure_operations','owner_member_erasure_storage_objects')
      AND c.column_name ~* '(url|path|storage|file|attachment|document|reference|evidence|image|logo)'
      AND c.data_type IN ('text','character varying','character','jsonb','ARRAY')
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM public.%I t WHERE t.%I IS NOT NULL AND EXISTS (
         SELECT 1 FROM storage.objects o WHERE o.owner_id=$1::text
           AND (pg_catalog.strpos(t.%I::text,o.bucket_id||''/''||o.name)>0
             OR pg_catalog.strpos(t.%I::text,o.name)>0))',
      r.table_name,r.column_name,r.column_name,r.column_name
    ) INTO n USING p_auth_user_id;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','shared_storage_reference','table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  -- A target UUID written into another member's invitation is an identity
  -- collision, not permission to erase or retarget that invitation.
  SELECT count(*) INTO n FROM public.member_password_invitations i
  WHERE i.member_id<>p_member_id AND (i.expected_auth_user_id=p_auth_user_id
    OR i.auth_user_id=p_auth_user_id OR i.auth_write_user_id=p_auth_user_id);
  IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'code','other_member_invitation_identity','table','member_password_invitations','column','auth_identity','count',n)); END IF;
  SELECT count(*) INTO n FROM public.member_password_recovery_sessions mprs
    JOIN auth.sessions s ON s.id=mprs.session_id
    JOIN public.member_password_invitations i ON i.id=mprs.invitation_id
  WHERE s.user_id=p_auth_user_id AND i.member_id<>p_member_id;
  IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'code','other_member_recovery_session','table','member_password_recovery_sessions','column','invitation_id','count',n)); END IF;
  SELECT count(*) INTO n FROM public.member_infinite_bonus_events e
    WHERE e.actor_user_id=p_auth_user_id AND e.member_id<>p_member_id;
  IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'code','append_only_actor_reference','table','member_infinite_bonus_events','column','actor_user_id','count',n)); END IF;
  -- Any non-null exact Member identifier outside the explicit cleanup allowlist
  -- is surfaced before execution. Newly added tables fail closed automatically.
  FOR r IN SELECT c.table_name,c.column_name,c.data_type
    FROM information_schema.columns c JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND cl.relkind IN ('r','p') AND c.table_name<>'owner_member_erasure_operations'
      AND c.column_name=ANY(ARRAY['member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id',
        'origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id','author_member_id',
        'actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id','reviewed_by_member_id'])
      AND (c.data_type='bigint' OR c.data_type='integer')
      AND NOT ((c.table_name,c.column_name) IN (('members','id'),('member_auth_bindings','member_id'),('notes','target_member_id'),
        ('member_password_invitations','member_id'),('member_password_audit','member_id'),('member_registration_invites','registered_member_id'),('team_memberships','member_id'),
        ('team_member_metrics','member_id'),('team_member_custom_field_values','member_id'),('announcement_recipients','member_id'),
        ('team_access_audit','member_id'),('task_contribution_events','member_id'),('member_infinite_bonus_events','member_id'),
        ('web_ideas','submitted_by_member_id'),('web_ideas','suggested_leader_member_id'),
        ('web_idea_contributors','member_id'),('web_projects','owner_member_id'),('web_projects','lead_member_id'),
        ('web_projects','origin_submitter_member_id'),('web_project_members','member_id'),
        ('web_project_agreement_acceptances','member_id'),('web_project_consents','member_id'),
        ('web_project_activity_logs','actor_member_id'),('web_project_task_assignees','member_id'),
        ('web_project_task_comments','author_member_id')))
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I WHERE %I=$1',r.table_name,r.column_name) INTO n USING p_member_id;
    IF n>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(blockers) b WHERE b->>'table'=r.table_name AND b->>'column'=r.column_name) THEN
      blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code','unhandled_member_reference','table',r.table_name,'column',r.column_name,'count',n));
    END IF;
  END LOOP;
  -- Every UUID value equal to the exact Auth identity must be an explicitly
  -- handled reference. Unknown nullable and non-null columns both block.
  FOR r IN SELECT c.table_name,c.column_name
    FROM information_schema.columns c JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND cl.relkind IN ('r','p') AND c.table_name<>'owner_member_erasure_operations'
      AND c.data_type='uuid'
      AND NOT ((c.table_name,c.column_name) IN (
        ('member_auth_bindings','auth_user_id'),('admin_accounts','user_id'),('team_admin_assignments','user_id'),
        ('member_infinite_bonus_events','actor_user_id'),
        ('member_password_invitations','created_by'),('member_password_invitations','expected_auth_user_id'),
        ('member_password_invitations','auth_user_id'),('member_password_invitations','auth_write_user_id'),
        ('member_registration_invites','created_by'),('member_password_audit','actor_user_id'),
        ('team_access_audit','actor_user_id'),('team_access_audit','subject_user_id'),
        ('task_contribution_events','actor_user_id'),('web_program_admin_audit','actor_auth_user_id'),
        ('web_program_admin_audit','target_auth_user_id'),('web_project_activity_logs','actor_auth_user_id'),
        ('web_project_agreements','created_by_auth_user_id'),('web_project_agreement_acceptances','actor_auth_user_id'),
        ('web_project_consents','actor_auth_user_id'),('web_idea_reviews','reviewer_auth_user_id'),
        ('web_project_milestones','created_by_auth_user_id'),('web_project_milestone_dependencies','created_by_auth_user_id'),
        ('web_project_sprints','created_by_auth_user_id'),('web_project_tasks','created_by_auth_user_id'),
        ('web_project_task_assignees','assigned_by_auth_user_id'),('web_project_task_comments','author_auth_user_id'),
        ('web_resources','created_by_auth_user_id'),('web_project_resource_refs','added_by_auth_user_id'),
        ('web_project_integrations','created_by_auth_user_id')))
  LOOP
    sql:=pg_catalog.format('SELECT count(*) FROM public.%I WHERE %I=$1',r.table_name,r.column_name);
    EXECUTE sql INTO n USING p_auth_user_id;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','unhandled_auth_reference','table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  -- GoTrue may cascade through auth-owned tables, but custom non-public schemas
  -- must not be changed implicitly by its delete_user operation.
  FOR r IN SELECT ns.nspname AS schema_name,rel.relname AS table_name,att.attname AS column_name
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class rel ON rel.oid=fk.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid=rel.oid AND att.attnum=fk.conkey[1] AND NOT att.attisdropped
    JOIN pg_catalog.pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_catalog.pg_namespace pns ON pns.oid=parent.relnamespace
    JOIN pg_catalog.pg_type typ ON typ.oid=att.atttypid
    WHERE fk.contype='f' AND pg_catalog.cardinality(fk.conkey)=1 AND pg_catalog.cardinality(fk.confkey)=1
      AND pns.nspname='auth' AND parent.relname='users' AND ns.nspname NOT IN ('auth','public') AND typ.typname='uuid'
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I=$1',r.schema_name,r.table_name,r.column_name) INTO n USING p_auth_user_id;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','external_auth_foreign_key','schema',r.schema_name,'table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  FOR r IN SELECT c.table_schema AS schema_name,c.table_name,c.column_name,c.data_type
    FROM information_schema.columns c JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema NOT IN ('public','auth','information_schema','pg_catalog','extensions')
      AND cl.relkind IN ('r','p') AND (c.data_type IN ('uuid','jsonb') OR c.column_name=ANY(ARRAY[
        'member_id','target_member_id','source_member_id','registered_member_id','owner_member_id','lead_member_id',
        'origin_submitter_member_id','suggested_leader_member_id','submitted_by_member_id','reporter_member_id',
        'author_member_id','actor_member_id','created_by_member_id','updated_by_member_id','uploaded_by_member_id',
        'reviewed_by_member_id','auth_user_id','user_id','actor_user_id','subject_user_id','created_by',
        'created_by_auth_user_id','updated_by','reviewed_by_auth_user_id','rated_by','approved_by',
        'added_by_auth_user_id','actor_auth_user_id','target_auth_user_id','reviewer_auth_user_id',
        'author_auth_user_id','assigned_by_auth_user_id','updated_by_auth_user_id','auth_write_user_id']))
  LOOP
    IF r.schema_name='storage' AND r.table_name='objects' AND r.column_name='owner_id' THEN CONTINUE; END IF;
    IF r.data_type='jsonb' THEN
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I t WHERE public.owner_member_erasure_json_has_identity(t.%I,$1,$2)',r.schema_name,r.table_name,r.column_name)
        INTO n USING p_member_id,p_auth_user_id;
    ELSIF r.data_type='uuid' THEN
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I=$1',r.schema_name,r.table_name,r.column_name) INTO n USING p_auth_user_id;
    ELSIF r.column_name ILIKE '%member%' THEN
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I::text=$1',r.schema_name,r.table_name,r.column_name) INTO n USING p_member_id::text;
    ELSE
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I::text=$1',r.schema_name,r.table_name,r.column_name) INTO n USING p_auth_user_id::text;
    END IF;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','unhandled_external_identity','schema',r.schema_name,'table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  -- Unknown JSON identity locations block; known task/announcement fields are
  -- removed surgically in the transaction and are therefore excluded here.
  FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
    JOIN pg_catalog.pg_class cl ON cl.relname=c.table_name JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname=c.table_schema
    WHERE c.table_schema='public' AND cl.relkind IN ('r','p') AND c.data_type='jsonb'
      AND NOT ((c.table_name,c.column_name) IN (('tasks','assigned_to'),('tasks','tracking'),
        ('announcements','target_audience'),('announcements','read_receipts')))
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I t WHERE public.owner_member_erasure_json_has_identity(t.%I,$1,$2)',r.table_name,r.column_name)
      INTO n USING p_member_id,p_auth_user_id;
    IF n>0 THEN blockers:=blockers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code','unhandled_json_identity','table',r.table_name,'column',r.column_name,'count',n)); END IF;
  END LOOP;
  RETURN blockers;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_blockers(BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.owner_member_erasure_preview(p_member_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_auth UUID; v_count BIGINT; v_operation UUID; v_name TEXT; v_email TEXT; v_preview_token TEXT;
  v_expires TIMESTAMPTZ; v_handover JSONB:='[]'::jsonb; v_blockers JSONB:='[]'::jsonb; v_is_admin BOOLEAN;
  r RECORD;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF p_member_id IS NULL OR p_member_id<=0 THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  SELECT count(*),(array_agg(b.auth_user_id))[1] INTO v_count,v_auth
    FROM public.member_auth_bindings b WHERE b.member_id=p_member_id;
  IF v_count<>1 OR v_auth IS NULL THEN RAISE EXCEPTION 'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_auth_bindings b WHERE b.auth_user_id=v_auth AND b.member_id<>p_member_id)
     OR (SELECT count(*) FROM public.member_auth_bindings b WHERE b.auth_user_id=v_auth)<>1 THEN RAISE EXCEPTION 'AUTH_BINDING_AMBIGUOUS'; END IF;
  IF v_auth=auth.uid() THEN RAISE EXCEPTION 'SELF_ERASURE_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id=v_auth AND a.role='owner') THEN RAISE EXCEPTION 'PRIMARY_OWNER_ERASURE_FORBIDDEN'; END IF;
  SELECT m.full_name,m.email INTO v_name,v_email FROM public.members m WHERE m.id=p_member_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  DELETE FROM public.owner_member_erasure_operations
    WHERE owner_auth_user_id=auth.uid() AND status='previewed' AND expires_at<=clock_timestamp();
  v_operation:=extensions.gen_random_uuid();
  v_preview_token:=extensions.gen_random_uuid()::text||extensions.gen_random_uuid()::text;
  v_expires:=clock_timestamp()+INTERVAL '15 minutes';
  v_blockers:=public.owner_member_erasure_blockers(p_member_id,v_auth);
  SELECT COALESCE(jsonb_agg(q.requirement ORDER BY q.entity_name,q.entity_id),'[]'::jsonb) INTO v_handover
  FROM (
    SELECT p.id AS entity_id,p.name AS entity_name,jsonb_build_object(
      'kind','web_projects.owner_member_id','entity_id',p.id,'entity_name',p.name,
      'candidates',COALESCE((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'full_name',m.full_name) ORDER BY m.full_name,m.id)
        FROM public.web_project_members pm JOIN public.members m ON m.id=pm.member_id
        WHERE pm.project_id=p.id AND pm.member_id<>p_member_id AND pm.status='active' AND pm.role IN ('lead','contributor') AND m.work_status='active'),'[]'::jsonb)
    ) AS requirement FROM public.web_projects p WHERE p.owner_member_id=p_member_id
    UNION ALL
    SELECT i.id,i.title,jsonb_build_object(
      'kind','web_ideas.submitted_by_member_id','entity_id',i.id,'entity_name',i.title,
      'candidates',COALESCE((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'full_name',m.full_name) ORDER BY m.full_name,m.id)
        FROM public.web_idea_contributors c JOIN public.members m ON m.id=c.member_id
        WHERE c.idea_id=i.id AND c.member_id<>p_member_id AND m.work_status='active'),'[]'::jsonb)
    ) FROM public.web_ideas i WHERE i.submitted_by_member_id=p_member_id
  ) q;
  FOR r IN SELECT value FROM jsonb_array_elements(v_handover) LOOP
    IF jsonb_array_length(r.value->'candidates')=0 THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','successor_unavailable',
        'kind',r.value->>'kind','entity_id',r.value->>'entity_id','count',1));
    END IF;
  END LOOP;
  SELECT EXISTS(SELECT 1 FROM public.admin_accounts a WHERE a.user_id=v_auth) INTO v_is_admin;
  INSERT INTO public.owner_member_erasure_operations(operation_id,owner_auth_user_id,target_member_id,target_auth_user_id,
    preview_token_hash,preview_fingerprint,expires_at,storage_object_count)
  VALUES(v_operation,auth.uid(),p_member_id,v_auth,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_preview_token,'UTF8'),'sha256'),'hex'),
    public.owner_member_erasure_fingerprint(p_member_id,v_auth),v_expires,(SELECT count(*) FROM storage.objects WHERE owner_id=v_auth::text));
  RETURN pg_catalog.jsonb_build_object('ok',true,'preview',pg_catalog.jsonb_build_object(
    'operation_id',v_operation,'member_id',p_member_id,'auth_user_id',v_auth,'member_name',v_name,
    'email_masked',CASE WHEN v_email IS NULL THEN NULL ELSE pg_catalog.left(v_email,1)||'***@'||pg_catalog.split_part(v_email,'@',2) END,
    'preview_token',v_preview_token,'expires_at',v_expires,
    'impacts',jsonb_build_array(
      jsonb_build_object('key','member_profile','label_ar','ملف العضو','label_en','Member profile','count',1),
      jsonb_build_object('key','auth_binding','label_ar','ربط الهوية','label_en','Auth binding','count',1),
      jsonb_build_object('key','task_json','label_ar','إسنادات وتتبع المهام','label_en','Task assignments and tracking','count',(SELECT count(*) FROM public.tasks t WHERE (t.tracking ? p_member_id::text) OR (t.assigned_to @> jsonb_build_array(p_member_id)) OR (t.assigned_to @> jsonb_build_array(p_member_id::text)))),
      jsonb_build_object('key','announcement_json','label_ar','جمهور وإيصالات الإعلانات','label_en','Announcement audiences and receipts','count',(SELECT count(*) FROM public.announcements a WHERE (a.read_receipts ? p_member_id::text) OR a.target_audience->'member_ids' @> jsonb_build_array(p_member_id) OR a.target_audience->'member_ids' @> jsonb_build_array(p_member_id::text)))
    ),
    'shared_teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'other_member_count',x.n) ORDER BY t.name) FROM public.team_memberships tm JOIN public.teams t ON t.id=tm.team_id CROSS JOIN LATERAL (SELECT count(*)::int n FROM public.team_memberships z WHERE z.team_id=t.id AND z.member_id<>p_member_id) x WHERE tm.member_id=p_member_id),'[]'::jsonb),
    'shared_projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'other_member_count',x.n,'dependent_rows',x.d) ORDER BY p.name) FROM public.web_project_members pm JOIN public.web_projects p ON p.id=pm.project_id CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE m.member_id<>p_member_id)::int n,count(*)::int d FROM public.web_project_members m WHERE m.project_id=p.id) x WHERE pm.member_id=p_member_id),'[]'::jsonb),
    'handover_requirements',v_handover,
    'storage_object_count',(SELECT count(*)::int FROM storage.objects o WHERE o.owner_id=v_auth::text),
    'owner_target',false,'is_admin',v_is_admin,'blockers',v_blockers,'can_execute',jsonb_array_length(v_blockers)=0));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_preview(BIGINT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_preview(BIGINT) TO authenticated;

CREATE FUNCTION public.owner_member_erasure_execute_database(p_operation_id UUID,p_member_id BIGINT,p_auth_user_id UUID,p_successor_assignments JSONB,p_preview_token TEXT,p_confirmation TEXT)
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
  FOR r IN SELECT DISTINCT ns.nspname,rel.relname
    FROM pg_catalog.pg_class rel
    JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid=rel.oid AND att.attnum>0 AND NOT att.attisdropped
    WHERE ns.nspname NOT IN ('auth','information_schema','pg_catalog','extensions','pg_toast') AND rel.relkind IN ('r','p')
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
    EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',r.nspname,r.relname);
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


-- The Edge worker enumerates and deletes Storage through the Storage API only.
-- owner_id is compared byte-for-byte with the exact Auth UUID captured at preview.
CREATE FUNCTION public.owner_member_erasure_storage_candidates(p_operation_id UUID,p_cursor TEXT,p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations; objs JSONB; next_cursor TEXT; total BIGINT; page_count INTEGER;
  separator_position INTEGER; cursor_bucket_length INTEGER; cursor_bucket TEXT; cursor_name TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation_id IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id;
  IF NOT FOUND OR op.status NOT IN ('previewed','database_erased') OR op.target_auth_user_id IS NULL THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  IF p_cursor IS NOT NULL THEN
    IF pg_catalog.char_length(p_cursor)>2048 OR p_cursor !~ '^[1-9][0-9]{0,2}:' THEN RAISE EXCEPTION 'INVALID_STORAGE_CURSOR'; END IF;
    separator_position:=position(':' IN p_cursor);
    BEGIN cursor_bucket_length:=substring(p_cursor FROM 1 FOR separator_position-1)::integer;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_STORAGE_CURSOR'; END;
    IF cursor_bucket_length NOT BETWEEN 1 AND 255 OR separator_position+cursor_bucket_length>=pg_catalog.char_length(p_cursor) THEN RAISE EXCEPTION 'INVALID_STORAGE_CURSOR'; END IF;
    cursor_bucket:=substring(p_cursor FROM separator_position+1 FOR cursor_bucket_length);
    cursor_name:=substring(p_cursor FROM separator_position+1+cursor_bucket_length);
    IF pg_catalog.char_length(cursor_bucket)<>cursor_bucket_length OR cursor_name='' THEN RAISE EXCEPTION 'INVALID_STORAGE_CURSOR'; END IF;
  END IF;
  SELECT count(*) INTO total FROM storage.objects o WHERE o.owner_id=op.target_auth_user_id::text;
  WITH page AS (
    SELECT o.bucket_id,o.name FROM storage.objects o WHERE o.owner_id=op.target_auth_user_id::text
      AND (p_cursor IS NULL OR (o.bucket_id,o.name)>(cursor_bucket,cursor_name))
    ORDER BY o.bucket_id,o.name LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket_id',x.bucket_id,'name',x.name,'owner_id',op.target_auth_user_id::text) ORDER BY x.bucket_id,x.name),'[]'::jsonb),
         (array_agg(pg_catalog.char_length(x.bucket_id)::text||':'||x.bucket_id||x.name ORDER BY x.bucket_id DESC,x.name DESC))[1],count(*)
    INTO objs,next_cursor,page_count FROM page x;
  RETURN jsonb_build_object('ok',true,'scope_verified',true,'owner_id',op.target_auth_user_id::text,'objects',objs,
    'next_cursor',CASE WHEN page_count<p_limit THEN NULL ELSE next_cursor END,'complete',page_count<p_limit,
    'owner_object_count',total);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_storage_candidates(UUID,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_storage_candidates(UUID,TEXT,INTEGER) TO service_role;

CREATE FUNCTION public.owner_member_erasure_store_storage_batch(p_operation_id UUID,p_objects JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations; item JSONB; n INTEGER:=0; manifest_count BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation_id IS NULL OR jsonb_typeof(p_objects)<>'array' OR jsonb_array_length(p_objects)>500 THEN RAISE EXCEPTION 'SERVICE_ONLY_OR_INVALID_BATCH'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status<>'previewed' OR op.target_auth_user_id IS NULL THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  IF op.storage_manifest_complete AND jsonb_array_length(p_objects)>0 THEN RAISE EXCEPTION 'STORAGE_MANIFEST_ALREADY_SEALED'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_objects) AS e(value) LOOP
    IF jsonb_typeof(item)<>'object' OR item - ARRAY['bucket_id','name']::text[]<>'{}'::jsonb
       OR jsonb_typeof(item->'bucket_id')<>'string' OR jsonb_typeof(item->'name')<>'string'
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id=item->>'bucket_id' AND o.name=item->>'name' AND o.owner_id=op.target_auth_user_id::text) THEN
      RAISE EXCEPTION 'STORAGE_OBJECT_NOT_OWNED_BY_TARGET';
    END IF;
    INSERT INTO public.owner_member_erasure_storage_objects(operation_id,bucket_id,object_name)
      VALUES(p_operation_id,item->>'bucket_id',item->>'name') ON CONFLICT DO NOTHING;
    -- Count validated entries, not only newly inserted rows: a retried batch
    -- after a lost RPC response is a successful idempotent replay.
    n:=n+1;
  END LOOP;
  IF jsonb_array_length(p_objects)=0 THEN
    SELECT count(*) INTO manifest_count FROM public.owner_member_erasure_storage_objects WHERE operation_id=p_operation_id;
    IF manifest_count<>op.storage_object_count
       OR (SELECT count(*) FROM storage.objects o WHERE o.owner_id=op.target_auth_user_id::text)<>op.storage_object_count
       OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.owner_id=op.target_auth_user_id::text AND NOT EXISTS(
         SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND so.bucket_id=o.bucket_id AND so.object_name=o.name))
       OR EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND NOT EXISTS(
         SELECT 1 FROM storage.objects o WHERE o.owner_id=op.target_auth_user_id::text AND o.bucket_id=so.bucket_id AND o.name=so.object_name)) THEN
      RAISE EXCEPTION 'STORAGE_MANIFEST_SCOPE_MISMATCH'; END IF;
    UPDATE public.owner_member_erasure_operations SET storage_manifest_complete=TRUE WHERE operation_id=p_operation_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'stored_count',n,
    'manifest_count',(SELECT count(*) FROM public.owner_member_erasure_storage_objects WHERE operation_id=p_operation_id),
    'complete',jsonb_array_length(p_objects)=0);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_store_storage_batch(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_store_storage_batch(UUID,JSONB) TO service_role;

CREATE FUNCTION public.owner_member_erasure_pending_storage_batch(p_operation_id UUID,p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations; out_objects JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id;
  IF NOT FOUND OR NOT op.storage_manifest_complete THEN RAISE EXCEPTION 'STORAGE_MANIFEST_INCOMPLETE'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket_id',x.bucket_id,'name',x.object_name) ORDER BY x.bucket_id,x.object_name),'[]'::jsonb)
    INTO out_objects FROM (SELECT bucket_id,object_name FROM public.owner_member_erasure_storage_objects WHERE operation_id=p_operation_id AND NOT is_deleted ORDER BY bucket_id,object_name LIMIT p_limit) x;
  RETURN out_objects;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_pending_storage_batch(UUID,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_pending_storage_batch(UUID,INTEGER) TO service_role;

CREATE FUNCTION public.owner_member_erasure_mark_storage_batch(p_operation_id UUID,p_objects JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item JSONB; n INTEGER:=0; changed_count INTEGER; op public.owner_member_erasure_operations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation_id IS NULL OR jsonb_typeof(p_objects)<>'array' OR jsonb_array_length(p_objects)>500 THEN RAISE EXCEPTION 'SERVICE_ONLY_OR_INVALID_BATCH'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status<>'database_erased' OR NOT op.storage_manifest_complete THEN RAISE EXCEPTION 'STORAGE_MANIFEST_INCOMPLETE'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_objects) AS e(value) LOOP
    IF jsonb_typeof(item)<>'object' OR item-ARRAY['bucket_id','name']::text[]<>'{}'
       OR jsonb_typeof(item->'bucket_id')<>'string' OR jsonb_typeof(item->'name')<>'string' THEN RAISE EXCEPTION 'INVALID_STORAGE_MARK_BATCH'; END IF;
    UPDATE public.owner_member_erasure_storage_objects SET is_deleted=TRUE
    WHERE operation_id=p_operation_id AND bucket_id=item->>'bucket_id' AND object_name=item->>'name' AND NOT is_deleted;
    GET DIAGNOSTICS changed_count=ROW_COUNT;
    n:=n+changed_count;
    IF NOT EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects WHERE operation_id=p_operation_id AND bucket_id=item->>'bucket_id' AND object_name=item->>'name') THEN RAISE EXCEPTION 'STORAGE_MANIFEST_ENTRY_NOT_FOUND'; END IF;
  END LOOP;
  UPDATE public.owner_member_erasure_operations SET deleted_storage_objects=deleted_storage_objects+n WHERE operation_id=p_operation_id;
  RETURN jsonb_build_object('ok',true,'marked_count',n,'deleted_storage_objects',(SELECT deleted_storage_objects FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_mark_storage_batch(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_mark_storage_batch(UUID,JSONB) TO service_role;

CREATE FUNCTION public.owner_member_erasure_mark_auth_deleted(p_operation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation_id IS NULL THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  IF op.status='complete' THEN RETURN op.result; END IF;
  IF op.status<>'database_erased' OR op.target_auth_user_id IS NULL THEN RAISE EXCEPTION 'DATABASE_ERASURE_NOT_COMMITTED'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE u.id=op.target_auth_user_id) THEN RAISE EXCEPTION 'AUTH_USER_STILL_EXISTS'; END IF;
  IF NOT op.storage_manifest_complete OR EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects o WHERE o.operation_id=p_operation_id AND NOT o.is_deleted)
    OR (SELECT count(*) FROM public.owner_member_erasure_storage_objects o WHERE o.operation_id=p_operation_id)<>op.storage_object_count
    OR op.deleted_storage_objects<>op.storage_object_count THEN RAISE EXCEPTION 'STORAGE_ERASURE_INCOMPLETE'; END IF;
  UPDATE public.owner_member_erasure_operations SET status='complete',completed_at=clock_timestamp(),
    deleted_auth_users=1,target_member_id=NULL,target_auth_user_id=NULL,
    result=result||jsonb_build_object('ok',true,'status','complete','deleted',jsonb_build_object('database_rows',deleted_database_rows,'storage_objects',deleted_storage_objects,'auth_users',1))
    WHERE operation_id=p_operation_id RETURNING result INTO op.result;
  DELETE FROM public.owner_member_erasure_storage_objects WHERE operation_id=p_operation_id;
  RETURN op.result;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_mark_auth_deleted(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_mark_auth_deleted(UUID) TO service_role;

CREATE FUNCTION public.owner_member_erasure_operation_work(p_operation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ONLY'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true,'operation_id',op.operation_id,'status',op.status,'stage',op.status,
    'member_id',op.target_member_id,'auth_user_id',op.target_auth_user_id,
    'database_complete',op.status IN ('database_erased','complete'),
    'storage_complete',op.status='complete' OR (op.status='database_erased' AND op.storage_manifest_complete
      AND NOT EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND NOT so.is_deleted)
      AND (SELECT count(*) FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id)=op.storage_object_count),
    'storage_object_count',op.storage_object_count,'deleted_storage_objects',op.deleted_storage_objects,
    'storage_manifest_complete',op.storage_manifest_complete,'auth_deleted',op.deleted_auth_users=1,
    'auth_complete',op.deleted_auth_users=1,
    'retryable',op.status IN ('database_erased','complete'));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_operation_work(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_operation_work(UUID) TO service_role;

CREATE FUNCTION public.owner_member_erasure_status(p_operation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.owner_member_erasure_operations;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR NOT public.is_owner() THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=p_operation_id AND owner_auth_user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'ERASURE_OPERATION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true,'operation_id',op.operation_id,
    'status',CASE WHEN op.status='complete' THEN 'complete' WHEN op.status='previewed' THEN 'pending' ELSE 'partial' END,
    'stage',op.status,'retryable',op.status IN ('database_erased','complete'),
    'database_complete',op.status IN ('database_erased','complete'),
    'storage_complete',op.status='complete' OR (op.status='database_erased' AND op.storage_manifest_complete
      AND NOT EXISTS(SELECT 1 FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id AND NOT so.is_deleted)
      AND (SELECT count(*) FROM public.owner_member_erasure_storage_objects so WHERE so.operation_id=p_operation_id)=op.storage_object_count),
    'auth_complete',op.deleted_auth_users=1,
    'expires_at',op.expires_at,'storage_object_count',op.storage_object_count,'deleted_storage_objects',op.deleted_storage_objects,
    'deleted_database_rows',op.deleted_database_rows,'deleted_auth_users',op.deleted_auth_users,
    'deleted',jsonb_build_object('database_rows',op.deleted_database_rows,'storage_objects',op.deleted_storage_objects,'auth_users',op.deleted_auth_users));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_member_erasure_status(UUID) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_member_erasure_status(UUID) TO authenticated;

COMMIT;
