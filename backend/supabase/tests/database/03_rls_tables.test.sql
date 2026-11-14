-- 03 — Table-level RLS and privilege enforcement for anon, non-admin
-- authenticated users, and admins scoped to specific permission keys.
BEGIN;
\ir _helpers.psql

SELECT plan(46);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner','tasks_admin','notes_admin','members_admin','ann_admin','noperm_admin','outsider']) AS n;
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.grant_admin('notes_admin', 'admin', phantoms_test.perms('notes'));
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.grant_admin('ann_admin', 'admin', phantoms_test.perms('announcements'));
  PERFORM phantoms_test.grant_admin('noperm_admin', 'admin', phantoms_test.perms());
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  INSERT INTO public.tasks (title, assigned_to) VALUES ('RLS task', '"ALL"'::jsonb);
  INSERT INTO public.notes (text, author, target_member_id) VALUES ('RLS note', 'test', phantoms_test.mid('alice'));
  INSERT INTO public.announcements (title, content) VALUES ('RLS announcement', 'body');
  INSERT INTO public.member_custom_fields (label) VALUES ('RLS field');
  INSERT INTO public.member_evaluations (member_id, title, feedback)
  VALUES (phantoms_test.mid('alice'), 'RLS evaluation', 'feedback');
  PERFORM phantoms_test.bind_device('alice');
END $$;

-- anon: no direct table access at all ---------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT 1 FROM public.members LIMIT 1$$, '42501', NULL, 'anon cannot SELECT members');
SELECT throws_ok($$SELECT 1 FROM public.tasks LIMIT 1$$, '42501', NULL, 'anon cannot SELECT tasks');
SELECT throws_ok($$UPDATE public.tasks SET tracking = '{}'$$, '42501', NULL, 'anon cannot UPDATE tasks (no direct tracking writes)');
SELECT throws_ok($$SELECT 1 FROM public.notes LIMIT 1$$, '42501', NULL, 'anon cannot SELECT notes');
SELECT throws_ok($$INSERT INTO public.notes (text) VALUES ('x [B:+50]')$$, '42501', NULL, 'anon cannot INSERT bonus notes');
SELECT throws_ok($$SELECT 1 FROM public.announcements LIMIT 1$$, '42501', NULL, 'anon cannot SELECT announcements');
SELECT throws_ok($$SELECT 1 FROM public.member_device_sessions LIMIT 1$$, '42501', NULL, 'anon cannot SELECT device sessions');
SELECT throws_ok($$SELECT 1 FROM public.member_registration_invites LIMIT 1$$, '42501', NULL, 'anon cannot SELECT invites');
SELECT throws_ok($$SELECT 1 FROM public.member_evaluations LIMIT 1$$, '42501', NULL, 'anon cannot SELECT evaluations');
SELECT throws_ok($$SELECT 1 FROM public.member_custom_fields LIMIT 1$$, '42501', NULL, 'anon cannot SELECT custom field definitions');
SELECT throws_ok($$SELECT 1 FROM public.whatsapp_settings LIMIT 1$$, '42501', NULL, 'anon cannot SELECT whatsapp_settings');
SELECT throws_ok($$SELECT 1 FROM public.member_infinite_bonus_events LIMIT 1$$, '42501', NULL, 'anon cannot SELECT bonus audit log');
RESET ROLE;

-- authenticated but not an admin: RLS hides everything ------------------------
SELECT phantoms_test.login_as('outsider');
SELECT is((SELECT count(*)::int FROM public.members), 0, 'outsider sees no members');
SELECT is((SELECT count(*)::int FROM public.tasks), 0, 'outsider sees no tasks');
SELECT is((SELECT count(*)::int FROM public.notes), 0, 'outsider sees no notes');
SELECT is((SELECT count(*)::int FROM public.announcements), 0, 'outsider sees no announcements');
SELECT is((SELECT count(*)::int FROM public.member_evaluations), 0, 'outsider sees no evaluations');
SELECT throws_ok($$INSERT INTO public.members (email, full_name) VALUES ('evil@phantoms-test.example', 'Evil')$$,
  '42501', NULL, 'outsider INSERT into members violates RLS');
SELECT throws_ok($$INSERT INTO public.notes (text, target_member_id) VALUES ('[B:+50]', phantoms_test.mid('alice'))$$,
  '42501', NULL, 'outsider cannot forge bonus notes');
SELECT is(phantoms_test.affected('UPDATE public.members SET completion_rank = 100'), 0,
  'outsider UPDATE on members affects no rows');
SELECT throws_ok($$SELECT 1 FROM public.member_device_sessions LIMIT 1$$, '42501', NULL, 'outsider cannot read device sessions');
SELECT throws_ok($$SELECT 1 FROM public.whatsapp_settings LIMIT 1$$, '42501', NULL, 'outsider cannot read whatsapp_settings');
RESET ROLE;

-- admin with all-false permissions sees nothing --------------------------------
SELECT phantoms_test.login_as('noperm_admin');
SELECT is((SELECT count(*)::int FROM public.members) + (SELECT count(*)::int FROM public.tasks)
          + (SELECT count(*)::int FROM public.notes) + (SELECT count(*)::int FROM public.announcements), 0,
  'admin with no permission keys sees no rows in any section');
RESET ROLE;

-- tasks-only admin --------------------------------------------------------------
SELECT phantoms_test.login_as('tasks_admin');
SELECT is((SELECT count(*)::int FROM public.tasks), 1, 'tasks admin reads tasks');
SELECT is((SELECT count(*)::int FROM public.members), 2, 'tasks admin reads members (needed for assignment)');
SELECT is((SELECT count(*)::int FROM public.notes), 0, 'tasks admin cannot read notes');
SELECT is((SELECT count(*)::int FROM public.announcements), 0, 'tasks admin cannot read announcements');
SELECT is(phantoms_test.affected($sql$UPDATE public.tasks SET description = 'edited'$sql$), 1,
  'tasks admin can update tasks');
SELECT is(phantoms_test.affected($sql$UPDATE public.members SET bio = 'edited'$sql$), 0,
  'tasks admin cannot update members');
SELECT throws_ok($$INSERT INTO public.members (email, full_name) VALUES ('t@phantoms-test.example', 'T')$$,
  '42501', NULL, 'tasks admin cannot insert members');
SELECT throws_ok($$INSERT INTO public.announcements (title, content) VALUES ('x', 'y')$$,
  '42501', NULL, 'tasks admin cannot create announcements');
SELECT throws_ok($$INSERT INTO public.member_custom_fields (label) VALUES ('x')$$,
  '42501', NULL, 'tasks admin cannot create custom fields');
RESET ROLE;

-- notes-only admin ----------------------------------------------------------------
SELECT phantoms_test.login_as('notes_admin');
SELECT is((SELECT count(*)::int FROM public.notes), 1, 'notes admin reads notes');
SELECT is((SELECT count(*)::int FROM public.tasks), 0, 'notes admin cannot read tasks');
SELECT lives_ok($$INSERT INTO public.notes (text, author, target_member_id) VALUES ('note', 'a', phantoms_test.mid('bob'))$$,
  'notes admin can insert notes');
SELECT is((SELECT count(*)::int FROM public.member_evaluations), 1, 'notes admin can read evaluations');
RESET ROLE;

-- members-only admin --------------------------------------------------------------
SELECT phantoms_test.login_as('members_admin');
SELECT lives_ok($$INSERT INTO public.members (email, full_name) VALUES ('carol@phantoms-test.example', 'Carol')$$,
  'members admin can insert members');
SELECT lives_ok($$INSERT INTO public.member_custom_fields (label) VALUES ('Shirt size')$$,
  'members admin can create custom fields');
SELECT throws_like($$UPDATE public.members SET bonus_infinite = true WHERE email = 'carol@phantoms-test.example'$$,
  '%BONUS_RPC_REQUIRED%', 'direct bonus_infinite updates are blocked by trigger even for admins');
SELECT throws_ok($$SELECT session_token FROM public.members LIMIT 1$$, '42501', NULL,
  'members admin cannot read the legacy session_token column');
RESET ROLE;

-- announcements-only admin ----------------------------------------------------
SELECT phantoms_test.login_as('ann_admin');
SELECT is((SELECT count(*)::int FROM public.announcements), 1, 'announcements admin reads announcements');
SELECT lives_ok($$INSERT INTO public.announcements (title, content) VALUES ('Hello', 'World')$$,
  'announcements admin can create announcements');
SELECT is((SELECT count(*)::int FROM public.notes), 0, 'announcements admin cannot read notes');
RESET ROLE;

-- owner sees every section --------------------------------------------------------
SELECT phantoms_test.login_as('owner');
SELECT ok((SELECT count(*) FROM public.members) = 3 AND (SELECT count(*) FROM public.tasks) = 1
          AND (SELECT count(*) FROM public.notes) = 2 AND (SELECT count(*) FROM public.announcements) = 2,
  'owner reads members, tasks, notes and announcements');
SELECT throws_ok($$SELECT 1 FROM public.member_device_sessions LIMIT 1$$, '42501', NULL,
  'even the owner cannot read hashed device sessions directly');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- audit log immutability (even as table owner) ----------------------------------
SELECT throws_like($$DELETE FROM public.member_infinite_bonus_events$$, '%',
  'bonus audit log rows cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
