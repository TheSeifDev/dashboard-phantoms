// =====================================================
// تثبيت كلمة المرور بين الموبايل والويب
// =====================================================
// المشكلة: العضو بيدخل من التطبيق (Android/iOS WebView) بنفس البريد ونفس
// كلمة المرور اللي سجل بيها، والتطبيق بيرفض. الخادم مش بيفرّق بين المتصفح
// والتطبيق، فالفرق لازم يكون في النص اللي اتبعت من الكيبورد:
//   1) كيبورد الموبايل بيضيف مسافة في آخر الكلمة (خصوصًا مع الإكمال التلقائي).
//   2) iOS بيخزّن الحروف المتراكبة بصيغة NFD، وأندرويد/الويب بيستخدموا NFC،
//      فنفس كلمة المرور بتبقى bytes مختلفة.
//   3) الملء التلقائي (Google/iCloud password manager) ممكن يحقن كلمة قديمة.
// الحل: بنجرّب الشكل اللي المستخدم كتبه الأول (من غير أي تغيير)، وبعدين
// الأشكال المُطبّعة (بدون مسافات طرفية + NFC) لو الخادم رفض البيانات.
// كل المحاولات بتتوقف فورًا على أي خطأ مش "بيانات دخول غلط" (شبكة/مهلة/429).
// =====================================================

import { classifyAuthFailure } from './auth-errors';

/** أقصى عدد محاولات لكل تسجيل دخول (الشكل الأصلي + 4 أشكال مُطبّعة). */
export const MAX_PASSWORD_VARIANTS = 5;

// رموز غير مرئية (اتجاه الكتابة، عرض صفري، علامات لصق من واتساب) وأرقام عربية/فارسية
// بتدخل من كيبورد عربي أو بالنسخ واللصق وبتخلّي نفس كلمة المرور بايتات مختلفة.
const INVISIBLE_CHARACTERS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
function toAsciiDigit(character: string): string {
  const code = character.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
}
/** يشيل الرموز المخفية ويحوّل الأرقام العربية لإنجليزية (يُستخدم كمحاولة أخيرة فقط). */
export function cleanCredentialText(value: string): string {
  return normalizeToNfc(value).replace(INVISIBLE_CHARACTERS, '').replace(ARABIC_INDIC_DIGITS, toAsciiDigit).trim();
}

function normalizeToNfc(value: string): string {
  try {
    return typeof value.normalize === 'function' ? value.normalize('NFC') : value;
  } catch {
    return value;
  }
}

/**
 * أشكال كلمة المرور اللي بنجرّبها بالترتيب. الشكل الأول دايمًا زي ما اتكتب
 * بالحرف، عشان أي كلمة مرور شغالة حاليًا تفضل شغالة بنفس السلوك.
 */
export function passwordVariants(raw: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    variants.push(value);
  };
  push(raw);
  const trimmed = raw.trim();
  push(trimmed);
  push(normalizeToNfc(raw));
  push(normalizeToNfc(trimmed));
  push(cleanCredentialText(raw));
  return variants.slice(0, MAX_PASSWORD_VARIANTS);
}

export interface PasswordAttemptResult<Result> {
  /** نتيجة المحاولة الناجحة، أو null لو كل المحاولات فشلت. */
  result: Result | null;
  error: unknown;
  /** عدد المحاولات اللي اتعملت فعليًا (1 لو نجحت من أول مرة). */
  attempts: number;
  /** هل نجحت المحاولة بشكل مختلف عن النص اللي المستخدم كتبه؟ */
  normalized: boolean;
}

/**
 * بيسجّل الدخول بكلمة المرور، ولو الخادم قال "بيانات غلط" بيجرّب الأشكال
 * المُطبّعة. أي خطأ تاني (شبكة، مهلة، 429، 5xx) بيرجع فورًا من غير محاولات
 * زيادة عشان ما نضاعفش الضغط على الخادم ولا نستهلك حد المحاولات.
 */
export async function signInWithPasswordVariants<Result extends { error: unknown }>(options: {
  email: string;
  password: string;
  signIn: (credentials: { email: string; password: string }) => Promise<Result>;
}): Promise<PasswordAttemptResult<Result>> {
  const variants = passwordVariants(options.password);
  let attempts = 0;
  let lastError: unknown = null;
  for (const variant of variants) {
    attempts += 1;
    const result = await options.signIn({ email: options.email, password: variant });
    if (!result.error) {
      return { result, error: null, attempts, normalized: attempts > 1 };
    }
    lastError = result.error;
    if (classifyAuthFailure(result.error).kind !== 'INVALID_CREDENTIALS') {
      return { result: null, error: result.error, attempts, normalized: false };
    }
  }
  return { result: null, error: lastError, attempts, normalized: false };
}
