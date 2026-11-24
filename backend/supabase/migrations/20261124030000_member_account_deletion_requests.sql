-- =====================================================
-- طلبات حذف الحساب نهائيًا (عضو يطلب / الأدمن يوافق)
-- =====================================================
-- العضو يطلب الحذف من الإعدادات، والطلب يظهر للأدمن للمراجعة. عند الموافقة
-- يُنفَّذ نفس مسار المحو المعتمد في owner_member_erasure (حذف كل الصفوف
-- المرتبطة بالعضوية والهوية) ثم يحذف الـ Edge Function حساب الدخول وملفات
-- التخزين. الرفض يحفظ سببًا يظهر للعضو.
-- =====================================================

-- 1) جدول الطلبات -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_deletion_requests (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  member_id BIGINT REFERENCES public.members(id) ON DELETE SET NULL,
  auth_user_id UUID,
  member_name TEXT NOT NULL,
  member_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT member_deletion_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  member_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  decision_note TEXT,
  completed_at TIMESTAMPTZ,
  CONSTRAINT member_deletion_requests_note_length CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  CONSTRAINT member_deletion_requests_reason_length CHECK (member_reason IS NULL OR char_length(member_reason) <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS member_deletion_requests_one_pending
  ON public.member_deletion_requests (member_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS member_deletion_requests_status_idx
  ON public.member_deletion_requests (status, requested_at DESC);

ALTER TABLE public.member_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_deletion_requests FROM PUBLIC, anon, authenticated, service_role;

-- ربط عملية المحو بالطلب (يستخدمه حارس السجلات أحادية الإضافة).
ALTER TABLE public.owner_member_erasure_operations
  ADD COLUMN IF NOT EXISTS deletion_request_id UUID REFERENCES public.member_deletion_requests(id) ON DELETE SET NULL;

-- 2) الحارس: يسمح بحذف هوية العضو أثناء تنفيذ طلب حذف معتمد ---------------
CREATE OR REPLACE FUNCTION public.owner_member_erasure_append_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.owner_member_erasure_operations; ctx UUID; oldj JSONB; newj JSONB; allow_fields TEXT[] := ARRAY[]::text[]; subject_fields TEXT[] := ARRAY[]::text[]; v_request_ok BOOLEAN := FALSE; v_op_found BOOLEAN := FALSE;
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'APPEND_ONLY_TRUNCATE_FORBIDDEN' USING ERRCODE='55000'; END IF;
  BEGIN ctx := NULLIF(pg_catalog.current_setting('phantoms.owner_member_erasure_operation',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN ctx := NULL; END;
  SELECT * INTO op FROM public.owner_member_erasure_operations WHERE operation_id=ctx AND status='executing' FOR SHARE;
  v_op_found := FOUND;
  IF v_op_found AND op.deletion_request_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.member_deletion_requests r
      WHERE r.id = op.deletion_request_id
        AND r.status = 'approved'
        AND r.decided_by = auth.uid()
        AND r.member_id = op.target_member_id
        AND r.auth_user_id = op.target_auth_user_id
        AND (public.is_owner() OR public.has_admin_permission('members'))
    ) INTO v_request_ok;
  END IF;
  IF NOT v_op_found OR op.owner_auth_user_id IS DISTINCT FROM auth.uid()
     OR NOT (public.is_owner() OR v_request_ok)
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
REVOKE ALL ON FUNCTION public.owner_member_erasure_append_guard() FROM PUBLIC, anon, authenticated, service_role;

-- 3) العضو: إنشاء/إلغاء/قراءة طلبه ---------------------------------------
CREATE OR REPLACE FUNCTION public.request_member_deletion(p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member BIGINT; v_auth UUID; v_name TEXT; v_email TEXT; v_id UUID; v_pending UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT b.member_id INTO v_member FROM public.member_auth_bindings b
    WHERE b.auth_user_id = auth.uid() AND b.password_ready IS TRUE;
  IF v_member IS NULL THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  SELECT m.full_name, m.email INTO v_name, v_email FROM public.members m WHERE m.id = v_member FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF COALESCE(public.m_work_status(v_member), '') <> 'active' THEN RAISE EXCEPTION 'MEMBER_NOT_ACTIVE'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id = auth.uid() AND a.role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_CANNOT_DELETE_ACCOUNT';
  END IF;
  SELECT r.id INTO v_pending FROM public.member_deletion_requests r
    WHERE r.member_id = v_member AND r.status = 'pending' LIMIT 1;
  IF v_pending IS NOT NULL THEN RAISE EXCEPTION 'DELETION_REQUEST_EXISTS'; END IF;
  INSERT INTO public.member_deletion_requests (member_id, auth_user_id, member_name, member_email, member_reason)
    VALUES (v_member, auth.uid(), v_name, v_email, NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''))
    RETURNING id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION public.request_member_deletion(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_member_deletion(TEXT) TO authenticated;

-- حالة الطلب للعضو الحالي (pending/rejected/cancelled/completed)
CREATE OR REPLACE FUNCTION public.member_deletion_request_state()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member BIGINT; v_row public.member_deletion_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT b.member_id INTO v_member FROM public.member_auth_bindings b WHERE b.auth_user_id = auth.uid();
  IF v_member IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok', true, 'request', NULL); END IF;
  SELECT * INTO v_row FROM public.member_deletion_requests r
    WHERE r.member_id = v_member AND r.status IN ('pending', 'approved', 'rejected')
    ORDER BY r.requested_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', true, 'request', NULL); END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'request', pg_catalog.jsonb_build_object(
    'request_id', v_row.id, 'status', v_row.status, 'requested_at', v_row.requested_at,
    'decided_at', v_row.decided_at, 'decision_note', v_row.decision_note));
END;
$$;
REVOKE ALL ON FUNCTION public.member_deletion_request_state() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_deletion_request_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_member_deletion_request()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member BIGINT; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT b.member_id INTO v_member FROM public.member_auth_bindings b WHERE b.auth_user_id = auth.uid();
  IF v_member IS NULL THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  UPDATE public.member_deletion_requests r SET status = 'cancelled', decided_at = clock_timestamp()
    WHERE r.member_id = v_member AND r.status = 'pending' RETURNING r.id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_FOUND'; END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_member_deletion_request() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_member_deletion_request() TO authenticated;

-- 4) الأدمن: قائمة الطلبات + رفض + تنفيذ -------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_member_deletion_requests()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner() OR public.has_admin_permission('members')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'request_id', r.id, 'member_id', r.member_id, 'member_name', r.member_name,
      'member_email', r.member_email, 'status', r.status, 'member_reason', r.member_reason,
      'requested_at', r.requested_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note)
      ORDER BY r.requested_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.member_deletion_requests r
    WHERE r.status IN ('pending', 'approved', 'rejected')
      AND r.requested_at > clock_timestamp() - INTERVAL '120 days';
  RETURN pg_catalog.jsonb_build_object('ok', true, 'requests', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_member_deletion_requests() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_member_deletion_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_member_deletion(p_request_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.member_deletion_requests;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner() OR public.has_admin_permission('members')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.member_deletion_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_FOUND'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_PENDING'; END IF;
  UPDATE public.member_deletion_requests r
    SET status = 'rejected', decided_at = clock_timestamp(), decided_by = auth.uid(),
        decision_note = NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
    WHERE r.id = p_request_id;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reject_member_deletion(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_member_deletion(UUID, TEXT) TO authenticated;

-- تنفيذ الحذف: يحذف كل صفوف العضوية والهوية ثم يترك حساب الدخول للتخزين/GoTrue.
CREATE OR REPLACE FUNCTION public.member_deletion_admin_execute(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.member_deletion_requests; v_member BIGINT; v_auth UUID; v_operation UUID;
  v_deleted BIGINT := 0; v_changed BIGINT; v_successor BIGINT; v_found BOOLEAN; v_handover JSONB := '[]'::jsonb;
  v_name TEXT; r RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner() OR public.has_admin_permission('members')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO v_row FROM public.member_deletion_requests q WHERE q.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_FOUND'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_PENDING'; END IF;
  v_member := v_row.member_id; v_auth := v_row.auth_user_id;
  IF v_member IS NULL OR v_auth IS NULL THEN RAISE EXCEPTION 'DELETION_REQUEST_INCOMPLETE'; END IF;
  IF v_auth = auth.uid() THEN RAISE EXCEPTION 'SELF_DELETION_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.user_id = v_auth AND a.role = 'owner') THEN
    RAISE EXCEPTION 'OWNER_DELETION_FORBIDDEN';
  END IF;
  IF (SELECT count(*) FROM public.member_auth_bindings b WHERE b.member_id = v_member AND b.auth_user_id = v_auth) <> 1
     OR (SELECT count(*) FROM public.member_auth_bindings b WHERE b.auth_user_id = v_auth) <> 1 THEN
    RAISE EXCEPTION 'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS';
  END IF;
  SELECT m.full_name INTO v_name FROM public.members m WHERE m.id = v_member FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;

  -- الموافقة تُسجَّل أولًا حتى يراها حارس السجلات أحادية الإضافة داخل نفس المعاملة.
  UPDATE public.member_deletion_requests q
    SET status = 'approved', decided_at = clock_timestamp(), decided_by = auth.uid()
    WHERE q.id = p_request_id;

  v_operation := extensions.gen_random_uuid();
  INSERT INTO public.owner_member_erasure_operations (
    operation_id, owner_auth_user_id, target_member_id, target_auth_user_id, preview_token_hash,
    preview_fingerprint, expires_at, status, result, storage_object_count, storage_manifest_complete, deletion_request_id)
  VALUES (v_operation, auth.uid(), v_member, v_auth,
    pg_catalog.md5(v_operation::text) || pg_catalog.md5(v_member::text || v_auth::text),
    pg_catalog.md5(v_operation::text || ':request'),
    clock_timestamp() + INTERVAL '30 minutes', 'executing', '{}'::jsonb,
    (SELECT count(*) FROM storage.objects o WHERE o.owner_id = v_auth::text), TRUE, p_request_id);

  LOCK TABLE public.members, public.member_auth_bindings, public.member_password_invitations,
    public.member_password_audit, public.member_password_recovery_sessions, public.member_app_usage,
    public.member_registration_invites, public.notes, public.tasks, public.announcements,
    public.team_memberships, public.team_member_metrics, public.team_member_custom_field_values,
    public.announcement_recipients, public.team_access_audit, public.task_contribution_events,
    public.member_infinite_bonus_events, public.web_ideas, public.web_idea_contributors,
    public.web_projects, public.web_project_members, public.web_project_agreement_acceptances,
    public.web_project_consents, public.web_project_activity_logs, public.web_program_admin_audit,
    public.admin_accounts, public.team_admin_assignments IN SHARE ROW EXCLUSIVE MODE;

  PERFORM pg_catalog.set_config('phantoms.owner_member_erasure_operation', v_operation::text, true);

  -- إزالة معرّف العضو من حقول JSON فقط، دون المساس بباقي المحتوى.
  UPDATE public.tasks t SET assigned_to = CASE
      WHEN pg_catalog.jsonb_typeof(t.assigned_to) = 'array' THEN COALESCE((SELECT pg_catalog.jsonb_agg(e.value ORDER BY e.ordinality)
        FROM pg_catalog.jsonb_array_elements(t.assigned_to) WITH ORDINALITY e(value, ordinality)
        WHERE e.value #>> '{}' IS DISTINCT FROM v_member::text), '[]'::jsonb)
      ELSE t.assigned_to END,
    tracking = CASE WHEN pg_catalog.jsonb_typeof(t.tracking) = 'object' THEN t.tracking - v_member::text ELSE t.tracking END
  WHERE (pg_catalog.jsonb_typeof(t.assigned_to) = 'array' AND (t.assigned_to @> pg_catalog.jsonb_build_array(v_member) OR t.assigned_to @> pg_catalog.jsonb_build_array(v_member::text)))
     OR (pg_catalog.jsonb_typeof(t.tracking) = 'object' AND t.tracking ? v_member::text);

  UPDATE public.announcements a SET
    target_audience = CASE WHEN pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
      THEN pg_catalog.jsonb_set(a.target_audience, '{member_ids}', COALESCE((SELECT pg_catalog.jsonb_agg(e.value ORDER BY e.ordinality)
        FROM pg_catalog.jsonb_array_elements(a.target_audience -> 'member_ids') WITH ORDINALITY e(value, ordinality)
        WHERE e.value #>> '{}' IS DISTINCT FROM v_member::text), '[]'::jsonb), false) ELSE a.target_audience END,
    read_receipts = COALESCE(a.read_receipts, '{}'::jsonb) - v_member::text
  WHERE a.read_receipts ? v_member::text OR (pg_catalog.jsonb_typeof(a.target_audience -> 'member_ids') = 'array'
    AND (a.target_audience -> 'member_ids' @> pg_catalog.jsonb_build_array(v_member) OR a.target_audience -> 'member_ids' @> pg_catalog.jsonb_build_array(v_member::text)));

  -- السجلات أحادية الإضافة: تُحذف سجلات العضو نفسه ويُجهَّل الفاعل.
  DELETE FROM public.member_infinite_bonus_events WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.task_contribution_events WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  UPDATE public.task_contribution_events SET actor_user_id = NULL, actor_erased = TRUE WHERE actor_user_id = v_auth;
  UPDATE public.team_access_audit SET actor_user_id = NULL WHERE actor_user_id = v_auth;
  DELETE FROM public.team_access_audit WHERE member_id = v_member OR subject_user_id = v_auth;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  UPDATE public.web_program_admin_audit SET actor_auth_user_id = NULL WHERE actor_auth_user_id = v_auth;
  UPDATE public.web_program_admin_audit SET target_auth_user_id = NULL WHERE target_auth_user_id = v_auth;
  UPDATE public.web_project_activity_logs SET actor_auth_user_id = NULL WHERE actor_auth_user_id = v_auth;
  UPDATE public.web_project_activity_logs SET actor_member_id = NULL WHERE actor_member_id = v_member;
  UPDATE public.web_project_agreements SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_agreement_acceptances SET actor_auth_user_id = NULL WHERE actor_auth_user_id = v_auth;
  UPDATE public.web_project_consents SET actor_auth_user_id = NULL WHERE actor_auth_user_id = v_auth;
  UPDATE public.web_idea_reviews SET reviewer_auth_user_id = NULL WHERE reviewer_auth_user_id = v_auth;
  UPDATE public.web_project_milestones SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_milestone_dependencies SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_sprints SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_tasks SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_task_assignees SET assigned_by_auth_user_id = NULL WHERE assigned_by_auth_user_id = v_auth;
  UPDATE public.web_project_task_comments SET author_auth_user_id = NULL WHERE author_auth_user_id = v_auth;
  UPDATE public.web_resources SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  UPDATE public.web_project_resource_refs SET added_by_auth_user_id = NULL WHERE added_by_auth_user_id = v_auth;
  UPDATE public.web_project_integrations SET created_by_auth_user_id = NULL WHERE created_by_auth_user_id = v_auth;
  DELETE FROM public.web_project_agreement_acceptances WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.web_project_consents WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;

  -- ملكية العمل المشترك تنتقل تلقائيًا لأقرب عضو نشط، وإلا يُوقف الطلب.
  FOR r IN SELECT p.id, p.owner_member_id, p.name FROM public.web_projects p WHERE p.owner_member_id = v_member FOR UPDATE LOOP
    SELECT pm.member_id INTO v_successor FROM public.web_project_members pm
      JOIN public.members m ON m.id = pm.member_id
      WHERE pm.project_id = r.id AND pm.member_id <> v_member AND pm.status = 'active'
        AND pm.role IN ('lead', 'contributor') AND m.work_status = 'active'
      ORDER BY (pm.role = 'lead') DESC, pm.member_id LIMIT 1;
    IF v_successor IS NULL THEN RAISE EXCEPTION 'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR: web_projects:%', r.id; END IF;
    UPDATE public.web_projects SET owner_member_id = v_successor, updated_at = clock_timestamp() WHERE id = r.id;
    v_handover := v_handover || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind', 'web_project', 'id', r.id, 'name', r.name, 'successor_member_id', v_successor));
  END LOOP;
  FOR r IN SELECT i.id, i.title FROM public.web_ideas i WHERE i.submitted_by_member_id = v_member FOR UPDATE LOOP
    SELECT c.member_id INTO v_successor FROM public.web_idea_contributors c
      JOIN public.members m ON m.id = c.member_id
      WHERE c.idea_id = r.id AND c.member_id <> v_member AND m.work_status = 'active'
      ORDER BY c.member_id LIMIT 1;
    IF v_successor IS NULL THEN RAISE EXCEPTION 'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR: web_ideas:%', r.id; END IF;
    UPDATE public.web_ideas SET submitted_by_member_id = v_successor WHERE id = r.id;
    v_handover := v_handover || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind', 'web_idea', 'id', r.id, 'name', r.title, 'successor_member_id', v_successor));
  END LOOP;
  UPDATE public.web_projects SET lead_member_id = NULL WHERE lead_member_id = v_member;
  UPDATE public.web_projects SET origin_submitter_member_id = NULL WHERE origin_submitter_member_id = v_member;
  UPDATE public.web_ideas SET suggested_leader_member_id = NULL WHERE suggested_leader_member_id = v_member;

  -- الدعوات والصفوف الشخصية.
  UPDATE public.member_password_invitations SET created_by = NULL WHERE created_by = v_auth AND member_id <> v_member;
  UPDATE public.member_registration_invites SET created_by = NULL WHERE created_by = v_auth;
  UPDATE public.member_registration_invites SET registered_member_id = NULL WHERE registered_member_id = v_member;
  UPDATE public.member_password_audit SET actor_user_id = NULL WHERE actor_user_id = v_auth;
  DELETE FROM public.member_password_audit WHERE member_id = v_member OR invitation_id IN
    (SELECT id FROM public.member_password_invitations WHERE member_id = v_member);
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.member_password_recovery_sessions WHERE invitation_id IN
    (SELECT id FROM public.member_password_invitations WHERE member_id = v_member);
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.member_password_invitations WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.team_member_metrics WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.team_member_custom_field_values WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.announcement_recipients WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.team_memberships WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.team_admin_assignments WHERE user_id = v_auth;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.admin_accounts WHERE user_id = v_auth;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  UPDATE public.notes SET target_member_id = NULL, target_name = NULL WHERE target_member_id = v_member;
  DELETE FROM public.web_idea_contributors WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.web_project_task_assignees WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  UPDATE public.web_project_task_comments SET author_member_id = NULL, author_auth_user_id = NULL
    WHERE author_member_id = v_member OR author_auth_user_id = v_auth;
  DELETE FROM public.web_project_members WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.member_app_usage WHERE member_id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.member_auth_bindings WHERE member_id = v_member AND auth_user_id = v_auth;
  GET DIAGNOSTICS v_changed = ROW_COUNT; v_deleted := v_deleted + v_changed;
  DELETE FROM public.members WHERE id = v_member;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN RAISE EXCEPTION 'MEMBER_DELETION_DELETE_FAILED'; END IF;
  v_deleted := v_deleted + v_changed;

  IF EXISTS (SELECT 1 FROM public.member_auth_bindings b WHERE b.auth_user_id = v_auth)
     OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = v_member) THEN
    RAISE EXCEPTION 'DELETION_IDENTITY_RESIDUAL';
  END IF;

  -- فحص نهائي: أي عمود معرّف ما زال يشير للعضو أو لحساب الدخول يوقف العملية.
  FOR r IN SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN pg_catalog.pg_class cl ON cl.relname = c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = c.table_schema
    WHERE c.table_schema = 'public' AND c.table_name NOT IN ('owner_member_erasure_operations', 'member_deletion_requests')
      AND cl.relkind IN ('r', 'p') AND c.column_name = ANY(ARRAY[
        'member_id', 'target_member_id', 'source_member_id', 'registered_member_id', 'owner_member_id', 'lead_member_id',
        'origin_submitter_member_id', 'suggested_leader_member_id', 'submitted_by_member_id', 'reporter_member_id', 'author_member_id',
        'actor_member_id', 'created_by_member_id', 'updated_by_member_id', 'uploaded_by_member_id', 'reviewed_by_member_id',
        'auth_user_id', 'user_id', 'actor_user_id', 'subject_user_id', 'created_by', 'created_by_auth_user_id', 'updated_by',
        'reviewed_by_auth_user_id', 'rated_by', 'approved_by', 'added_by_auth_user_id', 'actor_auth_user_id', 'target_auth_user_id',
        'reviewer_auth_user_id', 'author_auth_user_id', 'assigned_by_auth_user_id', 'updated_by_auth_user_id'])
  LOOP
    IF r.data_type IN ('bigint', 'integer', 'smallint', 'numeric') THEN
      EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I = $1)', r.table_schema, r.table_name, r.column_name) INTO v_found USING v_member;
    ELSIF r.data_type = 'uuid' THEN
      EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I = $1)', r.table_schema, r.table_name, r.column_name) INTO v_found USING v_auth;
    ELSE
      EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I = $1 OR %I = $2)', r.table_schema, r.table_name, r.column_name, r.column_name) INTO v_found USING v_auth::text, v_member::text;
    END IF;
    IF v_found THEN RAISE EXCEPTION 'DELETION_IDENTIFIER_RESIDUAL: %.%.%', r.table_schema, r.table_name, r.column_name; END IF;
  END LOOP;
  FOR r IN SELECT c.table_schema, c.table_name, c.column_name FROM information_schema.columns c
    JOIN pg_catalog.pg_class cl ON cl.relname = c.table_name
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = c.table_schema
    WHERE c.table_schema = 'public' AND c.table_name NOT IN ('owner_member_erasure_operations', 'member_deletion_requests')
      AND cl.relkind IN ('r', 'p') AND c.data_type = 'jsonb'
  LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I t WHERE public.owner_member_erasure_json_has_identity(t.%I, $1, $2)', r.table_schema, r.table_name, r.column_name)
      INTO v_changed USING v_member, v_auth;
    IF v_changed > 0 THEN RAISE EXCEPTION 'DELETION_JSON_IDENTITY_RESIDUAL: %.%.%', r.table_schema, r.table_name, r.column_name; END IF;
  END LOOP;

  UPDATE public.owner_member_erasure_operations
    SET status = 'database_erased', deleted_database_rows = v_deleted,
        result = pg_catalog.jsonb_build_object('request_id', p_request_id, 'member_id', v_member, 'handover', v_handover)
    WHERE operation_id = v_operation;
  PERFORM pg_catalog.set_config('phantoms.owner_member_erasure_operation', '', true);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'request_id', p_request_id, 'member_id', v_member,
    'member_name', v_name, 'auth_user_id', v_auth, 'deleted_rows', v_deleted, 'handover', v_handover);
END;
$$;
REVOKE ALL ON FUNCTION public.member_deletion_admin_execute(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_deletion_admin_execute(UUID) TO authenticated;

-- ملفات التخزين المملوكة لحساب الدخول (تُحذف من الـ Edge Function عبر Storage API).
CREATE OR REPLACE FUNCTION public.member_deletion_storage_objects(p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner() OR public.has_admin_permission('members')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bucket_id', o.bucket_id, 'name', o.name) ORDER BY o.bucket_id, o.name), '[]'::jsonb)
    INTO v_rows FROM storage.objects o WHERE o.owner_id = p_auth_user_id::text;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'objects', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.member_deletion_storage_objects(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_deletion_storage_objects(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_deletion_mark_complete(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_owner() OR public.has_admin_permission('members')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.member_deletion_requests r
    SET status = 'completed', completed_at = clock_timestamp(), auth_user_id = NULL
    WHERE r.id = p_request_id AND r.status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_REQUEST_NOT_APPROVED'; END IF;
  -- إغلاق عملية المحو المرتبطة بالطلب حتى تبقى السجلات متسقة.
  UPDATE public.owner_member_erasure_operations o
    SET status = 'complete', completed_at = clock_timestamp(), deleted_auth_users = 1,
        target_member_id = NULL, target_auth_user_id = NULL
    WHERE o.deletion_request_id = p_request_id AND o.status = 'database_erased';
  RETURN pg_catalog.jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'completed');
END;
$$;
REVOKE ALL ON FUNCTION public.member_deletion_mark_complete(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_deletion_mark_complete(UUID) TO authenticated;

-- 5) مساعد صغير لحالة العضوية -------------------------------------------
CREATE OR REPLACE FUNCTION public.m_work_status(p_member_id BIGINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.work_status FROM public.members m WHERE m.id = p_member_id;
$$;
REVOKE ALL ON FUNCTION public.m_work_status(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
