import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_PERMISSION_OPTIONS,
  FULL_ADMIN_PERMISSIONS,
  normalizeAdminPermissions,
  TEAM_PERMISSION_OPTIONS,
} from '../src/features/admin/access/permissions';

test('Web Projects is an explicit global administrator feature permission', () => {
  assert.ok(ADMIN_PERMISSION_OPTIONS.some((option) => option.key === 'web_projects'));
  assert.equal(FULL_ADMIN_PERMISSIONS.web_projects, true);
  assert.equal(normalizeAdminPermissions({ dashboard: true }).web_projects, false);
  assert.equal(normalizeAdminPermissions({ web_projects: true }).web_projects, true);
});

test('Web Projects is not an Internal Team capability', () => {
  const teamKeys = TEAM_PERMISSION_OPTIONS.map((option) => option.key);
  assert.equal(teamKeys.includes('web_projects' as never), false);
  assert.ok(teamKeys.includes('tasks'));
  assert.ok(teamKeys.includes('members'));
  assert.equal(teamKeys.length, 8);
});
