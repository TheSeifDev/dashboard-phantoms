import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';

const taskApi = readFileSync(new URL('../src/features/tasks/api.ts', import.meta.url), 'utf8');
const contributionHook = readFileSync(new URL('../src/features/dashboard/useTaskContributions.ts', import.meta.url), 'utf8');

test('approval and reversal invalidate the exact contribution family immediately, preserving all other required caches', () => {
  assert.match(contributionHook, /queryKey: \['task-contributions', year, memberId\]/);
  for (const name of ['useApproveTaskSubmission', 'useRevokeTaskApproval']) {
    const start = taskApi.indexOf(`export const ${name} =`);
    assert.ok(start >= 0);
    const next = taskApi.indexOf('\nexport const ', start + 1);
    const source = taskApi.slice(start, next < 0 ? undefined : next);
    assert.match(source, /onSettled:/);
    for (const key of ['tasks', 'members', 'notes', 'member-bonus', 'member-tasks', 'task-contributions']) {
      assert.ok(source.includes(`qc.invalidateQueries({ queryKey: ['${key}'] })`), `${name} must invalidate ${key}`);
    }
  }
});

test('real query-client prefix invalidation reaches all years/member scopes but not unrelated queries', async () => {
  const client = new QueryClient();
  const keys = [['task-contributions', 2026, null], ['task-contributions', 2025, 1], ['task-contributions', 2026, 2]];
  for (const key of keys) client.setQueryData(key, { approvals: 0 });
  client.setQueryData(['unrelated'], { value: 'preserve' });
  await client.invalidateQueries({ queryKey: ['task-contributions'], refetchType: 'none' });
  for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  assert.equal(client.getQueryState(['unrelated'])?.isInvalidated, false);
  client.clear();
});
