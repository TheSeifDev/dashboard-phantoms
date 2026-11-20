import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(frontend, path), 'utf8');
const routes = JSON.parse(read('public/manus-routes.json')).routes;
const router = read('src/router/index.tsx');
const sidebar = read('src/components/layout/AppSidebar.tsx');
const header = read('src/components/layout/AdminHeader.tsx');
const types = read('src/types/db.ts');
const teams = read('src/features/teams/TeamsManagementPage.tsx');

const expectedRoutes = [
  '/admin/web-projects',
  '/admin/web-projects/ideas',
  '/admin/web-projects/projects',
  '/admin/web-projects/projects/:projectId',
  '/admin/web-projects/timeline',
  '/admin/web-projects/agile',
  '/admin/web-projects/tasks',
  '/admin/web-projects/reports',
  '/admin/web-projects/resources',
  '/portal/projects',
  '/portal/projects/:projectId',
];

test('every admin and member Web Projects route is in the page manifest', () => {
  const paths = new Set(routes.map((route) => route.path));
  for (const path of expectedRoutes) assert.ok(paths.has(path), `missing route manifest entry: ${path}`);
  assert.ok(routes.length <= 1000);
});

test('admin routes use the dedicated permission and member routes use the existing member guard', () => {
  assert.match(router, /path: 'web-projects',[\s\S]*?AdminSection permission="web_projects"/);
  assert.match(router, /path: 'web-projects\/projects\/:projectId',[\s\S]*?AdminSection permission="web_projects"/);
  assert.match(router, /path: '\/portal\/projects',[\s\S]*?ProtectedMemberRoute/);
  assert.match(router, /path: '\/portal\/projects\/:projectId',[\s\S]*?ProtectedMemberRoute/);
  assert.doesNotMatch(router, /path:\s*['"]teams\/web-projects/);
});

test('sidebar and page search register Web Projects as a separate permission-filtered area', () => {
  assert.match(sidebar, /title: 'مشروعات الويب'[\s\S]*?permission: 'web_projects'/);
  assert.match(header, /path: '\/admin\/web-projects',.*permission: 'web_projects'/);
  assert.match(header, /path: '\/admin\/web-projects\/resources',.*permission: 'web_projects'/);
});

test('Internal Team permission types and editor exclude the global Web Projects bit', () => {
  assert.match(types, /TeamPermission = Exclude<AdminPermission, 'web_projects'>/);
  assert.match(teams, /TEAM_PERMISSION_OPTIONS/);
  assert.doesNotMatch(teams, /ADMIN_PERMISSION_OPTIONS|FULL_ADMIN_PERMISSIONS/);
});
