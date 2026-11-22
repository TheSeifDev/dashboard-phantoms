// =====================================================
// تصنيف أخطاء تسجيل الدخول وترجمتها لرسائل صادقة
// =====================================================
// المشكلة اللي كانت بتحصل: أي فشل (شبكة، مهلة، 429، 5xx) كان بيتحوّل
// لرسالة "البريد الإلكتروني أو كلمة المرور غير صحيحة"، فالعضو كان بيفتكر
// إن كلمة المرور غلط وهو أصلًا مش قادر يوصل للخادم.
// =====================================================

import { isSupabaseTransportError, isTransportFailure, transportFailureReason } from '../../lib/supabase/transport';

export type AuthFailureKind =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'RATE_LIMITED'
  | 'INVALID_API_KEY'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SERVER'
  | 'UNKNOWN';

export interface AuthFailure {
  kind: AuthFailureKind;
  status: number | null;
  message: string;
}

type AuthLikeError = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
};

function readError(error: unknown): AuthLikeError | null {
  if (!error || typeof error !== 'object') return null;
  return error as AuthLikeError;
}

function readStatus(error: AuthLikeError): number | null {
  const raw = error.status;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readText(error: AuthLikeError): string {
  const parts = [error.message, error.code, error.name]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return parts.toLowerCase();
}

/** يصنّف أي خطأ خارج من supabase.auth إلى نوع مفهوم للواجهة. */
export function classifyAuthFailure(error: unknown): AuthFailure {
  const record = readError(error);
  const status = record ? readStatus(record) : null;
  const text = record ? readText(record) : String(error ?? '').toLowerCase();
  const message = record && typeof record.message === 'string' ? record.message : '';

  if (isSupabaseTransportError(error)) {
    return {
      kind: transportFailureReason(error) === 'timeout' ? 'TIMEOUT' : 'NETWORK',
      status,
      message,
    };
  }
  if (isTransportFailure(error)) {
    return { kind: 'NETWORK', status, message };
  }
  if (text.includes('invalid api key') || text.includes('invalid_api_key') || text.includes('no api key')) {
    return { kind: 'INVALID_API_KEY', status, message };
  }
  if (text.includes('email not confirmed') || text.includes('email_not_confirmed')) {
    return { kind: 'EMAIL_NOT_CONFIRMED', status, message };
  }
  if (
    status === 429
    || text.includes('rate limit')
    || text.includes('too many requests')
    || text.includes('over_request_rate_limit')
    || text.includes('over_email_send_rate_limit')
  ) {
    return { kind: 'RATE_LIMITED', status, message };
  }
  if (
    text.includes('invalid login credentials')
    || text.includes('invalid_credentials')
    || text.includes('invalid grant')
  ) {
    return { kind: 'INVALID_CREDENTIALS', status, message };
  }
  if (status !== null && status >= 500) {
    return { kind: 'SERVER', status, message };
  }
  if (status === 0) {
    return { kind: 'NETWORK', status, message };
  }
  return { kind: 'UNKNOWN', status, message };
}

type Translate = (arabic: string, english: string) => string;

/** رسالة عربية واضحة لكل نوع فشل. */
export function authFailureMessage(failure: AuthFailure, t: Translate, fallback?: string): string {
  switch (failure.kind) {
    case 'INVALID_CREDENTIALS':
      return t('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'The email or password is incorrect.');
    case 'EMAIL_NOT_CONFIRMED':
      return t(
        'الحساب محتاج تأكيد البريد الإلكتروني الأول. افتح رسالة التأكيد وبعدها جرّب الدخول.',
        'This account still needs email confirmation. Open the confirmation email, then try again.',
      );
    case 'RATE_LIMITED':
      return t(
        'محاولات دخول كتير في وقت قصير. استنى دقيقة وجرّب تاني.',
        'Too many sign-in attempts in a short time. Wait a minute and try again.',
      );
    case 'INVALID_API_KEY':
      return t(
        'إعداد اتصال Supabase غير صحيح على الخادم. راجع إعدادات النشر.',
        'The Supabase connection is misconfigured on the server. Check the deployment settings.',
      );
    case 'NETWORK':
      return t(
        'مش قادرين نوصل لخادم الدخول. اتأكد من الإنترنت (جرّب واي فاي أو بيانات الموبايل) وجرّب تاني.',
        'We could not reach the sign-in server. Check your connection (try Wi-Fi or mobile data) and try again.',
      );
    case 'TIMEOUT':
      return t(
        'الاتصال بالخادم بطيء أوي فقطعناه. جرّب تاني على شبكة أحسن.',
        'The connection to the server was too slow, so we stopped it. Try again on a better network.',
      );
    case 'SERVER':
      return t(
        'خادم الدخول بيرفض الطلب دلوقتي. استنى شوية وجرّب تاني.',
        'The sign-in server is refusing requests right now. Wait a moment and try again.',
      );
    default:
      return fallback
        ? t(fallback, fallback)
        : t('حصلت مشكلة وإحنا بنسجل دخولك. جرّب تاني.', 'Something went wrong while signing you in. Please try again.');
  }
}

/** هل الفشل ده مشكلة اتصال (يعني كلمة المرور مش المتهم)؟ */
export function isConnectivityFailure(failure: AuthFailure): boolean {
  return failure.kind === 'NETWORK' || failure.kind === 'TIMEOUT' || failure.kind === 'SERVER';
}
