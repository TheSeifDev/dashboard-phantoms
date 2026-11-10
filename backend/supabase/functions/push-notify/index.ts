import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  ...(Deno.env.get('PHANTOMS_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()),
  (Deno.env.get('PHANTOMS_APP_URL') ?? '').trim().replace(/\/+$/, ''),
  'https://admin-phantoms.vercel.app',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean));
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' },
});

// إعداد VAPID
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:operations@phantoms.org',
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
);

serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  const reply = (body: unknown, status = 200) => response(body, status, origin);

  if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://admin-phantoms.vercel.app' } });
  }

  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return reply({ error: 'مطلوب توثيق.' }, 401);
    
    // التحقق من صلاحيات الإدارة التي تستدعي الرابط
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply({ error: 'الجلسة غير صالحة.' }, 401);
    
    // صلاحية الإرسال مرتبطة بصلاحية الإدارة المركزية، لا بقائمة بريد منفصلة.
    const { data: isAdmin, error: adminError } = await supabase.rpc('has_admin_permission', { p_permission: 'announcements' });
    if (adminError || isAdmin !== true) {
         return reply({ error: 'غير مخول بإرسال الإشعارات.' }, 403);
    }
    
    const { title, body, icon, url, memberIds } = await req.json();
    if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
        typeof body !== 'string' || !body.trim() || body.length > 500 ||
        !Array.isArray(memberIds)) {
      return reply({ error: 'بيانات الإشعار غير مكتملة.' }, 400);
    }

    const validIds = [...new Set(
      memberIds.filter((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)
    )];
    if (validIds.length === 0 || validIds.length > 50 || validIds.length !== memberIds.length) {
      return reply({ error: 'قائمة الأعضاء غير صالحة (1-50 بلا تكرار).' }, 400);
    }

    const safeIcon = typeof icon === 'string' && icon !== ''
      ? icon.slice(0, 2048)
      : '/branding/phantoms-mark-192.png';
    if (safeIcon !== '/branding/phantoms-mark-192.png' && safeIcon !== '/branding/phantoms-icon-192.png' && !/^https:\/\/[^/]+/.test(safeIcon) && !safeIcon.startsWith('/')) {
      return reply({ error: 'أيقونة الإشعار غير صالحة.' }, 400);
    }
    const safeUrl = typeof url === 'string' && url !== '' ? url.slice(0, 2048) : '/portal';
    if (!safeUrl.startsWith('/') && !/^https:\/\/[^/]+/.test(safeUrl)) {
      return reply({ error: 'رابط الإشعار غير صالح.' }, 400);
    }
    
    // جلب اشتراكات الأعضاء من قاعدة البيانات
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    const { data: members, error: membersError } = await serviceClient
      .from('members')
      .select('id, push_subscription')
      .in('id', validIds)
      .not('push_subscription', 'is', 'null');
      
    if (membersError || !members) return reply({ error: 'خطأ في جلب الاشتراكات.' }, 500);
    if (members.length === 0) return reply({ sent: 0, failed: 0, message: 'لا يوجد أعضاء لديهم تطبيق منزّل واشتراكات مفعّلة.' });
    
    const payload = JSON.stringify({
      title: title.trim().slice(0, 120),
      body: body.trim().slice(0, 500),
      icon: safeIcon,
      url: safeUrl,
    });
    
    let sent = 0;
    let failed = 0;
    
    for (const member of members) {
      try {
        await webpush.sendNotification(member.push_subscription, payload);
        sent++;
      } catch (err: unknown) {
        failed++;
        console.error(`فشل إرسال إشعار للعضو ${member.id}:`, err);
        // (Optional: remove subscription from DB if err.statusCode === 410 (Gone))
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await serviceClient.from('members').update({ push_subscription: null }).eq('id', member.id);
        }
      }
    }
    
    return reply({ sent, failed });
    
  } catch (err: unknown) {
    console.error('Push Notification Error:', err);
    return reply({ error: 'حدث خطأ غير متوقع.' }, 500);
  }
});
