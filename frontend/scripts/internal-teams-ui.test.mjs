import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [router, sidebar, header, listPage, teamPage, seatCard, memberRoster, teamCopy, api, db, routes, migration] = await Promise.all([
  read('src/router/index.tsx'),
  read('src/components/layout/AppSidebar.tsx'),
  read('src/components/layout/AdminHeader.tsx'),
  read('src/features/teams/TeamsManagementPage.tsx'),
  read('src/features/teams/TeamPage.tsx'),
  read('src/features/teams/components/SeatCard.tsx'),
  read('src/features/teams/components/MemberRoster.tsx'),
  read('src/features/teams/components/teamCopy.ts'),
  read('src/features/teams/api.ts'),
  read('src/types/db.ts'),
  read('public/manus-routes.json'),
  read('../backend/supabase/migrations/20261120074604_internal_teams_foundation.sql'),
]);
// The teams feature is split across the list page, the per-team page, and two
// extracted panels; the guards below apply to the whole feature surface.
const page = [listPage, teamPage, seatCard, memberRoster, teamCopy].join('\n');

test('internal team management is lazy-loaded, Owner-gated for governance, and console-gated for team managers', () => {
  assert.match(router, /const TeamsManagementPage = lazy\(\(\) => import\('\.\.\/features\/teams\/TeamsManagementPage'\)\)/);
  assert.match(router, /path: 'teams', element: <ProtectedOwnerRoute><Page><TeamsManagementPage \/><\/Page><\/ProtectedOwnerRoute>/);
  assert.match(router, /path: 'teams\/:teamId', element: <ProtectedTeamConsoleRoute><Page><TeamPage \/><\/Page><\/ProtectedTeamConsoleRoute>/);
  assert.match(page, /const access = useAdminAccess\(user\?\.id \?\? null\)/);
  assert.match(page, /const canOpenConsole = isOwner \|\| isAdmin \|\| teamRole !== null/);
  assert.match(page, /useOwnerTeams\(isOwner\)/);
  assert.match(page, /useTeamAdminCandidates\(isOwner\)/);
  assert.ok(JSON.parse(routes).routes.some((route) => route.path === '/admin/teams'));
});

test('Head and Monitor are per-team seats with explicit feature permissions, never global Admin creation', () => {
  assert.match(page, /const ROLES: TeamAdminRole\[\] = \['head', 'monitor'\]/);
  assert.match(page, /owner_set_team_admin_seat|useSetTeamAdminSeat/);
  assert.match(page, /PERMISSION_COPY\[key\]/);
  assert.match(page, /This grants team-only access and never creates a global Admin/);
  assert.doesNotMatch(page, /admin_add_account|supabase\.auth\.admin/);
  assert.doesNotMatch(api, /admin_add_account|admin_update_permissions/);
  assert.match(db, /is_team_admin: boolean/);
  assert.match(db, /teams: TeamAccessEntry\[\]/);
});

test('member membership is many-to-many and status/revocation is team-local', () => {
  assert.match(db, /export type TeamMembership = \{/);
  assert.match(migration, /PRIMARY KEY\s*\(team_id,\s*member_id\)/i);
  assert.match(page, /same person can join other teams without another account or profile/);
  assert.match(page, /Only this team membership was suspended/);
  assert.match(page, /member account and other teams remain intact/);
  assert.match(api, /teamMembersKey = \(teamId: string\) => \['team-members', teamId\]/);
  assert.match(api, /p_team_id: input\.teamId, p_member_id: input\.memberId/);
  assert.doesNotMatch(page, /supabase\.auth\.(admin\.)?(deleteUser|resetPasswordForEmail)/);
});

test('team navigation appears in the Owner-only system administration group', () => {
  const sidebarEntry = sidebar.slice(sidebar.indexOf("to: '/admin/teams'"), sidebar.indexOf("to: '/admin/teams'") + 160);
  assert.match(sidebarEntry, /ownerOnly: true/);
  assert.match(header, /path: '\/admin\/teams'.*ownerOnly: true/);
});
