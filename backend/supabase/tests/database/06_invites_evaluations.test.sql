-- 06 — Member invitations and self-registration, performance evaluations,
-- dynamic custom fields and announcement view RPCs.
BEGIN;
\ir _helpers.psql

SELECT plan(30);

-- Fixtures (as postgres) ------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n) FROM unnest(ARRAY['members_admin','ranking_admin','tasks_admin']) AS n;
  PERFORM phantoms_test.grant_admin('members_admin', 'admin', phantoms_test.perms('members'));
  PERFORM phantoms_test.grant_admin('ranking_admin', 'admin', phantoms_test.perms('ranking'));
  PERFORM phantoms_test.grant_admin('tasks_admin', 'admin', phantoms_test.perms('tasks'));
  PERFORM phantoms_test.create_member('alice');
  PERFORM phantoms_test.create_member('bob');
  PERFORM phantoms_test.bind_device('alice');
  PERFORM phantoms_test.bind_device('bob');
  INSERT INTO public.member_custom_fields (label, field_type, is_active, sort_order) VALUES
    ('Shirt size', 'select', true, 1), ('Retired field', 'short_text', false, 2);
  INSERT INTO public.member_evaluations (member_id, title, feedback, points)
  VALUES (phantoms_test.mid('alice'), 'Q4 review', 'Solid quarter', 5);
  INSERT INTO phantoms_test.vars VALUES
    ('invite_token', 'invite-token-' || repeat('a', 40)),
    ('eval_alice', (SELECT id::text FROM public.member_evaluations WHERE title = 'Q4 review'));
END $$;

-- Invite creation -----------------------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.create_member_invite(phantoms_test.var('invite_token'), 'n', 24)$$,
  '42501', NULL, 'anon cannot create invites');
RESET ROLE;
SELECT phantoms_test.login_as('tasks_admin');
SELECT throws_like($$SELECT public.create_member_invite(phantoms_test.var('invite_token'), 'n', 24)$$,
  '%MEMBERS_PERMISSION_REQUIRED%', 'admin without the members key cannot create invites');
RESET ROLE;
SELECT phantoms_test.login_as('members_admin');
SELECT throws_like($$SELECT public.create_member_invite('too-short', 'n', 24)$$,
  '%INVALID_INVITE_TOKEN%', 'invite tokens shorter than 32 characters are rejected');
SELECT ok((public.create_member_invite(phantoms_test.var('invite_token'), 'Spring cohort', 24) ->> 'id') IS NOT NULL,
  'members admin creates an invite');
SELECT ok((public.create_member_invite('expired-token-' || repeat('b', 40), 'old', 1) ->> 'id') IS NOT NULL,
  'members admin creates a second invite (to be expired)');
SELECT ok((public.create_member_invite('revoked-token-' || repeat('c', 40), 'revoked', 24) ->> 'id') IS NOT NULL,
  'members admin creates a third invite (to be revoked)');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT count(*)::int FROM public.member_registration_invites WHERE token_hash = phantoms_test.var('invite_token')), 0,
  'the raw invite token is never stored');
SELECT is((SELECT count(*)::int FROM public.member_registration_invites
            WHERE token_hash = encode(extensions.digest(convert_to(phantoms_test.var('invite_token'), 'UTF8'), 'sha256'), 'hex')), 1,
  'only the SHA-256 hash of the invite token is stored');
UPDATE public.member_registration_invites SET expires_at = now() - interval '1 minute' WHERE note = 'old';
UPDATE public.member_registration_invites SET is_revoked = true WHERE note = 'revoked';

-- Invite context and registration (anon) ---------------------------------------
SELECT phantoms_test.login_anon();
SELECT is(public.get_member_invite_context(phantoms_test.var('invite_token')) ->> 'valid', 'true', 'valid invite resolves for anon');
SELECT is(jsonb_array_length(public.get_member_invite_context(phantoms_test.var('invite_token')) -> 'custom_fields'), 1,
  'invite context exposes only active custom fields');
SELECT is(public.get_member_invite_context('expired-token-' || repeat('b', 40)) ->> 'valid', 'false', 'expired invite is invalid');
SELECT is(public.get_member_invite_context('revoked-token-' || repeat('c', 40)) ->> 'valid', 'false', 'revoked invite is invalid');
SELECT is(public.get_member_invite_context('x') ->> 'reason', 'INVALID_TOKEN', 'malformed token is rejected without a lookup');
SELECT throws_like($$SELECT public.submit_member_registration_invite(phantoms_test.var('invite_token'), '{"full_name":"X","email":"x@phantoms-test.example"}')$$,
  '%INVALID_NAME%', 'registration validates the full name');
SELECT throws_like($$SELECT public.submit_member_registration_invite(phantoms_test.var('invite_token'), '{"full_name":"New Person","email":"not-an-email"}')$$,
  '%INVALID_EMAIL%', 'registration validates the email');
SELECT throws_like($$SELECT public.submit_member_registration_invite(phantoms_test.var('invite_token'),
                       jsonb_build_object('full_name', 'Dup Person', 'email', upper((SELECT email FROM phantoms_test.members WHERE name = 'alice'))))$$,
  '%EMAIL_ALREADY_EXISTS%', 'registration rejects an existing member email (case-insensitive)');
SELECT ok((public.submit_member_registration_invite(phantoms_test.var('invite_token'),
             '{"full_name":"New Person","email":"New.Person@phantoms-test.example","custom_fields":{"1":"L"},"completion_rank":100,"bonus_infinite":true}') ->> 'member_id') IS NOT NULL,
  'anon completes self-registration with a valid invite');
SELECT throws_like($$SELECT public.submit_member_registration_invite(phantoms_test.var('invite_token'), '{"full_name":"Second Person","email":"second@phantoms-test.example"}')$$,
  '%INVALID_OR_EXPIRED_INVITE%', 'an invite can be used only once');
SELECT throws_like($$SELECT public.submit_member_registration_invite('expired-token-' || repeat('b', 40), '{"full_name":"Late Person","email":"late@phantoms-test.example"}')$$,
  '%INVALID_OR_EXPIRED_INVITE%', 'an expired invite cannot register');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is((SELECT ARRAY[email, completion_rank::text, bonus_infinite::text, work_status] FROM public.members WHERE full_name = 'New Person'),
  ARRAY['new.person@phantoms-test.example', '0', 'false', 'active'],
  'registered member is normalized and cannot self-assign rank or infinite bonus');
SELECT ok((SELECT used_at IS NOT NULL AND registered_member_id IS NOT NULL FROM public.member_registration_invites
            WHERE token_hash = encode(extensions.digest(convert_to(phantoms_test.var('invite_token'), 'UTF8'), 'sha256'), 'hex')),
  'invite is marked used and linked to the new member');

-- Evaluations -------------------------------------------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_like($$SELECT * FROM public.get_member_evaluations(phantoms_test.mid('alice'), phantoms_test.tok('bob'))$$,
  '%DEVICE_REQUIRED%', 'IDOR: bob''s token cannot read alice''s evaluations');
SELECT is((SELECT count(*)::int FROM public.get_member_evaluations(phantoms_test.mid('alice'), phantoms_test.tok('alice'))), 1,
  'alice reads her own evaluation');
SELECT is(public.mark_member_evaluation_read(phantoms_test.var('eval_alice')::bigint, phantoms_test.mid('bob'), phantoms_test.tok('bob')), false,
  'bob cannot mark alice''s evaluation as read');
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

-- Web Push subscription (device-bound) -------------------------------------------
SELECT phantoms_test.login_anon();
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
  '%DEVICE_REQUIRED%', 'IDOR: cannot overwrite another member''s push subscription');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
