BEGIN;
SELECT no_plan();
\ir _helpers.psql

SELECT phantoms_test.create_user('records-owner');
SELECT phantoms_test.create_user('records-notes-admin');
SELECT phantoms_test.create_user('records-ranking-admin');
SELECT phantoms_test.create_user('records-unprivileged');
SELECT phantoms_test.create_member('records-software-member', NULL, TRUE);
SELECT phantoms_test.create_member('records-hardware-member');
SELECT phantoms_test.bind_device('records-software-member');
SELECT phantoms_test.grant_admin('records-owner', 'owner');

INSERT INTO phantoms_test.vars(key, value) VALUES
  ('records-software-team', (SELECT id::TEXT FROM public.teams WHERE slug = 'software')),
  ('records-hardware-team', (SELECT id::TEXT FROM public.teams WHERE slug = 'hardware'));

RESET ROLE;
SELECT phantoms_test.login_as('records-owner');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.uid('records-notes-admin'), 'head', phantoms_test.perms('notes'))$$,
  'Owner can assign a notes-only Head in the test team');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.uid('records-ranking-admin'), 'monitor', phantoms_test.perms('ranking','members'))$$,
  'Owner can assign a ranking-and-members Monitor in the test team');
SELECT is(public.team_add_member(phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-software-member')), 'active',
  'Owner creates an active team membership for the primary record fixture');
SELECT is(public.team_add_member(phantoms_test.var('records-hardware-team')::UUID,
  phantoms_test.mid('records-hardware-member')), 'active',
  'Owner creates an active membership in a separate team');
SELECT is(public.team_add_member(phantoms_test.var('records-hardware-team')::UUID,
  phantoms_test.mid('records-software-member')), 'active',
  'same member can hold a separate active membership in another team');

RESET ROLE;
INSERT INTO public.team_member_metrics (team_id, member_id, bonus_points)
VALUES (phantoms_test.var('records-software-team')::UUID,
        phantoms_test.mid('records-software-member'), 11);
SELECT phantoms_test.login_as('records-unprivileged');
SELECT throws_ok($$SELECT public.team_list_notes(phantoms_test.var('records-software-team')::UUID)$$,
  'P0001', NULL, 'unassigned users cannot list team notes');

RESET ROLE;
SELECT phantoms_test.login_as('records-notes-admin');
SELECT is(jsonb_array_length(public.team_list_notes(phantoms_test.var('records-software-team')::UUID)), 0,
  'notes permission can list only the authorized team notes');
SELECT throws_ok($$SELECT public.team_list_ranking(phantoms_test.var('records-software-team')::UUID)$$,
  'P0001', NULL, 'notes permission does not imply ranking permission');
SELECT throws_ok($$SELECT public.team_list_notes(phantoms_test.var('records-hardware-team')::UUID)$$,
  'P0001', NULL, 'notes permission does not cross team boundaries');
SELECT lives_ok($$INSERT INTO phantoms_test.vars(key,value) VALUES (
  'records-note-id', public.team_create_note(
    phantoms_test.var('records-software-team')::UUID,
    'A scoped team note', phantoms_test.mid('records-software-member'))::TEXT)$$,
  'team note is created with a server-selected author and a validated target');
SELECT is(jsonb_array_length(public.team_list_notes(phantoms_test.var('records-software-team')::UUID)), 1,
  'team note listing returns the scoped note');
SELECT is(public.team_list_notes(phantoms_test.var('records-software-team')::UUID)->0->>'target_name',
  'Test records-software-member', 'note target name is resolved from the canonical active member');
SELECT throws_ok($$SELECT public.team_create_note(
  phantoms_test.var('records-software-team')::UUID, 'forged target',
  phantoms_test.mid('records-hardware-member'))$$,
  'P0001', NULL, 'note target must be an active member of the same team');
SELECT throws_ok($$SELECT public.team_create_note(
  phantoms_test.var('records-software-team')::UUID, '[B:17] legacy bonus',
  phantoms_test.mid('records-software-member'))$$,
  'P0001', NULL, 'team notes cannot inject legacy global bonus markers');
RESET ROLE;
SELECT phantoms_test.login_as('records-owner');
SELECT is(public.team_delete_note(phantoms_test.var('records-hardware-team')::UUID,
  phantoms_test.var('records-note-id')::BIGINT), FALSE,
  'a note ID from another team cannot be deleted through this team scope');

RESET ROLE;
SELECT phantoms_test.login_as('records-ranking-admin');
SELECT throws_ok($$SELECT public.team_list_notes(phantoms_test.var('records-software-team')::UUID)$$,
  'P0001', NULL, 'ranking permission does not imply notes permission');
SELECT lives_ok($$INSERT INTO phantoms_test.vars(key,value) VALUES (
  'records-evaluation-id', public.team_create_evaluation(
    phantoms_test.var('records-software-team')::UUID,
    phantoms_test.mid('records-software-member'), 'Strong delivery', 'excellent', 6,
    'Clear, specific team feedback')::TEXT)$$,
  'team evaluation and its points are committed through one scoped RPC');
SELECT is(jsonb_array_length(public.team_list_evaluations(phantoms_test.var('records-software-team')::UUID)), 1,
  'evaluation listing returns active team evaluations');
SELECT is(public.team_list_ranking(phantoms_test.var('records-software-team')::UUID)->0->>'bonus_points', '17',
  'positive team evaluation points add to the same-team task-award baseline');
SELECT is(jsonb_array_length(public.team_list_ranking(phantoms_test.var('records-software-team')::UUID)), 1,
  'team ranking contains only active team members');
SELECT throws_ok($$SELECT public.team_create_evaluation(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-hardware-member'), 'Wrong team', 'good', 2, 'Not a team member')$$,
  'P0001', NULL, 'evaluation target must be an active member of the same team');
SELECT throws_ok($$SELECT public.team_create_evaluation(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-software-member'), 'Bad grade', 'invalid', 1, 'Feedback')$$,
  'P0001', NULL, 'evaluation grade is validated server-side');
SELECT lives_ok($$SELECT public.team_delete_evaluation(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.var('records-evaluation-id')::BIGINT)$$,
  'team evaluation deletion reverses its team metric delta atomically');
SELECT is(public.team_list_ranking(phantoms_test.var('records-software-team')::UUID)->0->>'bonus_points', '11',
  'deleting an evaluation reverses only its award and preserves prior task points');

RESET ROLE;
INSERT INTO public.member_evaluations (
  member_id, title, grade, points, feedback, evaluator_name, team_id
) VALUES (
  phantoms_test.mid('records-software-member'), 'Legacy global evaluation', 'good', 0,
  'Global legacy feedback', 'Global administration', NULL
);
INSERT INTO phantoms_test.vars(key, value)
SELECT 'records-global-evaluation-id', e.id::TEXT
FROM public.member_evaluations AS e
WHERE e.member_id = phantoms_test.mid('records-software-member')
  AND e.team_id IS NULL AND e.title = 'Legacy global evaluation';
SELECT phantoms_test.login_as('records-owner');
INSERT INTO phantoms_test.vars(key, value) VALUES (
  'records-active-team-evaluation-id', public.team_create_evaluation(
    phantoms_test.var('records-software-team')::UUID,
    phantoms_test.mid('records-software-member'), 'Active team evaluation', 'good', 3,
    'Visible while active')::TEXT);
INSERT INTO phantoms_test.vars(key, value) VALUES (
  'records-suspended-team-evaluation-id', public.team_create_evaluation(
    phantoms_test.var('records-hardware-team')::UUID,
    phantoms_test.mid('records-software-member'), 'Other team evaluation', 'good', 4,
    'Hidden after membership suspension')::TEXT);
RESET ROLE;
UPDATE public.team_memberships SET status = 'suspended', updated_at = now()
WHERE team_id = phantoms_test.var('records-hardware-team')::UUID
  AND member_id = phantoms_test.mid('records-software-member');
SELECT phantoms_test.login_as('records-owner');
SELECT is(jsonb_array_length(public.team_list_evaluations(
  phantoms_test.var('records-hardware-team')::UUID)), 0,
  'team evaluation listing hides rows after the target membership is suspended');
RESET ROLE;
SELECT phantoms_test.login_as('records-software-member');
SELECT is((SELECT count(*)::INT FROM public.get_member_evaluations(
  phantoms_test.mid('records-software-member'), phantoms_test.tok('records-software-member'))), 2,
  'device-bound member receives legacy global and own active-team evaluations only');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.get_member_evaluations(
    phantoms_test.mid('records-software-member'), phantoms_test.tok('records-software-member')) AS e
  WHERE e.id = phantoms_test.var('records-suspended-team-evaluation-id')::BIGINT
), 'device-bound member cannot read an evaluation from a suspended other-team membership');
SELECT ok(NOT public.mark_member_evaluation_read(
  phantoms_test.var('records-suspended-team-evaluation-id')::BIGINT,
  phantoms_test.mid('records-software-member'), phantoms_test.tok('records-software-member')),
  'device-bound member cannot acknowledge an evaluation from a suspended other team');
SELECT ok(public.mark_member_evaluation_read(
  phantoms_test.var('records-active-team-evaluation-id')::BIGINT,
  phantoms_test.mid('records-software-member'), phantoms_test.tok('records-software-member')),
  'device-bound member can acknowledge an evaluation for the same active team');

RESET ROLE;
SELECT phantoms_test.login_as('records-ranking-admin');
SELECT throws_ok($$SELECT public.team_create_note(
  phantoms_test.var('records-software-team')::UUID, 'wrong feature')$$,
  'P0001', NULL, 'members/ranking permissions do not imply notes permission');
SELECT lives_ok($$INSERT INTO phantoms_test.vars(key,value) VALUES (
  'records-field-id', public.team_create_custom_field(
    phantoms_test.var('records-software-team')::UUID, 'Work area', 'select',
    '["North","South"]'::JSONB)::TEXT)$$,
  'team custom-field definition is stored with its team scope');
SELECT is(jsonb_array_length(public.team_list_custom_fields(
  phantoms_test.var('records-software-team')::UUID)), 1,
  'custom-field listing returns only definitions scoped to the active team');
SELECT ok(public.team_set_custom_field_value(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-software-member'),
  phantoms_test.var('records-field-id')::BIGINT, '"North"'::JSONB),
  'custom-field value accepts an allowed option for an active team member');
SELECT is(public.team_list_custom_field_values(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-software-member'))->0->>'value', 'North',
  'custom-field value listing returns only the member/team value');
SELECT throws_ok($$SELECT public.team_set_custom_field_value(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-software-member'),
  phantoms_test.var('records-field-id')::BIGINT, '"West"'::JSONB)$$,
  'P0001', NULL, 'select custom-field values must match the declared options');
SELECT throws_ok($$SELECT public.team_create_custom_field(
  phantoms_test.var('records-software-team')::UUID, 'Bad choices', 'select',
  '["", "Good"]'::JSONB)$$,
  'P0001', NULL, 'custom-field option labels cannot be blank');
SELECT throws_ok($$SELECT public.team_set_custom_field_value(
  phantoms_test.var('records-software-team')::UUID,
  phantoms_test.mid('records-hardware-member'),
  phantoms_test.var('records-field-id')::BIGINT, '"North"'::JSONB)$$,
  'P0001', NULL, 'custom-field values require an active same-team member');

RESET ROLE;
SELECT ok((SELECT m.completion_rank = 0 FROM public.members AS m
  WHERE m.id = phantoms_test.mid('records-software-member')),
  'team evaluation operations leave canonical global completion rank unchanged');
SELECT ok((SELECT count(*) = 0 FROM public.member_custom_fields
  WHERE team_id IS NULL AND label = 'Work area'),
  'team custom-field creation does not create a canonical global field');
SELECT ok((SELECT m.custom_fields = '{}'::JSONB FROM public.members AS m
  WHERE m.id = phantoms_test.mid('records-software-member')),
  'team custom-field values do not write to the legacy member JSON/custom-field storage');
SELECT ok((SELECT count(*) = 0 FROM public.notes
  WHERE id = phantoms_test.var('records-note-id')::BIGINT AND team_id IS NULL),
  'team notes remain scoped and are not stored as global notes');

SELECT * FROM finish();
ROLLBACK;
