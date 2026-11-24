-- Round 35 — الحذف النهائي لسجل العضو من طرف المالك.
--
-- المشكلة: الحذف العادي (DELETE على members) كان بيترفض لأن فيه قيود
-- ON DELETE RESTRICT على جداول مرتبطة بالعضو (دعوات كلمة المرور، اشتراكات
-- التيمات، استخدام التطبيق، مشاريع الويب)، وفيه جداول append-only بتمنع
-- تحديث مرجع العضو إلا داخل عملية إزالة معتمدة.
--
-- الحل: دالة واحدة للمالك بتحذف كل الصفوف اللي تخص العضو ده تحديدًا، وبعدين
-- السجل نفسه — كل ده في ترانزاكشن واحدة. الجداول المشتركة أو سجلات الآخرين
-- ما بتتلمسش خالص، والجداول append-only بتتنضف داخل سياق عملية إزالة مسجّلة
-- (نفس الحارس الموجود) فمفيش تعطيل لأي trigger.
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_delete_member(p_member_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_member RECORD;
  v_auth UUID;
  v_op UUID := pg_catalog.gen_random_uuid();
  v_result JSONB := '{}'::jsonb;
  n INTEGER;
BEGIN
  IF v_uid IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'FORBIDDEN: الحذف النهائي متاح للمالك فقط.';
  END IF;

  SELECT m.id, m.full_name, m.email
    INTO v_member
    FROM public.members AS m
   WHERE m.id = p_member_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: العضو غير موجود.';
  END IF;

  SELECT b.auth_user_id INTO v_auth
    FROM public.member_auth_bindings AS b
   WHERE b.member_id = p_member_id
   LIMIT 1;

  IF v_auth IS NOT NULL AND v_auth = v_uid THEN
    RAISE EXCEPTION 'SELF_DELETE_FORBIDDEN: مش مسموح تحذف سجل العضو المرتبط بحسابك.';
  END IF;

  -- سياق عملية إزالة معتمدة: الحارس على الجداول append-only بيسمح بإزالة
  -- صفوف الهدف فقط، وده بيسجّل العملية في نفس الجدول اللي بيستخدمه مسار
  -- الحذف الكامل، فمفيش trigger بيتعطّل ولا بيانات حد تاني بتتأثر.
  INSERT INTO public.owner_member_erasure_operations (
    operation_id, owner_auth_user_id, target_member_id, target_auth_user_id,
    preview_token_hash, preview_fingerprint, expires_at, status
  ) VALUES (
    v_op, v_uid, p_member_id, v_auth,
    pg_catalog.encode(extensions.digest('owner-direct-delete:' || v_op::text, 'sha256'), 'hex'),
    public.owner_member_erasure_fingerprint(p_member_id, v_auth),
    now() + INTERVAL '1 hour',
    'executing'
  );
  PERFORM pg_catalog.set_config('phantoms.owner_member_erasure_operation', v_op::text, true);

  -- 1) الجداول append-only: بنشيل صفوف العضو نفسه بس
  DELETE FROM public.team_access_audit WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('team_access_audit', n);
  DELETE FROM public.task_contribution_events WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('task_contribution_events', n);
  -- سجل البونص عليه حارس immutability خاص بيه ومالوش FK على members،
  -- فبنسيبه زي ما هو (سجل تاريخي) ومش بنلمسه.

  -- 2) الدعوات وجلسات الاسترجاع المرتبطة بيها
  DELETE FROM public.member_password_recovery_sessions
   WHERE invitation_id IN (SELECT id FROM public.member_password_invitations WHERE member_id = p_member_id);
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('member_password_recovery_sessions', n);
  DELETE FROM public.member_password_invitations WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('member_password_invitations', n);

  -- 3) الصفوف اللي معناها العضو نفسه
  DELETE FROM public.member_app_usage WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('member_app_usage', n);
  DELETE FROM public.team_memberships WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('team_memberships', n);

  -- 4) مشاريع الويب: بنفك الربط بدل ما نمسح شغل التيم
  DELETE FROM public.web_idea_contributors WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('web_idea_contributors', n);
  DELETE FROM public.web_project_members WHERE member_id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_result := v_result || pg_catalog.jsonb_build_object('web_project_members', n);
  UPDATE public.web_ideas SET submitted_by_member_id = NULL WHERE submitted_by_member_id = p_member_id;
  UPDATE public.web_ideas SET suggested_leader_member_id = NULL WHERE suggested_leader_member_id = p_member_id;
  UPDATE public.web_projects SET origin_submitter_member_id = NULL WHERE origin_submitter_member_id = p_member_id;
  UPDATE public.web_projects SET lead_member_id = NULL WHERE lead_member_id = p_member_id;
  UPDATE public.web_projects SET owner_member_id = NULL WHERE owner_member_id = p_member_id;

  -- 5) السجل نفسه — الباقي بيتشال أو بيتفك أوتوماتيك بالـ FK actions
  DELETE FROM public.members WHERE id = p_member_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'MEMBER_DELETE_FAILED: سجل العضو ما اتشالش.';
  END IF;

  v_result := v_result || pg_catalog.jsonb_build_object('member', 1, 'member_id', p_member_id, 'full_name', v_member.full_name);

  UPDATE public.owner_member_erasure_operations
     SET status = 'complete',
         target_member_id = NULL,
         target_auth_user_id = NULL,
         completed_at = now(),
         deleted_database_rows = COALESCE((SELECT sum(value::bigint) FROM pg_catalog.jsonb_each_text(v_result) WHERE key <> 'full_name' AND key <> 'member_id'), 0),
         result = pg_catalog.jsonb_build_object('mode', 'owner_direct_delete', 'member_id', p_member_id, 'counts', v_result)
   WHERE operation_id = v_op;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'member_id', p_member_id, 'counts', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_delete_member(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_delete_member(BIGINT) TO authenticated;

COMMIT;
