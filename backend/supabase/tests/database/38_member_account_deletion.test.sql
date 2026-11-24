-- Disposable, rollback-only fixture for member-initiated account deletion.
-- يغطي: إنشاء الطلب، منع التكرار، صلاحيات الأدمن، الرفض بسبب، والموافقة
-- التي تحذف كل صفوف العضوية ثم تعلّم الطلب مكتمل. الحذف الفعلي لحساب الدخول
-- وملفات التخزين يتم في الـ Edge Function (GoTrue/Storage API) خارج SQL.
BEGIN;
\set ON_ERROR_STOP on
\ir _helpers.psql
SELECT plan(1);
DO $$
DECLARE
  v_owner_auth UUID := '61111111-1111-4111-8111-111111111111';
  v_member_auth UUID := '62222222-2222-4222-8222-222222222222';
  v_second_auth UUID := '63333333-3333-4333-8333-333333333333';
  v_owner_member BIGINT;
  v_member BIGINT;
  v_second_member BIGINT;
  v_permissions JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
  v_state JSONB;
  v_created JSONB;
  v_request_id UUID;
  v_rejected JSONB;
  v_executed JSONB;
  v_blocked BOOLEAN;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES
    (v_owner_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-owner@example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    (v_member_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-member@example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    (v_second_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-second@example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('deletion-owner@example.invalid','Synthetic Deletion Owner',0) RETURNING id INTO v_owner_member;
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('deletion-member@example.invalid','Synthetic Deletion Member',0) RETURNING id INTO v_member;
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('deletion-second@example.invalid','Synthetic Deletion Second',0) RETURNING id INTO v_second_member;
  INSERT INTO public.admin_accounts(user_id,role,permissions) VALUES(v_owner_auth,'owner',v_permissions);
  INSERT INTO public.member_auth_bindings(member_id,auth_user_id,normalized_email,password_ready)
    VALUES(v_owner_member,v_owner_auth,'deletion-owner@example.invalid',false),
          (v_member,v_member_auth,'deletion-member@example.invalid',true),
          (v_second_member,v_second_auth,'deletion-second@example.invalid',true);
  INSERT INTO public.member_app_usage(member_id,last_app_version,last_app_build,platform)
    VALUES(v_member,'1.0.0','1','android');

  -- 1) جدول الطلبات محمي: RLS مفعّل ولا صلاحيات مباشرة لأي دور عميل.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.member_deletion_requests'::regclass) THEN
    RAISE EXCEPTION 'DELETION_REQUESTS_RLS_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='member_deletion_requests'
      AND grantee IN ('anon','authenticated','service_role')
  ) THEN
    RAISE EXCEPTION 'DELETION_REQUESTS_CLIENT_GRANTS_PRESENT';
  END IF;

  -- 2) العضو ينشئ طلبًا، والحالة تظهر له.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_member_auth,'email','deletion-member@example.invalid',
    'role','authenticated','aud','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_member_auth::text,true);
  v_created := public.request_member_deletion('سبب اختباري');
  IF (v_created->>'status') IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  v_request_id := (v_created->>'request_id')::uuid;
  v_state := public.member_deletion_request_state();
  IF (v_state->'request'->>'request_id')::uuid IS DISTINCT FROM v_request_id THEN
    RAISE EXCEPTION 'MEMBER_STATE_MISSING_REQUEST';
  END IF;

  -- 3) طلب مكرر مرفوض، والعضو لا يصل لقائمة الأدمن.
  v_blocked := FALSE;
  BEGIN
    PERFORM public.request_member_deletion('تكرار');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := position('DELETION_REQUEST_EXISTS' in SQLERRM) > 0;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'DUPLICATE_REQUEST_ALLOWED'; END IF;
  v_blocked := FALSE;
  BEGIN
    PERFORM public.admin_list_member_deletion_requests();
  EXCEPTION WHEN OTHERS THEN
    v_blocked := position('FORBIDDEN' in SQLERRM) > 0;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'MEMBER_REACHED_ADMIN_QUEUE'; END IF;

  -- 4) المالك يرفض بسبب، والعضو يقرأ سبب الرفض.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','deletion-owner@example.invalid',
    'role','authenticated','aud','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner_auth::text,true);
  v_rejected := public.admin_reject_member_deletion(v_request_id,'محتاجينك الفترة الجاية');
  IF (v_rejected->>'status') IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'REJECT_NOT_APPLIED'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_member_auth,'email','deletion-member@example.invalid',
    'role','authenticated','aud','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_member_auth::text,true);
  v_state := public.member_deletion_request_state();
  IF (v_state->'request'->>'status') IS DISTINCT FROM 'rejected'
     OR (v_state->'request'->>'decision_note') IS DISTINCT FROM 'محتاجينك الفترة الجاية' THEN
    RAISE EXCEPTION 'MEMBER_DID_NOT_SEE_REJECTION';
  END IF;

  -- 5) طلب جديد ثم موافقة المالك: كل صفوف العضوية تُحذف والطلب يكتمل.
  v_created := public.request_member_deletion(NULL);
  v_request_id := (v_created->>'request_id')::uuid;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','deletion-owner@example.invalid',
    'role','authenticated','aud','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner_auth::text,true);
  v_executed := public.member_deletion_admin_execute(v_request_id);
  IF (v_executed->>'auth_user_id')::uuid IS DISTINCT FROM v_member_auth THEN
    RAISE EXCEPTION 'EXECUTION_TARGET_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE id=v_member)
     OR EXISTS (SELECT 1 FROM public.member_auth_bindings WHERE member_id=v_member OR auth_user_id=v_member_auth)
     OR EXISTS (SELECT 1 FROM public.member_app_usage WHERE member_id=v_member) THEN
    RAISE EXCEPTION 'MEMBER_ROWS_RESIDUAL';
  END IF;
  IF (SELECT count(*) FROM public.members WHERE id=v_second_member) <> 1
     OR (SELECT count(*) FROM public.member_auth_bindings WHERE member_id=v_second_member) <> 1 THEN
    RAISE EXCEPTION 'OTHER_MEMBER_WAS_TOUCHED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_deletion_requests WHERE id=v_request_id AND status='approved') THEN
    RAISE EXCEPTION 'REQUEST_NOT_APPROVED_DURING_EXECUTION';
  END IF;
  PERFORM public.member_deletion_mark_complete(v_request_id);
  IF NOT EXISTS (SELECT 1 FROM public.member_deletion_requests WHERE id=v_request_id AND status='completed') THEN
    RAISE EXCEPTION 'REQUEST_NOT_COMPLETED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.owner_member_erasure_operations
                 WHERE deletion_request_id=v_request_id AND status='complete' AND target_member_id IS NULL) THEN
    RAISE EXCEPTION 'ERASURE_OPERATION_NOT_CLOSED';
  END IF;

  -- 6) الحارس يمنع أي تعديل على السجلات أحادية الإضافة من غير عملية تنفيذ.
  INSERT INTO public.member_infinite_bonus_events(member_id,member_name,member_email,enabled,reason,actor_user_id,actor_email)
    VALUES(v_second_member,'Synthetic Deletion Second','deletion-second@example.invalid',true,'fixture',v_owner_auth,'deletion-owner@example.invalid');
  PERFORM set_config('phantoms.owner_member_erasure_operation','',true);
  v_blocked := FALSE;
  BEGIN
    UPDATE public.member_infinite_bonus_events SET reason='tampered' WHERE member_id=v_second_member;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE; -- أي حارس (صفّي أو على مستوى الجملة) كفاية لمنع التعديل
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'APPEND_ONLY_GUARD_BYPASSED'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_infinite_bonus_events WHERE member_id=v_second_member AND reason='tampered') THEN
    RAISE EXCEPTION 'APPEND_ONLY_ROW_CHANGED';
  END IF;
END;
$$;
SELECT pass('member deletion requests: request, duplicate block, admin-only queue, rejection note, approved erasure, append-only guard');
SELECT * FROM finish();
ROLLBACK;
