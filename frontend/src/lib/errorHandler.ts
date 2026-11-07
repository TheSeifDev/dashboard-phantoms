/**
 * معالج الأخطاء المركزي
 * Centralized error handling for better user experience
 */

import type { PostgrestError } from '@supabase/supabase-js';

export type AppError = {
  message: string;
};

/**
 * تحويل أخطاء Supabase إلى رسائل عربية واضحة.
 * لا تُرجع details/hint/code للواجهة — تسريب مخطط قاعدة البيانات
 * ورسائل PostgreSQL الخام للعميل مرفوض في الإنتاج.
 */
export function handleSupabaseError(error: PostgrestError | Error | unknown): AppError {
  // خطأ من PostgreSQL
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as PostgrestError;

    // أخطاء شائعة
    const errorMessages: Record<string, string> = {
      '23505': 'الإيميل مستخدم قبل كده',
      '23503': 'مينفعش تمسح السجل ده عشان فيه بيانات مرتبطة بيه',
      '42501': 'معندكش صلاحية تعمل الإجراء ده',
      'PGRST116': 'مفيش صف مطابق للمعرّف ده',
      'PGRST301': 'الجلسة انتهت - سجل دخولك تاني',
    };

    return {
      message: errorMessages[pgError.code] || 'حصلت مشكلة في قاعدة البيانات',
    };
  }
  
  // خطأ عادي من JavaScript
  if (error instanceof Error) {
    return {
      message: error.message || 'حصلت مشكلة غير متوقعة',
    };
  }
  
  // خطأ غير معروف
  return {
    message: 'حصلت مشكلة غير متوقعة',
  };
}

/**
 * تسجيل الأخطاء (يمكن ربطه بخدمة مثل Sentry)
 */
export function logError(error: unknown, context?: string): void {
  if (import.meta.env.DEV) {
    console.error(`[Error${context ? ` in ${context}` : ''}]:`, error);
  }
  
  // في Production: أرسل إلى خدمة تتبع الأخطاء
  // مثل Sentry أو LogRocket
  // Sentry.captureException(error, { tags: { context } });
}

/**
 * معالج عام للأخطاء مع toast notification
 */
export function showErrorToast(error: unknown, context?: string): void {
  logError(error, context);
  const appError = handleSupabaseError(error);
  // Toast مركزي بدل alert — يعمل حتى خارج React عبر zustand store
  import('../store/toast').then(({ toast }) => toast.error(appError.message)).catch(() => {
    // fallback نادر لو فشل تحميل المتجر
    console.error(appError.message);
  });
}
