BEGIN;
SELECT plan(16);
\ir _helpers.psql

SELECT phantoms_test.create_user('harden-owner');
SELECT phantoms_test.create_user('harden-global');
SELECT phantoms_test.create_user('harden-head');
SELECT phantoms_test.create_user('harden-monitor');
SELECT phantoms_test.create_member('harden-member');
SELECT phantoms_test.grant_admin('harden-owner', 'owner');
SELECT phantoms_test.grant_admin('harden-global', 'admin', phantoms_test.perms('members'));
UPDATE public.members SET work_status = 'active' WHERE id = phantoms_test.mid('harden-member');
INSERT INTO phantoms_test.vars(key,value) VALUES
  ('harden-a', (SELECT id::TEXT FROM public.teams WHERE slug = 'software')),
  ('harden-b', (SELECT id::TEXT FROM public.teams WHERE slug = 'hardware'));
SELECT phantoms_test.login_as('harden-owner');
SELECT throws_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('harden-a')::UUID, phantoms_test.uid('harden-global'), 'head', phantoms_test.perms('members'))$$,
  'P0001', 'TEAM_ADMIN_REQUIRES_NON_GLOBAL_ACCOUNT', 'direct assignment rejects a global Admin');
SELECT throws_ok($$SELECT public.owner_set_team_admin_seat(
  phantoms_test.var('harden-a')::UUID, 'head', phantoms_test.uid('harden-owner'), phantoms_test.perms('members'))$$,
  'P0001', 'TEAM_ADMIN_REQUIRES_NON_GLOBAL_ACCOUNT', 'atomic replacement rejects the global Owner');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('harden-a')::UUID, phantoms_test.uid('harden-head'), 'head', phantoms_test.perms('members'))$$,
  'non-global Head assignment succeeds');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('harden-b')::UUID, phantoms_test.uid('harden-head'), 'head', phantoms_test.perms('members'))$$,
  'one non-global Head may have another team assignment');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('harden-a')::UUID, phantoms_test.uid('harden-monitor'), 'monitor', phantoms_test.perms('members'))$$,
  'Monitor gets a single-team members assignment');
SELECT public.team_add_member(phantoms_test.var('harden-b')::UUID, phantoms_test.mid('harden-member'));
RESET ROLE;
SELECT phantoms_test.login_as('harden-head');
SELECT is(public.team_add_member(phantoms_test.var('harden-a')::UUID, phantoms_test.mid('harden-member')),
  'pending', 'Head adds pending membership in one team');
SELECT throws_ok($$SELECT public.team_review_member(
  phantoms_test.var('harden-a')::UUID, phantoms_test.mid('harden-member'), NULL)$$,
  'P0001', 'INVALID_INPUT', 'NULL decision fails closed');
SELECT is((SELECT status FROM public.team_memberships
  WHERE team_id = phantoms_test.var('harden-a')::UUID AND member_id = phantoms_test.mid('harden-member')),
  'pending', 'invalid decision leaves the pending membership unchanged');
SELECT throws_ok($$SELECT public.team_review_member(
  phantoms_test.var('harden-a')::UUID, phantoms_test.mid('harden-member'), 'invalid')$$,
  'P0001', 'INVALID_INPUT', 'unknown decision fails closed');
SELECT is(public.team_review_member(phantoms_test.var('harden-a')::UUID, phantoms_test.mid('harden-member'), 'approve'),
  'active', 'valid decision still works for the assigned team');
SELECT ok(public.is_admin(), 'Head remains an admin management account after approvals');
RESET ROLE;
SELECT is((SELECT status FROM public.team_memberships
  WHERE team_id = phantoms_test.var('harden-b')::UUID AND member_id = phantoms_test.mid('harden-member')),
  'active', 'other team membership remains active and untouched');
SELECT is((SELECT work_status FROM public.members WHERE id = phantoms_test.mid('harden-member')),
  'active', 'team review does not change the canonical member status');
SELECT phantoms_test.login_as('harden-monitor');
SELECT throws_ok($$SELECT public.team_list_roster(phantoms_test.var('harden-b')::UUID, 'members')$$,
  'P0001', 'TEAM_FEATURE_PERMISSION_REQUIRED', 'Monitor cannot read the roster of an unassigned team');
SELECT lives_ok($$SELECT public.team_list_roster(phantoms_test.var('harden-a')::UUID, 'members')$$,
  'Monitor can still read the assigned team roster');
SELECT throws_ok($$SELECT public.team_add_member(phantoms_test.var('harden-b')::UUID, phantoms_test.mid('harden-member'))$$,
  'P0001', 'MEMBERS_PERMISSION_REQUIRED', 'Monitor cannot mutate membership in an unassigned team');
SELECT * FROM finish();
ROLLBACK;
