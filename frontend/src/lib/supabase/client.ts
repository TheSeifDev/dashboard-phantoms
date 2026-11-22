import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/db';
import { supabaseBaseUrl, supabaseDirectUrl } from './endpoints';
import { createSupabaseFetch } from './transport';

// متغيرات env قد تكون غائبة — نمثلها بأمانة (string | undefined) ثم نفرق
// العنوان الأساسي بقى بروكسي نفس الدومين (لو متاح) مع رجوع تلقائي للمباشر.
const supabaseUrl = supabaseBaseUrl;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  ?? 'placeholder-anon-key';

const resilientSupabaseFetch = createSupabaseFetch({
  primaryBase: supabaseBaseUrl,
  fallbackBase: supabaseDirectUrl,
});

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  // تنبيه واضح للمطور بدل فشل صامت
  console.warn(
    '[supabase] مفاتيح Supabase غير مضبوطة.\n' +
    'أنشئ ملف .env.local في frontend/ وأضف:\n' +
    'VITE_SUPABASE_URL=...\nVITE_SUPABASE_ANON_KEY=...'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: resilientSupabaseFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // URL sessions are accepted only by the explicit admin invite/recovery callback
    // routes. This prevents a member OTP/magic-link URL from becoming an admin session.
    detectSessionInUrl: false,
    // حفظ الجلسة حسب اختيار "تذكرني": localStorage للدائم، sessionStorage للمؤقت.
    // يُقرأ العلم في كل عملية (وليس مرة واحدة) حتى يبدّل المستخدم اختياره قبل الدخول.
    storage: {
      getItem: (key: string) => {
        try {
          const remember = localStorage.getItem('phantoms_admin_remember') !== '0';
          if (!remember) {
            try {
              return sessionStorage.getItem(key);
            } catch {
              return null;
            }
          }
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string) => {
        try {
          let remember = true;
          try {
            remember = localStorage.getItem('phantoms_admin_remember') !== '0';
          } catch {
            remember = true;
          }
          if (remember) {
            localStorage.setItem(key, value);
            try {
              sessionStorage.removeItem(key);
            } catch {
              // ignore
            }
          } else {
            sessionStorage.setItem(key, value);
            try {
              localStorage.removeItem(key);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      },
      removeItem: (key: string) => {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
        try {
          sessionStorage.removeItem(key);
        } catch {
          // ignore
        }
      },
    } as any,
  },
});

/** ينظّف نسخة الجلسة من المخزن غير المستخدم حسب اختيار التذكر — يمنع بقاء جلسة دائمة بعد اختيار مؤقت */
export const syncAdminSessionStorage = (remember: boolean): void => {
  try {
    if (remember) {
      // سنحفظ دائماً: انقل أي جلسة مؤقتة إلى الدائم
      const keys: string[] = [];
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('sb-')) keys.push(k);
        }
      } catch {
        // ignore
      }
      for (const k of keys) {
        try {
          const v = sessionStorage.getItem(k);
          if (v !== null) localStorage.setItem(k, v);
          sessionStorage.removeItem(k);
        } catch {
          // ignore
        }
      }
    } else {
      // جلسة مؤقتة: احذف أي نسخ دائمة قديمة حتى لا تُبعث بعد قفل المتصفح
      const keys: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sb-')) keys.push(k);
        }
      } catch {
        // ignore
      }
      for (const k of keys) {
        try {
          localStorage.removeItem(k);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
};
