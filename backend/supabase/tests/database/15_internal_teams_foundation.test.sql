BEGIN;
SELECT plan(38);
\ir _helpers.psql

SELECT ok(to_regclass('public.teams') IS NOT NULL, 'internal teams table exists');
SELECT ok(to_regclass('public.team_memberships') IS NOT NULL, 'member-team many-to-many table exists');
SELECT ok(to_regclass('public.team_admin_assignments') IS NOT NULL, 'separate team admin assignment table exists');
SELECT ok(to_regclass('public.team_member_metrics') IS NOT NULL, 'team-specific rank and bonus metrics exist');
SELECT ok(to_regclass('public.team_member_custom_field_values') IS NOT NULL, 'team-specific custom-field value storage exists');
SELECT ok(to_regclass('public.announcement_recipients') IS NOT NULL, 'normalized announcement recipient storage exists');
SELECT ok(to_regclass('public.team_access_audit') IS NOT NULL, 'team assignment audit exists');
SELECT ok((SELECT count(*) = 3 FROM public.teams WHERE slug IN ('software','hardware','ai')), 'example teams are provisioned empty');
SELECT ok((SELECT count(*) = 0 FROM public.team_memberships), 'no existing members are auto-assigned');
SELECT ok((SELECT count(*) = 0 FROM public.tasks WHERE team_id IS NOT NULL), 'historical tasks remain unassigned');
SELECT ok((SELECT count(*) = 0 FROM public.notes WHERE team_id IS NOT NULL), 'historical notes remain unassigned');
SELECT ok((SELECT count(*) = 0 FROM public.announcements WHERE team_id IS NOT NULL), 'historical announcements remain unassigned');

SELECT phantoms_test.create_user('team-owner');
SELECT phantoms_test.create_user('multi-team-head');
SELECT phantoms_test.create_user('team-monitor');
SELECT phantoms_test.create_user('team-member');
SELECT phantoms_test.create_user('unprivileged');
SELECT phantoms_test.grant_admin('team-owner', 'owner');
SELECT phantoms_test.create_member('multi-team-member');
SELECT phantoms_test.create_member('team-member');

SELECT phantoms_test.login_as('team-owner');
INSERT INTO phantoms_test.vars(key,value) VALUES
  ('team_software_id',(SELECT id::TEXT FROM public.teams WHERE slug='software')),
  ('team_hardware_id',(SELECT id::TEXT FROM public.teams WHERE slug='hardware')),
  ('team_ai_id',(SELECT id::TEXT FROM public.teams WHERE slug='ai'));
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  (phantoms_test.var('team_software_id')::uuid),
  phantoms_test.uid('multi-team-head'), 'head', phantoms_test.perms('dashboard','members','tasks'))$$,
  'Owner can assign a team-scoped Head with selected permissions');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  (phantoms_test.var('team_hardware_id')::uuid),
  phantoms_test.uid('multi-team-head'), 'head', phantoms_test.perms('members'))$$,
  'one Head can be explicitly assigned to multiple teams with different permissions');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  (phantoms_test.var('team_software_id')::uuid),
  phantoms_test.uid('team-monitor'), 'monitor', phantoms_test.perms('members'))$$,
  'one distinct Monitor seat can be assigned to the same team');

RESET ROLE;
SELECT phantoms_test.login_as('multi-team-head');
SELECT ok(public.is_admin(), 'Head with an active assignment is an admin management account');
SELECT ok(public.has_admin_permission('tasks'), 'assigned task permission is exposed to admin feature gates');
SELECT ok(public.has_team_permission((phantoms_test.var('team_software_id')::uuid),'tasks'), 'Head has tasks permission in Software');
SELECT ok(NOT public.has_team_permission((phantoms_test.var('team_hardware_id')::uuid),'tasks'), 'same Head lacks tasks permission in Hardware');
SELECT ok(NOT public.has_team_permission((phantoms_test.var('team_ai_id')::uuid),'tasks'), 'Head has no access to an unassigned team');
SELECT ok((public.get_admin_access() ->> 'is_admin')::BOOLEAN IS TRUE, 'active team assignment is reported as admin access');
SELECT ok((public.get_admin_access() ->> 'is_team_admin')::BOOLEAN IS TRUE, 'team-only access response reports separate team role');
SELECT ok(jsonb_array_length(public.get_admin_access() -> 'teams') = 2, 'team-only access returns only its two assignments');
SELECT throws_ok($$INSERT INTO public.teams(slug,name) VALUES ('forged','Forged')$$, '42501', NULL, 'team Head cannot insert teams directly');
SELECT throws_ok($$INSERT INTO public.team_admin_assignments(team_id,user_id,role,created_by)
  VALUES ((phantoms_test.var('team_ai_id')::uuid), auth.uid(), 'head', auth.uid())$$,
  '42501', NULL, 'team Head cannot assign itself or alter seats directly');

RESET ROLE;
SELECT phantoms_test.login_as('team-owner');
SELECT lives_ok($$SELECT public.team_add_member(
  (phantoms_test.var('team_software_id')::uuid), phantoms_test.mid('multi-team-member'))$$,
  'Owner can add a member to Software');
SELECT lives_ok($$SELECT public.team_add_member(
  (phantoms_test.var('team_hardware_id')::uuid), phantoms_test.mid('multi-team-member'))$$,
  'same canonical member can belong to Hardware too');
SELECT is((SELECT count(*)::INT FROM public.team_memberships WHERE member_id=phantoms_test.mid('multi-team-member')), 2,
  'member identity remains one row with two team memberships');

RESET ROLE;
SELECT phantoms_test.login_as('team-monitor');
SELECT is((SELECT count(*)::INT FROM public.team_memberships WHERE team_id=(phantoms_test.var('team_software_id')::uuid)), 1,
  'Software Monitor can read a membership in the assigned team');
SELECT is((SELECT count(*)::INT FROM public.team_memberships WHERE team_id=(phantoms_test.var('team_hardware_id')::uuid)), 0,
  'Software Monitor cannot read the existing Hardware membership');
SELECT ok(public.has_team_membership((phantoms_test.var('team_software_id')::uuid),
  phantoms_test.mid('multi-team-member')), 'membership helper confirms an authorized same-team membership');
SELECT ok(NOT public.has_team_membership((phantoms_test.var('team_hardware_id')::uuid),
  phantoms_test.mid('multi-team-member')), 'membership helper hides an existing other-team membership');
SELECT throws_ok($$SELECT public.owner_list_team_members((phantoms_test.var('team_hardware_id')::uuid))$$,
  'P0001', NULL, 'Software Monitor cannot use the team roster RPC to read Hardware');

RESET ROLE;
SELECT phantoms_test.login_as('unprivileged');
SELECT ok(NOT public.has_team_membership((phantoms_test.var('team_software_id')::uuid),
  phantoms_test.mid('multi-team-member')), 'unassigned user cannot enumerate another member team membership');

RESET ROLE;
SELECT phantoms_test.login_as('multi-team-head');
SELECT is(public.team_add_member((phantoms_test.var('team_software_id')::uuid), phantomS_test.mid('team-member')), 'pending',
  'team-scoped members permission creates a pending membership, not global activation');
SELECT is(public.team_review_member((phantoms_test.var('team_software_id')::uuid),
  phantoms_test.mid('team-member'), 'approve'), 'active',
  'team manager can approve membership inside the assigned team');
SELECT ok(NOT public.has_team_permission((phantoms_test.var('team_software_id')::uuid),'whatsapp'),
  'ungranted feature remains denied within otherwise assigned team');

RESET ROLE;
SELECT ok((SELECT work_status='active' FROM public.members WHERE id = phantoms_test.mid('team-member')),
  'team approval does not change the canonical global work_status');

SELECT * FROM finish();
ROLLBACK;
