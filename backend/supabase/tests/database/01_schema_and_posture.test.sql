-- 01 — Final schema, signatures, constraints, indexes, triggers, RLS posture and
-- RPC grants after applying the full 24-migration chain on a fresh database.
BEGIN;
\ir _helpers.psql

SELECT plan(57);

-- ---------------------------------------------------------------------------
-- Migration history
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM supabase_migrations.schema_migrations), 24,
  'exactly 24 migrations are recorded');
SELECT is((SELECT min(version) FROM supabase_migrations.schema_migrations), '20261112000000',
  'first migration is 20261112000000');
SELECT is((SELECT max(version) FROM supabase_migrations.schema_migrations), '20261112000023',
  'last migration is 20261112000023');

-- ---------------------------------------------------------------------------
-- Tables present / removed
-- ---------------------------------------------------------------------------
SELECT tables_are('public', ARRAY[
  'admin_accounts', 'admin_emails', 'announcements', 'member_custom_fields',
  'member_device_sessions', 'member_evaluations', 'member_infinite_bonus_events',
  'member_registration_invites', 'members', 'notes', 'tasks', 'whatsapp_settings'
], 'public schema contains exactly the 12 final application tables');
SELECT hasnt_table('public', 'member_info_fields', '0019 member_info_fields was removed by 0020');
SELECT hasnt_table('public', 'member_info_submissions', '0019 member_info_submissions was removed by 0020');
SELECT hasnt_table('public', 'admin_permissions', 'no separate admin_permissions table exists');
SELECT is((SELECT count(*)::int FROM public.admin_emails), 0,
  'deprecated admin_emails holds no hardcoded placeholder identities');
SELECT is((SELECT count(*)::int FROM public.admin_accounts), 0,
  'fresh database has no admin or owner rows (owner comes only from bootstrap)');
SELECT is((SELECT enabled FROM public.whatsapp_settings WHERE id = 1), false,
  'WhatsApp is disabled by default');

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
SELECT hasnt_column('public', 'members', 'team', 'members.team removed (0006)');
SELECT hasnt_column('public', 'notes', 'team', 'notes.team removed (0006)');
SELECT hasnt_column('public', 'notes', 'target_team', 'notes.target_team removed (0006)');
SELECT has_column('public', 'members', 'custom_fields', 'members.custom_fields exists (0020)');
SELECT col_not_null('public', 'members', 'custom_fields', 'members.custom_fields is NOT NULL');
SELECT has_column('public', 'members', 'bonus_infinite', 'members.bonus_infinite exists (0016)');
SELECT has_column('public', 'notes', 'source_task_id', 'notes.source_task_id exists (0018)');
SELECT has_column('public', 'notes', 'source_member_id', 'notes.source_member_id exists (0018)');
SELECT has_column('public', 'tasks', 'bonus_points', 'tasks.bonus_points exists (0012)');
SELECT has_column('public', 'admin_accounts', 'permissions', 'admin_accounts.permissions exists');
SELECT col_type_is('public', 'admin_accounts', 'permissions', 'jsonb', 'admin_accounts.permissions is jsonb');

-- ---------------------------------------------------------------------------
-- Final eight-key permission model
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid)
     FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.admin_accounts'::regclass AND a.attname = 'permissions')::text ~ 'member_info',
  false, 'permissions default has no member_info key');
SELECT ok(
  (SELECT bool_and(pg_get_expr(d.adbin, d.adrelid) ~ ('"' || k || '": ?true'))
     FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum,
          unnest(ARRAY['dashboard','members','tasks','ranking','notes','announcements','whatsapp','ai_assistant']) AS k
    WHERE d.adrelid = 'public.admin_accounts'::regclass AND a.attname = 'permissions'),
  'permissions default enables all eight final keys');
SELECT has_check('public', 'admin_accounts', 'admin_accounts has CHECK constraints');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_accounts_permissions_valid'
                  AND conrelid = 'public.admin_accounts'::regclass),
  'admin_accounts_permissions_valid constraint exists');
SELECT ok(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'admin_accounts_permissions_valid'))
          !~ 'member_info',
  'permissions CHECK constraint no longer references member_info');
SELECT has_index('public', 'admin_accounts', 'admin_accounts_single_owner', 'single-owner partial unique index exists');
SELECT ok((SELECT indisunique FROM pg_index WHERE indexrelid = 'public.admin_accounts_single_owner'::regclass),
  'single-owner index is UNIQUE');

-- ---------------------------------------------------------------------------
-- Function signatures (0006 return-type repair, 0007/0009 replacements)
-- ---------------------------------------------------------------------------
SELECT hasnt_function('public', 'lookup_member_by_email', ARRAY['text'],
  'legacy one-argument lookup_member_by_email(text) no longer exists');
SELECT has_function('public', 'lookup_member_by_email', ARRAY['text', 'text'],
  'lookup_member_by_email(text, text) exists');
SELECT ok(pg_get_function_result('public.lookup_member_by_email(text,text)'::regprocedure) !~ '\m(team|session_token|phone|push_subscription)\M',
  'lookup_member_by_email returns no team/session_token/phone/push_subscription columns');
SELECT function_returns('public', 'admin_add_member_rating', ARRAY['bigint','integer','text','text'], 'bigint',
  'admin_add_member_rating(bigint,int,text,text) returns bigint');
SELECT function_returns('public', 'approve_task_submission', ARRAY['bigint','bigint','integer'], 'jsonb',
  'approve_task_submission returns jsonb');
SELECT function_returns('public', 'revoke_task_approval', ARRAY['bigint','bigint','text'], 'jsonb',
  'revoke_task_approval returns jsonb');
SELECT hasnt_function('public', 'admin_remove_account', ARRAY['uuid'],
  'admin_remove_account was removed in 0015 (deletion goes through an Edge Function)');
SELECT hasnt_function('public', 'get_member_info_form', ARRAY['bigint','text'], '0019 RPCs removed');

-- ---------------------------------------------------------------------------
-- Foreign keys, indexes, triggers
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 'admin_accounts', 'user_id', 'auth', 'users', 'id', 'admin_accounts.user_id -> auth.users.id');
SELECT fk_ok('public', 'member_device_sessions', 'member_id', 'public', 'members', 'id', 'member_device_sessions.member_id -> members.id');
SELECT fk_ok('public', 'member_evaluations', 'member_id', 'public', 'members', 'id', 'member_evaluations.member_id -> members.id');
SELECT fk_ok('public', 'notes', 'source_task_id', 'public', 'tasks', 'id', 'notes.source_task_id -> tasks.id');
SELECT fk_ok('public', 'member_registration_invites', 'registered_member_id', 'public', 'members', 'id', 'invites.registered_member_id -> members.id');
SELECT has_index('public', 'members', 'idx_members_custom_fields', 'GIN index on members.custom_fields');
SELECT has_trigger('public', 'members', 'members_bonus_infinite_rpc_only', 'bonus_infinite write guard trigger');
SELECT has_trigger('public', 'member_infinite_bonus_events', 'member_infinite_bonus_events_immutable', 'bonus audit log immutability trigger');
SELECT has_trigger('public', 'tasks', 'trg_tasks_guard_anon', 'anon approval guard trigger on tasks');

-- ---------------------------------------------------------------------------
-- RLS posture
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity), 0,
  'RLS is enabled on every public table');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)), 0,
  'no RLS policy grants anything to anon (member portal uses device-bound RPCs only)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
            AND (btrim(coalesce(qual, '')) = 'true' OR btrim(coalesce(with_check, '')) = 'true')), 0,
  'no permissive USING (true) / WITH CHECK (true) policy remains');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND grantee = 'anon'), 0,
  'anon holds no table privileges in public');
SELECT is((SELECT count(*)::int FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND grantee = 'anon'), 0,
  'anon holds no column privileges in public');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND grantee = 'authenticated'
              AND table_name IN ('admin_accounts', 'admin_emails', 'member_device_sessions',
                                 'member_infinite_bonus_events', 'whatsapp_settings')), 0,
  'authenticated has no direct privileges on admin/session/audit/WhatsApp tables');

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER hygiene and RPC grants
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS c WHERE c LIKE 'search_path=%')), 0,
  'every SECURITY DEFINER function in public pins search_path');
SELECT is(
  (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname IN ('admin_add_account', 'admin_add_member_rating', 'admin_list_accounts',
                        'admin_update_permissions', 'approve_task_submission', 'revoke_task_approval',
                        'create_member_invite', 'set_member_bonus_infinite', 'get_admin_access',
                        'has_admin_permission', 'is_admin', 'is_owner', 'get_announcement_details',
                        'get_announcement_stats', 'get_groq_key_from_vault', 'set_groq_key',
                        'assert_member_device')),
  NULL::text[],
  'no privileged/admin RPC is executable by anon');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_groq_key_from_vault()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.set_groq_key(text)', 'EXECUTE'),
  'Vault key functions are service_role-only');
SELECT ok(NOT has_function_privilege('anon', 'public.assert_member_device(bigint,text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.assert_member_device(bigint,text)', 'EXECUTE'),
  'assert_member_device is internal (not callable through the Data API)');
SELECT ok(has_function_privilege('anon', 'public.lookup_member_by_email(text,text)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.submit_task_status(bigint,bigint,text,text,text,text)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.get_member_tasks(bigint,text)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.submit_member_registration_invite(text,jsonb)', 'EXECUTE'),
  'member-portal RPCs remain executable by anon (device/invite gated internally)');
SELECT ok(NOT has_schema_privilege('anon', 'public', 'CREATE')
          AND NOT has_schema_privilege('authenticated', 'public', 'CREATE'),
  'anon/authenticated cannot create objects in public (search_path=public definers stay safe)');

SELECT * FROM finish();
ROLLBACK;
