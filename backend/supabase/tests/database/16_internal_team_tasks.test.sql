-- 16 — Team-scoped task operations; every synthetic fixture is rolled back.
BEGIN;
\ir _helpers.psql
SELECT no_plan();

DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['internal_task_owner','internal_task_head','internal_task_dashboard',
                    'internal_task_hardware_head','internal_task_global_admin','internal_task_outsider']) AS n;
  PERFORM phantoms_test.grant_admin('internal_task_owner','owner');
  PERFORM phantoms_test.grant_admin('internal_task_global_admin','admin',phantoms_test.perms('tasks'));
  PERFORM phantoms_test.create_member('internal_task_alice',NULL,TRUE);
  PERFORM phantoms_test.create_member('internal_task_hardware_member',NULL,TRUE);
  PERFORM phantoms_test.bind_device('internal_task_alice');
END $$;

INSERT INTO phantoms_test.vars(key,value) VALUES
  ('internal_task_software',(SELECT id::TEXT FROM public.teams WHERE slug='software')),
  ('internal_task_hardware',(SELECT id::TEXT FROM public.teams WHERE slug='hardware'));

SELECT phantoms_test.login_as('internal_task_owner');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.uid('internal_task_head'),
  'head',phantoms_test.perms('tasks'))$$,'Owner grants a team-only task seat');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.uid('internal_task_dashboard'),
  'monitor',phantoms_test.perms('dashboard'))$$,'dashboard permission remains a separate feature');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('internal_task_hardware')::UUID,phantoms_test.uid('internal_task_hardware_head'),
  'head',phantoms_test.perms('tasks'))$$,'another team receives an isolated task seat');
SELECT lives_ok($$SELECT public.team_add_member(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.mid('internal_task_alice'))$$,
  'Owner activates Alice in Software only');
SELECT lives_ok($$SELECT public.team_add_member(
  phantoms_test.var('internal_task_hardware')::UUID,phantoms_test.mid('internal_task_hardware_member'))$$,
  'Owner activates a different member in Hardware only');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Team Head has admin UI access, but team RPC permissions remain scoped.
SELECT phantoms_test.login_as('internal_task_head');
SELECT ok(public.is_admin(),'active team task assignment is an admin management account');
SELECT ok(public.has_admin_permission('tasks'),'assigned task permission is available to admin feature gates');
SELECT is(jsonb_array_length(public.team_list_roster(
  phantoms_test.var('internal_task_software')::UUID,'tasks')),1,
  'task-scoped roster exposes only active members in the selected team');
SELECT ok(public.team_list_roster(phantoms_test.var('internal_task_software')::UUID,'tasks')::TEXT !~ 'email|phone',
  'team task roster exposes no email or phone');
SELECT throws_like($$SELECT public.team_list_roster(
  phantoms_test.var('internal_task_software')::UUID,'dashboard')$$,
  '%TEAM_FEATURE_PERMISSION_REQUIRED%','roster checks the exact requested feature');
SELECT throws_like($$SELECT public.team_list_tasks(phantoms_test.var('internal_task_hardware')::UUID)$$,
  '%TEAM_TASKS_PERMISSION_REQUIRED%','task permission in Software does not authorize Hardware');
SELECT throws_like($$SELECT public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'cross-team target',NULL,
  jsonb_build_array(phantoms_test.mid('internal_task_hardware_member')::TEXT),FALSE,NULL,0)$$,
  '%TEAM_TASK_TARGET_NOT_ACTIVE_MEMBER%','task creation rejects an active member from another team');
SELECT throws_like($$SELECT public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'malformed targets',NULL,
  '{"member":true}'::JSONB,FALSE,NULL,0)$$,
  '%INVALID_TEAM_TASK_TARGETS%','task creation rejects non-array target JSON');
SELECT throws_like($$SELECT public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'invalid deadline',NULL,
  jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),TRUE,NULL,0)$$,
  '%INVALID_TEAM_TASK%','deadline flag and timestamp must agree');

INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_main',public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'Scoped contribution task','synthetic team task',
  jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),FALSE,NULL,10
)::TEXT;
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_revision',public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'Scoped revision task',NULL,
  jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),FALSE,NULL,0
)::TEXT;
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_cleanup',public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'Scoped cleanup task',NULL,
  '"ALL"'::JSONB,FALSE,NULL,0
)::TEXT;
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_zero_bonus',public.team_create_task(
  phantoms_test.var('internal_task_software')::UUID,'Scoped zero bonus task',NULL,
  jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),FALSE,NULL,0
)::TEXT;
SELECT is((SELECT task.value->'assigned_to' FROM jsonb_array_elements(
  public.team_list_tasks(phantoms_test.var('internal_task_software')::UUID)) AS task(value)
  WHERE task.value->>'title'='Scoped cleanup task'),
  '"ALL"'::JSONB,'team ALL assignment is stored as a validated team-scoped sentinel');
SELECT ok((public.team_list_tasks(phantoms_test.var('internal_task_software')::UUID)->0)
  ?& ARRAY['id','title','description','team_id','has_deadline','deadline_date','assigned_to','tracking','bonus_points'],
  'team task listing includes the required scoped fields');
SELECT is((public.team_list_tasks(phantoms_test.var('internal_task_software')::UUID)->0->>'team_id')::UUID,
  phantoms_test.var('internal_task_software')::UUID,'task listing preserves its team scope');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Team-only roles cannot bypass the task RPCs with direct table writes.
SELECT phantoms_test.login_as('internal_task_global_admin');
SELECT throws_like($statement$
  INSERT INTO public.tasks(title,assigned_to,tracking,team_id)
  VALUES ('unvalidated direct team row', '"ALL"'::JSONB, '{}'::JSONB,
          phantoms_test.var('internal_task_software')::UUID)
$statement$,'%TEAM_TASK_WRITE_FORBIDDEN%','direct global task-table insert cannot forge team scope');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- A password-authenticated active member sees only her global tasks and active
-- assignments in her own team; her existing device guard remains mandatory.
INSERT INTO public.tasks(title,assigned_to,tracking)
VALUES ('Synthetic global legacy task',jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),
        jsonb_build_object(phantoms_test.mid('internal_task_alice')::TEXT,'{"status":"pending"}'::JSONB));
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_global',id::TEXT FROM public.tasks WHERE title='Synthetic global legacy task';
SELECT phantoms_test.login_as('internal_task_hardware_head');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_hardware_task',public.team_create_task(
  phantoms_test.var('internal_task_hardware')::UUID,'Synthetic Hardware task',NULL,
  '"ALL"'::JSONB,FALSE,NULL,0)::TEXT;
RESET ROLE;
SELECT phantoms_test.clear_auth();

SELECT phantoms_test.login_as('internal_task_alice');
SELECT is(jsonb_array_length(public.get_member_tasks(
  phantoms_test.mid('internal_task_alice'),phantoms_test.tok('internal_task_alice'))),5,
  'member sees her active Software assignments plus her unchanged global task, not Hardware');
SELECT is(public.submit_task_status(
  phantoms_test.var('internal_task_main')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'under_review','synthetic submission','') ->> 'status',
  'under_review','member submits a team task with the existing device identity guard');
SELECT is(public.submit_task_delivery(
  phantoms_test.var('internal_task_cleanup')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'Completed scoped team work','Feedback for the team',4,'hard',
  '[{"label":"GitHub","url":"https://github.com/example/team"},{"label":"Wokwi","url":"https://wokwi.com/projects/456"}]'::JSONB)->>'status',
  'under_review','member submits structured work to an ALL-assigned active team task');
SELECT is((SELECT jsonb_array_length(tracking->phantoms_test.mid('internal_task_alice')::TEXT->'submission_links')
           FROM public.tasks WHERE id=phantoms_test.var('internal_task_cleanup')::BIGINT),2,
  'internal team task preserves multiple submission links in this member’s tracking key');
SELECT ok((SELECT (tracking->phantoms_test.mid('internal_task_alice')::TEXT->>'submitted_at')::TIMESTAMPTZ <= clock_timestamp()
            AND tracking->phantoms_test.mid('internal_task_alice')::TEXT ? 'usefulness_stars'
           FROM public.tasks WHERE id=phantoms_test.var('internal_task_cleanup')::BIGINT),
  'internal team task delivery has a server timestamp and usefulness rating');
SELECT throws_like($$SELECT public.submit_task_status(
  phantoms_test.var('internal_task_hardware_task')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'under_review','','')$$,
  '%TEAM_MEMBERSHIP_REQUIRED%','member cannot submit an ALL task without active membership in its team');
SELECT throws_like($$SELECT public.submit_task_delivery(
  phantoms_test.var('internal_task_hardware_task')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'Cross-team attempt','',3,'easy','[]'::JSONB)$$,
  '%TEAM_MEMBERSHIP_REQUIRED%','structured delivery cannot cross Internal Team membership boundaries');
SELECT is(public.submit_task_status(
  phantoms_test.var('internal_task_revision')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'under_review','revision path','') ->> 'status',
  'under_review','second active team assignment can be submitted');
SELECT is(public.submit_task_status(
  phantoms_test.var('internal_task_zero_bonus')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'under_review','zero bonus path','') ->> 'status',
  'under_review','zero-bonus task is available for legacy reversal regression coverage');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Old global approval is visible to global task admins but must reject a team
-- row before any canonical member rank or global note can persist.
SELECT phantoms_test.login_anon();
SELECT throws_like($$SELECT public.submit_task_status(
  phantoms_test.var('internal_task_main')::BIGINT,phantoms_test.mid('internal_task_alice'),
  phantoms_test.tok('internal_task_alice'),'under_review','','')$$,
  '%MEMBER_PASSWORD_REQUIRED%','anonymous device-token-only team submission remains denied by the password guard');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('internal_task_global_admin');
SELECT throws_like($$SELECT public.approve_task_submission(
  phantoms_test.var('internal_task_main')::BIGINT,
  phantoms_test.mid('internal_task_alice'),0)$$,
  '%TEAM_TASK_USE_SCOPED_REVIEW_RPC%','legacy global approval rejects a team task explicitly');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.members WHERE id=phantoms_test.mid('internal_task_alice')),0,
  'rejected legacy approval cannot change canonical rank');
SELECT is((SELECT count(*)::INT FROM public.notes WHERE target_member_id=phantoms_test.mid('internal_task_alice')),0,
  'rejected legacy approval cannot leave a global bonus note');
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
  WHERE task_id=phantoms_test.var('internal_task_main')::BIGINT),0,
  'rejected legacy approval cannot forge a team contribution event');

-- Team approval/reversal updates only team metrics and scoped ledger events.
SELECT phantoms_test.login_as('internal_task_head');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_approval',public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_main')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'approve','')::TEXT;
SELECT is((phantoms_test.var('internal_task_approval')::JSONB->>'completion_rank')::INT,15,
  'approval RPC returns the team-only awarded rank');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),15,
  'approval atomically adds five rank and the task bonus to team completion rank');
SELECT is((SELECT bonus_points FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),10::BIGINT,
  'team bonus is recorded in team metrics');
SELECT is((SELECT completion_rank FROM public.members WHERE id=phantoms_test.mid('internal_task_alice')),0,
  'team approval never changes canonical global member rank');
SELECT is((SELECT count(*)::INT FROM public.notes WHERE target_member_id=phantoms_test.mid('internal_task_alice')),0,
  'team approval never creates a global bonus note');
SELECT is((SELECT team_id FROM public.task_contribution_events
  WHERE task_id=phantoms_test.var('internal_task_main')::BIGINT AND event_type='approved'),
  phantoms_test.var('internal_task_software')::UUID,'team approval is recorded with its team_id');
SELECT phantoms_test.login_as('internal_task_owner');
SELECT is((public.get_task_contributions(
  extract(year FROM timezone('Africa/Cairo',now()))::INT,
  phantoms_test.mid('internal_task_alice'))->>'total_approvals')::BIGINT,0::BIGINT,
  'team approval events remain excluded from the legacy global heatmap');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('internal_task_head');
SELECT throws_like($$SELECT public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_main')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'approve','')$$,
  '%TEAM_TASK_APPROVAL_REQUIRES_UNDER_REVIEW%','approval requires the documented under_review state');
SELECT lives_ok($$SELECT public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_main')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'revoke','Synthetic team correction')$$,
  'team-only task reviewer can revoke an approval with a reason');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),0,
  'reversal atomically subtracts the exact team rank delta');
SELECT is((SELECT bonus_points FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),0::BIGINT,
  'reversal atomically subtracts the team bonus delta');
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
  WHERE task_id=phantoms_test.var('internal_task_main')::BIGINT AND team_id=phantoms_test.var('internal_task_software')::UUID),2,
  'reversal appends an event without rewriting approval history');
SELECT phantoms_test.login_as('internal_task_head');
SELECT is(public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_zero_bonus')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'approve','') ->> 'status','approved',
  'zero-bonus team approval uses the scoped review RPC');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('internal_task_global_admin');
SELECT throws_like($$SELECT public.revoke_task_approval(
  phantoms_test.var('internal_task_zero_bonus')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'Legacy global reversal attempt')$$,
  '%TEAM_TASK_USE_SCOPED_REVIEW_RPC%','legacy global reversal rejects a team task explicitly');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),5,
  'failed global reversal did not undo team metrics');
SELECT is((SELECT completion_rank FROM public.members WHERE id=phantoms_test.mid('internal_task_alice')),0,
  'failed global reversal did not mutate canonical member rank');
SELECT phantoms_test.login_as('internal_task_head');
SELECT is(public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_zero_bonus')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'revoke','Scoped zero-bonus correction')->>'status',
  'revision_requested','zero-bonus team reversal uses the scoped metric path');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.team_member_metrics
  WHERE team_id=phantoms_test.var('internal_task_software')::UUID
    AND member_id=phantoms_test.mid('internal_task_alice')),0,
  'second scoped reversal returns the team rank to its exact baseline');
SELECT phantoms_test.login_as('internal_task_global_admin');
SELECT throws_like($statement$
  DELETE FROM public.tasks WHERE id=phantoms_test.var('internal_task_main')::BIGINT
$statement$,'%TEAM_TASK_USE_SCOPED_DELETE_RPC%','direct global DELETE cannot bypass team contribution history');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::INT FROM public.tasks WHERE id=phantoms_test.var('internal_task_main')::BIGINT),1,
  'rejected direct DELETE leaves the team task intact');
SELECT phantoms_test.login_as('internal_task_head');
SELECT throws_like($$SELECT public.team_delete_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_main')::BIGINT)$$,
  '%TASK_CONTRIBUTION_HISTORY_BLOCKS_DELETE%','task with ledger history cannot be deleted after reversal');
SELECT throws_like($$SELECT public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_revision')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'revision','')$$,
  '%TEAM_TASK_REVIEW_REASON_REQUIRED%','revision requires a meaningful reason');
SELECT is(public.team_review_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_revision')::BIGINT,
  phantoms_test.mid('internal_task_alice'),'revision','Please provide the missing proof') ->> 'status',
  'revision_requested','reviewer can request revision without changing team metrics');
SELECT is(public.team_delete_task(
  phantoms_test.var('internal_task_software')::UUID,phantoms_test.var('internal_task_cleanup')::BIGINT),TRUE,
  'task without approval history can be deleted through the scoped RPC');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Dashboard history keeps the global summary shape but is scoped to team_id.
SELECT phantoms_test.login_as('internal_task_dashboard');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_summary',public.get_team_task_contributions(
  phantoms_test.var('internal_task_software')::UUID,
  EXTRACT(YEAR FROM timezone('Africa/Cairo',statement_timestamp()))::INT,NULL)::TEXT;
SELECT is(phantoms_test.var('internal_task_summary')::JSONB->>'timezone','Africa/Cairo',
  'team contribution summary preserves the existing dashboard shape');
SELECT is((phantoms_test.var('internal_task_summary')::JSONB->>'total_approvals')::BIGINT,2::BIGINT,
  'team contribution summary counts approvals but does not subtract reversals');
SELECT is(jsonb_typeof(phantoms_test.var('internal_task_summary')::JSONB->'days'),'array',
  'team contribution summary returns the same bounded day/count structure');
SELECT throws_like($$SELECT public.get_team_task_contributions(
  phantoms_test.var('internal_task_hardware')::UUID,
  EXTRACT(YEAR FROM timezone('Africa/Cairo',statement_timestamp()))::INT,NULL)$$,
  '%TEAM_DASHBOARD_PERMISSION_REQUIRED%','dashboard permission remains team-scoped');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- The established global path remains valid: global task approval still changes
-- canonical rank and writes a NULL-team event, never a team event.
INSERT INTO public.tasks(title,assigned_to,tracking)
VALUES ('Synthetic global approval task',jsonb_build_array(phantoms_test.mid('internal_task_alice')::TEXT),
        jsonb_build_object(phantoms_test.mid('internal_task_alice')::TEXT,'{"status":"under_review"}'::JSONB));
INSERT INTO phantoms_test.vars(key,value)
SELECT 'internal_task_global_approval',id::TEXT FROM public.tasks WHERE title='Synthetic global approval task';
SELECT phantoms_test.login_as('internal_task_global_admin');
SELECT lives_ok($$SELECT public.approve_task_submission(
  phantoms_test.var('internal_task_global_approval')::BIGINT,
  phantoms_test.mid('internal_task_alice'),0)$$,'existing global task approval remains unchanged');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT completion_rank FROM public.members WHERE id=phantoms_test.mid('internal_task_alice')),5,
  'global approval still updates only the global canonical rank');
SELECT is((SELECT team_id FROM public.task_contribution_events
  WHERE task_id=phantoms_test.var('internal_task_global_approval')::BIGINT AND event_type='approved'),NULL::UUID,
  'global contribution event retains NULL team scope');

-- RPC exposure and security-definer hardening.
SELECT ok(NOT has_function_privilege('anon','public.team_list_tasks(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.team_list_tasks(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.team_list_tasks(uuid)','EXECUTE'),
  'team task RPCs are authenticated-only');
SELECT ok(NOT has_function_privilege('anon','public.team_create_task(uuid,text,text,jsonb,boolean,timestamp with time zone,integer)','EXECUTE')
  AND has_function_privilege('authenticated','public.team_create_task(uuid,text,text,jsonb,boolean,timestamp with time zone,integer)','EXECUTE'),
  'team task creation cannot be called by anon');

SELECT * FROM finish();
ROLLBACK;
