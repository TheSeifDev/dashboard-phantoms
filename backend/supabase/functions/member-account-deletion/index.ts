import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =====================================================
// حذف حساب عضو بعد موافقة الأدمن على طلبه
// =====================================================
// 1) يتحقق إن المستدعي أدمن (أو المالك) من خلال get_admin_access.
// 2) ينفّذ RPC member_deletion_admin_execute اللي بيحذف كل صفوف العضوية
//    والهوية (نفس مسار المحو المعتمد) ويرجّع auth_user_id.
// 3) يحذف ملفات التخزين الخاصة بالحساب عبر Storage API بمفتاح الخدمة.
// 4) يحذف حساب الدخول من GoTrue، وبعدها يعلّم الطلب "completed".
// لو أي خطوة فشلت بعد الحذف، الطلب يفضل "approved" والأدمن يقدر يعيد
// المحاولة من نفس الزر (retry) من غير ما يلمس بيانات حد تاني.
// =====================================================

const allowedOrigins = new Set([
  ...(Deno.env.get('PHANTOMS_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()),
  (Deno.env.get('PHANTOMS_APP_URL') ?? '').trim().replace(/\/+$/, ''),
  'https://dashboard-phantoms.vercel.app',
  'https://admin-phantoms.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean));

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin || 'https://dashboard-phantoms.vercel.app',
    'Content-Type': 'application/json',
  },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StorageObject {
  bucket_id: string;
  name: string;
}

function safeObjects(raw: unknown): StorageObject[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is StorageObject => Boolean(item)
    && typeof (item as StorageObject).bucket_id === 'string'
    && typeof (item as StorageObject).name === 'string'
    && (item as StorageObject).bucket_id.length > 0
    && (item as StorageObject).name.length > 0);
}

serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://dashboard-phantoms.vercel.app' } });
  }
  if (req.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED' }, 405, origin);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply({ code: 'UNAUTHORIZED' }, 401, origin);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anonKey || !serviceKey) return reply({ code: 'SERVER_CONFIG' }, 503, origin);

  const body = await req.json().catch(() => null) as { action?: unknown; request_id?: unknown } | null;
  const action = body?.action === 'retry' ? 'retry' : 'approve';
  const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
  if (!UUID_RE.test(requestId)) return reply({ code: 'INVALID_REQUEST_ID' }, 400, origin);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await caller.auth.getUser();
  if (authError || !userData.user) return reply({ code: 'UNAUTHORIZED' }, 401, origin);

  const { data: access, error: accessError } = await caller.rpc('get_admin_access');
  if (accessError) return reply({ code: 'ACCESS_CHECK_FAILED' }, 500, origin);
  const canDelete = access?.is_owner === true || access?.permissions?.members === true;
  if (!canDelete) return reply({ code: 'FORBIDDEN' }, 403, origin);

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let authUserId = '';
  let memberName = '';
  let deletedRows = 0;

  if (action === 'approve') {
    const { data, error } = await caller.rpc('member_deletion_admin_execute', { p_request_id: requestId });
    if (error) {
      const message = String(error.message ?? '');
      const known = ['DELETION_REQUEST_NOT_FOUND', 'DELETION_REQUEST_NOT_PENDING', 'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR',
        'OWNER_DELETION_FORBIDDEN', 'SELF_DELETION_FORBIDDEN', 'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS', 'FORBIDDEN'];
      const code = known.find((entry) => message.includes(entry)) ?? 'DELETION_FAILED';
      return reply({ code, detail: message.slice(0, 200) }, code === 'FORBIDDEN' ? 403 : 409, origin);
    }
    authUserId = typeof data?.auth_user_id === 'string' ? data.auth_user_id : '';
    memberName = typeof data?.member_name === 'string' ? data.member_name : '';
    deletedRows = Number.isSafeInteger(data?.deleted_rows) ? data.deleted_rows : 0;
    if (!UUID_RE.test(authUserId)) return reply({ code: 'DELETION_TARGET_MISSING' }, 409, origin);
  } else {
    // retry: الطلب معتمد بالفعل، بس محتاجين نكمل حذف التخزين وحساب الدخول.
    const { data, error } = await service.from('member_deletion_requests')
      .select('id,auth_user_id,member_name,status')
      .eq('id', requestId)
      .maybeSingle();
    if (error || !data) return reply({ code: 'DELETION_REQUEST_NOT_FOUND' }, 404, origin);
    if (data.status !== 'approved') return reply({ code: 'DELETION_REQUEST_NOT_APPROVED' }, 409, origin);
    authUserId = typeof data.auth_user_id === 'string' ? data.auth_user_id : '';
    memberName = typeof data.member_name === 'string' ? data.member_name : '';
    if (!UUID_RE.test(authUserId)) return reply({ code: 'DELETION_TARGET_MISSING' }, 409, origin);
  }

  // ملفات التخزين: نحذفها قبل حساب الدخول لأن الملكية بتتبني على auth uuid.
  const { data: manifest } = await caller.rpc('member_deletion_storage_objects', { p_auth_user_id: authUserId });
  const objects = safeObjects(manifest?.objects);
  const buckets = new Map<string, string[]>();
  for (const object of objects) {
    const list = buckets.get(object.bucket_id) ?? [];
    list.push(object.name);
    buckets.set(object.bucket_id, list);
  }
  let removedObjects = 0;
  for (const [bucket, names] of buckets) {
    for (let index = 0; index < names.length; index += 100) {
      const chunk = names.slice(index, index + 100);
      const { error } = await service.storage.from(bucket).remove(chunk);
      if (!error) removedObjects += chunk.length;
    }
  }

  const { error: deleteUserError } = await service.auth.admin.deleteUser(authUserId, false);
  if (deleteUserError) {
    return reply({
      code: 'AUTH_DELETE_FAILED',
      retryable: true,
      deleted_rows: deletedRows,
      removed_objects: removedObjects,
      message_ar: 'تم حذف بيانات العضو من اللوحة، لكن حساب الدخول لم يُحذف بعد. أعد المحاولة.',
      message_en: 'Member data was removed from the dashboard, but the sign-in account still exists. Retry.',
    }, 502, origin);
  }

  const { error: completeError } = await caller.rpc('member_deletion_mark_complete', { p_request_id: requestId });
  if (completeError) return reply({ code: 'COMPLETION_MARK_FAILED', retryable: true }, 500, origin);

  return reply({
    ok: true,
    status: 'completed',
    request_id: requestId,
    member_name: memberName,
    deleted_rows: deletedRows,
    removed_objects: removedObjects,
  }, 200, origin);
});
