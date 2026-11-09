import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  ...(Deno.env.get('PHANTOMS_ALLOWED_ORIGINS') ?? Deno.env.get('WASLA_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()),
  (Deno.env.get('PHANTOMS_APP_URL') ?? Deno.env.get('WASLA_APP_URL') ?? '').trim().replace(/\/+$/, ''),
  'https://admin-phantoms.vercel.app',
  'https://admin-wasla.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean));
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://admin-phantoms.vercel.app', 'Content-Type': 'application/json' },
});

serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://admin-phantoms.vercel.app' } });
  }
  if (req.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED', message: 'الطريقة غير مدعومة.' }, 405, origin);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply({ code: 'UNAUTHORIZED', message: 'يلزم تسجيل دخول المالك.' }, 401, origin);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anonKey || !serviceKey) {
    return reply({ code: 'SERVER_CONFIG', message: 'إعداد حذف الحسابات غير مكتمل على الخادم.' }, 503, origin);
  }

  const ownerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: authError } = await ownerClient.auth.getUser();
  if (authError || !userData.user) return reply({ code: 'UNAUTHORIZED', message: 'جلسة الإدارة غير صالحة.' }, 401, origin);

  const { data: access, error: accessError } = await ownerClient.rpc('get_admin_access');
  if (accessError || !access?.is_owner) {
    return reply({ code: 'OWNER_ONLY', message: 'حذف الحسابات متاح لمالك النظام فقط.' }, 403, origin);
  }

  const payload = await req.json().catch(() => null) as { user_id?: unknown } | null;
  const userId = typeof payload?.user_id === 'string' ? payload.user_id.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return reply({ code: 'INVALID_ID', message: 'معرّف الحساب مش صحيح.' }, 400, origin);
  }
  if (userId === userData.user.id) {
    return reply({ code: 'OWNER_IMMUTABLE', message: 'مينفعش حذف مالك النظام.' }, 403, origin);
  }

  const { data: accounts, error: accountsError } = await ownerClient.rpc('admin_list_accounts');
  if (accountsError) return reply({ code: 'ADMIN_LIST_FAILED', message: 'معرفناش نتحقق من حسابات الإدارة.' }, 500, origin);
  const target = (accounts ?? []).find((account: { user_id?: string; role?: string }) => account.user_id === userId);
  if (!target || target.role !== 'admin') {
    return reply({ code: 'ADMIN_NOT_FOUND', message: 'حساب المشرف ده مش موجود.' }, 404, origin);
  }

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId, false);
  if (deleteError) {
    return reply({ code: 'ADMIN_DELETE_FAILED', message: 'معرفناش نحذف حساب الدخول. مفيش تغيير اتعمل على الحساب.' }, 502, origin);
  }

  return reply({ deleted: true }, 200, origin);
});
