import dotenv from 'dotenv';

// .env.local أولاً (أسرار التطوير المحلية غير المتتبعة)، ثم .env للقيم المشتركة.
// متغيرات البيئة الفعلية تسبق الاثنين دائماً.
dotenv.config({ path: '.env.local' });
dotenv.config();

export interface AppConfig {
  port: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  corsOrigins: string[];
  nodeEnv: string;
  isDev: boolean;
  isTest: boolean;
  allowDevBypass: boolean;
  isMock: boolean;
}

function parseOrigins(raw?: string): string[] {
  if (!raw) return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return raw
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
}

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3030,
  supabaseUrl:
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://mukqrnmveydxfphftlaq.supabase.co',
  // لا قيمة افتراضية مضمّنة للمفتاح — يُقرأ من البيئة فقط ويفشل مغلقاً عند غيابه.
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '',
  corsOrigins: parseOrigins(
    process.env.CORS_ORIGIN || process.env.WHATSAPP_BRIDGE_ORIGINS
  ),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  isTest: (process.env.NODE_ENV || '') === 'test',
  // تجاوز التطوير صريح فقط — لا يُفعّل ضمنياً في أي بيئة.
  allowDevBypass: process.env.ALLOW_DEV_BYPASS === 'true',
  isMock: true,
};

if (!config.supabaseAnonKey && config.nodeEnv === 'production') {
  console.warn('[WhatsApp Service] SUPABASE_ANON_KEY missing — auth verification will fail closed.');
}
