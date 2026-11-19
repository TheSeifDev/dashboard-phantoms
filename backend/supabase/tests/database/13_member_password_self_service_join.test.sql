-- 13 — Self-service member registration and password-only reset.
-- Uses disposable Auth/member rows, verifies the real PostgreSQL guards/RPCs,
-- and rolls the complete fixture transaction back. GoTrue is tested separately.
BEGIN;
\ir _helpers.psql

SELECT no_plan();

CREATE FUNCTION phantoms_test.as_service()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);
END $$;
GRANT SELECT, INSERT, UPDATE ON phantoms_test.vars TO service_role;

SELECT phantoms_test.create_user('join_admin');
SELECT phantoms_test.grant_admin('join_admin', 'admin', phantoms_test.perms('members'));
SELECT phantoms_test.create_member('existing_reset', 'reset-self@phantoms-test.example', true);
UPDATE public.members
SET full_name = 'Stored Member Profile', phone = '+201234567890', residence = 'Alexandria'
WHERE email = 'reset-self@phantoms-test.example';

SELECT has_table('public', 'member_password_invitations', 'private invitation table exists');
SELECT ok(NOT has_table_privilege('anon', 'public.member_password_invitations', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.member_password_invitations', 'SELECT'),
          'join invitations are never directly readable');
SELECT ok(NOT has_function_privilege('anon', 'public.member_password_complete_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_complete_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_complete_profile(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
          'profile completion RPC is service-only');
SELECT ok(NOT has_function_privilege('anon', 'public.get_member_pending_review()', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.get_member_pending_review()', 'EXECUTE'),
          'pending review status is available only to authenticated clients');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                  AND indexname = 'member_password_one_active_join_per_email'),
          'one active join per normalized email is enforced by a unique index');

SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('j', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL::bigint, 'new-self@phantoms-test.example', 'join', NULL, NULL, 24, 'join fixture',
  phantoms_test.uid('join_admin'))$$,
  'Admin may issue a join invitation without a pre-existing member or Auth UUID');
RESET ROLE;
SELECT is((SELECT member_id FROM public.member_password_invitations
           WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join'), NULL::bigint,
          'new join starts without a member id');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join'), 'pending',
          'new join begins pending');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'new-self@phantoms-test.example'), 0,
          'issuing the link does not create a member row');
SELECT is((SELECT count(*)::int FROM auth.users WHERE email = 'new-self@phantoms-test.example'), 0,
          'issuing the link does not create an Auth identity');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE token_hash = 'phpw_' || repeat('j', 64)), 0,
          'the raw join token is never stored');
SELECT phantoms_test.as_service();
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('k', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL::bigint, 'new-self@phantoms-test.example', 'join', NULL, NULL, 24, '',
  phantoms_test.uid('join_admin'))$$, '%REVIEW_REQUIRED%',
  'a second active join for the same normalized email is rejected');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('l', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL::bigint, 'reset-self@phantoms-test.example', 'join', NULL, NULL, 24, '',
  phantoms_test.uid('join_admin'))$$, '%IDENTITY_CONFLICT%',
  'join cannot target an existing member identity');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('m', 64), 'UTF8'), 'sha256'), 'hex'),
  1, 'wrong@phantoms-test.example', 'join', NULL, NULL, 24, '',
  phantoms_test.uid('join_admin'))$$, '%INVALID_INPUT%',
  'join cannot be issued with a supplied member id');

INSERT INTO phantoms_test.vars(key, value)
SELECT 'join_claim', public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('j', 64), 'UTF8'), 'sha256'), 'hex'),
  'new-self@phantoms-test.example')::text;
SELECT is((SELECT (value::jsonb ->> 'purpose') FROM phantoms_test.vars WHERE key = 'join_claim'), 'join',
          'reservation preserves the join purpose');
SELECT is((SELECT value::jsonb ->> 'member_id' FROM phantoms_test.vars WHERE key = 'join_claim'), NULL,
          'reservation remains unbound until profile completion');

SELECT throws_like($$INSERT INTO public.members(email, full_name, completion_rank, work_status)
  VALUES ('new-self@phantoms-test.example', 'Forged Admin Row', 0, 'inactive')$$,
  '%REGISTRATION_IN_PROGRESS%', 'no member row can be created before the exact invitation-bound Auth write');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'new-self@phantoms-test.example'), 0,
          'a rejected out-of-band insert leaves no member row');

RESET ROLE;
INSERT INTO auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '40000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'new-self@phantoms-test.example', 'self-service-fixture-hash', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
INSERT INTO phantoms_test.users(name, id, email)
VALUES ('join_new', '40000000-0000-4000-8000-000000000001', 'new-self@phantoms-test.example');
SELECT phantoms_test.as_service();
SELECT is((SELECT auth_write_completed_at IS NOT NULL AND auth_write_user_id = '40000000-0000-4000-8000-000000000001'::uuid
           FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example'), true,
          'the Auth INSERT trigger marks exactly the reserved join write');
SELECT throws_like($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'join_claim') ->> 'claim_id')::uuid,
  '40000000-0000-4000-8000-000000000001', NULL)$$, '%INVALID_INPUT%',
  'join completion requires the member-entered profile');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE normalized_email = 'new-self@phantoms-test.example'), 'reserved',
          'a missing profile does not partially complete or create a member');

SELECT lives_ok($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'join_claim') ->> 'claim_id')::uuid,
  '40000000-0000-4000-8000-000000000001',
  '{"fullName":"Self Service Member","phone":"+201112223333","residence":"Cairo","workConditions":"Remote","bio":"Member supplied","device":"لابتوب","gender":"ذكر"}'::jsonb)$$,
  'self-entered profile completes the reserved join atomically');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'new-self@phantoms-test.example'), 1,
          'join creates exactly one member after the guarded Auth write');
SELECT is((SELECT work_status FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'inactive',
          'self-registered member remains inactive pending Admin review');
SELECT is((SELECT full_name FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'Self Service Member',
          'the submitted full name is saved');
SELECT is((SELECT phone FROM public.members WHERE email = 'new-self@phantoms-test.example'), '+201112223333',
          'the submitted phone is saved');
SELECT is((SELECT residence FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'Cairo',
          'the submitted residence is saved');
SELECT is((SELECT work_conditions FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'Remote',
          'the submitted work conditions are saved');
SELECT is((SELECT bio FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'Member supplied',
          'the submitted bio is saved');
SELECT is((SELECT device FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'لابتوب',
          'the submitted device is saved');
SELECT is((SELECT gender FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'ذكر',
          'the submitted gender is saved');
SELECT is((SELECT b.auth_user_id FROM public.member_auth_bindings b JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'new-self@phantoms-test.example'), '40000000-0000-4000-8000-000000000001'::uuid,
          'the new inactive member binds only to the exact invitation Auth user');
SELECT is((SELECT b.password_ready FROM public.member_auth_bindings b JOIN public.members m ON m.id = b.member_id
           WHERE m.email = 'new-self@phantoms-test.example'), true,
          'new self-service identity is password-ready');
SELECT is((SELECT member_id FROM public.member_password_invitations
           WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join'),
          (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
          'completed join invitation is bound to its newly created member');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join'), 'complete',
          'join invitation is terminal after completion');
SELECT is((SELECT details ->> 'membership' FROM public.member_password_audit
           WHERE action = 'completed' AND member_id = (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example')
           ORDER BY created_at DESC LIMIT 1), 'pending_review',
          'completion audit records only the pending membership classification');
SELECT throws_like($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'join_claim') ->> 'claim_id')::uuid,
  '40000000-0000-4000-8000-000000000001', NULL)$$, '%REVIEW_REQUIRED%',
  'completed join cannot be replayed to change the profile');

RESET ROLE;
SELECT phantoms_test.login_as('join_new');
SELECT is(public.get_member_pending_review() ->> 'status', 'pending_review',
          'the exact authenticated owner receives only the pending-review status');
SELECT is((SELECT count(*)::int FROM jsonb_object_keys(public.get_member_pending_review())), 1,
          'pending-review response exposes no profile fields or member identifier');
SELECT is(public.get_member_password_access(), NULL::jsonb,
          'inactive self-registered members receive no active portal access record');
SELECT is((SELECT count(*)::int FROM public.members), 0,
          'inactive member RLS hides every member row, including its own profile');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT is(public.get_member_pending_review(), NULL::jsonb,
          'unauthenticated callers receive no pending-review status');

SELECT phantoms_test.as_service();
SELECT ok(NOT has_function_privilege('anon', 'public.member_password_list_join_reviews(uuid,timestamptz,bigint,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_list_join_reviews(uuid,timestamptz,bigint,uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_list_join_reviews(uuid,timestamptz,bigint,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_password_approve_join(bigint,uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.member_password_approve_join(bigint,uuid)', 'EXECUTE'),
          'Admin review RPCs are service-only and direct browser execution is revoked');
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(phantoms_test.uid('join_admin'))), 1,
          'Owner-permitted Admin sees the completed inactive join, not unused links');
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'full_name'),
          'Self Service Member', 'review queue exposes the member-entered profile to an authorized reviewer');
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'email'),
          'new-self@phantoms-test.example', 'review queue includes the email the member submitted');
SELECT throws_like($$SELECT public.member_password_list_join_reviews(phantoms_test.uid('join_new'))$$,
                   '%UNAUTHORIZED%', 'a member cannot use the service review function as an Admin');
SELECT throws_like($$SELECT public.member_password_approve_join(
  (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
  phantoms_test.uid('join_new'))$$, '%UNAUTHORIZED%', 'a member cannot approve their own registration');
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT phantoms_test.login_as('join_admin');
SELECT throws_like($$UPDATE public.members SET work_status = NULL
  WHERE email = 'new-self@phantoms-test.example'$$, '%JOIN_REVIEW_REQUIRED%',
  'generic Admin cannot move a completed unapproved join to a nullable intermediary state');
SELECT is((SELECT work_status FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'inactive',
          'a rejected intermediary-state update leaves the join inactive and reviewable');
SELECT throws_like($$UPDATE public.members SET work_status = 'active'
  WHERE email = 'new-self@phantoms-test.example'$$, '%JOIN_REVIEW_REQUIRED%',
  'generic Admin member updates cannot bypass the first-activation review guard');
SELECT is((SELECT work_status FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'inactive',
          'a rejected direct activation leaves the join inactive and without approval');
RESET ROLE;
UPDATE auth.users SET email = 'new-self-drift@phantoms-test.example'
WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT phantoms_test.as_service();
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(phantoms_test.uid('join_admin'))), 1,
          'review queue keeps a completed join visible when its current Auth email has drifted');
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'email_identity_matches')::boolean, false,
          'email drift is surfaced as a blocked review item without exposing current Auth email');
SELECT throws_like($$SELECT public.member_password_approve_join(
  (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
  phantoms_test.uid('join_admin'))$$, '%REVIEW_REQUIRED%',
  'approval rejects a completed join whose current Auth email no longer matches');
RESET ROLE;
UPDATE auth.users SET email = 'new-self@phantoms-test.example'
WHERE id = '40000000-0000-4000-8000-000000000001';
SELECT phantoms_test.as_service();
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(phantoms_test.uid('join_admin'))), 1,
          'restoring the exact Auth email makes the still-unapproved request reviewable again');
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'email_identity_matches')::boolean, true,
          'restored Auth email clears the review blocker');
RESET ROLE;

UPDATE public.members SET email = 'new-self-member-drift@phantoms-test.example'
WHERE email = 'new-self@phantoms-test.example';
SELECT phantoms_test.as_service();
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(phantoms_test.uid('join_admin'))), 1,
          'review queue keeps a completed join visible when the member email has drifted');
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'email_identity_matches')::boolean, false,
          'member email drift is surfaced as a blocked review item');
SELECT throws_like($$SELECT public.member_password_approve_join(
  (SELECT id FROM public.members WHERE email = 'new-self-member-drift@phantoms-test.example'),
  phantoms_test.uid('join_admin'))$$, '%REVIEW_REQUIRED%',
  'approval rejects a visible completed join whose member email no longer matches');
RESET ROLE;
UPDATE public.members SET email = 'new-self@phantoms-test.example'
WHERE email = 'new-self-member-drift@phantoms-test.example';
SELECT phantoms_test.as_service();
SELECT is((public.member_password_list_join_reviews(phantoms_test.uid('join_admin')) -> 0 ->> 'email_identity_matches')::boolean, true,
          'restoring the member email clears the review blocker');
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(
  phantoms_test.uid('join_admin'),
  (SELECT completed_at FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join'),
  (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join')
)), 0, 'review pagination cursor excludes the last row and cannot repeat it');
RESET ROLE;

SELECT phantoms_test.as_service();
SELECT is((public.member_password_approve_join(
  (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
  phantoms_test.uid('join_admin')) ->> 'approved'), 'true',
  'authorized Admin approval activates the reviewed member');
SELECT is((SELECT work_status FROM public.members WHERE email = 'new-self@phantoms-test.example'), 'active',
          'approved self-service member becomes active');
SELECT is((SELECT count(*)::int FROM public.member_password_audit
           WHERE member_id = (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example')
             AND invitation_id = (SELECT id FROM public.member_password_invitations
                                  WHERE normalized_email = 'new-self@phantoms-test.example' AND purpose = 'join')
             AND action = 'admin_approved'), 1,
          'approval is recorded exactly once against the completed join and member');
SELECT is((SELECT actor_user_id FROM public.member_password_audit
           WHERE member_id = (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example')
             AND action = 'admin_approved'), phantoms_test.uid('join_admin'),
          'approval audit records the authenticated Admin actor');
SELECT is(jsonb_array_length(public.member_password_list_join_reviews(phantoms_test.uid('join_admin'))), 0,
          'approved membership leaves the pending-review queue');
SELECT is((public.member_password_approve_join(
  (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example'),
  phantoms_test.uid('join_admin')) ->> 'status'), 'already_approved',
  'repeated approval is idempotently reported and does not create a second audit row');
SELECT is((SELECT count(*)::int FROM public.member_password_audit
           WHERE action = 'admin_approved'
             AND member_id = (SELECT id FROM public.members WHERE email = 'new-self@phantoms-test.example')), 1,
          'retry leaves the single approval audit record intact');
RESET ROLE;
SELECT phantoms_test.clear_auth();

-- An Admin may leave the join email blank. The member's first valid submission
-- is bound atomically under the shared email-registration lock before Auth.
SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('u', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL::bigint, NULL::text, 'join', NULL, NULL, 24, 'unbound join email optional',
  phantoms_test.uid('join_admin'))$$,
  'Admin may issue a unique join link without supplying an email');
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('v', 64), 'UTF8'), 'sha256'), 'hex'),
  NULL::bigint, NULL::text, 'join', NULL, NULL, 24, 'unbound join sibling',
  phantoms_test.uid('join_admin'))$$,
  'distinct email-free join links remain individually issuable');
RESET ROLE;
SELECT is((SELECT normalized_email IS NULL AND member_id IS NULL AND status = 'pending'
           FROM public.member_password_invitations WHERE note = 'unbound join email optional'), true,
          'an email-free link stores neither a guessed email nor a member id');
SELECT is((SELECT count(*)::int FROM public.member_password_invitations
           WHERE token_hash = 'phpw_' || repeat('u', 64)), 0,
          'an email-free link still stores only the token hash');
SELECT phantoms_test.as_service();
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('w', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('existing_reset'), NULL::text, 'enroll', NULL, NULL, 24, '',
  phantoms_test.uid('join_admin'))$$, '%INVALID_INPUT%',
  'enroll invitations still require an email');
SELECT throws_like($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('x', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('existing_reset'), NULL::text, 'reset', NULL, NULL, 24, '',
  phantoms_test.uid('join_admin'))$$, '%INVALID_INPUT%',
  'reset invitations still require an email');
SELECT throws_like($$SELECT public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('u', 64), 'UTF8'), 'sha256'), 'hex'), NULL::text)$$,
  '%INVALID_TOKEN%', 'recipient email remains required at redemption');
SELECT is((public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('u', 64), 'UTF8'), 'sha256'), 'hex'),
  'reset-self@phantoms-test.example') ->> 'status'), 'identity_conflict',
  'a collision with an existing member is rejected without consuming the join link');
RESET ROLE;
SELECT is((SELECT normalized_email IS NULL AND status = 'pending'
           FROM public.member_password_invitations WHERE note = 'unbound join email optional'), true,
          'a conflicting email leaves the join link unbound and pending');
SELECT lives_ok($$INSERT INTO phantoms_test.vars(key, value)
SELECT 'unbound_join_claim', public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('u', 64), 'UTF8'), 'sha256'), 'hex'),
  '  UNBOUND-SELF@PHANTOMS-TEST.EXAMPLE  ')::text$$,
  'the recipient can bind their own normalized email on the first valid use');
SELECT is((SELECT normalized_email FROM public.member_password_invitations
           WHERE note = 'unbound join email optional'), 'unbound-self@phantoms-test.example',
          'recipient email is normalized and atomically attached to the invitation');
SELECT is((SELECT status FROM public.member_password_invitations
           WHERE note = 'unbound join email optional'), 'reserved',
          'the email binding and one-use reservation happen together');
SELECT is((SELECT (value::jsonb ->> 'email') FROM phantoms_test.vars WHERE key = 'unbound_join_claim'),
          'unbound-self@phantoms-test.example', 'reservation returns only the normalized claimed email');
SELECT is((public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('v', 64), 'UTF8'), 'sha256'), 'hex'),
  'unbound-self@phantoms-test.example') ->> 'status'), 'identity_conflict',
  'another unbound link cannot concurrently claim the same active registration email');
RESET ROLE;
SELECT is((SELECT normalized_email IS NULL AND status = 'pending'
           FROM public.member_password_invitations WHERE note = 'unbound join sibling'), true,
          'the losing sibling link stays unbound for its intended recipient');
INSERT INTO auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '40000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unbound-self@phantoms-test.example', 'self-service-unbound-hash', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
INSERT INTO phantoms_test.users(name, id, email)
VALUES ('join_unbound', '40000000-0000-4000-8000-000000000002', 'unbound-self@phantoms-test.example');
SELECT phantoms_test.as_service();
SELECT lives_ok($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE note = 'unbound join email optional'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'unbound_join_claim') ->> 'claim_id')::uuid,
  '40000000-0000-4000-8000-000000000002',
  '{"fullName":"Unbound Self Service Member","phone":"","residence":"","workConditions":"","bio":"","device":"","gender":""}'::jsonb)$$,
  'email-free Admin issuance still completes the member-entered profile behind the guarded Auth write');
SELECT is((SELECT count(*)::int FROM public.members WHERE email = 'unbound-self@phantoms-test.example'), 1,
          'email-free issuance creates exactly one member only after redemption');
SELECT is((SELECT work_status FROM public.members WHERE email = 'unbound-self@phantoms-test.example'), 'inactive',
          'email-free join remains inactive pending Admin review');
SELECT is((SELECT status FROM public.member_password_invitations WHERE note = 'unbound join email optional'), 'complete',
          'email-free link reaches a terminal completed state');
SELECT throws_like($$SELECT public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('u', 64), 'UTF8'), 'sha256'), 'hex'),
  'unbound-self@phantoms-test.example')$$, '%ALREADY_USED%',
  'a completed email-free join link cannot be used a second time');

-- Existing-member password reset is a separate, profile-preserving path.
SELECT phantoms_test.as_service();
INSERT INTO phantoms_test.vars(key, value)
SELECT 'reset_auth_id', auth_user_id::text FROM public.member_auth_bindings
WHERE member_id = phantoms_test.mid('existing_reset');
SELECT lives_ok($$SELECT public.member_password_issue_invitation(
  encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex'),
  phantoms_test.mid('existing_reset'), 'reset-self@phantoms-test.example', 'reset',
  (SELECT value::uuid FROM phantoms_test.vars WHERE key = 'reset_auth_id'), NULL, 24, 'reset fixture',
  phantoms_test.uid('join_admin'))$$, 'Admin can issue a reset for the exact existing member binding');
INSERT INTO phantoms_test.vars(key, value)
SELECT 'reset_claim', public.member_password_reserve(
  encode(extensions.digest(convert_to('phpw_' || repeat('r', 64), 'UTF8'), 'sha256'), 'hex'),
  'reset-self@phantoms-test.example')::text;
RESET ROLE;
UPDATE auth.users SET encrypted_password = 'reset-self-service-fixture-hash'
WHERE id = (SELECT value::uuid FROM phantoms_test.vars WHERE key = 'reset_auth_id');
SELECT phantoms_test.as_service();
SELECT throws_like($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'reset-self@phantoms-test.example'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'reset_claim') ->> 'claim_id')::uuid,
  (SELECT value::uuid FROM phantoms_test.vars WHERE key = 'reset_auth_id'),
  '{"fullName":"Should Not Replace Profile","phone":""}'::jsonb)$$, '%INVALID_INPUT%',
  'reset RPC rejects any profile payload');
SELECT lives_ok($$SELECT public.member_password_complete_profile(
  (SELECT id FROM public.member_password_invitations WHERE normalized_email = 'reset-self@phantoms-test.example'),
  ((SELECT value::jsonb FROM phantoms_test.vars WHERE key = 'reset_claim') ->> 'claim_id')::uuid,
  (SELECT value::uuid FROM phantoms_test.vars WHERE key = 'reset_auth_id'), NULL)$$,
  'reset completes with no profile payload');
SELECT is((SELECT full_name FROM public.members WHERE email = 'reset-self@phantoms-test.example'), 'Stored Member Profile',
          'password reset preserves the existing member name');
SELECT is((SELECT phone FROM public.members WHERE email = 'reset-self@phantoms-test.example'), '+201234567890',
          'password reset preserves the existing member phone');
SELECT is((SELECT residence FROM public.members WHERE email = 'reset-self@phantoms-test.example'), 'Alexandria',
          'password reset preserves the existing member residence');
SELECT is((SELECT details ->> 'membership' FROM public.member_password_audit
           WHERE action = 'completed' AND member_id = phantoms_test.mid('existing_reset')
           ORDER BY created_at DESC LIMIT 1), 'active',
          'existing-member reset completion remains active');
SELECT ok((SELECT status = 'complete' AND member_id = phantoms_test.mid('existing_reset')
           FROM public.member_password_invitations WHERE normalized_email = 'reset-self@phantoms-test.example'),
          'reset invitation completes against the pre-existing member only');

RESET ROLE;
SELECT finish();
ROLLBACK;
