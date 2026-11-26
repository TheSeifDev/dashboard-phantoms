import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { managerDestination, authorizedTeamEntries, workspaceTeamEntries } from '../src/features/teams/access';
import type { TeamAccessEntry } from '../src/types/db';

const a: TeamAccessEntry = { team_id: 'team-a-local', slug: 'software', name: 'Software', role: 'head', permissions: { tasks: true } };
const b: TeamAccessEntry = { team_id: 'team-b-local', slug: 'hardware', name: 'Hardware', role: 'monitor', permissions: { members: true, tasks: false } };

test('global access remains in /admin even if a team projection is returned', () => {
  assert.equal(managerDestination({ is_admin: true, is_team_admin: true, teams: [a] }), '/admin');
  assert.deepEqual(authorizedTeamEntries({ is_admin: true, is_team_admin: true, teams: [a] }), []);
});

test('team-only management access requires the trusted flag and actual team seats', () => {
  assert.equal(managerDestination({ is_admin: false, is_team_admin: true, teams: [a, b] }), '/admin');
  assert.equal(managerDestination({ is_admin: false, is_team_admin: false, teams: [a] }), null);
  assert.equal(managerDestination({ is_team_admin: true, teams: [{ ...a, role: null }] }), null);
  assert.equal(managerDestination({ is_team_admin: true, teams: [] }), null);
  assert.equal(managerDestination(undefined), null);
});

test('assignments keep distinct permissions and never create a union', () => {
  const teams = authorizedTeamEntries({ is_team_admin: true, teams: [a, b] });
  assert.equal(teams[0].permissions.tasks, true);
  assert.equal(teams[1].permissions.tasks, false);
  assert.equal(teams[1].permissions.members, true);
  assert.equal(a.permissions.members, undefined);
});

test('global administrators explicitly enter teams without becoming Head or combining team permissions', () => {
  const globalTeam: TeamAccessEntry = { ...a, role: null, permissions: { tasks: false, members: true } };
  const access = { is_admin: true, is_team_admin: false, teams: [globalTeam, a] };
  assert.equal(managerDestination(access), '/admin');
  assert.deepEqual(workspaceTeamEntries(access), [globalTeam]);
  assert.equal(workspaceTeamEntries(access)[0].permissions.tasks, false);
  assert.deepEqual(workspaceTeamEntries({ is_admin: false, is_team_admin: true, teams: [a, b] }), [a, b]);
});

test('router has separate team routes while global pages remain protected', () => {
  const source = readFileSync(new URL('../src/router/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(destination === '\/admin'\) return <>{children}<\/>/);
  assert.match(source, /if \(destination !== '\/team'\) return <Navigate to="\/admin\/login" replace \/>/);
  assert.match(source, /path: '\/team'.*ProtectedTeamRoute/);
  assert.match(source, /path: '\/team\/:teamId'.*ProtectedTeamRoute/);
  assert.match(source, /path: 'admins'.*ProtectedOwnerRoute/);
  assert.match(source, /path: 'teams'.*ProtectedOwnerRoute/);
  assert.match(source, /if \(!access\.data\?\.is_admin\)/);
});
