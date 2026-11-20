import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [page, api, router, routes, accessHelper, taskMigration, recordMigration, announcementMigration] = await Promise.all([
  read('src/features/teams/workspace/TeamWorkspacePage.tsx'),
  read('src/features/teams/workspace/api.ts'),
  read('src/router/index.tsx'),
  read('public/manus-routes.json'),
  read('src/features/teams/access.ts'),
  read('../backend/supabase/migrations/20261120074850_internal_team_tasks.sql'),
  read('../backend/supabase/migrations/20261120074944_internal_team_records.sql'),
  read('../backend/supabase/migrations/20261120075039_internal_team_announcements.sql'),
]);

test('team routes load only the dedicated team workspace behind the team access guard', () => {
  assert.match(router, /path: '\/team', element: <ProtectedTeamRoute><Page><TeamWorkspacePage \/><\/Page><\/ProtectedTeamRoute>/);
  assert.match(router, /path: '\/team\/:teamId', element: <ProtectedTeamRoute><Page><TeamWorkspacePage \/><\/Page><\/ProtectedTeamRoute>/);
  assert.match(page, /export default function TeamWorkspacePage\(\)/);
  assert.match(page, /useParams/);
  assert.match(page, /useNavigate/);
  assert.match(routes, /"path":"\/team","title":"Team workspace"/);
  assert.match(routes, /"path":"\/team\/:teamId","title":"Assigned team workspace"/);
  assert.match(page, /workspaceTeamEntries\(access\.data\)/);
  assert.match(accessHelper, /team\.role === 'head' \|\| team\.role === 'monitor'/);
});

test('team picker and section navigation are assignment- and feature-specific', () => {
  assert.match(page, /teamEntries\.find\(\(team\) => team\.team_id === routeTeamId\)/);
  assert.match(page, /currentTeam\?\.permissions\[FEATURE_FOR_SECTION\[section\.id\]\] === true/);
  assert.match(page, /members: 'members'/);
  assert.match(page, /tasks: 'tasks'/);
  assert.match(page, /notes: 'notes'/);
  assert.match(page, /ranking: 'ranking'/);
  assert.match(page, /announcements: 'announcements'/);
  assert.match(page, /'custom-fields': 'members'/);
  assert.doesNotMatch(page, /permissions\s*\|\|\s*access\.data\?\.permissions/);
});

test('every operational query uses user/team/section scope and revocation cancels and removes stale results', () => {
  assert.match(api, /\['team-workspace', userId, teamId, section\]/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'tasks'\)/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'members'\)/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'notes'\)/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'ranking'\)/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'announcements'\)/);
  assert.match(page, /queryKey: teamWorkspaceKey\(userId, teamId, 'custom-fields'\)/);
  assert.match(page, /queryClient\.cancelQueries\(\{ queryKey: scope \}\)/);
  assert.match(page, /queryClient\.removeQueries\(\{ queryKey: scope \}\)/);
  assert.match(page, /if \(access\.isError\) return <ErrorState/);
  assert.doesNotMatch(page, /keepPreviousData/);
});

test('member and task actions stay within active team roster and never call global operational hooks', () => {
  assert.match(api, /supabase\.rpc\('owner_list_team_members', \{ p_team_id: teamId \}\)/);
  assert.match(api, /supabase\.rpc\('team_list_roster', \{ p_team_id: teamId, p_feature: feature \}\)/);
  assert.match(page, /function memberIsActive/);
  assert.match(page, /member\.membership_status === 'active'/);
  assert.match(page, /member\.work_status === 'active'/);
  assert.match(page, /reviewWorkspaceMember/);
  assert.match(api, /supabase\.rpc\('team_review_member'/);
  assert.match(page, /Only this team membership was removed/);
  assert.match(taskMigration, /tm\.status='active' AND m\.work_status='active'/);
  assert.match(page, /assignedTo: selectedIds/);
  assert.doesNotMatch(page, /useMembers\(|useTasks\(|useAnnouncements\(|useNotes\(/);
  assert.doesNotMatch(page, /\{member\.email\}/);
  assert.doesNotMatch(page, /supabase\.auth\.(admin\.)?(deleteUser|resetPasswordForEmail)/);
});

test('workspace controls use only listed narrow RPCs and never send externally', () => {
  const expected = [
    'team_list_tasks', 'team_create_task', 'team_delete_task', 'team_review_task',
    'team_list_roster', 'team_list_notes', 'team_create_note', 'team_delete_note',
    'team_list_evaluations', 'team_create_evaluation', 'team_delete_evaluation',
    'team_list_ranking', 'team_list_announcements', 'team_create_announcement',
    'team_set_announcement_active', 'team_delete_announcement', 'team_list_custom_fields',
    'team_create_custom_field', 'team_set_custom_field_value', 'team_list_custom_field_values',
  ];
  for (const rpc of expected) assert.ok(api.includes(`supabase.rpc('${rpc}'`), `Missing literal scoped RPC ${rpc}`);
  assert.match(recordMigration, /team_member_custom_field_values/);
  assert.match(announcementMigration, /INSERT INTO public\.announcement_recipients/);
  assert.match(api, /p_member_ids: null/);
  assert.doesNotMatch(page + api, /sendPushNotification|send_push\s*:\s*true|send_whatsapp\s*:\s*true|supabase\.functions\.invoke/);
  assert.match(page, /recipients are snapshotted at publication/);
  assert.match(page, /Team AI assistant is not enabled in the team workspace yet/);
  assert.match(page, /Team WhatsApp is not enabled in the team workspace yet/);
});

test('logout clears the local admin auth store only after Supabase sign-out succeeds', () => {
  const logoutStart = page.indexOf('const logout = async () =>');
  const logoutEnd = page.indexOf('\n  };', logoutStart) + 5;
  const logout = page.slice(logoutStart, logoutEnd);
  assert.ok(logoutStart >= 0);
  assert.ok(logout.indexOf('await supabase.auth.signOut()') < logout.indexOf('clearAuth()'));
  assert.match(logout, /if \(error\) throw error/);
});
