-- 06 — Retired legacy invitations, service-owned member-bound password
-- invitations, performance evaluations, dynamic custom fields and push RPCs.
BEGIN;
\ir _helpers.psql

SELECT plan(33);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['members_admin','ranking_admin','tasks_admin','outsider']) AS n;
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.grant_admin('ranking_admin', 'admin', phantoms_test.perms('ranking'));
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.create_member('alice', NULL, true);
  PERFORM phantoms_test.create_member('bob', NULL, true);
  PERFORM phantoms_test.create_member('invite_member', 'invite-member@phantoms-test.example');
  PERFORM phantoms_test.bind_device('alice');
  PERFORM phantoms_test.bind_device('bob');
  INSERT INTO public.member_custom_fields (label, field_type, is_active, sort_order) VALUES
    ('Shirt size', 'select', true, 1), ('Retired field', 'short_text', false, 2);
  INSERT INTO public.member_evaluations (member_id, title, feedback, points)
  VALUES (phantoms_test.mid('alice'), 'Q4 review', 'Solid quarter', 5);
  INSERT INTO phantoms_test.vars VALUES
    ('password_token', 'phpw_' || repeat('a', 64)),
    ('eval_alice', (SELECT id::text FROM public.member_evaluations WHERE title = 'Q4 review'));
END $$;

-- Retired legacy invitation authority is explicitly closed -------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.create_member_invite('legacy-token-should-not-work', 'n', 24)$$,
  '42501', NULL, 'anon cannot create retired legacy invites');
RESET ROLE;
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_ok($$SELECT public.create_member_invite('legacy-token-should-not-work', 'n', 24)$$,
  '42501', NULL, 'authenticated admins cannot create retired legacy invites');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_ok($$SELECT public.create_member_invite('legacy-token-should-not-work', 'n', 24)$$,
  '42501', NULL, 'member-permission admins cannot create retired legacy invites');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.get_member_invite_context('legacy-token-should-not-work')$$,
  '42501', NULL, 'anon cannot resolve retired legacy invite context');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_ok($$SELECT public.get_member_invite_context('legacy-token-should-not-work')$$,
  '42501', NULL, 'authenticated users cannot resolve retired legacy invite context');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.submit_member_registration_invite('legacy-token-should-not-work', '{"full_name":"X","email":"x@phantoms-test.example"}')$$,
  '42501', NULL, 'anon cannot submit retired legacy registration');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_ok($$SELECT public.submit_member_registration_invite('legacy-token-should-not-work', '{"full_name":"X","email":"x@phantoms-test.example"}')$$,
  '42501', NULL, 'authenticated users cannot submit retired legacy registration');
RESET ROLE;
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT 1 FROM public.member_registration_invites LIMIT 1$$,
  '42501', NULL, 'anon cannot read retained legacy invitation history');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_ok($$SELECT 1 FROM public.member_registration_invites LIMIT 1$$,
  '42501', NULL, 'authenticated users cannot read retained legacy invitation history');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.create_member_invite(text,text,integer)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.create_member_invite(text,text,integer)', 'EXECUTE'),
  'retired invite creation has no Data API grant');

-- New invitations are service-owned, member-bound and never public signup ----
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to(phantoms_test.var('password_token'), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('invite_member'), 'INVITE-MEMBER@phantoms-test.example', 'enroll', NULL, NULL, 24, 'Spring cohort', phantoms_test.uid('members_admin'))$$,
  'members admin actor can issue a bound invitation through the service path');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE member_id = phantoms_test.mid('invite_member')), 1,
  'one member-bound password invitation was issued');
SELECT is((SELECT ARRAY[member_id::text, normalized_email, purpose, created_by::text, note]
           FROM public.member_password_invitations WHERE member_id = phantoms_test.mid('invite_member')),
  ARRAY[phantoms_test.mid('invite_member')::text, 'invite-member@phantoms-test.example', 'enroll', phantoms_test.uid('members_admin')::text, 'Spring cohort'],
  'invitation is bound to the exact normalized member email, purpose and actor');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE token_hash = phantoms_test.var('password_token')), 0,
  'raw/prefixed password invitation token is never stored');
SELECT ok((SELECT token_hash ~ '^[0-9a-f]{64}$' FROM public.member_password_invitations
           WHERE member_id = phantoms_test.mid('invite_member')),
  'only a SHA-256-shaped invitation hash is stored');
SELECT is((SELECT count(*)::int FROM public.member_password_audit
           WHERE member_id = phantoms_test.mid('invite_member') AND action = 'issued'), 1,
  'new invitation issuance writes a non-secret audit event');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('b', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('invite_member'), 'invite-member@phantoms-test.example', 'enroll', NULL, NULL, 24, 'bad actor', phantoms_test.uid('tasks_admin'))$$,
  '%UNAUTHORIZED%', 'service invitation issuance requires the member permission actor');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  'short', phantoms_test.mid('invite_member'), 'invite-member@phantoms-test.example', 'enroll', NULL, NULL, 24, '', phantoms_test.uid('members_admin'))$$,
  '%INVALID_INPUT%', 'new invitation hashes must be exactly 64 lowercase hex characters');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('c', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('invite_member'), 'wrong@phantoms-test.example', 'enroll', NULL, NULL, 24, '', phantoms_test.uid('members_admin'))$$,
  '%WRONG_EMAIL%', 'new invitation issuance enforces the exact member email');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to(phantoms_test.var('password_token'), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('invite_member'), 'invite-member@phantoms-test.example', 'enroll', NULL, NULL, 24, 'duplicate', phantoms_test.uid('members_admin'))$$,
  '%REVIEW_REQUIRED%', 'only one active bound invitation may exist for a member');
SELECT ok(NOT has_function_privilege('anon', 'public.member_password_issue_invitation(text,bigint,text,text,uuid,text,integer,text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_issue_invitation(text,bigint,text,text,uuid,text,integer,text,uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_issue_invitation(text,bigint,text,text,uuid,text,integer,text,uuid)', 'EXECUTE'),
  'bound invitation issuance is service-only');
RESET ROLE;

-- Evaluations -----------------------------------------------------------------
SELECT phantoms_test.login_as('alice');
SELECT throws_like($$SELECT * FROM public.get_member_evaluations(phantoms_test.mid('alice'), phantoms_test.tok('bob'))$$,
  '%DEVICE_REQUIRED%', 'IDOR: bob''s token cannot read alice''s evaluations');
SELECT is((SELECT count(*)::int FROM public.get_member_evaluations(phantoms_test.mid('alice'), phantoms_test.tok('alice'))), 1,
  'alice reads her own evaluation');
SELECT throws_like($$SELECT public.mark_member_evaluation_read(phantoms_test.var('eval_alice')::bigint, phantoms_test.mid('bob'), phantoms_test.tok('bob'))$$, '%MEMBER_PASSWORD_REQUIRED%',
  'alice''s JWT cannot mark bob''s evaluation target as read');
SELECT is(public.mark_member_evaluation_read(phantoms_test.var('eval_alice')::bigint, phantoms_test.mid('alice'), phantoms_test.tok('alice')), true,
  'alice marks her evaluation as read');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT ok((SELECT viewed_at IS NOT NULL AND read_at IS NOT NULL FROM public.member_evaluations WHERE id = phantoms_test.var('eval_alice')::bigint),
  'viewed_at and read_at are recorded');
SELECT phantoms_test.login_as('ranking_admin');
SELECT lives_ok($$INSERT INTO public.member_evaluations (member_id, title, feedback, points) VALUES (phantoms_test.mid('bob'), 'Review', 'Good', 3)$$,
  'ranking admin can write evaluations');
SELECT throws_ok($$INSERT INTO public.member_evaluations (member_id, title, feedback, points) VALUES (phantoms_test.mid('bob'), 'Review', 'Good', 21)$$,
  '23514', NULL, 'evaluation points are bounded (-10..20)');
RESET ROLE;
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_ok($$INSERT INTO public.member_evaluations (member_id, title, feedback) VALUES (phantoms_test.mid('bob'), 'Nope', 'Nope')$$,
  '42501', NULL, 'tasks-only admin cannot write evaluations');
RESET ROLE;

-- Web Push subscription (device-bound) ---------------------------------------
SELECT phantoms_test.login_as('alice');
SELECT ok(public.save_push_subscription(phantoms_test.mid('alice'), (SELECT email FROM phantoms_test.members WHERE name = 'alice'),
                                        '{"endpoint":"https://push.example.com/abc","keys":{}}', phantoms_test.tok('alice')),
  'member saves her own https push subscription');
SELECT throws_like($$SELECT public.save_push_subscription(phantoms_test.mid('alice'), (SELECT email FROM phantoms_test.members WHERE name = 'bob'),
                                        '{"endpoint":"https://push.example.com/abc"}', phantoms_test.tok('alice'))$$,
  '%UNAUTHORIZED%', 'push subscription requires the matching member email');
SELECT throws_like($$SELECT public.save_push_subscription(phantoms_test.mid('alice'), (SELECT email FROM phantoms_test.members WHERE name = 'alice'),
                                        '{"endpoint":"http://insecure.example.com"}', phantoms_test.tok('alice'))$$,
  '%INVALID_SUBSCRIPTION%', 'non-https push endpoints are rejected');
SELECT throws_like($$SELECT public.save_push_subscription(phantoms_test.mid('bob'), (SELECT email FROM phantoms_test.members WHERE name = 'bob'),
                                        '{"endpoint":"https://push.example.com/x"}', phantoms_test.tok('alice'))$$,
  '%MEMBER_PASSWORD_REQUIRED%', 'IDOR: cannot overwrite another member''s push subscription');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
