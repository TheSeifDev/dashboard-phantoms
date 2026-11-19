-- 14 — Append-only task approval/reversal ledger and protected Cairo summary.
-- Synthetic fixtures only; the caller transaction is always rolled back.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['ledger_tasks_admin', 'ledger_dashboard_admin', 'ledger_outsider']) AS n;
  PERFORM phantoms_test.grant_admin('ledger_tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.grant_admin('ledger_dashboard_admin', 'admin', phantoms_test.perms('dashboard'));
  PERFORM phantoms_test.create_member('ledger_alice', NULL, true);
  PERFORM phantoms_test.create_member('ledger_bob', NULL, true);
  PERFORM phantoms_test.create_member('ledger_charlie', NULL, true);
  PERFORM phantoms_test.bind_device('ledger_alice');

  INSERT INTO public.tasks (title, assigned_to, bonus_points, tracking)
  VALUES (
    'Synthetic contribution ledger task',
    jsonb_build_array(phantoms_test.mid('ledger_alice'), phantoms_test.mid('ledger_bob')),
    0,
    jsonb_build_object(
      phantoms_test.mid('ledger_alice')::TEXT, '{"status":"under_review"}'::JSONB,
      phantoms_test.mid('ledger_bob')::TEXT, '{"status":"under_review"}'::JSONB
    )
  );
  INSERT INTO phantoms_test.vars(key, value)
  SELECT 'ledger_main_task', id::TEXT FROM public.tasks WHERE title = 'Synthetic contribution ledger task';

  INSERT INTO public.tasks (title, assigned_to, bonus_points, tracking)
  VALUES (
    'Synthetic rollback ledger task',
    jsonb_build_array(phantoms_test.mid('ledger_charlie')),
    0,
    jsonb_build_object(
      phantoms_test.mid('ledger_charlie')::TEXT, '{"status":"under_review"}'::JSONB
    )
  );
  INSERT INTO phantoms_test.vars(key, value)
  SELECT 'ledger_rollback_task', id::TEXT FROM public.tasks WHERE title = 'Synthetic rollback ledger task';
END $$;

-- Private storage: no browser role receives table or sequence access.
SELECT has_table('public', 'task_contribution_events', 'append-only contribution event table exists');
SELECT has_table('public', 'task_contribution_ledger_config', 'tracking metadata table exists');
SELECT ok((SELECT c.relrowsecurity FROM pg_class AS c
           WHERE c.oid = 'public.task_contribution_events'::regclass),
          'raw ledger has RLS enabled');
SELECT ok(
  NOT has_table_privilege('anon', 'public.task_contribution_events', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.task_contribution_events', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.task_contribution_events', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.task_contribution_events', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.task_contribution_events', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.task_contribution_events', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.task_contribution_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.task_contribution_events', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.task_contribution_events', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.task_contribution_events', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.task_contribution_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.task_contribution_events', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.task_contribution_events', 'TRUNCATE'),
  'clients and service_role cannot read or forge ledger rows');
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_task_contributions(integer,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.get_task_contributions(integer,bigint)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_task_contributions(integer,bigint)', 'EXECUTE'),
  'only authenticated clients can invoke the protected summary RPC');

SELECT phantoms_test.login_as('ledger_alice');
SELECT throws_ok(
  $$SELECT count(*) FROM public.task_contribution_events$$,
  '42501', NULL, 'ordinary member cannot inspect raw ledger rows'
);
SELECT throws_ok(
  $$INSERT INTO public.task_contribution_events
      (task_id, member_id, event_type, occurred_at, actor_user_id, provenance)
    VALUES (phantoms_test.var('ledger_main_task')::BIGINT,
            phantoms_test.mid('ledger_alice'), 'approved', now(),
            phantoms_test.uid('ledger_alice'), 'live_transition')$$,
  '42501', NULL, 'ordinary member cannot forge a ledger event'
);
RESET ROLE;
SELECT phantoms_test.clear_auth();

SELECT phantoms_test.login_anon();
SELECT throws_ok(
  $$SELECT public.get_task_contributions(EXTRACT(YEAR FROM timezone('Africa/Cairo', now()))::INTEGER, NULL)$$,
  '42501', NULL, 'anonymous callers cannot execute the summary RPC'
);
RESET ROLE;
SELECT phantoms_test.login_as('ledger_outsider');
SELECT throws_like(
  $$SELECT public.get_task_contributions(EXTRACT(YEAR FROM timezone('Africa/Cairo', now()))::INTEGER, NULL)$$,
  '%DASHBOARD_PERMISSION_REQUIRED%', 'authenticated non-admin cannot read the summary'
);
RESET ROLE;
SELECT phantoms_test.login_as('ledger_tasks_admin');
SELECT throws_like(
  $$SELECT public.get_task_contributions(EXTRACT(YEAR FROM timezone('Africa/Cairo', now()))::INTEGER, NULL)$$,
  '%DASHBOARD_PERMISSION_REQUIRED%', 'task-only Admin cannot read dashboard activity'
);
RESET ROLE;
SELECT phantoms_test.login_as('ledger_dashboard_admin');
SELECT throws_like(
  $$SELECT public.approve_task_submission(phantoms_test.var('ledger_rollback_task')::BIGINT,
      phantoms_test.mid('ledger_charlie'), 0)$$,
  '%TASKS_PERMISSION_REQUIRED%', 'dashboard-only permission is not sufficient to approve a task'
);
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_baseline_all', public.get_task_contributions(
  EXTRACT(YEAR FROM timezone('Africa/Cairo', statement_timestamp()))::INTEGER, NULL
)::TEXT;
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_baseline_today_count', COALESCE((
  SELECT (d.value ->> 'count')::BIGINT
  FROM jsonb_array_elements(phantoms_test.var('ledger_baseline_all')::JSONB -> 'days') AS d(value)
  WHERE d.value ->> 'date' = phantoms_test.var('ledger_baseline_all')::JSONB ->> 'today'
), 0)::TEXT;
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_baseline_total', phantoms_test.var('ledger_baseline_all')::JSONB ->> 'total_approvals';
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- Any failure later in the same transaction rolls back both approval effects
-- and the trigger-written event; there can be no dangling ledger entry.
SELECT phantoms_test.login_as('ledger_tasks_admin');
SELECT throws_like(
  $statement$
  DO $rollback$
  BEGIN
    PERFORM public.approve_task_submission(
      phantoms_test.var('ledger_rollback_task')::BIGINT,
      phantoms_test.mid('ledger_charlie'), 0
    );
    RAISE EXCEPTION 'LEDGER_TEST_ROLLBACK_SENTINEL';
  END
  $rollback$;
  $statement$,
  '%LEDGER_TEST_ROLLBACK_SENTINEL%', 'forced transaction failure aborts an otherwise valid approval'
);
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_rollback_task')::BIGINT),
          0, 'rolled-back approval leaves no ledger event');
SELECT is((SELECT tracking -> phantoms_test.mid('ledger_charlie')::TEXT ->> 'status'
           FROM public.tasks WHERE id = phantoms_test.var('ledger_rollback_task')::BIGINT),
          'under_review', 'rolled-back approval leaves task tracking unchanged');
SELECT is((SELECT completion_rank FROM public.members WHERE id = phantoms_test.mid('ledger_charlie')),
          0, 'rolled-back approval leaves member rank unchanged');

-- Successful approvals use the existing RPC and preserve its zero-bonus rank
-- contract; the AFTER trigger writes one event per transition in the same tx.
SELECT phantoms_test.login_as('ledger_tasks_admin');
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_alice_approval', public.approve_task_submission(
  phantoms_test.var('ledger_main_task')::BIGINT, phantoms_test.mid('ledger_alice'), 0
)::TEXT;
SELECT is((phantoms_test.var('ledger_alice_approval')::JSONB ->> 'bonus_awarded')::INT,
          0, 'zero-bonus approval remains valid');
SELECT is((phantoms_test.var('ledger_alice_approval')::JSONB ->> 'rank_awarded')::INT,
          5, 'zero-bonus approval retains the existing five-rank award');
SELECT throws_like(
  $$SELECT public.approve_task_submission(phantoms_test.var('ledger_main_task')::BIGINT,
      phantoms_test.mid('ledger_alice'), 0)$$,
  '%ALREADY_APPROVED%', 'the existing RPC rejects repeated approval'
);
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_bob_approval', public.approve_task_submission(
  phantoms_test.var('ledger_main_task')::BIGINT, phantoms_test.mid('ledger_bob'), 0
)::TEXT;
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'approved'),
          1, 'one live approval transition creates exactly one approval event');
SELECT is((SELECT provenance FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'approved'),
          'live_transition', 'new events identify their live transition provenance');
SELECT is((SELECT actor_user_id FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'approved'),
          phantoms_test.uid('ledger_tasks_admin'), 'live approval stores the authenticated Admin actor');
SELECT is((SELECT occurred_at <= statement_timestamp() FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'approved'),
          TRUE, 'live approval timestamp is generated by the transition transaction');
SELECT is((SELECT count(*)::INT FROM public.notes
           WHERE source_task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND source_member_id = phantoms_test.mid('ledger_alice')),
          0, 'zero bonus still creates no bonus note');

-- A member cannot change an approved item through the member submission RPC.
SELECT phantoms_test.login_as('ledger_alice');
SELECT throws_like(
  $$SELECT public.submit_task_status(
      phantoms_test.var('ledger_main_task')::BIGINT,
      phantoms_test.mid('ledger_alice'), phantoms_test.tok('ledger_alice'),
      'revision_requested', 'member cannot reverse approval', '')$$,
  '%ADMIN_APPROVAL_FORBIDDEN%', 'member cannot forge a reversal of an approved task'
);
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice')),
          1, 'rejected member attempt creates no ledger event');
SELECT is((SELECT tracking -> phantoms_test.mid('ledger_alice')::TEXT ->> 'status'
           FROM public.tasks WHERE id = phantoms_test.var('ledger_main_task')::BIGINT),
          'approved', 'rejected member attempt leaves approved tracking unchanged');

-- Revocation is an auditable event, not deletion of the original approval;
-- re-approval adds another activity event after the same task is approved anew.
SELECT phantoms_test.login_as('ledger_tasks_admin');
SELECT lives_ok(
  $$SELECT public.revoke_task_approval(phantoms_test.var('ledger_main_task')::BIGINT,
      phantoms_test.mid('ledger_alice'), 'Synthetic review correction')$$,
  'authorized Admin can revoke through the existing RPC'
);
SELECT throws_like(
  $$SELECT public.revoke_task_approval(phantoms_test.var('ledger_main_task')::BIGINT,
      phantoms_test.mid('ledger_alice'), 'Duplicate synthetic reversal')$$,
  '%NOT_APPROVED%', 'the existing RPC rejects a repeated reversal'
);
SELECT lives_ok(
  $$SELECT public.approve_task_submission(phantoms_test.var('ledger_main_task')::BIGINT,
      phantoms_test.mid('ledger_alice'), 0)$$,
  're-approved submission is recorded as a new approval transition'
);
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'approved'),
          2, 're-approval appends a second approval row without rewriting history');
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT
             AND member_id = phantoms_test.mid('ledger_alice') AND event_type = 'reversed'),
          1, 'revocation appends one reversal row while retaining both approvals');

-- Dashboard-only reader gets a bounded, privacy-preserving aggregate. Member
-- filtering isolates each member while team-wide counts retain all activity.
SELECT phantoms_test.login_as('ledger_dashboard_admin');
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_summary_all', public.get_task_contributions(
  EXTRACT(YEAR FROM timezone('Africa/Cairo', statement_timestamp()))::INTEGER, NULL
)::TEXT;
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_summary_alice', public.get_task_contributions(
  EXTRACT(YEAR FROM timezone('Africa/Cairo', statement_timestamp()))::INTEGER,
  phantoms_test.mid('ledger_alice')
)::TEXT;
INSERT INTO phantoms_test.vars(key, value)
SELECT 'ledger_summary_bob', public.get_task_contributions(
  EXTRACT(YEAR FROM timezone('Africa/Cairo', statement_timestamp()))::INTEGER,
  phantoms_test.mid('ledger_bob')
)::TEXT;
SELECT is(phantoms_test.var('ledger_summary_all')::JSONB ->> 'timezone',
          'Africa/Cairo', 'summary declares its stable Cairo timezone');
SELECT is((phantoms_test.var('ledger_summary_all')::JSONB ->> 'today')::DATE,
          timezone('Africa/Cairo', statement_timestamp())::DATE, 'summary today uses Cairo local date');
SELECT is((phantoms_test.var('ledger_summary_all')::JSONB ->> 'tracking_started_at')::TIMESTAMPTZ IS NOT NULL,
          TRUE, 'summary exposes when tracking began');
SELECT is((phantoms_test.var('ledger_summary_all')::JSONB ->> 'history_complete_since')::TIMESTAMPTZ,
          (phantoms_test.var('ledger_summary_all')::JSONB ->> 'tracking_started_at')::TIMESTAMPTZ,
          'summary exposes the complete-history boundary, separate from legacy snapshots');
SELECT is((phantoms_test.var('ledger_summary_all')::JSONB ->> 'total_approvals')::BIGINT
            - phantoms_test.var('ledger_baseline_total')::BIGINT,
          3::BIGINT, 'team-wide current-year total includes both approvals plus re-approval');
SELECT is((phantoms_test.var('ledger_summary_alice')::JSONB ->> 'total_approvals')::BIGINT,
          2::BIGINT, 'member filter includes only Alice approval events');
SELECT is((phantoms_test.var('ledger_summary_bob')::JSONB ->> 'total_approvals')::BIGINT,
          1::BIGINT, 'member filter includes only Bob approval events');
SELECT is(COALESCE((
  SELECT (d.value ->> 'count')::BIGINT
  FROM jsonb_array_elements(phantoms_test.var('ledger_summary_alice')::JSONB -> 'days') AS d(value)
  WHERE d.value ->> 'date' = phantoms_test.var('ledger_summary_alice')::JSONB ->> 'today'
), 0), 2::BIGINT, 'Alice heatmap keeps both approvals after one was reversed');
SELECT is(COALESCE((
  SELECT (d.value ->> 'count')::BIGINT
  FROM jsonb_array_elements(phantoms_test.var('ledger_summary_bob')::JSONB -> 'days') AS d(value)
  WHERE d.value ->> 'date' = phantoms_test.var('ledger_summary_bob')::JSONB ->> 'today'
), 0), 1::BIGINT, 'Bob heatmap does not include Alice activity');
SELECT is(COALESCE((
  SELECT (d.value ->> 'count')::BIGINT
  FROM jsonb_array_elements(phantoms_test.var('ledger_summary_all')::JSONB -> 'days') AS d(value)
  WHERE d.value ->> 'date' = phantoms_test.var('ledger_summary_all')::JSONB ->> 'today'
), 0) - phantoms_test.var('ledger_baseline_today_count')::BIGINT,
          3::BIGINT, 'team heatmap adds all three approval events and never subtracts reversal');
SELECT ok(jsonb_array_length(phantoms_test.var('ledger_summary_all')::JSONB -> 'days') <= 366,
          'summary days are bounded to at most 366 entries');
SELECT ok(jsonb_typeof(phantoms_test.var('ledger_summary_all')::JSONB -> 'days') = 'array',
          'summary exposes only a day/count JSON array, not raw events');
SELECT throws_like(
  $$SELECT public.get_task_contributions(1999, NULL)$$,
  '%INVALID_YEAR%', 'years earlier than the supported range are rejected'
);
SELECT throws_like(
  $$SELECT public.get_task_contributions(9999, NULL)$$,
  '%INVALID_YEAR%', 'future years are rejected'
);
SELECT throws_like(
  $$SELECT public.get_task_contributions(
      EXTRACT(YEAR FROM timezone('Africa/Cairo', statement_timestamp()))::INTEGER, 0)$$,
  '%INVALID_MEMBER_ID%', 'non-positive member selectors are rejected'
);
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- The append-only trigger is a second layer behind revoked table privileges.
SELECT throws_like(
  $$UPDATE public.task_contribution_events SET occurred_at = occurred_at
    WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT$$,
  '%TASK_CONTRIBUTION_LEDGER_APPEND_ONLY%', 'even privileged row updates cannot rewrite ledger history'
);
SELECT throws_like(
  $$DELETE FROM public.task_contribution_events
    WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT$$,
  '%TASK_CONTRIBUTION_LEDGER_APPEND_ONLY%', 'even privileged row deletes cannot erase ledger history'
);
SELECT throws_like(
  $$TRUNCATE public.task_contribution_events$$,
  '%TASK_CONTRIBUTION_LEDGER_APPEND_ONLY%', 'even privileged truncate cannot erase ledger history'
);
SELECT is((SELECT count(*)::INT FROM public.task_contribution_events
           WHERE task_id = phantoms_test.var('ledger_main_task')::BIGINT),
          4, 'append-only guard leaves all four main-task events intact');

SELECT * FROM finish();
ROLLBACK;
