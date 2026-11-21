import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const functionPath = fileURLToPath(new URL('./index.ts', import.meta.url));
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { createHandler } = await import(moduleUrl);

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = 42;
const TARGET_AUTH_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_OBJECT = {
  bucket_id: 'member-files',
  name: 'avatars/target.png',
  owner_id: TARGET_AUTH_ID,
};
const PREVIEW_TOKEN = 'opaque-preview-token-with-sufficient-entropy';

function makeJwt(payload = {}) {
  const encoded = Buffer.from(JSON.stringify({
    sub: OWNER_ID,
    role: 'authenticated',
    aud: 'authenticated',
    session_id: SESSION_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...payload,
  })).toString('base64url');
  return `Bearer e30.${encoded}.signature`;
}

function request(body, token = makeJwt()) {
  return new Request('https://edge.test/owner-member-erasure', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function basePreview() {
  return {
    operation_id: OPERATION_ID,
    member_id: MEMBER_ID,
    auth_user_id: TARGET_AUTH_ID,
    member_name: 'Target Member',
    email_masked: 'ta***@example.test',
    preview_token: PREVIEW_TOKEN,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    impacts: [],
    shared_teams: [],
    shared_projects: [],
    handover_requirements: [],
    owner_target: false,
    is_admin: false,
    blockers: [],
    can_execute: true,
    storage_object_count: 1,
  };
}

function executeBody(overrides = {}) {
  return {
    action: 'execute',
    operation_id: OPERATION_ID,
    member_id: MEMBER_ID,
    auth_user_id: TARGET_AUTH_ID,
    preview_token: PREVIEW_TOKEN,
    successor_assignments: {},
    confirmation: `ERASE ${MEMBER_ID} ${TARGET_AUTH_ID.slice(0, 8)}`,
    ...overrides,
  };
}

function createHarness({ owner = true, authPresent = true, deleteBehavior = null, databaseTimeout = false } = {}) {
  const state = {
    owner,
    authPresent,
    deleteBehavior,
    databaseTimeout,
    manifest: [],
    storageObjects: [STORAGE_OBJECT],
    markedStorageCount: 0,
    manifestSealed: false,
    phase: 'previewed',
    events: [],
    callerRpcNames: [],
    serviceRpcNames: [],
    storageCalls: [],
    serviceClients: 0,
    preview: basePreview(),
    databaseRows: 12,
  };
  const event = (value) => state.events.push(value);
  const pendingObjects = () => state.manifest.filter((item) => !item.deleted);
  const serviceClient = {
    rpc: async (name, args) => {
      state.serviceRpcNames.push(name);
      event(`service-rpc:${name}`);
      if (name === 'owner_member_erasure_operation_work') {
        return { data: {
          ok: true,
          operation_id: OPERATION_ID,
          member_id: state.phase === 'complete' ? null : MEMBER_ID,
          auth_user_id: state.phase === 'complete' ? null : TARGET_AUTH_ID,
          stage: state.phase,
          database_complete: ['database_erased', 'storage_complete', 'complete'].includes(state.phase),
          storage_complete: ['storage_complete', 'complete'].includes(state.phase),
          auth_complete: state.phase === 'complete',
          auth_deleted: state.phase === 'complete',
        }, error: null };
      }
      if (name === 'owner_member_erasure_storage_candidates') {
        assert.equal(args.p_operation_id, OPERATION_ID);
        assert.equal(args.p_cursor, null);
        assert.ok([1, 500].includes(args.p_limit));
        const objects = state.candidatePage?.objects ?? state.storageObjects;
        return { data: {
          ok: true,
          scope_verified: state.candidatePage?.scope_verified ?? true,
          owner_id: TARGET_AUTH_ID,
          objects,
          next_cursor: null,
          complete: true,
          owner_object_count: state.candidatePage?.owner_object_count ?? state.storageObjects.length,
        }, error: null };
      }
      if (name === 'owner_member_erasure_store_storage_batch') {
        assert.ok(args.p_objects.every((object) =>
          Object.keys(object).sort().join(',') === 'bucket_id,name'));
        const objects = args.p_objects.map(({ bucket_id, name }) => ({ bucket_id, name }));
        for (const object of objects) {
          if (!state.manifest.some((item) => item.bucket_id === object.bucket_id && item.name === object.name)) {
            state.manifest.push({ ...object, deleted: false });
          }
        }
        if (objects.length === 0) state.manifestSealed = true;
        return { data: { ok: true, stored_count: objects.length,
          manifest_count: state.manifest.length, complete: objects.length === 0 }, error: null };
      }
      if (name === 'owner_member_erasure_pending_storage_batch') {
        return { data: pendingObjects().slice(0, args.p_limit).map(({ bucket_id, name }) => ({ bucket_id, name })), error: null };
      }
      if (name === 'owner_member_erasure_mark_storage_batch') {
        let marked = 0;
        for (const object of args.p_objects) {
          const item = state.manifest.find((entry) => entry.bucket_id === object.bucket_id && entry.name === object.name);
          if (item && !item.deleted) {
            item.deleted = true;
            marked += 1;
          }
        }
        state.markedStorageCount += marked;
        if (pendingObjects().length === 0) state.phase = 'storage_complete';
        return { data: { ok: true, marked_count: marked }, error: null };
      }
      if (name === 'owner_member_erasure_mark_auth_deleted') {
        assert.equal(state.authPresent, false, 'finalizer must only run after Auth absence is verified');
        state.phase = 'complete';
        return { data: { ok: true, auth_deleted: true }, error: null };
      }
      assert.fail(`Unexpected service RPC ${name}`);
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            assert.equal(bucket, STORAGE_OBJECT.bucket_id);
            assert.ok(paths.length <= 1000);
            state.storageCalls.push({ type: 'remove', bucket, paths: [...paths] });
            event('storage-remove');
            state.storageObjects = state.storageObjects.filter((item) => !paths.includes(item.name));
            return { data: paths.map((name) => ({ name })), error: null };
          },
          async list(folder, options) {
            state.storageCalls.push({ type: 'list', bucket, folder, options });
            event('storage-list');
            return { data: state.storageObjects.filter((item) => item.bucket_id === bucket
              && (folder ? item.name.startsWith(`${folder}/`) : !item.name.includes('/')))
              .map((item) => ({ name: item.name.split('/').at(-1) })), error: null };
          },
        };
      },
    },
    auth: {
      admin: {
        async getUserById(userId) {
          assert.equal(userId, TARGET_AUTH_ID);
          event('auth-get-user');
          return state.authPresent
            ? { data: { user: { id: TARGET_AUTH_ID } }, error: null }
            : { data: { user: null }, error: null };
        },
        async deleteUser(userId, shouldSoftDelete) {
          assert.equal(userId, TARGET_AUTH_ID);
          assert.equal(shouldSoftDelete, false, 'hard erasure must request permanent Auth deletion');
          event('auth-delete-user');
          if (state.deleteBehavior) return state.deleteBehavior(state);
          state.authPresent = false;
          return { data: { user: { id: TARGET_AUTH_ID } }, error: null };
        },
      },
    },
  };
  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: OWNER_ID } }, error: null }) },
    rpc: async (name, args) => {
      state.callerRpcNames.push(name);
      event(`caller-rpc:${name}`);
      if (name === 'get_admin_access') return { data: { is_owner: state.owner }, error: null };
      if (name === 'owner_member_erasure_preview') {
        assert.deepEqual(args, { p_member_id: MEMBER_ID });
        return { data: { ok: true, preview: state.preview }, error: null };
      }
      if (name === 'owner_member_erasure_execute_database') {
        assert.deepEqual(args, {
          p_operation_id: OPERATION_ID,
          p_member_id: MEMBER_ID,
          p_auth_user_id: TARGET_AUTH_ID,
          p_successor_assignments: {},
          p_preview_token: PREVIEW_TOKEN,
          p_confirmation: `ERASE ${MEMBER_ID} ${TARGET_AUTH_ID.slice(0, 8)}`,
        });
        state.phase = 'database_erased';
        if (state.databaseTimeout) return { data: null, error: { message: 'simulated network timeout after commit' } };
        return { data: { ok: true, operation_id: OPERATION_ID, stage: 'database_erased' }, error: null };
      }
      if (name === 'owner_member_erasure_status') {
        const complete = state.phase === 'complete';
        const databaseComplete = ['database_erased', 'storage_complete', 'complete'].includes(state.phase);
        const storageComplete = ['storage_complete', 'complete'].includes(state.phase);
        const authComplete = complete;
        return { data: {
          ok: true,
          operation_id: OPERATION_ID,
          status: complete ? 'complete' : state.phase === 'previewed' ? 'pending' : 'partial',
          stage: state.phase,
          retryable: databaseComplete,
          database_complete: databaseComplete,
          storage_complete: storageComplete,
          auth_complete: authComplete,
          deleted: { database_rows: state.databaseRows, storage_objects: state.markedStorageCount, auth_users: authComplete ? 1 : 0 },
        }, error: null };
      }
      assert.fail(`Unexpected caller RPC ${name}`);
    },
  };
  const createClient = (_url, key) => {
    if (key === 'service-secret') {
      state.serviceClients += 1;
      return serviceClient;
    }
    return callerClient;
  };
  const handler = createHandler({
    createClient,
    env: {
      SUPABASE_URL: 'http://local.test',
      SUPABASE_ANON_KEY: 'anon-test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    },
  });
  return { handler, state };
}

async function jsonResponse(response) {
  return { status: response.status, body: await response.json() };
}

test('owner gate runs before action dispatch and before any service-role client or erasure RPC', async () => {
  const { handler, state } = createHarness({ owner: false });
  const result = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'NOT_OWNER');
  assert.equal(state.serviceClients, 0);
  assert.deepEqual(state.callerRpcNames, ['get_admin_access']);
  assert.ok(state.events.indexOf('caller-rpc:get_admin_access') < state.events.length);
});

test('execute rejects non-exact bodies, target UUIDs, shared-project deletion, and confirmation before mutation', async () => {
  for (const invalid of [
    executeBody({ confirmation: 'ERASE 42 wrong-id' }),
    executeBody({ auth_user_id: 'not-a-uuid' }),
    executeBody({ include_shared_project_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }),
    { ...executeBody(), unexpected: true },
  ]) {
    const { handler, state } = createHarness();
    const result = await jsonResponse(await handler(request(invalid)));
    assert.equal(result.status, 400);
    assert.ok(!state.callerRpcNames.includes('owner_member_erasure_execute_database'));
    assert.equal(state.serviceClients, 0);
  }
});

test('preview captures only a verified exact-owner inventory and returns count, never object paths', async () => {
  const { handler, state } = createHarness();
  const result = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.preview.storage_object_count, 1);
  assert.equal(result.body.preview.operation_id, OPERATION_ID);
  assert.equal(JSON.stringify(result.body).includes('avatars/target.png'), false);
  assert.ok(state.serviceRpcNames.includes('owner_member_erasure_storage_candidates'));
  assert.ok(state.serviceRpcNames.includes('owner_member_erasure_store_storage_batch'));
  assert.equal(state.manifest.length, 1);
  assert.equal(state.manifestSealed, true);
});

test('unproved or mismatched Storage inventory blocks before any database mutation', async () => {
  const { handler, state } = createHarness();
  state.serviceRpcNames = [];
  const originalCreate = state.preview;
  state.preview = { ...originalCreate, storage_object_count: 2 };
  const result = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ERASURE_SCOPE_BLOCKED');
  assert.ok(!state.callerRpcNames.includes('owner_member_erasure_execute_database'));
  assert.ok(!state.serviceRpcNames.includes('owner_member_erasure_mark_storage_batch'));
});

test('unverified owner scope is rejected, and an empty but verified inventory is still durably captured', async () => {
  const unverified = createHarness();
  unverified.state.candidatePage = {
    ok: true, scope_verified: false, owner_id: TARGET_AUTH_ID, objects: [], next_cursor: null, complete: true,
  };
  const blocked = await jsonResponse(await unverified.handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(blocked.body.code, 'ERASURE_SCOPE_BLOCKED');
  assert.ok(!unverified.state.serviceRpcNames.includes('owner_member_erasure_store_storage_batch'));

  const empty = createHarness();
  empty.state.preview = { ...empty.state.preview, storage_object_count: 0 };
  empty.state.storageObjects = [];
  empty.state.candidatePage = {
    ok: true, scope_verified: true, owner_id: TARGET_AUTH_ID, objects: [], next_cursor: null, complete: true,
  };
  const preview = await jsonResponse(await empty.handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.preview.storage_object_count, 0);
  assert.ok(empty.state.serviceRpcNames.includes('owner_member_erasure_store_storage_batch'));
});

test('execute orders atomic DB, Storage API deletion and exact absence verification, batch marking, then Auth deletion and finalization', async () => {
  const { handler, state } = createHarness();
  // First preview establishes and stores the exact Storage inventory.
  const preview = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(preview.body.ok, true);
  const result = await jsonResponse(await handler(request(executeBody())));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'complete');
  assert.deepEqual(result.body.deleted, { database_rows: 12, storage_objects: 1, auth_users: 1 });
  const db = state.events.indexOf('caller-rpc:owner_member_erasure_execute_database');
  const remove = state.events.indexOf('storage-remove');
  const absentCheck = state.events.indexOf('storage-list');
  const markStorage = state.events.indexOf('service-rpc:owner_member_erasure_mark_storage_batch');
  const deleteAuth = state.events.indexOf('auth-delete-user');
  const markAuth = state.events.indexOf('service-rpc:owner_member_erasure_mark_auth_deleted');
  assert.ok(db < remove && remove < absentCheck && absentCheck < markStorage && markStorage < deleteAuth && deleteAuth < markAuth);
  assert.ok(state.storageCalls.some((call) => call.type === 'remove' && call.paths[0] === STORAGE_OBJECT.name));
  assert.ok(!state.serviceRpcNames.some((name) => /delete_storage|delete_auth|remove_storage/i.test(name)));
  assert.doesNotMatch(source, /storage\.objects|\.from\s*\(\s*['"]/);
  assert.doesNotMatch(source, /\.delete\s*\(/);
});

test('an ambiguous database network timeout proceeds only when caller status proves the atomic DB commit', async () => {
  const { handler, state } = createHarness({ databaseTimeout: true });
  const preview = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(preview.body.ok, true);
  const result = await jsonResponse(await handler(request(executeBody())));
  assert.equal(result.body.status, 'complete');
  assert.equal(state.callerRpcNames.filter((name) => name === 'owner_member_erasure_execute_database').length, 1);
  assert.ok(state.events.indexOf('caller-rpc:owner_member_erasure_execute_database') < state.events.indexOf('storage-remove'));
});

test('ambiguous Auth timeout stays partial until Auth absence is verified, then retry finalizes the same operation', async () => {
  const { handler, state } = createHarness({
    deleteBehavior: async () => ({ error: { message: 'simulated network timeout' } }),
  });
  const preview = await jsonResponse(await handler(request({ action: 'preview', member_id: MEMBER_ID })));
  assert.equal(preview.body.ok, true);
  const first = await jsonResponse(await handler(request(executeBody())));
  assert.equal(first.body.status, 'partial');
  assert.equal(first.body.stage, 'auth_delete');
  assert.equal(first.body.retryable, true);
  assert.equal(state.phase, 'storage_complete');
  assert.equal(state.authPresent, true);
  assert.ok(!state.serviceRpcNames.includes('owner_member_erasure_mark_auth_deleted'));

  // The original delete may have committed after the timed-out response reached Edge.
  state.authPresent = false;
  const retry = await jsonResponse(await handler(request({ action: 'retry', operation_id: OPERATION_ID })));
  assert.equal(retry.body.status, 'complete');
  assert.equal(retry.body.operation_id, OPERATION_ID);
  assert.equal(state.phase, 'complete');
  assert.equal(state.events.filter((entry) => entry === 'auth-delete-user').length, 1);
  assert.ok(state.serviceRpcNames.includes('owner_member_erasure_mark_auth_deleted'));
});

test('retry never returns complete while Auth still exists', async () => {
  const { handler, state } = createHarness({
    deleteBehavior: async () => ({ error: { message: 'simulated network timeout' } }),
  });
  state.phase = 'storage_complete';
  state.storageObjects = [];
  state.manifest = [{ bucket_id: STORAGE_OBJECT.bucket_id, name: STORAGE_OBJECT.name, deleted: true }];
  state.manifestSealed = true;
  const retry = await jsonResponse(await handler(request({ action: 'retry', operation_id: OPERATION_ID })));
  assert.equal(retry.body.status, 'partial');
  assert.equal(retry.body.stage, 'auth_delete');
  assert.equal(retry.body.retryable, true);
  assert.ok(!state.serviceRpcNames.includes('owner_member_erasure_mark_auth_deleted'));
});

test('source keeps bearer claim verification and owner check on every non-preflight request', () => {
  assert.match(source, /caller\.auth\.getUser\(\)/);
  assert.match(source, /caller\.rpc\('get_admin_access'\)/);
  assert.match(source, /access\.is_owner !== true/);
  assert.match(source, /payload\.session_id/);
  assert.match(source, /payload\.exp \* 1000 > now\(\)/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /auth\.admin\.deleteUser\(authUserId, false\)/);
  assert.match(source, /STORAGE_REMOVE_LIMIT = 500/);
  assert.ok(source.indexOf('const owner = await ownerContext(request)') < source.indexOf('const body = await readJsonBody(request)'));
  assert.ok(functionPath.endsWith('/owner-member-erasure/index.ts'));
});
