-- 04 — Member portal: device-bound sessions, OTP binding, enumeration and
-- BOLA/IDOR resistance, task submission paths (anon, OTP-authenticated
-- member, tasks admin), session expiry and logout.
BEGIN;
\ir _helpers.psql

SELECT plan(38);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user('tasks_admin');
  PERFORM phantoms_test.create_user('members_admin');
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  PERFORM phantoms_test.create_member('dave');
  -- Auth identities that share the member's email (simulates a verified OTP login).
  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         m.email, now(), '{"provider":"email"}', '{}', now(), now()
  FROM phantoms_test.members AS m WHERE m.name IN ('alice', 'bob');
  INSERT INTO phantoms_test.users (name, id, email)
  SELECT 'otp_' || m.name, u.id, u.email
  FROM phantoms_test.members AS m JOIN auth.users AS u ON u.email = m.email
  WHERE m.name IN ('alice', 'bob');
  PERFORM phantoms_test.bind_device('bob');
  INSERT INTO public.tasks (title, assigned_to, tracking)
  VALUES ('Alice task', jsonb_build_array(phantoms_test.mid('alice')::text),
          jsonb_build_object(phantoms_test.mid('bob')::text, '{"status":"pending","note":"bob secret"}'::jsonb));
  INSERT INTO public.tasks (title, assigned_to) VALUES ('Bob only', jsonb_build_array(phantoms_test.mid('bob')));
  INSERT INTO public.tasks (title, assigned_to) VALUES ('Everyone', '"ALL"'::jsonb);
  INSERT INTO phantoms_test.vars VALUES
    ('alice_task', (SELECT id::text FROM public.tasks WHERE title = 'Alice task')),
    ('bob_task', (SELECT id::text FROM public.tasks WHERE title = 'Bob only')),
    ('all_task', (SELECT id::text FROM public.tasks WHERE title = 'Everyone'));
  INSERT INTO public.notes (text, author, target_member_id) VALUES
    ('Good job [B:+3]', 'admin', phantoms_test.mid('alice')),
    ('Late [B:-1]', 'admin', phantoms_test.mid('alice')),
    ('Bob note [B:+7]', 'admin', phantoms_test.mid('bob'));
END $$;

-- Enumeration resistance and unauthenticated binding ------------------------------
SELECT phantoms_test.login_anon();
SELECT is((SELECT count(*)::int FROM public.lookup_member_by_email((SELECT email FROM phantoms_test.members WHERE name = 'alice'), NULL)), 0,
  'anon lookup without a device token reveals nothing about an existing member');
SELECT is((SELECT count(*)::int FROM public.lookup_member_by_email((SELECT email FROM phantoms_test.members WHERE name = 'alice'), phantoms_test.tok('alice'))), 0,
  'anon lookup with an unbound device token reveals nothing and does not bind');
SELECT is((SELECT count(*)::int FROM public.lookup_member_by_email('nobody@phantoms-test.example', 'whatever-token-0123456789')), 0,
  'unknown email returns the same empty result');
SELECT throws_like($$SELECT public.bind_member_device_session((SELECT email FROM phantoms_test.members WHERE name = 'alice'), phantoms_test.tok('alice'))$$,
  '%UNAUTHORIZED%', 'anon cannot bind a device without OTP verification');
SELECT throws_like($$SELECT public.get_member_tasks(phantoms_test.mid('alice'), phantoms_test.tok('alice'))$$,
  '%DEVICE_REQUIRED%', 'unbound token cannot read member tasks');
SELECT throws_ok($$SELECT public.assert_member_device(phantoms_test.mid('alice'), phantoms_test.tok('alice'))$$,
  '42501', NULL, 'assert_member_device is not directly callable');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.member_device_sessions WHERE member_id = phantoms_test.mid('alice')), 0,
  'no session row was created for alice by anonymous attempts');

-- OTP-verified binding ---------------------------------------------------------
SELECT phantoms_test.login_as('otp_bob');
SELECT throws_like($$SELECT public.bind_member_device_session((SELECT email FROM phantoms_test.members WHERE name = 'alice'), 'attacker-device-token-0123456789')$$,
  '%UNAUTHORIZED%', 'an OTP session for bob cannot bind a device to alice');
RESET ROLE;
SELECT phantoms_test.login_as('otp_alice');
SELECT ok(public.bind_member_device_session(upper((SELECT email FROM phantoms_test.members WHERE name = 'alice')), phantoms_test.tok('alice')),
  'alice binds her device after OTP verification');
SELECT throws_like($$SELECT public.bind_member_device_session((SELECT email FROM phantoms_test.members WHERE name = 'alice'), 'short')$$,
  '%DEVICE_REQUIRED%', 'device tokens shorter than 16 characters are rejected');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT token_hash FROM public.member_device_sessions WHERE member_id = phantoms_test.mid('alice')),
  encode(extensions.digest(convert_to(phantoms_test.tok('alice'), 'UTF8'), 'sha256'), 'hex'),
  'only the SHA-256 hash of the device token is stored');

-- Bound device: anon portal access ----------------------------------------------
SELECT phantoms_test.login_anon();
SELECT is((SELECT full_name FROM public.lookup_member_by_email((SELECT email FROM phantoms_test.members WHERE name = 'alice'), phantoms_test.tok('alice'))),
  'Test alice', 'bound device can look up its own member profile');
SELECT is(jsonb_array_length(public.get_member_tasks(phantoms_test.mid('alice'), phantoms_test.tok('alice'))), 2,
  'alice sees exactly her assigned task and the ALL task');
SELECT ok(public.get_member_tasks(phantoms_test.mid('alice'), phantoms_test.tok('alice'))::text !~ 'bob secret',
  'get_member_tasks never leaks another member''s tracking entry');
SELECT throws_like($$SELECT public.get_member_tasks(phantoms_test.mid('bob'), phantoms_test.tok('alice'))$$,
  '%DEVICE_REQUIRED%', 'IDOR: alice''s token cannot read bob''s tasks');
SELECT throws_like($$SELECT public.get_member_tasks(phantoms_test.mid('alice'), NULL)$$,
  '%DEVICE_REQUIRED%', 'missing device token is rejected');
SELECT is(public.get_member_bonus_total(phantoms_test.mid('alice'), phantoms_test.tok('alice')), 2::bigint,
  'bonus total sums [B:±n] tags for alice only (+3 −1)');
SELECT throws_like($$SELECT public.get_member_bonus_total(phantoms_test.mid('bob'), phantoms_test.tok('alice'))$$,
  '%DEVICE_REQUIRED%', 'IDOR: alice''s token cannot read bob''s bonus total');
SELECT is(public.get_member_bonus_infinite(phantoms_test.mid('alice'), phantoms_test.tok('alice')), false,
  'alice reads her own bonus_infinite flag');

-- Task submission: anon member path ----------------------------------------------
SELECT is(public.submit_task_status(phantoms_test.var('alice_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'),
                                    'under_review', 'done', 'https://example.com/proof') ->> 'status',
  'under_review', 'anon member submits her own assigned task');
SELECT lives_ok($$SELECT public.submit_task_status(phantoms_test.var('all_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'), 'in_progress', '', '')$$,
  'anon member can update a task assigned to ALL');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'), 'under_review', '', '')$$,
  '%NOT_ASSIGNED%', 'member cannot submit a task she is not assigned to');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('bob'), phantoms_test.tok('alice'), 'under_review', '', '')$$,
  '%DEVICE_REQUIRED%', 'IDOR: alice''s token cannot submit on behalf of bob');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('alice_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'), 'approved', '', '')$$,
  '%INVALID_STATUS%', 'members cannot self-approve');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('alice_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice'), 'under_review', '', 'javascript:alert(1)')$$,
  '%INVALID_URL%', 'non-http submission URLs are rejected');
RESET ROLE;
SELECT is((SELECT tracking -> phantoms_test.mid('bob')::text ->> 'note' FROM public.tasks WHERE id = phantoms_test.var('alice_task')::bigint),
  'bob secret', 'alice''s submission patched only her own tracking key');

-- Task submission: OTP-authenticated member (regression for the 0022 fix) -----
SELECT phantoms_test.login_as('otp_bob');
SELECT is(public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('bob'), phantoms_test.tok('bob'),
                                    'under_review', 'from OTP session', '') ->> 'status',
  'under_review', 'OTP-authenticated (non-admin) member can submit with a valid device token');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('bob'), NULL, 'under_review', '', '')$$,
  '%DEVICE_REQUIRED%', 'OTP-authenticated member still needs a device token');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('alice_task')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('bob'), 'under_review', '', '')$$,
  '%DEVICE_REQUIRED%', 'OTP-authenticated member cannot act for another member');
SELECT is((SELECT count(*)::int FROM public.tasks), 0, 'OTP-authenticated member still cannot read tasks directly');
RESET ROLE;

-- Task submission: tasks admin path ------------------------------------------------
SELECT phantoms_test.login_as('tasks_admin');
SELECT is(public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('bob'), NULL,
                                    'revision_requested', 'please fix', '') ->> 'status',
  'revision_requested', 'tasks admin can request a revision without a device token');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_like($$SELECT public.submit_task_status(phantoms_test.var('bob_task')::bigint, phantoms_test.mid('bob'), NULL, 'pending', '', '')$$,
  '%DEVICE_REQUIRED%', 'an admin without the tasks key gets no admin bypass');
RESET ROLE;

-- Readiness self-service --------------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT ok(public.update_member_readiness(phantoms_test.mid('alice'), phantoms_test.tok('alice'), true),
  'member can toggle her own field readiness');
SELECT throws_like($$SELECT public.update_member_readiness(phantoms_test.mid('bob'), phantoms_test.tok('alice'), true)$$,
  '%DEVICE_REQUIRED%', 'IDOR: cannot toggle another member''s readiness');

-- Logout and expiry -------------------------------------------------------------
SELECT ok(public.logout_member_device(phantoms_test.mid('alice'), phantoms_test.tok('alice')), 'logout deletes the device session');
SELECT throws_like($$SELECT public.get_member_tasks(phantoms_test.mid('alice'), phantoms_test.tok('alice'))$$,
  '%DEVICE_REQUIRED%', 'token is unusable after logout');
RESET ROLE;
UPDATE public.member_device_sessions SET last_seen_at = now() - interval '91 days' WHERE member_id = phantoms_test.mid('bob');
SELECT phantoms_test.login_anon();
SELECT throws_like($$SELECT public.get_member_tasks(phantoms_test.mid('bob'), phantoms_test.tok('bob'))$$,
  '%DEVICE_REQUIRED%', 'sessions idle for more than 90 days expire');
SELECT is((SELECT count(*)::int FROM public.lookup_member_by_email((SELECT email FROM phantoms_test.members WHERE name = 'bob'), phantoms_test.tok('bob'))), 0,
  'expired session cannot be revived through lookup without OTP');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
