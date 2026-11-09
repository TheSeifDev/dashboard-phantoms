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
  headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' },
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
    return reply({ code: 'SERVER_CONFIG', message: 'إعداد خدمة الدعوات غير مكتمل على الخادم.' }, 503, origin);
  }

  const ownerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: authError } = await ownerClient.auth.getUser();
  if (authError || !userData.user) return reply({ code: 'UNAUTHORIZED', message: 'جلسة الإدارة غير صالحة.' }, 401, origin);

  const { data: access, error: accessError } = await ownerClient.rpc('get_admin_access');
  if (accessError || !access?.is_owner) {
    return reply({ code: 'OWNER_ONLY', message: 'إضافة المشرفين متاحة لمالك النظام فقط.' }, 403, origin);
  }

  const payload = await req.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ code: 'INVALID_EMAIL', message: 'اكتب بريد إلكتروني صحيح.' }, 400, origin);
  }

  const { data: existingAccount, error: existingError } = await ownerClient.rpc('admin_add_account', { p_email: email });
  if (!existingError) return reply({ account: existingAccount, invited: false }, 200, origin);
  if (!existingError.message.includes('ADMIN_USER_NOT_FOUND')) {
    const code = existingError.message.match(/\b([A-Z_]{4,}):/)?.[1] ?? 'ADMIN_ADD_FAILED';
    return reply({ code, message: existingError.message.split(':').slice(1).join(':').trim() }, 400, origin);
  }

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const configuredAppUrl = Deno.env.get('WASLA_APP_URL')?.trim();
  const redirectOrigin = configuredAppUrl
    || (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : '');
  const redirectTo = redirectOrigin ? new URL('/admin/set-password', redirectOrigin).toString() : undefined;
  const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
  if (inviteError) {
    // لو تم تسجيل الحساب بالتزامن مع الدعوة، أضفه كمشرف بدل إرسال دعوة ثانية.
    const { data: racedAccount, error: racedError } = await ownerClient.rpc('admin_add_account', { p_email: email });
    if (!racedError) return reply({ account: racedAccount, invited: false }, 200, origin);
    return reply({ code: 'INVITE_SEND_FAILED', message: 'معرفناش نبعت دعوة للحساب. اتأكد من إعداد بريد Supabase وجرّب تاني.' }, 502, origin);
  }

  const { data: account, error: grantError } = await ownerClient.rpc('admin_add_account', { p_email: email });
  if (grantError) {
    return reply({ code: 'INVITE_CREATED_GRANT_FAILED', message: 'اتعمل الحساب، لكن منح الصلاحية ما اكتملش. أعد المحاولة من نفس الشاشة.' }, 500, origin);
  }
  return reply({ account, invited: true }, 200, origin);
});
