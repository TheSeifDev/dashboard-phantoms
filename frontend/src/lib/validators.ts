/**
 * مكتبة التحقق من صحة البيانات
 * Validation utilities for Wasla Tech System
 */

/**
 * التحقق من صحة البريد الإلكتروني
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmed = email.trim();
  
  // فحص إضافي للأمان
  if (trimmed.length > 254) return false; // RFC 5321
  if (trimmed.includes('..')) return false; // نقطتين متتاليتين غير مسموح
  
  return emailRegex.test(trimmed);
}

/**
 * التحقق من رقم الهاتف المصري
 */
export function isValidEgyptianPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  
  const cleaned = phone.replace(/[\s\-()]/g, '');
  
  // أرقام مصرية: تبدأ بـ 01 وطولها 11 رقم
  const egyptianMobileRegex = /^(010|011|012|015)\d{8}$/;
  // أو رقم دولي +20
  const internationalRegex = /^\+20(10|11|12|15)\d{8}$/;
  
  return egyptianMobileRegex.test(cleaned) || internationalRegex.test(cleaned);
}

/**
 * تنظيف النصوص من المحارف الخطرة (XSS prevention)
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/[<>]/g, '') // إزالة علامات HTML
    .replace(/javascript:/gi, '') // إزالة JavaScript protocols
    .replace(/on\w+=/gi, '') // إزالة event handlers
    .trim();
}

/**
 * التحقق من قوة كلمة المرور
 */
export function checkPasswordStrength(password: string): {
  score: number;
  feedback: string;
  isStrong: boolean;
} {
  if (!password) return { score: 0, feedback: 'الباسورد فاضي', isStrong: false };
  
  let score = 0;
  const feedback: string[] = [];
  
  // الطول
  if (password.length >= 8) score += 1;
  else feedback.push('لازم الباسورد يكون 8 حروف على الأقل');
  
  if (password.length >= 12) score += 1;
  
  // أحرف كبيرة وصغيرة
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  else feedback.push('اكتب حروف كبيرة وصغيرة');
  
  // أرقام
  if (/\d/.test(password)) score += 1;
  else feedback.push('ضيف أرقام');
  
  // رموز خاصة
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  else feedback.push('ضيف رموز خاصة');
  
  const isStrong = score >= 4;
  const feedbackText = isStrong ? 'باسورد قوي' : feedback.join('، ');
  
  return { score, feedback: feedbackText, isStrong };
}

/**
 * التحقق من صحة URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.length > 2048) return false;

  try {
    const parsed = new URL(url.trim());
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * إرجاع href آمن للعرض فقط — يقبل http/https حصراً.
 * أي قيمة أخرى (javascript:, data:, blob:, مسار نسبي غامض) تُرفض بإرجاع null
 * حتى لا تتحول بيانات مخزنة إلى XSS/open-redirect عند العرض.
 */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

/** التأكد من معرّف رقمي موجب ضمن حد 32-bit */
export function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

/**
 * تحديد حد نصي (للعرض في الواجهة)
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
