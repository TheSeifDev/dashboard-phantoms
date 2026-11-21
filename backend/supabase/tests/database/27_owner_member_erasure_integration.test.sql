-- Disposable, rollback-only integration fixture for Owner member/Auth erasure.
-- The exact Storage/Auth API effects below are explicitly simulated with local
-- fixture SQL; this is NOT evidence of a live GoTrue or Supabase Storage run.
BEGIN;
\set ON_ERROR_STOP on
\ir _helpers.psql
SELECT plan(1);

DO $$
DECLARE
  v_owner_auth UUID := '11111111-1111-4111-8111-111111111111';
  v_target_auth UUID := '22222222-2222-4222-8222-222222222222';
  v_successor_auth UUID := '33333333-3333-4333-8333-333333333333';
  v_session UUID := '44444444-4444-4444-8444-444444444444';
  v_owner_member BIGINT;
  v_target_member BIGINT;
  v_successor_member BIGINT;
  v_team UUID;
  v_project UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_idea UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_web_task UUID;
  v_task BIGINT;
  v_target_invitation UUID := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_other_invitation UUID := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_preview JSONB;
  v_preview_token TEXT;
  v_operation UUID;
  v_assignments JSONB;
  v_storage_page JSONB;
  v_store_result JSONB;
  v_pending JSONB;
  v_marked JSONB;
  v_db_result JSONB;
  v_status JSONB;
  v_invalid_successor_blocked BOOLEAN := FALSE;
  v_storage_reference_blockers JSONB;
  v_collision_member BIGINT;
  v_collision_auth UUID := '55555555-5555-4555-8555-555555555555';
  v_collision_inv UUID := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_collision_preview JSONB;
  v_bonus_blocker_preview JSONB;
  v_permissions JSONB := '{"dashboard":true,"members":true,"tasks":true,"ranking":true,"notes":true,"announcements":true,"whatsapp":true,"ai_assistant":true,"web_projects":true}'::jsonb;
BEGIN
  -- Synthetic Auth users use reserved example.invalid addresses and no password.
  INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES
    (v_owner_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@erasure-test.example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    (v_target_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','target@erasure-test.example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
    (v_successor_auth,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','successor@erasure-test.example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  INSERT INTO auth.sessions(id,user_id,not_after) VALUES(v_session,v_target_auth,now()+interval '1 day');

  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('owner@erasure-test.example.invalid','Synthetic Owner',0) RETURNING id INTO v_owner_member;
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('target@erasure-test.example.invalid','Synthetic Target',0) RETURNING id INTO v_target_member;
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('successor@erasure-test.example.invalid','Synthetic Successor',0) RETURNING id INTO v_successor_member;
  INSERT INTO public.admin_accounts(user_id,role,permissions)
    VALUES(v_owner_auth,'owner',v_permissions),(v_target_auth,'admin',v_permissions);
  INSERT INTO public.member_auth_bindings(member_id,auth_user_id,normalized_email,password_ready)
    VALUES(v_owner_member,v_owner_auth,'owner@erasure-test.example.invalid',false),
          (v_target_member,v_target_auth,'target@erasure-test.example.invalid',true),
          (v_successor_member,v_successor_auth,'successor@erasure-test.example.invalid',true);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','owner@erasure-test.example.invalid',
    'role','authenticated','aud','authenticated','session_id',v_session)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner_auth::text,true);

  -- Self-Owner protection is enforced by the canonical exact binding, not name/email matching.
  BEGIN
    PERFORM public.owner_member_erasure_preview(v_owner_member);
    RAISE EXCEPTION 'TEST_EXPECTED_SELF_OWNER_PROTECTION';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT IN ('SELF_ERASURE_FORBIDDEN','PRIMARY_OWNER_ERASURE_FORBIDDEN') THEN RAISE; END IF;
  END;

  INSERT INTO public.teams(slug,name,created_by)
    VALUES('erasure-test-team','Synthetic Shared Team',v_owner_auth) RETURNING id INTO v_team;
  INSERT INTO public.team_memberships(team_id,member_id,status,created_by,approved_at,approved_by)
    VALUES(v_team,v_target_member,'active',v_owner_auth,now(),v_owner_auth),
          (v_team,v_successor_member,'active',v_owner_auth,now(),v_owner_auth);
  INSERT INTO public.team_access_audit(team_id,actor_user_id,action,subject_user_id,member_id,details)
    VALUES(v_team,v_target_auth,'member_added',v_successor_auth,v_successor_member,'{}'::jsonb),
          (v_team,v_successor_auth,'membership_removed',v_target_auth,v_target_member,'{}'::jsonb);

  INSERT INTO public.web_projects(id,slug,name,short_description,status,owner_member_id,lead_member_id,created_by_auth_user_id)
    VALUES(v_project,'erasure-test-project','Synthetic Shared Project','Local erasure test','proposed',v_target_member,NULL,v_owner_auth);
  INSERT INTO public.web_project_agreements(project_id,version,ownership_model,license_name,created_by_auth_user_id)
    VALUES(v_project,1,'joint','undetermined',v_target_auth);
  INSERT INTO public.web_project_members(project_id,member_id,role,status,accepted_agreement_version,agreement_accepted_at,added_by_auth_user_id)
    VALUES(v_project,v_target_member,'contributor','pending',NULL,NULL,v_owner_auth),
          (v_project,v_successor_member,'lead','pending',NULL,NULL,v_owner_auth);
  INSERT INTO public.web_project_agreement_acceptances(project_id,member_id,agreement_version,actor_auth_user_id)
    VALUES(v_project,v_target_member,1,v_target_auth),(v_project,v_successor_member,1,v_owner_auth);
  UPDATE public.web_project_members SET status='active',accepted_agreement_version=1,agreement_accepted_at=now()
    WHERE project_id=v_project;
  UPDATE public.web_projects SET lead_member_id=v_successor_member,status='active' WHERE id=v_project;
  INSERT INTO public.web_ideas(id,title,short_description,submitted_by_member_id)
    VALUES(v_idea,'Synthetic shared idea','Local erasure test',v_target_member);
  INSERT INTO public.web_idea_contributors(idea_id,member_id,responsibility)
    VALUES(v_idea,v_target_member,'Target contributor'),(v_idea,v_successor_member,'Surviving contributor');

  INSERT INTO public.web_project_activity_logs(project_id,actor_auth_user_id,actor_member_id,action,entity_type,details)
    VALUES(v_project,v_target_auth,v_target_member,'fixture_actor','test','{}'::jsonb);
  INSERT INTO public.web_project_tasks(id,project_id,reporter_member_id,title,created_by_auth_user_id)
    VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',v_project,v_successor_member,'Synthetic task',v_target_auth)
    RETURNING id INTO v_web_task;
  INSERT INTO public.web_project_task_assignees(project_id,task_id,member_id,is_primary,assigned_by_auth_user_id)
    VALUES(v_project,v_web_task,v_target_member,false,v_target_auth),
          (v_project,v_web_task,v_successor_member,true,v_target_auth);
  INSERT INTO public.web_project_task_comments(project_id,task_id,author_member_id,author_auth_user_id,body)
    VALUES(v_project,v_web_task,v_target_member,v_target_auth,'Shared work comment fixture');
  INSERT INTO public.web_project_consents(project_id,member_id,agreement_version,consent_type,granted,actor_auth_user_id)
    VALUES(v_project,v_target_member,1,'public_showcase',false,v_target_auth);

  INSERT INTO public.tasks(title,assigned_to,tracking)
    VALUES('Synthetic shared task',jsonb_build_array(v_target_member,v_successor_member),
      jsonb_build_object(v_target_member::text,jsonb_build_object('status','approved'),
        v_successor_member::text,jsonb_build_object('status','submitted')))
    RETURNING id INTO v_task;
  INSERT INTO public.task_contribution_events(task_id,member_id,event_type,occurred_at,actor_user_id,provenance)
    VALUES(v_task,v_target_member,'approved',now(),v_target_auth,'live_transition'),
          (v_task,v_successor_member,'approved',now(),v_target_auth,'live_transition');
  INSERT INTO public.member_infinite_bonus_events(member_id,member_name,member_email,enabled,reason,actor_user_id,actor_email)
    VALUES(v_target_member,'Synthetic Target','target@erasure-test.example.invalid',true,'fixture',v_target_auth,'target@erasure-test.example.invalid');
  INSERT INTO public.announcements(title,content,target_audience,read_receipts,created_by)
    VALUES('Synthetic announcement','Shared announcement',
      jsonb_build_object('type','members','member_ids',jsonb_build_array(v_target_member,v_successor_member)),
      jsonb_build_object(v_target_member::text,true,v_successor_member::text,true),'fixture');
  INSERT INTO public.notes(text,author,author_role,date,target_member_id,target_name)
    VALUES('Synthetic note','fixture','admin','2026-11-21',v_target_member,'Synthetic Target');

  INSERT INTO public.member_password_invitations(id,token_hash,member_id,normalized_email,purpose,expires_at,created_by,expected_auth_user_id,status)
    VALUES(v_target_invitation,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',v_target_member,
      'target@erasure-test.example.invalid','enroll',now()+interval '1 day',v_target_auth,v_target_auth,'pending'),
      (v_other_invitation,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',v_successor_member,
      'successor@erasure-test.example.invalid','enroll',now()+interval '1 day',v_target_auth,NULL,'pending');
  INSERT INTO public.member_password_recovery_sessions(session_id,invitation_id) VALUES(v_session,v_target_invitation);
  INSERT INTO public.member_password_audit(invitation_id,member_id,action,actor_user_id,details)
    VALUES(v_target_invitation,v_target_member,'issued',v_target_auth,'{}'::jsonb);

  INSERT INTO storage.buckets(id,name) VALUES('erasure-test-bucket','erasure-test-bucket');
  INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
    VALUES('erasure-test-bucket','target/private-fixture.txt',v_target_auth::text,'{}'::jsonb),
          ('erasure-test-bucket','successor/preserved-fixture.txt',v_successor_auth::text,'{}'::jsonb);

  -- Shared-project URLs and JSON documents referencing a target-owned object block erasure.
  UPDATE public.web_projects SET logo_url='https://example.invalid/storage/v1/object/public/erasure-test-bucket/target/private-fixture.txt'
    WHERE id=v_project;
  UPDATE public.web_ideas SET supporting_documents=jsonb_build_array(jsonb_build_object(
      'url','https://example.invalid/storage/v1/object/public/erasure-test-bucket/target/private-fixture.txt'))
    WHERE id=v_idea;
  v_storage_reference_blockers := public.owner_member_erasure_blockers(v_target_member,v_target_auth);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_storage_reference_blockers) b
      WHERE b->>'code'='shared_storage_reference' AND b->>'table'='web_projects' AND b->>'column'='logo_url')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_storage_reference_blockers) b
      WHERE b->>'code'='shared_storage_reference' AND b->>'table'='web_ideas' AND b->>'column'='supporting_documents') THEN
    RAISE EXCEPTION 'SHARED_STORAGE_REFERENCE_NOT_BLOCKED: %',v_storage_reference_blockers;
  END IF;
  UPDATE public.web_projects SET logo_url=NULL WHERE id=v_project;
  UPDATE public.web_ideas SET supporting_documents='[]'::jsonb WHERE id=v_idea;

  -- Immutable bonus attribution for another member cannot be detached safely.
  BEGIN
    INSERT INTO public.member_infinite_bonus_events(member_id,member_name,member_email,enabled,reason,actor_user_id,actor_email)
      VALUES(v_successor_member,'Synthetic Successor','successor@erasure-test.example.invalid',true,'fixture',v_target_auth,'target@erasure-test.example.invalid');
    v_bonus_blocker_preview := public.owner_member_erasure_preview(v_target_member);
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_bonus_blocker_preview->'preview'->'blockers') b
      WHERE b->>'code'='append_only_actor_reference' AND b->>'table'='member_infinite_bonus_events') THEN
      RAISE EXCEPTION 'APPEND_ONLY_BONUS_ACTOR_REFERENCE_NOT_BLOCKED';
    END IF;
    RAISE EXCEPTION 'ROLLBACK_EXPECTED_BONUS_BLOCKER_FIXTURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='ROLLBACK_EXPECTED_BONUS_BLOCKER_FIXTURE' THEN NULL; ELSE RAISE; END IF;
  END;

  -- A reference from another member's invitation to the target Auth UUID blocks completely.
  v_preview := public.owner_member_erasure_preview(v_target_member);
  IF v_preview->>'ok' IS DISTINCT FROM 'true'
     OR jsonb_array_length(v_preview->'preview'->'blockers')<>0
     OR (v_preview->'preview'->>'auth_user_id')::uuid IS DISTINCT FROM v_target_auth
     OR (v_preview->'preview'->>'storage_object_count')::integer<>1 THEN
    RAISE EXCEPTION 'UNEXPECTED_SAFE_FIXTURE_PREVIEW: %',v_preview;
  END IF;
  v_operation := (v_preview->'preview'->>'operation_id')::uuid;
  v_preview_token := v_preview->'preview'->>'preview_token';
  v_assignments := jsonb_build_object(
    'web_projects.owner_member_id:'||v_project::text,v_successor_member,
    'web_ideas.submitted_by_member_id:'||v_idea::text,v_successor_member);

  -- Capture the exact Storage inventory through service-role RPCs. No SQL Storage delete occurs here.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  v_storage_page := public.owner_member_erasure_storage_candidates(v_operation,NULL,500);
  IF v_storage_page->>'scope_verified'<>'true' OR jsonb_array_length(v_storage_page->'objects')<>1 THEN
    RAISE EXCEPTION 'STORAGE_CANDIDATES_SCOPE_FAILURE: %',v_storage_page;
  END IF;
  v_store_result := public.owner_member_erasure_store_storage_batch(v_operation,
    (SELECT jsonb_agg(jsonb_build_object('bucket_id',x->>'bucket_id','name',x->>'name'))
       FROM jsonb_array_elements(v_storage_page->'objects') x));
  IF (v_store_result->>'stored_count')::integer<>1 OR v_store_result->>'complete'<>'false' THEN
    RAISE EXCEPTION 'STORAGE_MANIFEST_BATCH_FAILURE: %',v_store_result;
  END IF;
  v_store_result := public.owner_member_erasure_store_storage_batch(v_operation,
    (SELECT jsonb_agg(jsonb_build_object('bucket_id',x->>'bucket_id','name',x->>'name'))
       FROM jsonb_array_elements(v_storage_page->'objects') x));
  IF (v_store_result->>'stored_count')::integer<>1 OR v_store_result->>'manifest_count'<>'1' THEN
    RAISE EXCEPTION 'STORAGE_MANIFEST_RETRY_NOT_IDEMPOTENT: %',v_store_result;
  END IF;
  v_store_result := public.owner_member_erasure_store_storage_batch(v_operation,'[]'::jsonb);
  IF v_store_result->>'complete'<>'true' OR v_store_result->>'manifest_count'<>'1' THEN
    RAISE EXCEPTION 'STORAGE_MANIFEST_SEAL_FAILURE: %',v_store_result;
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','owner@erasure-test.example.invalid',
    'role','authenticated','aud','authenticated','session_id',v_session)::text,true);

  -- An ineligible successor fails before any committed mutation; the same preview remains usable.
  BEGIN
    PERFORM public.owner_member_erasure_execute_database(v_operation,v_target_member,v_target_auth,
      jsonb_build_object('web_projects.owner_member_id:'||v_project::text,v_owner_member,
        'web_ideas.submitted_by_member_id:'||v_idea::text,v_successor_member),
      v_preview_token,'ERASE '||v_target_member::text||' '||left(v_target_auth::text,8));
    RAISE EXCEPTION 'TEST_EXPECTED_INVALID_SUCCESSOR';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='INVALID_SUCCESSOR_MEMBER' THEN v_invalid_successor_blocked:=true;
    ELSIF SQLERRM='TEST_EXPECTED_INVALID_SUCCESSOR' THEN RAISE;
    ELSE RAISE; END IF;
  END;
  IF NOT v_invalid_successor_blocked OR NOT EXISTS(SELECT 1 FROM public.members WHERE id=v_target_member)
     OR NOT ((SELECT assigned_to FROM public.tasks WHERE title='Synthetic shared task') @> jsonb_build_array(v_target_member))
     OR NOT EXISTS(SELECT 1 FROM public.task_contribution_events WHERE member_id=v_successor_member AND actor_user_id=v_target_auth AND actor_erased IS FALSE) THEN
    RAISE EXCEPTION 'INVALID_SUCCESSOR_DID_NOT_ROLL_BACK';
  END IF;

  -- Fail-closed collision case: another member's invitation cannot be retargeted/deleted.
  INSERT INTO public.members(email,full_name,completion_rank)
    VALUES('collision@erasure-test.example.invalid','Synthetic Collision',0) RETURNING id INTO v_collision_member;
  INSERT INTO auth.users(id,aud,role,email,created_at,updated_at)
    VALUES(v_collision_auth,'authenticated','authenticated','collision@erasure-test.example.invalid',now(),now());
  INSERT INTO public.member_auth_bindings(member_id,auth_user_id,normalized_email)
    VALUES(v_collision_member,v_collision_auth,'collision@erasure-test.example.invalid');
  INSERT INTO public.member_password_invitations(id,token_hash,member_id,normalized_email,purpose,expires_at,created_by,expected_auth_user_id,status)
    VALUES(v_collision_inv,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',v_owner_member,
      'owner@erasure-test.example.invalid','enroll',now()+interval '1 day',v_owner_auth,v_collision_auth,'pending');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'role','authenticated','email','owner@erasure-test.example.invalid')::text,true);
  v_collision_preview := public.owner_member_erasure_preview(v_collision_member);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_collision_preview->'preview'->'blockers') b
    WHERE b->>'code'='other_member_invitation_identity') THEN
    RAISE EXCEPTION 'CROSS_MEMBER_AUTH_INVITATION_COLLISION_NOT_BLOCKED';
  END IF;
  -- Remove only this blocker fixture so the successful operation's remaining assertions stay isolated.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  DELETE FROM public.member_password_invitations WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff';
  DELETE FROM public.member_auth_bindings WHERE auth_user_id='55555555-5555-4555-8555-555555555555';
  DELETE FROM auth.users WHERE id='55555555-5555-4555-8555-555555555555';
  DELETE FROM public.members WHERE email='collision@erasure-test.example.invalid';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','owner@erasure-test.example.invalid',
    'role','authenticated','aud','authenticated','session_id',v_session)::text,true);
  v_db_result := public.owner_member_erasure_execute_database(v_operation,v_target_member,v_target_auth,
    v_assignments,v_preview_token,'ERASE '||v_target_member::text||' '||left(v_target_auth::text,8));
  IF v_db_result->>'auth_user_deletion_required'<>'true' OR v_db_result->>'shared_parents_preserved'<>'true' THEN
    RAISE EXCEPTION 'DATABASE_STAGE_RESULT_INVALID: %',v_db_result;
  END IF;
  -- A second call on this same committed operation is idempotent and never erases Auth/Storage itself.
  IF public.owner_member_erasure_execute_database(v_operation,v_target_member,v_target_auth,
      v_assignments,v_preview_token,'ERASE '||v_target_member::text||' '||left(v_target_auth::text,8)) IS DISTINCT FROM v_db_result THEN
    RAISE EXCEPTION 'DATABASE_STAGE_NOT_IDEMPOTENT';
  END IF;

  IF EXISTS(SELECT 1 FROM public.members WHERE id=v_target_member)
     OR EXISTS(SELECT 1 FROM public.member_auth_bindings WHERE member_id=v_target_member OR auth_user_id=v_target_auth)
     OR EXISTS(SELECT 1 FROM public.admin_accounts WHERE user_id=v_target_auth) THEN
    RAISE EXCEPTION 'TARGET_PROFILE_OR_AUTH_BINDING_REMAINS';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_accounts WHERE user_id=v_owner_auth AND role='owner')
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_target_auth)
     OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='target/private-fixture.txt' AND owner_id=v_target_auth::text) THEN
    RAISE EXCEPTION 'DATABASE_STAGE_DELETED_OUTSIDE_ITS_SCOPE';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=v_team)
     OR EXISTS(SELECT 1 FROM public.team_memberships WHERE team_id=v_team AND member_id=v_target_member)
     OR NOT EXISTS(SELECT 1 FROM public.team_memberships WHERE team_id=v_team AND member_id=v_successor_member AND status='active') THEN
    RAISE EXCEPTION 'TEAM_PRESERVATION_ASSERTION_FAILED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.web_projects WHERE id=v_project AND owner_member_id=v_successor_member)
     OR NOT EXISTS(SELECT 1 FROM public.web_project_members WHERE project_id=v_project AND member_id=v_successor_member)
     OR EXISTS(SELECT 1 FROM public.web_project_members WHERE project_id=v_project AND member_id=v_target_member)
     OR NOT EXISTS(SELECT 1 FROM public.web_ideas WHERE id=v_idea AND submitted_by_member_id=v_successor_member)
     OR NOT EXISTS(SELECT 1 FROM public.web_idea_contributors WHERE idea_id=v_idea AND member_id=v_successor_member) THEN
    RAISE EXCEPTION 'SHARED_PROJECT_OR_IDEA_PRESERVATION_ASSERTION_FAILED';
  END IF;
  IF (SELECT assigned_to FROM public.tasks WHERE title='Synthetic shared task')
       IS DISTINCT FROM jsonb_build_array(v_successor_member)
     OR (SELECT tracking FROM public.tasks WHERE title='Synthetic shared task') ? v_target_member::text
     OR NOT ((SELECT tracking FROM public.tasks WHERE title='Synthetic shared task') ? v_successor_member::text) THEN
    RAISE EXCEPTION 'TASK_JSON_SURGICAL_CLEANUP_FAILED';
  END IF;
  IF (SELECT target_audience->'member_ids' FROM public.announcements WHERE title='Synthetic announcement')
       IS DISTINCT FROM jsonb_build_array(v_successor_member)
     OR (SELECT read_receipts FROM public.announcements WHERE title='Synthetic announcement') ? v_target_member::text
     OR NOT ((SELECT read_receipts FROM public.announcements WHERE title='Synthetic announcement') ? v_successor_member::text) THEN
    RAISE EXCEPTION 'ANNOUNCEMENT_JSON_SURGICAL_CLEANUP_FAILED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.task_contribution_events WHERE member_id=v_target_member)
     OR NOT EXISTS(SELECT 1 FROM public.task_contribution_events WHERE member_id=v_successor_member
       AND actor_user_id IS NULL AND actor_erased IS TRUE)
     OR EXISTS(SELECT 1 FROM public.member_infinite_bonus_events WHERE member_id=v_target_member) THEN
    RAISE EXCEPTION 'APPEND_ONLY_LEDGER_PRIVACY_ASSERTION_FAILED';
  END IF;
  IF (SELECT count(*) FROM public.team_access_audit WHERE team_id=v_team)<>1
     OR NOT EXISTS(SELECT 1 FROM public.team_access_audit WHERE team_id=v_team AND actor_user_id IS NULL AND member_id=v_successor_member) THEN
    RAISE EXCEPTION 'TEAM_AUDIT_PRIVACY_ASSERTION_FAILED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.member_password_invitations WHERE id=v_target_invitation)
     OR NOT EXISTS(SELECT 1 FROM public.member_password_invitations WHERE id=v_other_invitation AND member_id=v_successor_member AND created_by IS NULL)
     OR EXISTS(SELECT 1 FROM public.member_password_audit WHERE member_id=v_target_member OR actor_user_id=v_target_auth)
     OR EXISTS(SELECT 1 FROM public.member_password_recovery_sessions WHERE invitation_id=v_target_invitation) THEN
    RAISE EXCEPTION 'INVITATION_OR_RECOVERY_PRIVACY_ASSERTION_FAILED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notes WHERE target_member_id IS NULL AND target_name IS NULL AND text='Synthetic note')
     OR NOT EXISTS(SELECT 1 FROM public.web_project_task_comments WHERE author_member_id IS NULL AND author_auth_user_id IS NULL AND body='Shared work comment fixture')
     OR EXISTS(SELECT 1 FROM public.web_project_task_assignees WHERE project_id=v_project AND member_id=v_target_member)
     OR NOT EXISTS(SELECT 1 FROM public.web_project_task_assignees WHERE project_id=v_project AND member_id=v_successor_member AND assigned_by_auth_user_id IS NULL)
     OR EXISTS(SELECT 1 FROM public.web_project_agreement_acceptances WHERE project_id=v_project AND member_id=v_target_member)
     OR EXISTS(SELECT 1 FROM public.web_project_consents WHERE project_id=v_project AND member_id=v_target_member)
     OR NOT EXISTS(SELECT 1 FROM public.web_project_agreements WHERE project_id=v_project AND created_by_auth_user_id IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.web_project_activity_logs WHERE project_id=v_project AND action='fixture_actor' AND actor_auth_user_id IS NULL AND actor_member_id IS NULL) THEN
    RAISE EXCEPTION 'SURGICAL_IDENTITY_CLEANUP_ASSERTION_FAILED';
  END IF;

  v_status := public.owner_member_erasure_status(v_operation);
  IF v_status->>'status'<>'partial' OR v_status->>'database_complete'<>'true'
     OR v_status->>'storage_complete'<>'false' OR v_status->>'auth_complete'<>'false'
     OR (v_status->'deleted'->>'auth_users')::integer<>0 THEN
    RAISE EXCEPTION 'DATABASE_COMPLETION_MUST_NOT_CLAIM_STORAGE_OR_AUTH: %',v_status;
  END IF;

  -- The following SQL statements simulate successful Storage API and GoTrue calls
  -- against these disposable fixtures only. The production Edge uses Storage/Auth APIs.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  BEGIN
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
      VALUES('erasure-test-bucket','target/late-write.txt',v_target_auth::text,'{}'::jsonb);
    RAISE EXCEPTION 'TEST_EXPECTED_STORAGE_FENCE';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'STORAGE_OWNER_ERASURE_IN_PROGRESS' THEN RAISE; END IF;
  END;
  v_pending := public.owner_member_erasure_pending_storage_batch(v_operation,10);
  IF jsonb_array_length(v_pending)<>1 OR v_pending->0->>'name'<>'target/private-fixture.txt' THEN
    RAISE EXCEPTION 'PENDING_STORAGE_MANIFEST_SCOPE_FAILED: %',v_pending;
  END IF;
  DELETE FROM storage.objects WHERE bucket_id=v_pending->0->>'bucket_id' AND name=v_pending->0->>'name';
  v_marked := public.owner_member_erasure_mark_storage_batch(v_operation,v_pending);
  IF (v_marked->>'marked_count')::integer<>1 THEN RAISE EXCEPTION 'STORAGE_MARK_COUNT_FAILED: %',v_marked; END IF;
  DELETE FROM auth.users WHERE id=v_target_auth;
  PERFORM public.owner_member_erasure_mark_auth_deleted(v_operation);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_auth,'email','owner@erasure-test.example.invalid',
    'role','authenticated','aud','authenticated','session_id',v_session)::text,true);
  v_status := public.owner_member_erasure_status(v_operation);
  IF v_status->>'status'<>'complete' OR v_status->>'database_complete'<>'true'
     OR v_status->>'storage_complete'<>'true' OR v_status->>'auth_complete'<>'true'
     OR (v_status->'deleted'->>'auth_users')::integer<>1
     OR (v_status->'deleted'->>'storage_objects')::integer<>1 THEN
    RAISE EXCEPTION 'SIMULATED_FINAL_STATUS_INVALID: %',v_status;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='erasure-test-bucket'
      AND name='successor/preserved-fixture.txt' AND owner_id=v_successor_auth::text)
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner_auth)
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_successor_auth) THEN
    RAISE EXCEPTION 'OTHER_AUTH_OR_STORAGE_FIXTURES_WERE_CHANGED';
  END IF;
END;
$$;

SELECT pass('exact-ID erasure preserves shared team/project/member data and requires confirmed DB, Storage, and Auth stages');
SELECT * FROM finish();
ROLLBACK;
