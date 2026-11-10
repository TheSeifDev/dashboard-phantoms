import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigins = new Set([
  ...(Deno.env.get('PHANTOMS_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()),
  (Deno.env.get('PHANTOMS_APP_URL') ?? '').trim().replace(/\/+$/, ''),
  'https://admin-phantoms.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean))
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const response = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' },
})
const normalizePhone = (raw: string) => {
  let digits = raw.replace(/[^\d]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('01') && digits.length === 11) digits = `20${digits.slice(1)}`
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null
}

serve(async (req) => {
  const origin = req.headers.get('Origin') ?? ''
  const reply = (body: unknown, status = 200) => response(body, status, origin)
  if (origin && !allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin || 'https://admin-phantoms.vercel.app' } })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return reply({ error: 'يلزم تسجيل دخول الإدارة.' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return reply({ error: 'جلسة الإدارة غير صالحة.' }, 401)
    const { data: isAdmin, error: adminError } = await supabase.rpc('has_admin_permission', { p_permission: 'whatsapp' })
    if (adminError || isAdmin !== true) return reply({ error: 'هذا الحساب غير مخوّل بإدارة إرسال واتساب.' }, 403)
    const { action, taskId, memberIds, consentConfirmed, enabled } = await req.json()
    const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
    const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'phantoms_task_assignment'
    const templateLanguage = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'ar'
    const graphVersion = Deno.env.get('WHATSAPP_GRAPH_API_VERSION')
    const configured = Boolean(token && phoneNumberId && templateName && templateLanguage && graphVersion)
    const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    if (action === 'status') {
      if (!configured) return reply({ configured: false, enabled: false, templateName: null })
      const { data: setting, error } = await service.from('whatsapp_settings').select('enabled').eq('id', 1).maybeSingle()
      if (error) throw error
      return reply({ configured, enabled: Boolean(setting?.enabled), templateName })
    }
    if (action === 'set-enabled') {
      if (typeof enabled !== 'boolean' || (enabled && !configured)) return reply({ error: 'لا يمكن تفعيل البوت قبل إكمال إعداد الربط.' }, 400)
      const { error } = await service.from('whatsapp_settings').upsert({ id: 1, enabled, updated_by: user.email, updated_at: new Date().toISOString() })
      if (error) throw error
      return reply({ configured, enabled, templateName: configured ? templateName : null })
    }
    if (action !== 'send') return reply({ error: 'إجراء غير معروف.' }, 400)
    if (!configured) return reply({ error: 'أكمل أسرار WhatsApp Cloud API وإعداد القالب على الخادم.' }, 503)
    const { data: setting, error: settingError } = await service.from('whatsapp_settings').select('enabled').eq('id', 1).maybeSingle()
    if (settingError || !setting?.enabled) return reply({ error: 'بوت واتساب متوقف. فعّله من لوحة الإدارة أولًا.' }, 409)
    if (!consentConfirmed || !Number.isInteger(taskId) || taskId <= 0 || !Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 50) {
      return reply({ error: 'تأكيد الموافقة مطلوب. اختر من 1 إلى 50 عضوًا لهذه الدفعة.' }, 400)
    }
    const validIds = memberIds.filter((id: unknown): id is number => Number.isInteger(id))
    const uniqueIds = [...new Set(validIds)]
    if (uniqueIds.length !== memberIds.length) return reply({ error: 'قائمة الأعضاء غير صالحة أو تحتوي تكرارًا.' }, 400)
    const [{ data: task, error: taskError }, { data: members, error: memberError }] = await Promise.all([
      supabase.from('tasks').select('id,title,description,has_deadline,deadline_date,assigned_to').eq('id', taskId).single(),
      supabase.from('members').select('id,full_name,phone,work_status').in('id', uniqueIds),
    ])
    if (taskError || !task) return reply({ error: 'المهمة غير موجودة أو لا يمكن الوصول إليها.' }, 404)
    if (memberError || !members || members.length !== uniqueIds.length) return reply({ error: 'تعذر التحقق من الأعضاء المحددين.' }, 400)
    const assigned = task.assigned_to === 'ALL' ? null : new Set((Array.isArray(task.assigned_to) ? task.assigned_to : []).map(String))
    if (members.some((member) => !member.phone || member.work_status === 'inactive' || (assigned && !assigned.has(String(member.id))))) {
      return reply({ error: 'يجب أن يكون كل مستلم نشطًا، لديه رقم صالح، ومكلفًا بهذه المهمة.' }, 400)
    }
    const results: string[] = []
    for (const member of members) {
      const to = normalizePhone(member.phone)
      if (!to) { results.push(`${member.full_name}: رقم الهاتف غير صالح بصيغة دولية.`); continue }
      const params = [member.full_name, task.title, task.description?.trim() || 'لا توجد تفاصيل إضافية', task.has_deadline && task.deadline_date ? task.deadline_date : 'غير محدد']
      try {
        const result = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: templateName, language: { code: templateLanguage }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } }),
        })
        if (result.ok) results.push('sent')
        else { const body = await result.json().catch(() => ({})); results.push(`${member.full_name}: ${body.error?.message ?? 'رفض WhatsApp الرسالة.'}`) }
      } catch {
        results.push(`${member.full_name}: تعذر الاتصال بخدمة WhatsApp.`)
      }
    }
    const sent = results.filter((item) => item === 'sent').length
    return reply({ sent, failed: results.length - sent, errors: results.filter((item) => item !== 'sent') })
  } catch (error) {
    console.error('WhatsApp task dispatch failed', error)
    return reply({ error: 'تعذر تنفيذ الإرسال. راجع إعداد الخادم وسجل Edge Function.' }, 500)
  }
})
