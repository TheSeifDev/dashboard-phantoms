-- 24 — Owner-only global Admin demotion: authorization, exact binding reporting,
-- immediate access change, and preservation of Auth/member/password/device/
-- invitation/audit/team/project rows.
BEGIN;
\ir _helpers.psql

SELECT plan(30 + 12);

-- Disposable fixtures ---------------------------------------------------------
DO $$
BEGIN
  PERFORM phantoms_test.create_user(n)
  FROM unnest(ARRAY['owner','full_admin','team_head','unbound_admin']) AS n;
  PERFORM phantoms_test.create_member('linked', NULL, true);
  PERFORM phantoms_test.grant_admin('owner', 'owner');
  PERFORM phantoms_test.grant_admin('full_admin', 'admin');
  PERFORM phantoms_test.grant_admin('unbound_admin', 'admin');
END $$;

UPDATE public.members
SET work_status = 'active'
WHERE id = phantoms_test.mid('linked');

INSERT INTO phantoms_test.vars(key, value)
SELECT 'team', id::TEXT FROM public.teams WHERE slug = 'software';
INSERT INTO phantoms_test.vars(key, value)
VALUES ('project', extensions.gen_random_uuid()::TEXT);

-- The linked target already has independent Team and Web Projects state.
INSERT INTO public.team_admin_assignments (team_id, user_id, role, permissions, created_by)
VALUES (
  phantoms_test.var('team')::UUID,
  phantoms_test.uid('linked'),
  'head',
  phantoms_test.perms('members'),
  phantoms_test.uid('owner')
);
INSERT INTO public.team_admin_assignments (team_id, user_id, role, permissions, created_by)
VALUES (phantoms_test.var('team')::UUID, phantoms_test.uid('team_head'),
  'monitor', phantoms_test.perms('members'), phantoms_test.uid('owner'));
-- Existing Team seat predates a subsequent global promotion. The Team INSERT
-- guard remains enabled; demotion must preserve this representable stored state.
SELECT phantoms_test.grant_admin('linked', 'admin');
INSERT INTO public.team_memberships (team_id, member_id, status, created_by, approved_at, approved_by)
VALUES (
  phantoms_test.var('team')::UUID,
  phantoms_test.mid('linked'),
  'active',
  phantoms_test.uid('owner'),
  now(),
  phantoms_test.uid('owner')
);

INSERT INTO public.web_projects (id, slug, name, owner_member_id, created_by_auth_user_id)
VALUES (
  phantoms_test.var('project')::UUID,
  'demotion-preservation',
  'Demotion preservation fixture',
  phantoms_test.mid('linked'),
  phantoms_test.uid('owner')
);
INSERT INTO public.web_project_agreements (
  project_id, version, ownership_model, license_name, created_by_auth_user_id
)
VALUES (
  phantoms_test.var('project')::UUID,
  1,
  'undetermined',
  'undetermined',
  phantoms_test.uid('owner')
);
INSERT INTO public.web_project_members (
  project_id, member_id, role, status, added_by_auth_user_id
)
VALUES (
  phantoms_test.var('project')::UUID,
  phantoms_test.mid('linked'),
  'contributor',
  'pending',
  phantoms_test.uid('owner')
);
INSERT INTO public.web_project_agreement_acceptances (
  project_id, member_id, agreement_version, actor_auth_user_id
)
VALUES (phantoms_test.var('project')::UUID, phantoms_test.mid('linked'), 1,
  phantoms_test.uid('linked'));
UPDATE public.web_project_members
SET status = 'active', accepted_agreement_version = 1, agreement_accepted_at = now()
WHERE project_id = phantoms_test.var('project')::UUID
  AND member_id = phantoms_test.mid('linked');

SELECT phantoms_test.bind_device('linked');
INSERT INTO public.member_password_invitations (
  token_hash, member_id, normalized_email, purpose, expires_at, note,
  created_by, status, revoked_at
)
VALUES (
  repeat('b', 64),
  phantoms_test.mid('linked'),
  lower((SELECT email FROM phantoms_test.users WHERE name = 'linked')),
  'enroll',
  now() + interval '7 days',
  'preserve invitation history',
  phantoms_test.uid('owner'),
  'revoked',
  now()
);
INSERT INTO public.member_password_audit (member_id, action, actor_user_id, details)
VALUES (
  phantoms_test.mid('linked'),
  'revoked',
  phantoms_test.uid('owner'),
  '{"fixture":"demotion-preservation"}'::JSONB
);

-- Every column of every promised preserved row, invoked only as postgres.
-- Test-only SECURITY INVOKER helper is rolled back with the synthetic fixtures.
CREATE FUNCTION phantoms_test.preservation_snapshot()
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'auth', (SELECT to_jsonb(r) FROM auth.users r WHERE id = phantoms_test.uid('linked')),
    'member', (SELECT to_jsonb(r) FROM public.members r WHERE id = phantoms_test.mid('linked')),
    'binding', (SELECT to_jsonb(r) FROM public.member_auth_bindings r WHERE member_id = phantoms_test.mid('linked')),
    'devices', (SELECT jsonb_agg(to_jsonb(r) ORDER BY token_hash) FROM public.member_device_sessions r WHERE member_id = phantoms_test.mid('linked')),
    'invitations', (SELECT jsonb_agg(to_jsonb(r) ORDER BY token_hash) FROM public.member_password_invitations r WHERE member_id = phantoms_test.mid('linked')),
    'audit', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.member_password_audit r WHERE member_id = phantoms_test.mid('linked')),
    'team_admin', (SELECT to_jsonb(r) FROM public.team_admin_assignments r WHERE team_id = phantoms_test.var('team')::UUID AND user_id = phantoms_test.uid('linked')),
    'team_member', (SELECT to_jsonb(r) FROM public.team_memberships r WHERE team_id = phantoms_test.var('team')::UUID AND member_id = phantoms_test.mid('linked')),
    'project', (SELECT to_jsonb(r) FROM public.web_projects r WHERE id = phantoms_test.var('project')::UUID),
    'project_agreement', (SELECT to_jsonb(r) FROM public.web_project_agreements r WHERE project_id = phantoms_test.var('project')::UUID AND version = 1),
    'project_acceptance', (SELECT to_jsonb(r) FROM public.web_project_agreement_acceptances r WHERE project_id = phantoms_test.var('project')::UUID AND member_id = phantoms_test.mid('linked')),
    'project_member', (SELECT to_jsonb(r) FROM public.web_project_members r WHERE project_id = phantoms_test.var('project')::UUID AND member_id = phantoms_test.mid('linked'))
  );
$$;
INSERT INTO phantoms_test.vars(key, value)
VALUES ('preservation-before', phantoms_test.preservation_snapshot()::TEXT);

-- Boundary checks before the owner operation -------------------------------
SELECT phantoms_test.login_anon();
SELECT throws_ok(
  $$SELECT public.admin_demote_account(phantoms_test.uid('unbound_admin'))$$,
  '42501', NULL,
  'anonymous callers cannot execute owner demotion'
);
RESET ROLE;

SELECT phantoms_test.login_as('full_admin');
SELECT throws_like(
  $$SELECT public.admin_demote_account(phantoms_test.uid('unbound_admin'))$$,
  '%OWNER_ONLY%',
  'a global Admin cannot demote another account'
);
RESET ROLE;

SELECT phantoms_test.login_as('team_head');
SELECT throws_like(
  $$SELECT public.admin_demote_account(phantoms_test.uid('unbound_admin'))$$,
  '%OWNER_ONLY%',
  'a Team-only account cannot demote a global account'
);
RESET ROLE;

SELECT phantoms_test.login_as('linked');
SELECT ok(public.is_admin(), 'the linked fixture starts as a global Admin');
SELECT is(
  public.get_member_password_access() ->> 'member_id',
  phantoms_test.mid('linked')::TEXT,
  'Admin/Member overlap uses Member access through its explicit binding before demotion'
);
RESET ROLE;

-- Owner demotion and strict result object -----------------------------------
SELECT phantoms_test.login_as('owner');
INSERT INTO phantoms_test.vars(key, value)
VALUES (
  'linked-demotion-result',
  public.admin_demote_account(phantoms_test.uid('linked'))::TEXT
);
SELECT is(
  (SELECT array_agg(k ORDER BY k)
   FROM jsonb_object_keys(phantoms_test.var('linked-demotion-result')::JSONB) AS keys(k)),
  ARRAY['demoted', 'member_linked', 'target_uuid']::TEXT[],
  'demotion returns only target_uuid, demoted, and member_linked'
);
SELECT is(
  phantoms_test.var('linked-demotion-result')::JSONB ->> 'target_uuid',
  phantoms_test.uid('linked')::TEXT,
  'demotion result confirms the exact target UUID'
);
SELECT is(
  phantoms_test.var('linked-demotion-result')::JSONB ->> 'demoted',
  'true',
  'demotion result positively confirms demoted=true'
);
SELECT is(
  phantoms_test.var('linked-demotion-result')::JSONB ->> 'member_linked',
  'true',
  'member_linked reports only the exact existing Auth/member binding'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INT FROM public.admin_accounts WHERE user_id = phantoms_test.uid('linked')),
  0,
  'demotion deletes exactly the target global admin row'
);
RESET ROLE;

SELECT phantoms_test.login_as('linked');
SELECT ok(public.is_admin(), 'the demoted identity retains management access through its active team assignment');
SELECT is(
  public.get_admin_access() ->> 'is_admin',
  'true',
  'get_admin_access keeps is_admin=true while the active team assignment remains'
);
SELECT is(
  public.get_member_password_access() ->> 'member_id',
  phantoms_test.mid('linked')::TEXT,
  'the exact eligible Member binding can use Member access after demotion'
);
RESET ROLE;

-- Preservation assertions ----------------------------------------------------
SELECT is(
  (SELECT count(*)::INT FROM auth.users
   WHERE id = phantoms_test.uid('linked')
     AND encrypted_password = 'fixture-password-hash-' || phantoms_test.uid('linked')::TEXT),
  1,
  'Auth user and password material remain untouched'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_auth_bindings
   WHERE member_id = phantoms_test.mid('linked')
     AND auth_user_id = phantoms_test.uid('linked')
     AND password_ready IS TRUE),
  1,
  'the exact member_auth_bindings row and password_ready state remain'
);
SELECT is(
  (SELECT count(*)::INT FROM public.members WHERE id = phantoms_test.mid('linked')),
  1,
  'the canonical member row remains'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_device_sessions WHERE member_id = phantoms_test.mid('linked')),
  1,
  'member device state remains'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_password_invitations WHERE member_id = phantoms_test.mid('linked')),
  1,
  'member password invitation history remains'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_password_audit WHERE member_id = phantoms_test.mid('linked')),
  1,
  'member password audit history remains'
);
SELECT is(
  (SELECT count(*)::INT FROM public.team_admin_assignments
   WHERE team_id = phantoms_test.var('team')::UUID AND user_id = phantoms_test.uid('linked')),
  1,
  'Team admin assignment remains independent of global Admin removal'
);
SELECT is(
  (SELECT count(*)::INT FROM public.team_memberships
   WHERE team_id = phantoms_test.var('team')::UUID AND member_id = phantoms_test.mid('linked') AND status = 'active'),
  1,
  'Team membership remains independent of global Admin removal'
);
SELECT is(
  (SELECT count(*)::INT FROM public.web_project_members
   WHERE project_id = phantoms_test.var('project')::UUID AND member_id = phantoms_test.mid('linked')),
  1,
  'Web Projects membership remains independent of global Admin removal'
);
SELECT is(
  phantoms_test.preservation_snapshot() -> k,
  phantoms_test.var('preservation-before')::JSONB -> k,
  'exact before/after preservation of all ' || k || ' fields'
)
FROM unnest(ARRAY['auth','member','binding','devices','invitations','audit',
  'team_admin','team_member','project','project_agreement','project_acceptance',
  'project_member']) AS snapshots(k);

-- Unbound targets report false and do not acquire a Member binding ----------
SELECT phantoms_test.login_as('owner');
INSERT INTO phantoms_test.vars(key, value)
VALUES (
  'unbound-demotion-result',
  public.admin_demote_account(phantoms_test.uid('unbound_admin'))::TEXT
);
SELECT is(
  phantoms_test.var('unbound-demotion-result')::JSONB ->> 'member_linked',
  'false',
  'an unbound identity reports member_linked=false'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INT FROM public.admin_accounts WHERE user_id = phantoms_test.uid('unbound_admin')),
  0,
  'the unbound target admin row is removed'
);
SELECT is(
  (SELECT count(*)::INT FROM public.member_auth_bindings WHERE auth_user_id = phantoms_test.uid('unbound_admin')),
  0,
  'demotion never creates a binding for an unbound identity'
);

-- Unknown, already-demoted, and owner/self targets fail closed --------------
SELECT phantoms_test.login_as('owner');
SELECT throws_like(
  $$SELECT public.admin_demote_account(phantoms_test.uid('linked'))$$,
  '%ADMIN_NOT_FOUND%',
  'an already-demoted target is rejected as not an Admin'
);
SELECT throws_like(
  $$SELECT public.admin_demote_account(NULL)$$,
  '%ADMIN_NOT_FOUND%',
  'a NULL target is rejected'
);
SELECT throws_like(
  $$SELECT public.admin_demote_account('00000000-0000-0000-0000-000000000099'::UUID)$$,
  '%ADMIN_NOT_FOUND%',
  'an unknown target is rejected'
);
SELECT throws_like(
  $$SELECT public.admin_demote_account(phantoms_test.uid('owner'))$$,
  '%SELF_DEMOTION_FORBIDDEN%',
  'the Owner/self target is immutable'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INT FROM public.admin_accounts WHERE role = 'owner'),
  1,
  'the single Owner row remains intact'
);

SELECT * FROM finish();
ROLLBACK;
