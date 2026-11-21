const MAX_BODY_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_ID_RE = UUID_RE;
const MAX_TOKEN_LENGTH = 2048;
const INVENTORY_PAGE_SIZE = 500;
const MAX_INVENTORY_PAGES = 10000;
const MAX_INVENTORY_OBJECTS = 1_000_000;
const STORAGE_REMOVE_LIMIT = 500;
const STORAGE_LIST_PAGE_SIZE = 1000;
const RETRY_STAGES = new Set(['database', 'storage_inventory', 'storage_delete', 'auth_delete', 'finalize']);

function defaultEnv(name) {
  return typeof Deno !== 'undefined' ? (Deno.env.get(name) ?? '') : '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function reply(body, status, origin, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Origin': origin || 'https://dashboard-phantoms.vercel.app',
      'Content-Type': 'application/json',
    },
  });
}

async function readJsonBody(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function verifiedTokenClaims(authorization, verifiedUserId, now) {
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/i);
  if (!match) return false;
  try {
    const segments = match[1].split('.');
    if (segments.length !== 3) return false;
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    if (!isRecord(payload)) return false;
    return payload.sub === verifiedUserId
      && payload.role === 'authenticated'
      && (payload.aud === 'authenticated' || (Array.isArray(payload.aud) && payload.aud.includes('authenticated')))
      && typeof payload.session_id === 'string'
      && UUID_RE.test(payload.session_id)
      && typeof payload.exp === 'number'
      && Number.isFinite(payload.exp)
      && payload.exp * 1000 > now();
  } catch {
    return false;
  }
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isBoundedText(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isMaskedEmail(value) {
  return value === null || (typeof value === 'string' && value.length <= 254 && /[*•…]/.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value));
}

function safeRpcData(result) {
  if (!result || result.error) throw new Error('RPC_UNAVAILABLE');
  return result.data;
}

function safeRpc(client, name, args) {
  return client.rpc(name, args).then(safeRpcData);
}

function normalizedStage(value) {
  if (!isRecord(value)) return '';
  const raw = [value.stage, value.current_stage, value.status].find((entry) => typeof entry === 'string');
  if (typeof raw !== 'string') return '';
  const stage = raw.toLowerCase().replace(/[ -]/g, '_');
  if (['previewed', 'database', 'database_pending'].includes(stage)) return 'database';
  if (['database_complete', 'database_erased', 'db_complete', 'storage_inventory_complete', 'storage_pending', 'storage_delete'].includes(stage)) return 'storage_delete';
  if (['storage_complete', 'auth_pending', 'auth_delete'].includes(stage)) return 'auth_delete';
  if (['auth_deleted', 'finalize', 'finalizing'].includes(stage)) return 'finalize';
  if (stage === 'complete' || stage === 'completed') return 'complete';
  return stage;
}

function databaseComplete(value) {
  return isRecord(value) && (value.database_complete === true
    || ['storage_delete', 'auth_delete', 'finalize', 'complete'].includes(normalizedStage(value)));
}

function storageComplete(value) {
  return isRecord(value) && (value.storage_complete === true
    || ['auth_delete', 'finalize', 'complete'].includes(normalizedStage(value)));
}

function statusIsComplete(value) {
  if (!isRecord(value)) return false;
  return value.ok === true && value.status === 'complete'
    && value.database_complete === true
    && value.storage_complete === true
    && value.auth_complete === true
    && isRecord(value.deleted)
    && isSafeCount(value.deleted.database_rows)
    && isSafeCount(value.deleted.storage_objects)
    && value.deleted.auth_users === 1;
}

function countFromStatus(status, name, fallback = 0) {
  const candidates = [status?.deleted?.[name], status?.counts?.[name], status?.[name]];
  const found = candidates.find(isSafeCount);
  return found === undefined ? fallback : found;
}

function completeResult(operationId, status, storageCount) {
  return {
    ok: true,
    status: 'complete',
    operation_id: operationId,
    database_complete: true,
    storage_complete: true,
    auth_complete: true,
    deleted: {
      database_rows: countFromStatus(status, 'database_rows'),
      storage_objects: countFromStatus(status, 'storage_objects', storageCount),
      auth_users: countFromStatus(status, 'auth_users', 1),
    },
  };
}

function partialResult(operationId, stage, retryable) {
  const safeStage = RETRY_STAGES.has(stage) ? stage : 'finalize';
  return {
    ok: false,
    status: 'partial',
    operation_id: operationId,
    stage: safeStage,
    retryable: retryable === true,
    message_ar: 'لم تكتمل جميع مراحل المحو. تحقّق من حالة العملية ثم أعد المحاولة إذا كانت قابلة للاستئناف.',
    message_en: 'Not all erasure stages are complete. Check the operation status and retry only if it is marked retryable.',
  };
}

function operationResponse(body, statusCode, origin, corsHeaders) {
  return reply(body, statusCode, origin, corsHeaders);
}

function validPreview(preview, requestedMemberId) {
  return isRecord(preview)
    && isUuid(preview.operation_id)
    && preview.member_id === requestedMemberId
    && isUuid(preview.auth_user_id)
    && isBoundedText(preview.member_name, 200)
    && isMaskedEmail(preview.email_masked)
    && isBoundedText(preview.preview_token, MAX_TOKEN_LENGTH)
    && Number.isFinite(Date.parse(preview.expires_at))
    && Array.isArray(preview.impacts)
    && Array.isArray(preview.shared_teams)
    && Array.isArray(preview.shared_projects)
    && Array.isArray(preview.handover_requirements)
    && Array.isArray(preview.blockers)
    && typeof preview.owner_target === 'boolean'
    && typeof preview.is_admin === 'boolean'
    && typeof preview.can_execute === 'boolean'
    && isSafeCount(preview.storage_object_count);
}

function validSuccessorAssignments(value) {
  if (!isRecord(value) || Object.keys(value).length > 500) return false;
  for (const [key, memberId] of Object.entries(value)) {
    const validNumericId = typeof memberId === 'number'
      ? Number.isSafeInteger(memberId) && memberId > 0
      : typeof memberId === 'string' && /^[1-9][0-9]*$/.test(memberId) && Number.isSafeInteger(Number(memberId));
    if (!isBoundedText(key, 256) || !validNumericId) return false;
  }
  return true;
}

function validExecuteBody(body) {
  if (!hasExactKeys(body, [
    'action', 'operation_id', 'member_id', 'auth_user_id', 'preview_token',
    'successor_assignments', 'confirmation',
  ])) return false;
  if (body.action !== 'execute' || !isUuid(body.operation_id)
      || typeof body.member_id !== 'number' || !Number.isSafeInteger(body.member_id) || body.member_id <= 0
      || !isUuid(body.auth_user_id)
      || !isBoundedText(body.preview_token, MAX_TOKEN_LENGTH)
      || !validSuccessorAssignments(body.successor_assignments)
      || typeof body.confirmation !== 'string') return false;
  return body.confirmation === `ERASE ${body.member_id} ${body.auth_user_id.slice(0, 8)}`;
}

function validRetryBody(body) {
  return hasExactKeys(body, ['action', 'operation_id'])
    && body.action === 'retry' && isUuid(body.operation_id);
}

function validPreviewBody(body) {
  return hasExactKeys(body, ['action', 'member_id'])
    && body.action === 'preview'
    && typeof body.member_id === 'number'
    && Number.isSafeInteger(body.member_id)
    && body.member_id > 0;
}

function safeStorageObject(value, targetAuthId, requireOwner) {
  if (!isRecord(value)) return null;
  const bucket = value.bucket_id ?? value.bucket;
  const name = value.name ?? value.object_name;
  if (!isBoundedText(bucket, 255) || !isBoundedText(name, 1024)
      || name.startsWith('/') || name.split('/').some((part) => part === '.' || part === '..')
      || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (requireOwner && value.owner_id !== targetAuthId) return null;
  return { bucket_id: bucket, name, ...(requireOwner ? { owner_id: targetAuthId } : {}) };
}

function storageKey(object) {
  return `${object.bucket_id}\u0000${object.name}`;
}

function scopeBlocked(action, origin, corsHeaders, operationId) {
  return reply({
    ok: false,
    code: 'ERASURE_SCOPE_BLOCKED',
    action,
    ...(operationId ? { operation_id: operationId } : {}),
    safe_to_execute: false,
    retryable: false,
    message_ar: 'تعذّر إثبات النطاق الكامل لملكية الملفات. لم يبدأ حذف قاعدة البيانات أو الحساب.',
    message_en: 'The complete exact-owner Storage inventory could not be proved. Database and Auth deletion have not started.',
  }, 409, origin, corsHeaders);
}

export function createHandler({ createClient, env = defaultEnv, now = () => Date.now() }) {
  const readEnv = (name) => typeof env === 'function' ? (env(name) ?? '') : (env[name] ?? '');
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  const allowedOrigins = new Set([
    ...readEnv('PHANTOMS_ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()),
    readEnv('PHANTOMS_APP_URL').trim().replace(/\/+$/, ''),
    'https://dashboard-phantoms.vercel.app',
    'https://admin-phantoms.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean));

  async function ownerContext(request) {
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization) return { status: 'unauthorized' };
    const url = readEnv('SUPABASE_URL');
    const anonKey = readEnv('SUPABASE_ANON_KEY');
    if (!url || !anonKey) return { status: 'unavailable' };
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { data: userData, error: authError } = await caller.auth.getUser();
      const userId = userData?.user?.id;
      if (authError || !isUuid(userId) || !verifiedTokenClaims(authorization, userId, now)) return { status: 'unauthorized' };
      const { data: access, error: accessError } = await caller.rpc('get_admin_access');
      if (accessError) return { status: 'unavailable' };
      if (!isRecord(access) || access.is_owner !== true) return { status: 'not_owner' };
      return { status: 'ok', caller, userId };
    } catch {
      return { status: 'unavailable' };
    }
  }

  function serviceClient() {
    const url = readEnv('SUPABASE_URL');
    const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('SERVICE_UNAVAILABLE');
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async function getStatus(caller, operationId) {
    return safeRpc(caller, 'owner_member_erasure_status', { p_operation_id: operationId });
  }

  async function getWork(service, operationId) {
    const work = await safeRpc(service, 'owner_member_erasure_operation_work', { p_operation_id: operationId });
    if (!isRecord(work) || work.ok === false || work.operation_id && work.operation_id !== operationId) throw new Error('OPERATION_WORK_INVALID');
    return work;
  }

  function workHasExactIdentity(work, memberId, authUserId) {
    return work.member_id === memberId && work.auth_user_id === authUserId;
  }

  async function captureInventory(service, preview) {
    let cursor = null;
    let pageCount = 0;
    let total = 0;
    const seenObjects = new Set();
    const seenCursors = new Set();
    while (true) {
      if (++pageCount > MAX_INVENTORY_PAGES) throw new Error('INVENTORY_UNPROVEN');
      const page = await safeRpc(service, 'owner_member_erasure_storage_candidates', {
        p_operation_id: preview.operation_id,
        p_cursor: cursor,
        p_limit: INVENTORY_PAGE_SIZE,
      });
      if (!isRecord(page) || page.ok !== true || page.scope_verified !== true
          || page.owner_id !== preview.auth_user_id || !Array.isArray(page.objects)
          || typeof page.complete !== 'boolean' || !isSafeCount(page.owner_object_count)
          || page.owner_object_count !== preview.storage_object_count) throw new Error('INVENTORY_UNPROVEN');
      if (!page.complete && (!isBoundedText(page.next_cursor, 2048) || page.next_cursor === cursor
          || seenCursors.has(page.next_cursor))) throw new Error('INVENTORY_UNPROVEN');
      if (page.complete && page.next_cursor !== null && page.next_cursor !== undefined) throw new Error('INVENTORY_UNPROVEN');
      const objects = [];
      for (const raw of page.objects) {
        const object = safeStorageObject(raw, preview.auth_user_id, true);
        if (!object) throw new Error('INVENTORY_UNPROVEN');
        const key = storageKey(object);
        if (seenObjects.has(key)) throw new Error('INVENTORY_UNPROVEN');
        seenObjects.add(key);
        objects.push(object);
        total += 1;
        if (total > MAX_INVENTORY_OBJECTS) throw new Error('INVENTORY_UNPROVEN');
      }
      if (objects.length > INVENTORY_PAGE_SIZE) throw new Error('INVENTORY_UNPROVEN');
      const stored = await safeRpc(service, 'owner_member_erasure_store_storage_batch', {
        p_operation_id: preview.operation_id,
        // Ownership was already checked against the exact Auth UUID above;
        // the SQL manifest RPC accepts only the minimum object key to persist.
        p_objects: objects.map(({ bucket_id, name }) => ({ bucket_id, name })),
      });
      if (!isRecord(stored) || stored.ok !== true || stored.stored_count !== objects.length
          || !isSafeCount(stored.manifest_count) || stored.manifest_count !== total) {
        throw new Error('INVENTORY_UNPROVEN');
      }
      if (page.complete) break;
      cursor = page.next_cursor;
      seenCursors.add(cursor);
    }
    if (total !== preview.storage_object_count) throw new Error('INVENTORY_UNPROVEN');
    const sealed = await safeRpc(service, 'owner_member_erasure_store_storage_batch', {
      p_operation_id: preview.operation_id,
      p_objects: [],
    });
    if (!isRecord(sealed) || sealed.ok !== true || sealed.complete !== true
        || sealed.manifest_count !== total || sealed.stored_count !== 0) throw new Error('INVENTORY_UNPROVEN');
    return total;
  }

  async function exactOwnerInventoryIsEmpty(service, operationId, authUserId) {
    const page = await safeRpc(service, 'owner_member_erasure_storage_candidates', {
      p_operation_id: operationId,
      p_cursor: null,
      p_limit: 1,
    });
    return isRecord(page) && page.ok === true && page.scope_verified === true
      && page.owner_id === authUserId && Array.isArray(page.objects) && page.objects.length === 0
      && page.complete === true && page.next_cursor === null && page.owner_object_count === 0;
  }

  function parsePendingObjects(data) {
    if (Array.isArray(data)) return data;
    if (!isRecord(data) || data.ok !== true) return null;
    if (Array.isArray(data.objects)) return data.objects;
    if (Array.isArray(data.pending_objects)) return data.pending_objects;
    return null;
  }

  async function storageObjectAbsent(service, object) {
    const slash = object.name.lastIndexOf('/');
    const folder = slash < 0 ? '' : object.name.slice(0, slash);
    const fileName = slash < 0 ? object.name : object.name.slice(slash + 1);
    if (!fileName) return false;
    for (let offset = 0; offset < 1_000_000; offset += STORAGE_LIST_PAGE_SIZE) {
      const { data, error } = await service.storage.from(object.bucket_id).list(folder, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        search: fileName,
      });
      if (error || !Array.isArray(data)) return false;
      if (data.some((entry) => isRecord(entry) && entry.name === fileName)) return false;
      if (data.length < STORAGE_LIST_PAGE_SIZE) return true;
    }
    return false;
  }

  async function drainStorage(service, operationId) {
    let batches = 0;
    while (true) {
      if (++batches > MAX_INVENTORY_PAGES) return { ok: false };
      let pending;
      try {
        pending = await safeRpc(service, 'owner_member_erasure_pending_storage_batch', {
          p_operation_id: operationId,
          p_limit: STORAGE_REMOVE_LIMIT,
        });
      } catch {
        return { ok: false };
      }
      const rawObjects = parsePendingObjects(pending);
      if (!rawObjects) return { ok: false };
      if (rawObjects.length === 0) return { ok: true };
      if (rawObjects.length > STORAGE_REMOVE_LIMIT) return { ok: false };
      const objects = rawObjects.map((raw) => safeStorageObject(raw, '', false));
      if (objects.some((object) => !object)) return { ok: false };
      const unique = new Set(objects.map(storageKey));
      if (unique.size !== objects.length) return { ok: false };
      const byBucket = new Map();
      for (const object of objects) {
        const list = byBucket.get(object.bucket_id) ?? [];
        list.push(object);
        byBucket.set(object.bucket_id, list);
      }
      for (const [bucket, bucketObjects] of byBucket) {
        if (bucketObjects.length > STORAGE_REMOVE_LIMIT) return { ok: false };
        try {
          // Storage API only. No SQL/table DELETE is used for object content.
          await service.storage.from(bucket).remove(bucketObjects.map(({ name }) => name));
        } catch {
          // A timeout is ambiguous; exact Storage API absence checks below reconcile it.
        }
      }
      for (const object of objects) {
        if (!await storageObjectAbsent(service, object)) return { ok: false };
      }
      let marked;
      try {
        marked = await safeRpc(service, 'owner_member_erasure_mark_storage_batch', {
          p_operation_id: operationId,
          p_objects: objects,
        });
      } catch {
        return { ok: false };
      }
      if (!isRecord(marked) || marked.ok !== true
          || (marked.marked_count !== undefined && marked.marked_count !== objects.length)) return { ok: false };
    }
  }

  function userAbsentResult(result) {
    if (!result) return false;
    if (!result.error && result.data?.user === null) return true;
    const error = result.error;
    if (!error) return false;
    return (error.status === 404 || error.statusCode === 404)
      && (error.code === 'user_not_found' || error.code === 'user_not_found_error');
  }

  async function verifyAuthAbsent(service, authUserId) {
    try {
      const result = await service.auth.admin.getUserById(authUserId);
      if (result?.data?.user && result.data.user.id === authUserId) return false;
      return userAbsentResult(result);
    } catch {
      return false;
    }
  }

  async function authAndFinalize(service, caller, operationId, authUserId, currentWork) {
    const pending = await safeRpc(service, 'owner_member_erasure_pending_storage_batch', {
      p_operation_id: operationId,
      p_limit: 1,
    });
    const pendingObjects = parsePendingObjects(pending);
    if (!pendingObjects || pendingObjects.length !== 0 || !storageComplete(currentWork)) return { ok: false, stage: 'storage_delete' };
    try {
      if (!await exactOwnerInventoryIsEmpty(service, operationId, authUserId)) {
        return { ok: false, stage: 'storage_inventory', retryable: false };
      }
    } catch {
      return { ok: false, stage: 'storage_inventory', retryable: false };
    }

    let absent = await verifyAuthAbsent(service, authUserId);
    if (!absent) {
      let userExists = false;
      try {
        const lookup = await service.auth.admin.getUserById(authUserId);
        userExists = !!lookup?.data?.user && lookup.data.user.id === authUserId;
        if (!userExists && !userAbsentResult(lookup)) return { ok: false, stage: 'auth_delete' };
        absent = userAbsentResult(lookup);
      } catch {
        return { ok: false, stage: 'auth_delete' };
      }
      if (userExists) {
        try {
          // shouldSoftDelete=false requests permanent Auth removal; this is intentionally the last destructive API call.
          await service.auth.admin.deleteUser(authUserId, false);
        } catch {
          // The request may have committed despite a network error; verify by exact Auth UUID.
        }
        absent = await verifyAuthAbsent(service, authUserId);
        if (!absent) return { ok: false, stage: 'auth_delete' };
      }
    }
    if (!absent) return { ok: false, stage: 'auth_delete' };
    try {
      if (!await exactOwnerInventoryIsEmpty(service, operationId, authUserId)) {
        return { ok: false, stage: 'finalize', retryable: false };
      }
    } catch {
      return { ok: false, stage: 'finalize', retryable: false };
    }

    let finalized;
    try {
      finalized = await safeRpc(service, 'owner_member_erasure_mark_auth_deleted', { p_operation_id: operationId });
    } catch {
      return { ok: false, stage: 'finalize' };
    }
    if (!isRecord(finalized) || finalized.ok !== true) return { ok: false, stage: 'finalize' };
    let finalStatus;
    try {
      finalStatus = await getStatus(caller, operationId);
    } catch {
      return { ok: false, stage: 'finalize' };
    }
    return statusIsComplete(finalStatus) ? { ok: true, status: finalStatus } : { ok: false, stage: 'finalize', status: finalStatus };
  }

  async function continueAfterDatabase(caller, service, operationId, memberId, authUserId, storageCount) {
    let work;
    try {
      work = await getWork(service, operationId);
    } catch {
      return partialResult(operationId, 'storage_inventory', true);
    }
    if (!workHasExactIdentity(work, memberId, authUserId) || !databaseComplete(work)) {
      return partialResult(operationId, 'database', false);
    }
    const stage = normalizedStage(work);
    if (!storageComplete(work)) {
      const drained = await drainStorage(service, operationId);
      if (!drained.ok) return partialResult(operationId, 'storage_delete', true);
      try {
        work = await getWork(service, operationId);
      } catch {
        return partialResult(operationId, 'storage_delete', true);
      }
      if (!workHasExactIdentity(work, memberId, authUserId) || !storageComplete(work)) {
        return partialResult(operationId, 'storage_delete', true);
      }
    }
    const finalized = await authAndFinalize(service, caller, operationId, authUserId, work);
    if (!finalized.ok) return partialResult(operationId, finalized.stage,
      finalized.retryable === false ? false : finalized.stage !== 'database');
    return completeResult(operationId, finalized.status, storageCount);
  }

  async function handlePreview(body, caller, origin) {
    let data;
    try {
      data = await safeRpc(caller, 'owner_member_erasure_preview', { p_member_id: body.member_id });
    } catch {
      return reply({ ok: false, code: 'PREVIEW_UNAVAILABLE' }, 503, origin, corsHeaders);
    }
    const preview = isRecord(data) && data.ok === true ? data.preview : null;
    if (!validPreview(preview, body.member_id)) return scopeBlocked('preview', origin, corsHeaders, preview?.operation_id);
    let service;
    try {
      service = serviceClient();
      const work = await getWork(service, preview.operation_id);
      if (!workHasExactIdentity(work, preview.member_id, preview.auth_user_id)) throw new Error('IDENTITY_SCOPE_UNPROVEN');
      const count = await captureInventory(service, preview);
      return reply({ ok: true, preview: {
        operation_id: preview.operation_id,
        member_id: preview.member_id,
        auth_user_id: preview.auth_user_id,
        member_name: preview.member_name,
        email_masked: preview.email_masked,
        preview_token: preview.preview_token,
        expires_at: preview.expires_at,
        impacts: preview.impacts,
        shared_teams: preview.shared_teams,
        shared_projects: preview.shared_projects,
        handover_requirements: preview.handover_requirements,
        storage_object_count: count,
        owner_target: preview.owner_target,
        is_admin: preview.is_admin,
        blockers: preview.blockers,
        can_execute: preview.can_execute,
      } }, 200, origin, corsHeaders);
    } catch {
      return scopeBlocked('preview', origin, corsHeaders, preview.operation_id);
    }
  }

  async function handleExecute(body, caller, origin) {
    // The caller-scoped atomic database RPC is deliberately the first mutation.
    let databaseResult = null;
    try {
      databaseResult = await safeRpc(caller, 'owner_member_erasure_execute_database', {
        p_operation_id: body.operation_id,
        p_member_id: body.member_id,
        p_auth_user_id: body.auth_user_id,
        p_successor_assignments: body.successor_assignments,
        p_preview_token: body.preview_token,
        p_confirmation: body.confirmation,
      });
    } catch {
      // The atomic RPC may have committed before a network timeout reached Edge.
    }
    let status;
    try {
      status = await getStatus(caller, body.operation_id);
    } catch {
      return operationResponse(partialResult(body.operation_id, 'database', true), 200, origin, corsHeaders);
    }
    const dbComplete = databaseComplete(databaseResult) || databaseComplete(status);
    if (!dbComplete) {
      return operationResponse(partialResult(body.operation_id, 'database', false), 200, origin, corsHeaders);
    }
    let service;
    try {
      service = serviceClient();
    } catch {
      return operationResponse(partialResult(body.operation_id, 'storage_inventory', true), 200, origin, corsHeaders);
    }
    const continued = await continueAfterDatabase(caller, service, body.operation_id, body.member_id, body.auth_user_id,
      countFromStatus(status, 'storage_objects'));
    return operationResponse(continued, 200, origin, corsHeaders);
  }

  async function handleRetry(body, caller, origin) {
    let status;
    try {
      status = await getStatus(caller, body.operation_id);
    } catch {
      return operationResponse(partialResult(body.operation_id, 'database', false), 200, origin, corsHeaders);
    }
    if (statusIsComplete(status)) {
      return operationResponse(completeResult(body.operation_id, status, countFromStatus(status, 'storage_objects')), 200, origin, corsHeaders);
    }
    if (!isRecord(status) || status.ok === false) {
      return reply({ ok: false, code: 'ERASURE_OPERATION_NOT_FOUND' }, 404, origin, corsHeaders);
    }
    if (!databaseComplete(status)) return operationResponse(partialResult(body.operation_id, 'database', false), 200, origin, corsHeaders);
    let service;
    try {
      service = serviceClient();
    } catch {
      return operationResponse(partialResult(body.operation_id, 'storage_inventory', true), 200, origin, corsHeaders);
    }
    let work;
    try {
      work = await getWork(service, body.operation_id);
    } catch {
      return operationResponse(partialResult(body.operation_id, 'storage_inventory', true), 200, origin, corsHeaders);
    }
    if (!isUuid(work.auth_user_id) || !Number.isSafeInteger(work.member_id) || work.member_id <= 0
        || !databaseComplete(work)) return operationResponse(partialResult(body.operation_id, 'database', false), 200, origin, corsHeaders);
    const continued = await continueAfterDatabase(caller, service, body.operation_id, work.member_id, work.auth_user_id,
      countFromStatus(status, 'storage_objects'));
    return operationResponse(continued, 200, origin, corsHeaders);
  }

  async function handleStatus(body, caller, origin) {
    let status;
    try {
      status = await getStatus(caller, body.operation_id);
    } catch {
      return reply({ ok: false, code: 'ERASURE_OPERATION_NOT_FOUND' }, 404, origin, corsHeaders);
    }
    if (!isRecord(status) || status.operation_id !== body.operation_id
        || !['complete', 'partial', 'pending'].includes(status.status)
        || typeof status.database_complete !== 'boolean'
        || typeof status.storage_complete !== 'boolean'
        || typeof status.auth_complete !== 'boolean'
        || !isRecord(status.deleted)
        || !isSafeCount(status.deleted.database_rows)
        || !isSafeCount(status.deleted.storage_objects)
        || !isSafeCount(status.deleted.auth_users)) {
      return reply({ ok: false, code: 'ERASURE_STATUS_INVALID' }, 503, origin, corsHeaders);
    }
    if (status.status === 'complete' && !statusIsComplete(status)) {
      return reply({ ok: false, code: 'ERASURE_STATUS_INVALID' }, 503, origin, corsHeaders);
    }
    return reply(status, 200, origin, corsHeaders);
  }

  return async function handler(request) {
    const origin = request.headers.get('Origin') ?? '';
    if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') {
      return new Response('ok', {
        headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://dashboard-phantoms.vercel.app' },
      });
    }
    if (request.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED' }, 405, origin, corsHeaders);

    const owner = await ownerContext(request);
    if (owner.status === 'unauthorized') return reply({ code: 'UNAUTHORIZED' }, 401, origin, corsHeaders);
    if (owner.status === 'not_owner') return reply({ code: 'NOT_OWNER' }, 403, origin, corsHeaders);
    if (owner.status !== 'ok') return reply({ code: 'SERVER_UNAVAILABLE' }, 503, origin, corsHeaders);

    const body = await readJsonBody(request);
    if (!body || typeof body.action !== 'string') return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
    if (body.action === 'preview') {
      if (!validPreviewBody(body)) return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
      return handlePreview(body, owner.caller, origin);
    }
    if (body.action === 'execute') {
      if (!validExecuteBody(body)) return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
      return handleExecute(body, owner.caller, origin);
    }
    if (body.action === 'retry') {
      if (!validRetryBody(body)) return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
      return handleRetry(body, owner.caller, origin);
    }
    if (body.action === 'status') {
      if (!hasExactKeys(body, ['action', 'operation_id']) || !isUuid(body.operation_id)) {
        return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
      }
      return handleStatus(body, owner.caller, origin);
    }
    return reply({ code: 'INVALID_INPUT' }, 400, origin, corsHeaders);
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  const [{ serve }, { createClient }] = await Promise.all([
    import('https://deno.land/std@0.168.0/http/server.ts'),
    import('https://esm.sh/@supabase/supabase-js@2.117.2'),
  ]);
  serve(createHandler({ createClient, env: (name) => Deno.env.get(name) ?? '' }));
}
