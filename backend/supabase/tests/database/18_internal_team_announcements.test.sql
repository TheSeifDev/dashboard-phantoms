BEGIN;
SELECT no_plan();
\ir _helpers.psql

SELECT ok(to_regprocedure('public.team_list_announcements(uuid)') IS NOT NULL,
  'team announcement listing RPC exists');
SELECT ok(to_regprocedure('public.team_create_announcement(uuid,text,text,text,jsonb)') IS NOT NULL,
  'team announcement creation RPC exists');
SELECT ok(to_regprocedure('public.team_set_announcement_active(uuid,bigint,boolean)') IS NOT NULL,
  'team announcement activation RPC exists');
SELECT ok(to_regprocedure('public.team_delete_announcement(uuid,bigint)') IS NOT NULL,
  'team announcement deletion RPC exists');
SELECT ok(to_regclass('public.announcement_recipients') IS NOT NULL,
  'normalized announcement recipients exist');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""']::TEXT[]
  FROM pg_proc WHERE oid='public.team_create_announcement(uuid,text,text,text,jsonb)'::regprocedure),
  'team creation RPC is SECURITY DEFINER with an empty search path');
SELECT ok(NOT has_function_privilege('anon','public.team_list_announcements(uuid)','EXECUTE'),
  'anonymous role cannot execute team announcement RPCs');
SELECT ok(has_function_privilege('authenticated','public.team_list_announcements(uuid)','EXECUTE'),
  'authenticated role can execute the team announcement RPC');

SELECT phantoms_test.create_user('announcement-owner');
SELECT phantoms_test.create_user('announcement-software-head');
SELECT phantoms_test.create_user('announcement-hardware-head');
SELECT phantoms_test.create_user('announcement-global-admin');
SELECT phantoms_test.create_user('announcement-no-permission');
SELECT phantoms_test.create_member('announcement-member-a', NULL, TRUE);
SELECT phantoms_test.create_member('announcement-member-c', NULL, TRUE);
SELECT phantoms_test.create_member('announcement-member-b', NULL, TRUE);
SELECT phantoms_test.create_member('announcement-member-late', NULL, TRUE);
SELECT phantoms_test.bind_device('announcement-member-a');
SELECT phantoms_test.bind_device('announcement-member-c');
SELECT phantoms_test.bind_device('announcement-member-b');
SELECT phantoms_test.bind_device('announcement-member-late');
SELECT phantoms_test.grant_admin('announcement-owner', 'owner');
SELECT phantoms_test.grant_admin('announcement-global-admin', 'admin', phantoms_test.perms('announcements'));

INSERT INTO phantoms_test.vars(key,value) VALUES
  ('announcement_software_team',(SELECT id::TEXT FROM public.teams WHERE slug='software')),
  ('announcement_hardware_team',(SELECT id::TEXT FROM public.teams WHERE slug='hardware'));

SELECT phantoms_test.login_as('announcement-owner');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.uid('announcement-software-head'), 'head', phantoms_test.perms('announcements'))$$,
  'Owner assigns an announcements-only Software Head');
SELECT lives_ok($$SELECT public.owner_assign_team_admin(
  phantoms_test.var('announcement_hardware_team')::UUID,
  phantoms_test.uid('announcement-hardware-head'), 'head', phantoms_test.perms('announcements'))$$,
  'Owner assigns an announcements-only Hardware Head');
SELECT lives_ok($$SELECT public.team_add_member(phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.mid('announcement-member-a'))$$, 'Owner adds the first active Software member');
SELECT lives_ok($$SELECT public.team_add_member(phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.mid('announcement-member-c'))$$, 'Owner adds the second active Software member');
SELECT lives_ok($$SELECT public.team_add_member(phantoms_test.var('announcement_hardware_team')::UUID,
  phantoms_test.mid('announcement-member-b'))$$, 'Owner adds an active Hardware member');

-- A historical/global row remains NULL-scoped and retains its JSON audience.
WITH inserted AS (
  INSERT INTO public.announcements(title,content,priority,target_audience,team_id,is_active,send_push,send_whatsapp)
  VALUES ('Global fixture','Global content','normal',
    jsonb_build_object('type','specific','member_ids',jsonb_build_array(phantoms_test.mid('announcement-member-a'))),
    NULL,TRUE,FALSE,FALSE)
  RETURNING id
)
INSERT INTO phantoms_test.vars(key,value)
SELECT 'announcement_global_id', id::TEXT FROM inserted
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
WITH inserted AS (
  INSERT INTO public.announcements(title,content,priority,target_audience,team_id,is_active,expires_at,send_push,send_whatsapp)
  VALUES ('Expired fixture','Expired content','normal',
    jsonb_build_object('type','specific','member_ids',jsonb_build_array(phantoms_test.mid('announcement-member-a'))),
    NULL,TRUE,now()-INTERVAL '1 minute',FALSE,FALSE)
  RETURNING id
)
INSERT INTO phantoms_test.vars(key,value)
SELECT 'announcement_expired_id', id::TEXT FROM inserted
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-software-head');
INSERT INTO phantoms_test.vars(key,value)
SELECT 'announcement_all_id', public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,
  'Software update','Team-wide content','high',NULL)::TEXT
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO phantoms_test.vars(key,value)
SELECT 'announcement_specific_id', public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,
  'Specific update','One-recipient content','normal',
  jsonb_build_array(phantoms_test.mid('announcement-member-a')))::TEXT
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

RESET ROLE;
SELECT is((SELECT count(*)::INT FROM public.announcement_recipients
  WHERE announcement_id=phantoms_test.var('announcement_all_id')::BIGINT), 2,
  'all-audience publication snapshots the two active Software members');
SELECT is((SELECT count(*)::INT FROM public.announcement_recipients
  WHERE announcement_id=phantoms_test.var('announcement_specific_id')::BIGINT), 1,
  'specific-audience publication snapshots exactly its selected member');
SELECT is((SELECT team_id::TEXT FROM public.announcements
  WHERE id=phantoms_test.var('announcement_all_id')::BIGINT),
  phantoms_test.var('announcement_software_team'), 'team announcement is never global NULL scope');
SELECT ok((SELECT send_push IS FALSE AND send_whatsapp IS FALSE FROM public.announcements
  WHERE id=phantoms_test.var('announcement_all_id')::BIGINT),
  'team announcement creation does not invoke external send channels');
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-software-head');
SELECT is(jsonb_array_length(public.team_list_announcements(
  phantoms_test.var('announcement_software_team')::UUID)), 2,
  'Software Head lists only Software announcements');
SELECT is((SELECT (e->>'recipient_count')::INT FROM jsonb_array_elements(
  public.team_list_announcements(phantoms_test.var('announcement_software_team')::UUID)) AS e
  WHERE (e->>'id')::BIGINT=phantoms_test.var('announcement_all_id')::BIGINT), 2,
  'team list reports active snapshot recipient count');
SELECT is((SELECT (e->>'read_count')::INT FROM jsonb_array_elements(
  public.team_list_announcements(phantoms_test.var('announcement_software_team')::UUID)) AS e
  WHERE (e->>'id')::BIGINT=phantoms_test.var('announcement_all_id')::BIGINT), 0,
  'team list starts with zero normalized reads');
SELECT ok(public.team_set_announcement_active(
  phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.var('announcement_all_id')::BIGINT,FALSE),
  'team permission holder can deactivate an announcement in the same team');
SELECT ok(public.team_set_announcement_active(
  phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.var('announcement_all_id')::BIGINT,TRUE),
  'team permission holder can reactivate an announcement in the same team');
SELECT throws_ok($$SELECT public.team_set_announcement_active(
  phantoms_test.var('announcement_hardware_team')::UUID,
  phantoms_test.var('announcement_all_id')::BIGINT,FALSE)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'another team cannot mutate this announcement by supplying its ID');
SELECT throws_ok($$SELECT public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,'Bad audience','Invalid','normal',
  jsonb_build_array(phantoms_test.mid('announcement-member-b')))$$,
  'P0001', 'ANNOUNCEMENT_RECIPIENT_NOT_ACTIVE_TEAM_MEMBER',
  'specific audience rejects an active member from another team');
SELECT throws_ok($$SELECT public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,'Bad audience','Invalid','normal',
  jsonb_build_array(phantoms_test.mid('announcement-member-a'),phantoms_test.mid('announcement-member-a')))$$,
  'P0001', 'DUPLICATE_ANNOUNCEMENT_RECIPIENT',
  'specific audience rejects duplicate member IDs');
SELECT throws_ok($$SELECT public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,'Bad audience','Invalid','normal',
  '["not-an-id"]'::JSONB)$$,
  'P0001', 'INVALID_ANNOUNCEMENT_AUDIENCE', 'specific audience rejects non-numeric IDs');

-- Snapshot does not expand when a member joins after publication.
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-owner');
SELECT lives_ok($$SELECT public.team_add_member(phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.mid('announcement-member-late'))$$, 'Owner adds a member after the announcements were published');
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM public.announcement_recipients
  WHERE announcement_id=phantoms_test.var('announcement_all_id')::BIGINT), 2,
  'all-audience recipients remain a publish-time snapshot');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-member-a');
SELECT ok(EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a'))
  WHERE id=phantoms_test.var('announcement_all_id')::BIGINT),
  'device-bound member sees their active team announcement');
SELECT ok(EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a'))
  WHERE id=phantoms_test.var('announcement_global_id')::BIGINT),
  'global member portal retains targeted global announcements');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a'))
  WHERE id=phantoms_test.var('announcement_expired_id')::BIGINT),
  'expired global announcement is withheld from the member portal');
SELECT ok(NOT public.mark_announcement_read(phantoms_test.var('announcement_expired_id')::BIGINT,
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a')),
  'expired announcement cannot receive a read mutation');
SELECT ok(public.mark_announcement_viewed(phantoms_test.var('announcement_all_id')::BIGINT,
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a')),
  'team recipient can record a view');
SELECT ok(public.mark_announcement_read(phantoms_test.var('announcement_all_id')::BIGINT,
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a')),
  'team recipient can record a read');
RESET ROLE;
SELECT ok((SELECT viewed_at IS NOT NULL AND last_viewed_at IS NOT NULL AND view_count=1 AND read_at IS NOT NULL
  FROM public.announcement_recipients
  WHERE announcement_id=phantoms_test.var('announcement_all_id')::BIGINT
    AND member_id=phantoms_test.mid('announcement-member-a')),
  'team views and reads use normalized recipient columns');
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-member-a');
SELECT ok(public.mark_announcement_read(phantoms_test.var('announcement_global_id')::BIGINT,
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a')),
  'global member receipt still uses the existing JSON receipt path');
RESET ROLE;
SELECT ok((SELECT read_receipts ? phantoms_test.mid('announcement-member-a')::TEXT
  FROM public.announcements WHERE id=phantoms_test.var('announcement_global_id')::BIGINT),
  'global JSON receipt format remains intact');
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-member-a');
SELECT ok(public.dismiss_announcement(phantoms_test.var('announcement_specific_id')::BIGINT,
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a')),
  'team recipient can dismiss their snapshot announcement');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a'))
  WHERE id=phantoms_test.var('announcement_specific_id')::BIGINT),
  'dismissed team announcement no longer appears in member portal');
SELECT throws_ok($$SELECT public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-c'))$$,
  'P0001', NULL, 'device token for a different member cannot read this portal identity');
SELECT throws_ok($$SELECT public.get_member_announcements(
  phantoms_test.mid('announcement-member-c'),phantoms_test.tok('announcement-member-a'))$$,
  'P0001', NULL, 'a member cannot combine another member ID with their own device token');
SELECT throws_ok($$SELECT public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),NULL)$$,
  'P0001', NULL, 'authenticated member portal calls still require device binding');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_anon();
SELECT throws_ok($$SELECT public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),phantoms_test.tok('announcement-member-a'))$$,
  'P0001', 'MEMBER_PASSWORD_REQUIRED',
  'anonymous device-token-only portal transport remains denied by password guards');
SELECT throws_ok($$SELECT public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),NULL)$$,
  'P0001', NULL, 'anonymous portal identity is rejected without a device token');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-member-c');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-c'),phantoms_test.tok('announcement-member-c'))
  WHERE id=phantoms_test.var('announcement_global_id')::BIGINT),
  'global specific audience is checked for the actual member');
SELECT ok(NOT public.mark_announcement_read(phantoms_test.var('announcement_global_id')::BIGINT,
  phantoms_test.mid('announcement-member-c'),phantoms_test.tok('announcement-member-c')),
  'global read receipt cannot be changed by a non-recipient');
RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-member-late');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-late'),phantoms_test.tok('announcement-member-late'))
  WHERE id=phantoms_test.var('announcement_all_id')::BIGINT),
  'member added after publication does not receive the team snapshot');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-software-head');
SELECT is((SELECT total_recipients FROM public.get_announcement_stats(
  phantoms_test.var('announcement_all_id')::BIGINT)), 2,
  'same-team feature permission can read stats for active snapshot recipients');
SELECT is((SELECT read_count FROM public.get_announcement_stats(
  phantoms_test.var('announcement_all_id')::BIGINT)), 1,
  'team stats count normalized reads');
SELECT is((SELECT viewed_count FROM public.get_announcement_stats(
  phantoms_test.var('announcement_all_id')::BIGINT)), 1,
  'team stats count normalized views');
SELECT is((SELECT count(*)::INT FROM public.get_announcement_details(
  phantoms_test.var('announcement_all_id')::BIGINT)), 2,
  'team details enumerate only active snapshot recipients');
SELECT throws_ok($$SELECT * FROM public.get_announcement_stats(
  phantoms_test.var('announcement_global_id')::BIGINT)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'team-only role cannot view global announcement stats');
SELECT throws_ok($$SELECT * FROM public.get_announcement_details(
  phantoms_test.var('announcement_global_id')::BIGINT)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'team-only role cannot enumerate global announcement recipients');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-hardware-head');
SELECT throws_ok($$SELECT public.team_list_announcements(
  phantoms_test.var('announcement_software_team')::UUID)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'another team cannot list Software announcements');
SELECT throws_ok($$SELECT * FROM public.get_announcement_stats(
  phantoms_test.var('announcement_all_id')::BIGINT)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'another team cannot inspect Software announcement statistics');
SELECT throws_ok($$SELECT * FROM public.get_announcement_details(
  phantoms_test.var('announcement_all_id')::BIGINT)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'another team cannot enumerate Software recipients');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-global-admin');
SELECT ok(jsonb_array_length(public.team_list_announcements(
  phantoms_test.var('announcement_software_team')::UUID)) = 2,
  'global announcements permission remains able to access team announcement administration');
SELECT is((SELECT total_recipients FROM public.get_announcement_stats(
  phantoms_test.var('announcement_global_id')::BIGINT)), 1,
  'global announcements permission can inspect global stats');
SELECT ok(EXISTS (SELECT 1 FROM public.get_member_announcements(
  phantoms_test.mid('announcement-member-a'),NULL)
  WHERE id=phantoms_test.var('announcement_all_id')::BIGINT),
  'global announcements permission is the explicit device-free exception');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-no-permission');
SELECT throws_ok($$SELECT public.team_list_announcements(
  phantoms_test.var('announcement_software_team')::UUID)$$,
  'P0001', 'ANNOUNCEMENTS_PERMISSION_REQUIRED',
  'authenticated users without global or same-team announcements permission are denied');

RESET ROLE;
SELECT phantoms_test.clear_auth();
SELECT phantoms_test.login_as('announcement-owner');
SELECT ok(public.team_delete_announcement(
  phantoms_test.var('announcement_software_team')::UUID,
  phantoms_test.var('announcement_specific_id')::BIGINT),
  'same-team permission holder can delete an announcement');
RESET ROLE;
SELECT is((SELECT count(*)::INT FROM public.announcement_recipients
  WHERE announcement_id=phantoms_test.var('announcement_specific_id')::BIGINT),0,
  'deleting a team announcement cascades only its normalized recipients');
SELECT phantoms_test.login_as('announcement-owner');
SELECT throws_ok($$SELECT public.team_create_announcement(
  phantoms_test.var('announcement_software_team')::UUID,'Bad priority','Invalid','critical',NULL)$$,
  'P0001', 'INVALID_ANNOUNCEMENT', 'creation validates priority server-side');

SELECT * FROM finish();
ROLLBACK;
