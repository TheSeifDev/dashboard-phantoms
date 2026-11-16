import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sendPushNotificationWithClient } from '../src/lib/api/push.ts';
import { isVapidPublicKeyReady } from '../src/lib/api/vapid.ts';
import type { supabase } from '../src/lib/supabase/client.ts';

type PushClient = typeof supabase;
const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => readFileSync(path.resolve(here, '..', relativePath), 'utf8');
const taskApi = source('src/features/tasks/api.ts');
const pushApi = source('src/lib/api/push.ts');

const validVapidKey = Buffer.from([4, ...Array.from({ length: 64 }, (_, index) => index + 1)])
  .toString('base64url');

function fakeClient(options: { token?: string | null; data?: unknown } = {}) {
  const calls = { auth: 0, invoke: 0, body: undefined as Record<string, unknown> | undefined };
  const client = {
    auth: {
      getSession: async () => {
        calls.auth += 1;
        return { data: { session: options.token === null ? null : { access_token: options.token ?? 'test-token' } } };
      },
    },
    functions: {
      invoke: async (_name: string, request: { body: Record<string, unknown> }) => {
        calls.invoke += 1;
        calls.body = request.body;
        return { data: options.data ?? { sent: 1 }, error: null };
      },
    },
  } as unknown as PushClient;
  return { client, calls };
}

test('VAPID readiness accepts only a non-placeholder 65-byte public key', () => {
  assert.equal(isVapidPublicKeyReady(''), false);
  assert.equal(isVapidPublicKeyReady('your-vapid-public-key'), false);
  assert.equal(isVapidPublicKeyReady('placeholder-vapid-key'), false);
  assert.equal(isVapidPublicKeyReady('not-base64-url'), false);
  assert.equal(isVapidPublicKeyReady('A'.repeat(86)), false);
  assert.equal(isVapidPublicKeyReady(validVapidKey), true);
});

test('missing, placeholder, and invalid VAPID defer before auth and push-notify', async (t) => {
  for (const [label, key] of [
    ['missing', ''],
    ['placeholder', 'your-vapid-public-key'],
    ['invalid non-65-byte', 'A'.repeat(86)],
  ] as const) {
    await t.test(label, async () => {
      const { client, calls } = fakeClient();
      const result = await sendPushNotificationWithClient(client, key, 'title', 'body', [7], '/portal');
      assert.equal(result, null);
      assert.equal(calls.auth, 0, `${label} key must return before getSession`);
      assert.equal(calls.invoke, 0, `${label} key must not invoke push-notify`);
    });
  }
});

test('valid VAPID dispatch preserves the existing authenticated push request', async () => {
  const { client, calls } = fakeClient({ data: { sent: 1, failed: 0 } });
  const result = await sendPushNotificationWithClient(client, validVapidKey, 'title', 'body', [7, 8], '/portal');
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.equal(calls.auth, 1);
  assert.equal(calls.invoke, 1);
  assert.deepEqual(calls.body, {
    title: 'title',
    body: 'body',
    memberIds: [7, 8],
    url: '/portal',
    icon: '/branding/phantoms-mark-192.png',
  });
});

test('a valid key still surfaces an authentication error instead of masking it', async () => {
  const { client, calls } = fakeClient({ token: null });
  await assert.rejects(
    sendPushNotificationWithClient(client, validVapidKey, 'title', 'body', [7]),
    /لازم تسجل دخولك الأول/,
  );
  assert.equal(calls.auth, 1);
  assert.equal(calls.invoke, 0);
});

test('task creation and approval persist before optional push dispatch, and DB errors remain visible', () => {
  const createStart = taskApi.indexOf('const { data, error } = await insert(newTask);');
  const createNotify = taskApi.indexOf('notifyAssigned(newTask.title, newTask.description, newTask.tracking);', createStart);
  const retryNotify = taskApi.indexOf('notifyAssigned(newTask.title, newTask.description, newTask.tracking);', createNotify + 1);
  const createThrow = taskApi.indexOf("if (!missingBonusColumn) throw toAppError(error, 'معرفناش نعمل المهمة.')", createStart);
  assert.ok(createStart >= 0 && createNotify > createStart, 'task creation must notify only after persistence succeeds');
  assert.ok(createThrow > createStart && retryNotify > createThrow, 'genuine task DB errors must remain visible before retry notification');

  const approvalRpc = taskApi.indexOf(".rpc('approve_task_submission'");
  const approvalNotify = taskApi.indexOf('void sendPushNotification(', approvalRpc);
  assert.ok(approvalRpc >= 0 && approvalNotify > approvalRpc, 'approval must persist before optional notification');
  assert.match(taskApi.slice(approvalNotify, approvalNotify + 300), /\.catch\(\(\) => \{\}\)/);
  assert.match(taskApi, /void sendPushNotification\([\s\S]*?\)\.catch\(\(\) => \{\}\)/);
  assert.match(pushApi, /if \(!isVapidPublicKeyReady\(vapidPublicKey\)\) return null;/);
  assert.ok(pushApi.indexOf('isVapidPublicKeyReady') < pushApi.indexOf('client.auth.getSession'), 'guard must precede auth');
  assert.ok(pushApi.indexOf('client.auth.getSession') < pushApi.indexOf("client.functions.invoke('push-notify'"), 'auth must precede invoke');
});
