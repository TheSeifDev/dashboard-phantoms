import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { mockBaileysManager } from '../services/mockBaileysManager.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DiagCheck {
  id: string;
  category: 'env' | 'network' | 'auth' | 'service' | 'cloud';
  label: string;
  status: CheckStatus;
  /** وصف آمن — أبداً لا يحمل قيم أسرار، فقط وجود/غياب وأسباب عامة */
  detail: string;
  /** خطوة إصلاح مقترحة بالعربية */
  fix?: string;
}

const ok = (id: string, category: DiagCheck['category'], label: string, detail: string): DiagCheck =>
  ({ id, category, label, status: 'ok', detail });
const warn = (id: string, category: DiagCheck['category'], label: string, detail: string, fix?: string): DiagCheck =>
  ({ id, category, label, status: 'warn', detail, fix });
const fail = (id: string, category: DiagCheck['category'], label: string, detail: string, fix?: string): DiagCheck =>
  ({ id, category, label, status: 'fail', detail, fix });

function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function checkSupabaseAuth(): Promise<{ reachable: boolean; latencyMs: number | null; kind: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // بدون apikey ترد الخدمة 401 برسالة "No API key" — وهذا بحد ذاته إثبات وصول.
    const headers: Record<string, string> = {};
    if (config.supabaseAnonKey) headers.apikey = config.supabaseAnonKey;
    const res = await fetch(`${config.supabaseUrl}/auth/v1/health`, { signal: controller.signal, headers });
    const text = await res.text().catch(() => '');
    const alive = res.ok || (res.status === 401 && /api key/i.test(text));
    return { reachable: alive, latencyMs: Date.now() - started, kind: alive ? 'ok' : `http-${res.status}` };
  } catch (err) {
    const kind = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
    return { reachable: false, latencyMs: null, kind };
  } finally {
    clearTimeout(timer);
  }
}

export const diagnosticsRouter = Router();

// GET /v1/diagnostics — خلف authMiddleware (إداريون فقط).
// لا يُرجع أي قيمة سرية: وجود/غياب وأسباب عامة فقط.
diagnosticsRouter.get('/v1/diagnostics', async (req: Request, res: Response) => {
  const checks: DiagCheck[] = [];

  // ── البيئة ──
  if (config.supabaseUrl && isHttpUrl(config.supabaseUrl)) {
    checks.push(ok('env/supabase-url', 'env', 'رابط Supabase مضبوط', `القيمة صالحة (${new URL(config.supabaseUrl).hostname})`));
  } else {
    checks.push(fail('env/supabase-url', 'env', 'رابط Supabase مضبوط', 'SUPABASE_URL مفقود أو ليس رابطاً صالحاً.',
      'أضف SUPABASE_URL في backend/whatsapp-service/.env.local ثم أعد تشغيل الجسر.'));
  }

  if (config.supabaseAnonKey) {
    checks.push(ok('env/anon-key', 'env', 'مفتاح التحقق (anon) موجود', 'المفتاح محمّل — التحقق من الجلسات ممكن.'));
  } else {
    checks.push(fail('env/anon-key', 'env', 'مفتاح التحقق (anon) موجود', 'SUPABASE_ANON_KEY مفقود — كل طلبات التحقق ستفشل.',
      'أضف SUPABASE_ANON_KEY (أو VITE_SUPABASE_ANON_KEY) في .env.local ثم أعد تشغيل الجسر.'));
  }

  checks.push(ok('auth/admin-source', 'auth', 'مصدر صلاحيات الإدارة', 'صلاحيات خدمة واتساب مرتبطة بجدول إدارة النظام في قاعدة البيانات.'));

  checks.push(ok('env/cors-origins', 'env', 'مصادر CORS', config.corsOrigins.join(', ') || 'الوضع الافتراضي المحلي.'));

  const vapidPub = Boolean(process.env.VAPID_PUBLIC_KEY);
  const vapidPriv = Boolean(process.env.VAPID_PRIVATE_KEY);
  if (vapidPub && vapidPriv) {
    checks.push(ok('env/vapid', 'env', 'مفاتيح VAPID للإشعارات', 'المفتاحان العام والخاص موجودان.'));
  } else {
    checks.push(warn('env/vapid', 'env', 'مفاتيح VAPID للإشعارات', 'مفاتيح الإشعارات الفورية غير مضبوطة — الإرسال عبر واتساب لا يتأثر.',
      'ولّدها بأمر npx web-push generate-vapid-keys وأضفها في .env.local.'));
  }

  // ── الشبكة: الوصول لخدمة Supabase Auth ──
  const net = await checkSupabaseAuth();
  if (net.reachable) {
    checks.push(ok('net/supabase-auth', 'network', 'الوصول إلى Supabase Auth', `مستجيب خلال ${net.latencyMs}ms.`));
  } else {
    const fix = net.kind === 'timeout'
      ? 'انتهت المهلة (8 ثوانٍ) — تحقق من اتصال الإنترنت أو جدار الحماية.'
      : net.kind === 'network'
        ? 'تعذر الاتصال — تحقق من صحة SUPABASE_URL ومن اتصال الخادم بالإنترنت.'
        : `الخدمة ردت بحالة غير سليمة (${net.kind}) — تحقق من حالة مشروع Supabase.`;
    checks.push(fail('net/supabase-auth', 'network', 'الوصول إلى Supabase Auth', `تعذر الوصول لخدمة المصادقة (السبب: ${net.kind}).`, fix));
  }

  // ── المصادقة: هوية المتصل الحالي ──
  const bypassActive = config.isTest || (config.isDev && config.allowDevBypass);
  const presentedNoToken = !req.headers.authorization;
  if (req.user) {
    if (presentedNoToken && bypassActive) {
      checks.push(warn('auth/caller', 'auth', 'هوية المتصل معتمدة', 'هوية تجريبية عبر التجاوز (بلا توكن حقيقي) — التحقق الحقيقي بـ JWT لم يُختبر بعد.',
        'سجّل دخول الإدارة في الواجهة ثم أعد الفحص لاختبار توكن حقيقي.'));
    } else {
      checks.push(ok('auth/caller', 'auth', 'هوية المتصل معتمدة', `الجلسة صالحة (${req.user.email}) وتم التحقق من صلاحيته في قاعدة البيانات.`));
    }
  } else {
    checks.push(fail('auth/caller', 'auth', 'هوية المتصل معتمدة', 'لا توجد هوية — الطلب بلا توكن صالح.',
      'سجّل دخول الإدارة في الواجهة ثم أعد فحص التشخيص.'));
  }
  if (bypassActive) {
    checks.push(warn('auth/bypass', 'auth', 'وضع التجاوز التطويري', 'التجاوز مفعّل — الطلبات بلا توكن تُقبل كهوية تجريبية. للإنتاج أطفئه (احذف ALLOW_DEV_BYPASS).'));
  } else {
    checks.push(ok('auth/bypass', 'auth', 'وضع التجاوز التطويري', 'معطّل — كل طلب يتطلب توكن إدارة حقيقي.'));
  }

  // ── الخدمة: حالة المحاكي + Cloud ──
  const status = mockBaileysManager.getStatus();
  checks.push(status.state === 'connected'
    ? ok('service/session', 'service', 'جلسة Baileys (تجريبي)', `متصل (${status.phone ?? 'بلا رقم'}).`)
    : warn('service/session', 'service', 'جلسة Baileys (تجريبي)', `الحالة: ${status.state} — طبيعي قبل أول ربط QR.`));

  const cloudVars = {
    'WHATSAPP_ACCESS_TOKEN': process.env.WHATSAPP_ACCESS_TOKEN,
    'WHATSAPP_PHONE_NUMBER_ID': process.env.WHATSAPP_PHONE_NUMBER_ID,
    'WHATSAPP_TEMPLATE_NAME': process.env.WHATSAPP_TEMPLATE_NAME,
    'WHATSAPP_GRAPH_API_VERSION': process.env.WHATSAPP_GRAPH_API_VERSION,
  };
  const missingCloud = Object.entries(cloudVars).filter(([, v]) => !v).map(([k]) => k);
  if (missingCloud.length === 0) {
    checks.push(ok('cloud/config', 'cloud', 'إعداد Meta Cloud API', 'كل أسرار السحابة موجودة.'));
  } else {
    checks.push(warn('cloud/config', 'cloud', 'إعداد Meta Cloud API',
      `تبويب السحابة معطّل — تنقص: ${missingCloud.join('، ')}.`,
      'أكمل أسرار WHATSAPP_* في بيئة Edge Function (Supabase) وليس هنا.'));
  }

  // ── قاعدة البيانات: مفتاح الخدمة وإعدادات واتساب ──
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    checks.push(warn('db/service-role', 'service', 'مفتاح الخدمة (قراءة الإعدادات)', 'غير مضبوط — لا يمكن قراءة whatsapp_settings من الجسر.',
      'أضفه في بيئة الخادم فقط (وليس في الواجهة أبداً).'));
  } else {
    try {
      const admin = createClient(config.supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data, error } = await admin.from('whatsapp_settings').select('enabled').eq('id', 1).maybeSingle();
      if (error) throw error;
      checks.push(ok('db/whatsapp-settings', 'service', 'إعدادات واتساب في القاعدة', `موجودة — البوت ${data?.enabled ? 'مفعّل' : 'متوقف'}.`));
    } catch {
      checks.push(warn('db/whatsapp-settings', 'service', 'إعدادات واتساب في القاعدة', 'تعذر القراءة بمفتاح الخدمة — تحقق من صلاحيته.',
        'تأكد أن المفتاح service_role صحيح وأن جدول whatsapp_settings موجود.'));
    }
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  res.json({
    generatedAt: new Date().toISOString(),
    mode: config.nodeEnv,
    summary: { total: checks.length, fails, warns: checks.filter((c) => c.status === 'warn').length },
    checks,
  });
});
