-- 26 — Owner Member/Auth erasure safety gate.
-- This suite asserts the existing schema blockers; it does not attempt deletion.
-- Catalog-only assertions avoid reading or mutating any real application rows.
BEGIN;
\ir _helpers.psql
SELECT plan(20);

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.member_auth_bindings'::regclass
    AND c.confrelid = 'auth.users'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'member_auth_bindings retains its RESTRICT Auth-user reference');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.member_password_invitations'::regclass
    AND c.confrelid = 'public.members'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'member_password_invitations retains its RESTRICT Member reference');

SELECT ok((
  SELECT count(*) >= 3
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.member_password_invitations'::regclass
    AND c.confrelid = 'auth.users'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'invitation creator, expected Auth identity, and Auth identity references remain RESTRICT');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.member_app_usage'::regclass
    AND c.confrelid = 'public.members'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'member_app_usage retains its RESTRICT Member reference');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.team_memberships'::regclass
    AND c.confrelid = 'public.members'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'team_memberships retains its RESTRICT Member reference');

SELECT ok((
  SELECT count(*) >= 3
  FROM pg_catalog.pg_constraint AS c
  WHERE c.confrelid = 'public.team_memberships'::regclass
    AND c.conrelid IN (
      'public.team_member_metrics'::regclass,
      'public.team_member_custom_field_values'::regclass,
      'public.announcement_recipients'::regclass
    )
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
    AND pg_catalog.cardinality(c.conkey) > 1
), 'team metrics, custom-field values, and announcement recipients retain composite RESTRICT membership references');

SELECT ok((
  SELECT count(*) >= 3
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.web_projects'::regclass
    AND c.confrelid = 'public.members'::regclass
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
), 'Web Project owner, lead, and origin-member references remain RESTRICT');

SELECT ok((
  SELECT count(*) >= 9
  FROM pg_catalog.pg_trigger AS t
  WHERE NOT t.tgisinternal
    AND t.tgname = ANY (ARRAY[
      'team_access_audit_no_mutation',
      'task_contribution_events_append_only',
      'member_infinite_bonus_events_immutable',
      'web_program_admin_audit_no_mutation',
      'web_project_agreements_no_mutation',
      'web_project_acceptances_no_mutation',
      'web_project_consents_no_mutation',
      'web_project_activity_no_mutation',
      'web_idea_reviews_no_mutation'
    ])
), 'known team, bonus, contribution, and Web Project histories retain append-only mutation guards');

SELECT ok((
  SELECT count(*) >= 9
  FROM pg_catalog.pg_trigger AS t
  WHERE NOT t.tgisinternal
    AND t.tgname = ANY (ARRAY[
      'team_access_audit_no_truncate',
      'task_contribution_events_no_truncate',
      'member_infinite_bonus_events_immutable',
      'web_program_admin_audit_no_truncate',
      'web_project_agreements_no_truncate',
      'web_project_acceptances_no_truncate',
      'web_project_consents_no_truncate',
      'web_project_activity_no_truncate',
      'web_idea_reviews_no_truncate'
    ])
), 'known append-only histories retain TRUNCATE protection');

SELECT is((
  SELECT count(*)::integer
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND ((c.table_name = 'tasks' AND c.column_name IN ('assigned_to', 'tracking'))
      OR (c.table_name = 'announcements' AND c.column_name IN ('target_audience', 'read_receipts')))
    AND c.data_type = 'jsonb'
), 4, 'task assignments/tracking and announcement audience/receipts are JSONB non-FK identifier stores');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid IN (
      'public.task_contribution_events'::regclass,
      'public.member_infinite_bonus_events'::regclass
    )
      AND c.confrelid = 'public.members'::regclass
      AND c.contype = 'f'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.task_contribution_events'::regclass
      AND a.attname = 'member_id' AND NOT a.attisdropped
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.member_infinite_bonus_events'::regclass
      AND a.attname = 'member_id' AND NOT a.attisdropped
  ), 'contribution and bonus histories retain Member identifiers without Member foreign keys');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='owner_member_erasure_append_guard'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%phantoms.owner_member_erasure_operation%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%owner_member_erasure_operations%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%APPEND_ONLY_TRUNCATE_FORBIDDEN%'
), 'append-only privacy exception requires an active transaction-scoped exact operation and retains TRUNCATE protection');

SELECT ok(has_function_privilege('authenticated','public.owner_member_erasure_preview(bigint)','EXECUTE')
  AND has_function_privilege('authenticated','public.owner_member_erasure_execute_database(uuid,bigint,uuid,jsonb,text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.owner_member_erasure_status(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.owner_member_erasure_preview(bigint)','EXECUTE'),
  'preview, execute, and safe status RPCs are exposed to authenticated callers only with in-function Owner checks');

SELECT ok(has_function_privilege('service_role','public.owner_member_erasure_storage_candidates(uuid,text,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.owner_member_erasure_store_storage_batch(uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.owner_member_erasure_pending_storage_batch(uuid,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.owner_member_erasure_mark_storage_batch(uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.owner_member_erasure_mark_auth_deleted(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.owner_member_erasure_operation_work(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.owner_member_erasure_operation_work(uuid)','EXECUTE'),
  'Storage/Auth saga work RPCs are service_role-only');

SELECT ok(NOT has_table_privilege('authenticated','public.owner_member_erasure_operations','SELECT')
  AND NOT has_table_privilege('service_role','public.owner_member_erasure_operations','SELECT')
  AND NOT has_table_privilege('authenticated','public.owner_member_erasure_storage_objects','SELECT')
  AND NOT has_table_privilege('service_role','public.owner_member_erasure_storage_objects','SELECT'),
  'private operation and Storage manifest tables deny direct table access');

SELECT ok((
  SELECT count(*)=13 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'owner_member_erasure_%'
    AND p.proname<>'owner_member_erasure_json_has_identity'
), 'all privileged erasure RPCs use SECURITY DEFINER with an empty search_path');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='member_bonus_audit_statement_guard'
    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%owner_member_erasure_operations%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%public.is_owner()%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%BONUS_AUDIT_IMMUTABLE%'
) AND NOT has_function_privilege('authenticated','public.member_bonus_audit_statement_guard()','EXECUTE')
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid='public.member_infinite_bonus_events'::regclass
      AND t.tgname='member_infinite_bonus_events_immutable' AND NOT t.tgisinternal
      AND (t.tgtype & 1)=0 AND (t.tgtype & 8)=8 AND (t.tgtype & 16)=16 AND (t.tgtype & 32)=32
  ), 'bonus statement guard is private, pinned, and covers UPDATE/DELETE/TRUNCATE');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='owner_member_erasure_execute_database'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%LOCK TABLE public.members,public.member_auth_bindings%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%public.web_project_integrations,public.web_idea_reviews,storage.objects%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%AND NOT (ns.nspname=''_realtime'' AND rel.relname IN (''extensions'',''feature_flags''))%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%rel.relkind IN (''r'',''p'')%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%r.nspname,r.relname%'
    AND pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%r.nspname,rel.relname%'
), 'erasure executor keeps application/Storage locks and excludes only the named Realtime metadata tables');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'owner_member_erasure_%'
    AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%DELETE FROM storage.objects%'
), 'no erasure SQL RPC directly deletes Storage objects');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='storage.objects'::regclass
    AND t.tgname='owner_member_erasure_storage_write_guard'
    AND NOT t.tgisinternal
), 'Storage writes cannot add or transfer target ownership during the committed erasure saga');

ROLLBACK;
