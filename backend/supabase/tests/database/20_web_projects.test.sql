-- 20 — Web Projects RLS, identity, agreement, workflow, reporting, resource,
-- immutable-audit and derived-progress contract. All fixtures roll back.
BEGIN;
\ir _helpers.psql
SELECT no_plan();

DO $$
BEGIN
  -- Member fixtures below create their own Auth identities. Keep separate Auth
  -- users only for the four global Admin/Owner permission test actors.
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['wp-owner','wp-admin','wp-default-deny','wp-team-only']) AS n;
  PERFORM phantoms_test.grant_admin('wp-owner','owner');
  PERFORM phantoms_test.grant_admin('wp-admin','admin',
    phantoms_test.perms() || '{"web_projects":true}'::jsonb);
  PERFORM phantoms_test.grant_admin('wp-default-deny','admin',phantoms_test.perms());
  PERFORM phantoms_test.grant_admin('wp-team-only','admin',phantoms_test.perms('tasks'));
  PERFORM phantoms_test.create_member(n,NULL,TRUE)
  FROM unnest(ARRAY['wp-owner-member','wp-lead','wp-contributor','wp-other-contributor',
                    'wp-viewer','wp-outsider','wp-second-lead']) AS n;
END $$;

SELECT is((SELECT permissions->>'web_projects' FROM public.admin_accounts
           WHERE user_id=phantoms_test.uid('wp-default-deny')),'false',
          'existing global Admin without the explicit feature bit remains denied');
SELECT phantoms_test.login_as('wp-owner');
SELECT ok(public.has_admin_permission('web_projects'),'system Owner has implicit Web Projects access');
SELECT ok(public.web_is_program_admin(),'Owner is recognized as a Web Projects program administrator');
SELECT lives_ok($$SELECT public.web_set_program_admin_access(phantoms_test.uid('wp-default-deny'),true)$$,
                'Owner can explicitly grant the separate Web Projects feature');
RESET ROLE;
SELECT phantoms_test.login_as('wp-default-deny');
SELECT ok(public.has_admin_permission('web_projects'),'explicit Web Projects bit is effective');
SELECT is(public.has_admin_permission('tasks'),false,'Web Projects grant does not grant global task authority');
SELECT is(public.has_team_permission((SELECT id FROM public.teams WHERE slug='software'),'tasks'),false,
          'Web Projects program admin receives no Internal Team seat or permission');
RESET ROLE;
SELECT phantoms_test.login_as('wp-team-only');
SELECT is(public.has_admin_permission('web_projects'),false,'legacy Admin permission does not imply Web Projects');
SELECT ok(public.has_admin_permission('tasks'),'explicit legacy task permission remains intact after feature grant');
SELECT is(public.has_team_permission((SELECT id FROM public.teams WHERE slug='software'),'tasks'),false,
          'global task permission alone does not create an Internal Team assignment');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT count(*) FROM public.web_projects$$,'42501',NULL,
                 'anonymous role is denied direct Web Projects table access');
SELECT throws_ok($$SELECT public.web_create_project('Denied','denied',1,NULL)$$,'42501',NULL,
                 'anonymous role cannot execute project-creation RPC');
RESET ROLE;

-- Two projects prove that roles and canonical identity are project-scoped.
SELECT phantoms_test.login_as('wp-admin');
INSERT INTO phantoms_test.vars(key,value) VALUES
 ('wp-p1',public.web_create_project('Web Alpha','wp-alpha',phantoms_test.mid('wp-owner-member'),phantoms_test.mid('wp-lead'))::text),
 ('wp-p2',public.web_create_project('Web Beta','wp-beta',phantoms_test.mid('wp-outsider'),phantoms_test.mid('wp-second-lead'))::text);
WITH x AS (INSERT INTO public.web_project_milestones(project_id,title,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p2')::uuid,'Beta milestone',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-m-p2',id::text FROM x;
WITH x AS (INSERT INTO public.web_project_sprints(project_id,name,starts_on,ends_on,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p2')::uuid,'Beta sprint',current_date,current_date+14,auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-s-p2',id::text FROM x;
SELECT lives_ok($$SELECT public.web_add_project_member(phantoms_test.var('wp-p2')::uuid,
             phantoms_test.mid('wp-lead'),'contributor','Build in Beta')$$,
             'same canonical member can hold a different role in another project');
SELECT is((SELECT count(*)::int FROM public.web_project_members
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND member_id=phantoms_test.mid('wp-lead') AND role='lead'),1,
          'the first project retains its own lead role');
SELECT is((SELECT count(*)::int FROM public.web_project_members
           WHERE project_id=phantoms_test.var('wp-p2')::uuid AND member_id=phantoms_test.mid('wp-lead') AND role='contributor'),1,
          'the same member has an independent contributor role in the second project');
SELECT is((SELECT count(*)::int FROM public.web_project_members
           WHERE project_id=phantoms_test.var('wp-p1')::uuid),2,
          'project creation creates independent pending owner and lead memberships');
SELECT is((SELECT count(*)::int FROM public.web_project_agreements
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND version=1),1,
          'each project begins with an immutable version-one agreement');
SELECT lives_ok($$SELECT public.web_add_project_member(phantoms_test.var('wp-p1')::uuid,
             phantoms_test.mid('wp-contributor'),'contributor','Build and test')$$,
             'program administrator can invite a canonical member as contributor');
SELECT lives_ok($$SELECT public.web_add_project_member(phantoms_test.var('wp-p1')::uuid,
             phantoms_test.mid('wp-other-contributor'),'contributor','Review')$$,
             'a member can participate in another project role independently');
SELECT lives_ok($$SELECT public.web_add_project_member(phantoms_test.var('wp-p1')::uuid,
             phantoms_test.mid('wp-viewer'),'viewer','Read only')$$,
             'viewer is added with a project-scoped read-only role');

-- A pending lead can read their own invitation and current agreement, not work.
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT is((SELECT count(*)::int FROM public.web_projects WHERE id=phantoms_test.var('wp-p1')::uuid),0,
          'pending invitee cannot read the general project workspace');
SELECT is((SELECT count(*)::int FROM public.web_project_agreements WHERE project_id=phantoms_test.var('wp-p1')::uuid),1,
          'pending invitee can read the current agreement');
SELECT is((SELECT count(*)::int FROM public.web_project_members
           WHERE project_id=phantoms_test.var('wp-p1')::uuid),1,
          'pending invitee sees only their own membership row');
SELECT is((SELECT count(*)::int FROM public.web_list_my_project_invitations()
           WHERE project_id=phantoms_test.var('wp-p1')::uuid),1,
          'invitation RPC returns the caller own current agreement');
SELECT throws_like($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,99)$$,
                   '%WEB_PROJECT_AGREEMENT_VERSION_STALE%','stale agreement acceptance is rejected');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,1)$$,
                'lead accepts only the current agreement version');
SELECT ok(public.web_can_access_project(phantoms_test.var('wp-p1')::uuid),
          'current accepted membership grants project workspace access');
SELECT throws_like($$SELECT public.web_set_project_permissions(phantoms_test.var('wp-p1')::uuid,true,false)$$,
                   '%WEB_PROJECT_BRAND_CONSENT_REQUIRED%','brand use stays disabled until other active contributors consent');
SELECT lives_ok($$SELECT public.web_set_project_status(phantoms_test.var('wp-p1')::uuid,'reviewing')$$,
                'project lifecycle may move from proposed to reviewing');
SELECT lives_ok($$SELECT public.web_set_project_status(phantoms_test.var('wp-p1')::uuid,'approved')$$,
                'project lifecycle may move from reviewing to approved');
SELECT lives_ok($$SELECT public.web_set_project_status(phantoms_test.var('wp-p1')::uuid,'planning')$$,
                'project lifecycle may move from approved to planning');
SELECT lives_ok($$SELECT public.web_set_project_status(phantoms_test.var('wp-p1')::uuid,'active')$$,
                'project becomes active only after its primary lead accepts');

-- Canonical member identity: callers cannot impersonate another member in idea/report paths.
RESET ROLE;
SELECT phantoms_test.login_as('wp-contributor');
SELECT throws_like($$SELECT public.web_create_idea(
  '{"title":"Forged identity","short_description":"No","submitted_by_member_id":999999}'::jsonb,ARRAY[]::bigint[])$$,
  '%WEB_IDEA_SUBMITTER_MUST_BE_CURRENT_MEMBER%','member cannot supply another canonical submitter identity');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'wp-idea',public.web_create_idea(
  jsonb_build_object('title','Project idea','short_description','A useful idea','problem_statement','Problem',
    'proposed_solution','Solution','target_audience','Members','phantoms_benefit','Better workflows',
    'graduation_project',true,'suggested_leader_member_id',phantoms_test.mid('wp-lead')),
  ARRAY[phantoms_test.mid('wp-other-contributor')])::text;
SELECT is((SELECT submitted_by_member_id FROM public.web_ideas WHERE id=phantoms_test.var('wp-idea')::uuid),
          phantoms_test.mid('wp-contributor'),'idea submitter is resolved from the bound Auth identity');
SELECT is((SELECT count(*)::int FROM public.web_ideas WHERE id=phantoms_test.var('wp-idea')::uuid),1,
          'idea author may read their own proposal');
RESET ROLE;
SELECT phantoms_test.login_as('wp-admin');
SELECT is(public.web_review_idea(phantoms_test.var('wp-idea')::uuid,'under_review','Initial review'),'under_review',
          'program admin can start the idea review');
SELECT is(public.web_review_idea(phantoms_test.var('wp-idea')::uuid,'approved','Approved for delivery'),'approved',
          'program admin can approve the reviewed idea');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'wp-converted',public.web_convert_idea_to_project(phantoms_test.var('wp-idea')::uuid,'wp-converted',NULL)::text;
SELECT is(public.web_convert_idea_to_project(phantoms_test.var('wp-idea')::uuid,'ignored-second-slug',NULL),
          phantoms_test.var('wp-converted')::uuid,'idea conversion is idempotent and returns the original project');
SELECT is((SELECT origin_submitter_member_id FROM public.web_projects WHERE id=phantoms_test.var('wp-converted')::uuid),
          phantoms_test.mid('wp-contributor'),'conversion preserves original idea submitter');
SELECT is((SELECT submitted_by_member_id FROM public.web_ideas WHERE id=phantoms_test.var('wp-idea')::uuid),
          phantoms_test.mid('wp-contributor'),'conversion retains the source idea and its submitter');
SELECT is((SELECT count(*)::int FROM public.web_projects WHERE source_idea_id=phantoms_test.var('wp-idea')::uuid),1,
          'one source idea cannot create duplicate projects');

-- Agreement acceptance, consent gates, role-specific task work.
RESET ROLE;
SELECT phantoms_test.login_as('wp-second-lead');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p2')::uuid,1)$$,
                'independent project lead accepts the second project agreement');
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p2')::uuid,1)$$,
                'same member independently accepts a contributor role in the second project');
RESET ROLE;
SELECT phantoms_test.login_as('wp-contributor');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,1)$$,
                'contributor accepts current agreement');
RESET ROLE;
SELECT phantoms_test.login_as('wp-other-contributor');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,1)$$,
                'second contributor may also join the same project');
RESET ROLE;
SELECT phantoms_test.login_as('wp-viewer');
SELECT lives_ok($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,1)$$,
                'viewer may accept but remains read-only');
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'phantoms_brand_assets',true)$$,
                'lead can record explicit current-version brand consent');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'public_showcase',true)$$,
                'lead can record explicit current-version showcase consent');
SELECT throws_like($$SELECT public.web_set_project_permissions(phantoms_test.var('wp-p1')::uuid,true,false)$$,
                   '%WEB_PROJECT_BRAND_CONSENT_REQUIRED%','brand use stays disabled until each contributor consents');
RESET ROLE;
SELECT phantoms_test.login_as('wp-contributor');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'phantoms_brand_assets',true)$$,
                'contributor opts into brand use explicitly');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'public_showcase',true)$$,
                'contributor opts into showcase explicitly');
RESET ROLE;
SELECT phantoms_test.login_as('wp-other-contributor');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'phantoms_brand_assets',true)$$,
                'each active contributor records own brand consent');
SELECT lives_ok($$SELECT public.web_record_project_consent(phantoms_test.var('wp-p1')::uuid,'public_showcase',true)$$,
                'each active contributor records own showcase consent');
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT lives_ok($$SELECT public.web_set_project_permissions(phantoms_test.var('wp-p1')::uuid,true,true)$$,
                'program project enables permissions only after current opt-in from every contributor');

-- Persist real milestone, sprint, tasks, assignment, comment, and deliverable data.
WITH x AS (INSERT INTO public.web_project_milestones(project_id,title,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,'Milestone One',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-m1',id::text FROM x;
WITH x AS (INSERT INTO public.web_project_milestones(project_id,title,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,'Milestone Two',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-m2',id::text FROM x;
WITH x AS (INSERT INTO public.web_project_sprints(project_id,name,starts_on,ends_on,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,'Sprint One',current_date,current_date+14,auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-sprint',id::text FROM x;
WITH x AS (INSERT INTO public.web_project_tasks(project_id,milestone_id,sprint_id,reporter_member_id,title,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,phantoms_test.var('wp-sprint')::uuid,
                   phantoms_test.mid('wp-lead'),'Task One',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-t1',id::text FROM x;
WITH x AS (INSERT INTO public.web_project_tasks(project_id,milestone_id,sprint_id,reporter_member_id,title,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,phantoms_test.var('wp-sprint')::uuid,
                   phantoms_test.mid('wp-lead'),'Task Two',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-t2',id::text FROM x;
INSERT INTO public.web_project_task_assignees(project_id,task_id,member_id,is_primary,assigned_by_auth_user_id)
VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-t1')::uuid,phantoms_test.mid('wp-contributor'),true,auth.uid());
WITH x AS (INSERT INTO public.web_project_deliverables(project_id,milestone_id,submitted_by_member_id,title)
           VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,
                   phantoms_test.mid('wp-contributor'),'Proof of work') RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-deliverable',id::text FROM x;
SELECT is((SELECT status FROM public.web_project_deliverables WHERE id=phantoms_test.var('wp-deliverable')::uuid),
          'draft','project lead can create a scoped draft request for an active contributor');
SELECT is((SELECT count(*)::int FROM public.web_project_task_assignees
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND member_id=phantoms_test.mid('wp-contributor')),1,
          'task assignment uses active membership in the same project');
SELECT lives_ok($$INSERT INTO public.web_project_milestone_dependencies(project_id,milestone_id,depends_on_milestone_id,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,phantoms_test.var('wp-m2')::uuid,auth.uid())$$,
  'same-project milestone dependency is accepted');
SELECT throws_like($$INSERT INTO public.web_project_milestone_dependencies(project_id,milestone_id,depends_on_milestone_id,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m2')::uuid,phantoms_test.var('wp-m1')::uuid,auth.uid())$$,
  '%WEB_PROJECT_MILESTONE_DEPENDENCY_CYCLE%','dependency cycle is rejected');
SELECT throws_like($$INSERT INTO public.web_project_milestone_dependencies(project_id,milestone_id,depends_on_milestone_id,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,phantoms_test.var('wp-m1')::uuid,auth.uid())$$,
  '%WEB_PROJECT_MILESTONE_SELF_DEPENDENCY%','milestone cannot depend on itself');

-- Assigned contributor may transition their task; viewers/outsiders may not.
RESET ROLE;
SELECT phantoms_test.login_as('wp-contributor');
SELECT throws_ok($$UPDATE public.web_project_tasks SET status='done' WHERE id=phantoms_test.var('wp-t1')::uuid$$,
                 '42501',NULL,'direct task status mutation is forbidden in favor of transition RPC');
SELECT is(public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'todo','Started work'),'todo',
          'assigned contributor transitions backlog task and persists a task comment');
SELECT is(public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'in_progress',NULL),'in_progress',
          'assigned contributor moves task into progress');
SELECT is(public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'in_review',NULL),'in_review',
          'assigned contributor submits task for review');
SELECT is(public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'done',NULL),'done',
          'assigned contributor completes a legal review transition');
SELECT throws_like($$SELECT public.web_transition_project_task(phantoms_test.var('wp-t2')::uuid,'todo',NULL)$$,
                   '%WEB_PROJECT_TASK_ASSIGNEE_OR_LEAD_REQUIRED%',
                   'same-project contributor cannot transition a task without an explicit assignment');
SELECT throws_like($$UPDATE public.web_project_tasks SET sprint_id=NULL WHERE id=phantoms_test.var('wp-t1')::uuid$$,
                   '%WEB_PROJECT_TASK_ASSIGNMENT_METADATA_LEAD_REQUIRED%','contributor cannot change task sprint/milestone assignment metadata');
SELECT lives_ok($$INSERT INTO public.web_project_task_attachments(project_id,task_id,uploaded_by_member_id,title,external_url)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-t1')::uuid,
          phantoms_test.mid('wp-contributor'),'Safe link','https://example.invalid/resource')$$,
  'active contributor may attach a safe HTTP(S) link to an assigned task');
SELECT throws_ok($$INSERT INTO public.web_project_task_attachments(project_id,task_id,uploaded_by_member_id,title,external_url)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-t1')::uuid,
          phantoms_test.mid('wp-contributor'),'Unsafe link','javascript:alert(1)')$$,
  '23514',NULL,'database rejects scriptable external attachment URL schemes');
UPDATE public.web_project_deliverables
SET title='Initial submission',description='Evidence attached',evidence='[{"url":"https://example.invalid/proof"}]'::jsonb,
    task_id=phantoms_test.var('wp-t1')::uuid,status='submitted',submitted_at=now()
WHERE id=phantoms_test.var('wp-deliverable')::uuid;
SELECT is((SELECT status FROM public.web_project_deliverables WHERE id=phantoms_test.var('wp-deliverable')::uuid),
          'submitted','requested contributor can submit evidence and associated task');
RESET ROLE;
SELECT phantoms_test.login_as('wp-viewer');
SELECT throws_like($$SELECT public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'in_progress',NULL)$$,
                   '%WEB_PROJECT_TASK_ASSIGNEE_OR_LEAD_REQUIRED%','viewer cannot transition even a task assigned to a contributor');
SELECT throws_like($$INSERT INTO public.web_project_task_comments(project_id,task_id,author_member_id,author_auth_user_id,body)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-t1')::uuid,phantoms_test.mid('wp-viewer'),auth.uid(),'forbidden')$$,
  '%WEB_PROJECT_CONTRIBUTOR_ROLE_REQUIRED%','viewer cannot write task comments');
RESET ROLE;
SELECT phantoms_test.login_as('wp-outsider');
SELECT is((SELECT count(*)::int FROM public.web_project_tasks WHERE project_id=phantoms_test.var('wp-p1')::uuid),0,
          'unrelated project member cannot read tasks from another project');
SELECT is((SELECT count(*)::int FROM public.web_project_task_comments WHERE task_id=phantoms_test.var('wp-t1')::uuid),0,
          'unrelated project member cannot read task comments');
SELECT throws_like($$SELECT public.web_transition_project_task(phantoms_test.var('wp-t1')::uuid,'blocked',NULL)$$,
                   '%WEB_PROJECT_TASK_ASSIGNEE_OR_LEAD_REQUIRED%','outsider cannot transition a task in an unrelated project');
RESET ROLE;

-- Individual reports are author/lead/program-admin private; review and revision are auditable.
SELECT phantoms_test.login_as('wp-contributor');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'wp-report',public.web_submit_member_report(phantoms_test.var('wp-p1')::uuid,current_date-7,current_date,
  'Private report sentinel 73','Current work','Next week',false,'Private blocker',true,'[]'::jsonb)::text;
SELECT is((SELECT count(*)::int FROM public.web_project_member_reports WHERE id=phantoms_test.var('wp-report')::uuid),1,
          'report author can read their own report');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.web_project_activity_logs
  WHERE project_id=phantoms_test.var('wp-p1')::uuid AND details::text LIKE '%Private report sentinel 73%'),
  'activity metadata does not copy private report text');
RESET ROLE;
SELECT phantoms_test.login_as('wp-other-contributor');
SELECT is((SELECT count(*)::int FROM public.web_project_member_reports WHERE id=phantoms_test.var('wp-report')::uuid),0,
          'another contributor cannot read a colleague report');
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT is((SELECT count(*)::int FROM public.web_project_member_reports WHERE id=phantoms_test.var('wp-report')::uuid),1,
          'accepted project lead can read member report');
UPDATE public.web_project_deliverables
SET status='revision_requested',review_notes='Please add a reproducible proof',reviewed_at=now()
WHERE id=phantoms_test.var('wp-deliverable')::uuid;
SELECT is((SELECT reviewed_by_auth_user_id FROM public.web_project_deliverables
           WHERE id=phantoms_test.var('wp-deliverable')::uuid),auth.uid(),
          'deliverable review records the authenticated lead even when client omits reviewer identity');
SELECT is(public.web_review_member_report(phantoms_test.var('wp-report')::uuid,'needs_clarification','Please add the blocker owner',true),
          'needs_clarification','lead can request report clarification and escalate a blocker');
SELECT is(public.web_review_member_report(phantoms_test.var('wp-report')::uuid,'reviewed','Reviewed',true),
          'reviewed','lead can finish reviewing a report');
RESET ROLE;
SELECT phantoms_test.login_as('wp-contributor');
SELECT throws_like($$SELECT public.web_submit_member_report(phantoms_test.var('wp-p1')::uuid,current_date-7,current_date,
  'Revised report','Current work','Next week',false,'',false,'[]'::jsonb)$$,
  '%WEB_PROJECT_REPORT_ALREADY_REVIEWED%','fully reviewed report cannot be silently replaced');
SELECT throws_like($$SELECT public.web_review_member_report(phantoms_test.var('wp-report')::uuid,'reviewed','Self review',false)$$,
  '%WEB_PROJECT_LEAD_OR_ADMIN_REQUIRED%','contributor cannot review another member report');
UPDATE public.web_project_deliverables
SET title='Revised submission',description='Updated evidence',evidence='[{"url":"https://example.invalid/revised"}]'::jsonb,
    status='submitted',submitted_at=now()
WHERE id=phantoms_test.var('wp-deliverable')::uuid;
SELECT is((SELECT status FROM public.web_project_deliverables WHERE id=phantoms_test.var('wp-deliverable')::uuid),
          'submitted','member can revise a deliverable after lead requests changes');
SELECT ok((SELECT reviewed_by_auth_user_id IS NULL AND reviewed_at IS NULL
           FROM public.web_project_deliverables WHERE id=phantoms_test.var('wp-deliverable')::uuid),
          'member resubmission clears stale reviewer metadata');
RESET ROLE;

-- Resource references: pending shared resources fail, approved shared resources succeed,
-- project-only resources cannot cross project boundaries.
SELECT phantoms_test.login_as('wp-admin');
WITH x AS (INSERT INTO public.web_resources(title,category,external_url,created_by_auth_user_id)
           VALUES ('Pending asset','other','https://example.invalid/pending',auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-resource-pending',id::text FROM x;
WITH x AS (INSERT INTO public.web_resources(title,category,external_url,access_status,is_approved,created_by_auth_user_id)
           VALUES ('Approved asset','other','https://example.invalid/approved','approved',true,auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-resource-shared',id::text FROM x;
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT throws_like($$INSERT INTO public.web_project_resource_refs(project_id,resource_id,added_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-resource-pending')::uuid,auth.uid())$$,
  '%WEB_SHARED_RESOURCE_NOT_APPROVED%','unapproved shared resource cannot be referenced');
SELECT lives_ok($$INSERT INTO public.web_project_resource_refs(project_id,resource_id,added_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-resource-shared')::uuid,auth.uid())$$,
  'approved shared resource can be referenced without copying it');
WITH x AS (INSERT INTO public.web_resources(scope_id,project_id,title,category,external_url,access_status,is_approved,created_by_auth_user_id)
           VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-p1')::uuid,'Alpha private asset','other',
                   'https://example.invalid/alpha','approved',true,auth.uid()) RETURNING id)
INSERT INTO phantoms_test.vars(key,value) SELECT 'wp-resource-project',id::text FROM x;
RESET ROLE;
SELECT throws_like($$INSERT INTO public.web_project_resource_refs(project_id,resource_id,added_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p2')::uuid,phantoms_test.var('wp-resource-project')::uuid,auth.uid())$$,
  '%WEB_PROJECT_RESOURCE_SCOPE_MISMATCH%','project-scoped resource cannot be referenced by a different project');
SELECT phantoms_test.login_as('wp-viewer');
SELECT throws_ok($$INSERT INTO public.web_project_resource_refs(project_id,resource_id,added_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-resource-project')::uuid,auth.uid())$$,
  '42501',NULL,'viewer cannot add project resource references through direct table writes');
RESET ROLE;

-- Cross-project composite foreign keys are tested as the program administrator so
-- project authorization does not mask the intentionally mismatched identities.
SELECT phantoms_test.login_as('wp-admin');
SELECT throws_ok($$INSERT INTO public.web_project_milestone_dependencies(project_id,milestone_id,depends_on_milestone_id,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m1')::uuid,
          (SELECT id FROM public.web_project_milestones WHERE project_id=phantoms_test.var('wp-p2')::uuid LIMIT 1),
          phantoms_test.uid('wp-admin'))$$,'23503',NULL,'composite dependency foreign key rejects a milestone from another project');
SELECT throws_ok($$INSERT INTO public.web_project_deliverables(project_id,task_id,submitted_by_member_id,title)
  VALUES (phantoms_test.var('wp-p2')::uuid,phantoms_test.var('wp-t1')::uuid,phantoms_test.mid('wp-lead'),'Cross-project deliverable')$$,
  '23503',NULL,'deliverable task foreign key rejects a task from another project');
SELECT throws_ok($$INSERT INTO public.web_project_tasks(project_id,parent_task_id,reporter_member_id,title,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p2')::uuid,phantoms_test.var('wp-t1')::uuid,
          phantoms_test.mid('wp-second-lead'),'Cross-project parent',phantoms_test.uid('wp-admin'))$$,
  '23503',NULL,'composite task-parent foreign key rejects a parent from another project');
SELECT throws_ok($$INSERT INTO public.web_project_tasks(project_id,milestone_id,reporter_member_id,title,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-m-p2')::uuid,
          phantoms_test.mid('wp-contributor'),'Cross-project milestone',phantoms_test.uid('wp-admin'))$$,
  '23503',NULL,'composite task-milestone foreign key rejects another project milestone');
SELECT throws_ok($$INSERT INTO public.web_project_tasks(project_id,sprint_id,reporter_member_id,title,created_by_auth_user_id)
  VALUES (phantoms_test.var('wp-p1')::uuid,phantoms_test.var('wp-s-p2')::uuid,
          phantoms_test.mid('wp-contributor'),'Cross-project sprint',phantoms_test.uid('wp-admin'))$$,
  '23503',NULL,'composite task-sprint foreign key rejects another project sprint');

-- Derive actual progress from persisted task/deliverable state, not stored percentages.
SELECT is((SELECT task_count FROM public.web_project_progress WHERE project_id=phantoms_test.var('wp-p1')::uuid),2::bigint,
          'project progress counts non-cancelled persisted tasks');
SELECT is((SELECT completed_task_count FROM public.web_project_progress WHERE project_id=phantoms_test.var('wp-p1')::uuid),1::bigint,
          'project progress derives completed count from task status');
SELECT is((SELECT progress_percent FROM public.web_project_progress WHERE project_id=phantoms_test.var('wp-p1')::uuid),50.00::numeric,
          'project progress percentage is computed as one of two tasks');
SELECT is((SELECT linked_task_count FROM public.web_project_milestone_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND milestone_id=phantoms_test.var('wp-m1')::uuid),2::bigint,
          'milestone progress counts linked tasks');
SELECT is((SELECT linked_deliverable_count FROM public.web_project_milestone_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND milestone_id=phantoms_test.var('wp-m1')::uuid),1::bigint,
          'milestone progress also counts linked deliverables');
SELECT is((SELECT progress_percent FROM public.web_project_milestone_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND milestone_id=phantoms_test.var('wp-m1')::uuid),33.33::numeric,
          'milestone percentage is derived from one done task among three tracked items');
SELECT is((SELECT task_count FROM public.web_project_sprint_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND sprint_id=phantoms_test.var('wp-sprint')::uuid),2::bigint,
          'sprint progress counts linked persisted tasks');
SELECT is((SELECT completed_task_count FROM public.web_project_sprint_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND sprint_id=phantoms_test.var('wp-sprint')::uuid),1::bigint,
          'sprint progress derives completed task count');
SELECT is((SELECT progress_percent FROM public.web_project_sprint_progress
           WHERE project_id=phantoms_test.var('wp-p1')::uuid AND sprint_id=phantoms_test.var('wp-sprint')::uuid),50.00::numeric,
          'sprint completion percentage is calculated from real tasks');

-- Amendment invalidates prior acceptance and consent; append-only histories cannot be rewritten.
RESET ROLE;
SELECT phantoms_test.login_as('wp-lead');
SELECT is(public.web_amend_project_agreement(phantoms_test.var('wp-p1')::uuid,'joint','Shared by agreement',
  'MIT','Credit contributors','{"reviewed":true}'::jsonb),2,
  'lead amendment creates a new immutable agreement version');
SELECT ok(NOT public.web_can_access_project(phantoms_test.var('wp-p1')::uuid),
          'old agreement acceptance no longer grants project access');
SELECT throws_like($$SELECT public.web_accept_project_agreement(phantoms_test.var('wp-p1')::uuid,1)$$,
                   '%WEB_PROJECT_AGREEMENT_VERSION_STALE%','old version cannot be accepted after amendment');
RESET ROLE;
SELECT phantoms_test.login_as('wp-admin');
SELECT is((SELECT status FROM public.web_project_members WHERE project_id=phantoms_test.var('wp-p1')::uuid
           AND member_id=phantoms_test.mid('wp-contributor')),'pending',
          'agreement amendment returns prior members to pending acceptance');
SELECT is((SELECT phantoms_brand_permission OR public_showcase_permission FROM public.web_projects
           WHERE id=phantoms_test.var('wp-p1')::uuid),false,
          'amendment resets brand and showcase permissions to off');
RESET ROLE;
SELECT throws_like($$UPDATE public.web_project_agreements SET license_name='tampered'
  WHERE project_id=phantoms_test.var('wp-p1')::uuid AND version=1$$,
  '%WEB_PROJECT_APPEND_ONLY%','agreement snapshots are immutable');
SELECT throws_like($$UPDATE public.web_project_activity_logs SET details='{}'::jsonb
  WHERE project_id=phantoms_test.var('wp-p1')::uuid$$,
  '%WEB_PROJECT_APPEND_ONLY%','project activity audit rows are append-only');
SELECT throws_like($$UPDATE public.web_program_admin_audit SET details='{}'::jsonb$$,
  '%WEB_PROJECT_APPEND_ONLY%','program-administrator audit rows are append-only');
SELECT ok(NOT has_table_privilege('anon','public.web_projects','SELECT')
          AND NOT has_table_privilege('service_role','public.web_projects','SELECT')
          AND has_table_privilege('authenticated','public.web_projects','SELECT'),
          'Web Projects direct table grants are authenticated-only and RLS-scoped');
SELECT ok(NOT has_function_privilege('anon','public.web_create_project(text,text,bigint,bigint)','EXECUTE')
          AND has_function_privilege('authenticated','public.web_create_project(text,text,bigint,bigint)','EXECUTE'),
          'project-creation RPC is not exposed to anon');

SELECT * FROM finish();
ROLLBACK;
