import { normalizeAuthEmail } from './auth-flow';

export { normalizeAuthEmail };

export const MEMBER_INVITE_PREFIX = 'phpw_';
export const MEMBER_PASSWORD_MIN_LENGTH = 12;
export const MEMBER_PASSWORD_MAX_UTF8_BYTES = 72;

export type MemberPasswordValidation =
  | { ok: true }
  | { ok: false; code: 'WEAK_PASSWORD' | 'PASSWORD_MISMATCH' };

export type MemberInviteLocation =
  | { kind: 'token'; token: string }
  | { kind: 'legacy'; token: string }
  | { kind: 'invalid' }
  | { kind: 'missing' };

export function validateMemberPassword(password: string, confirmPassword?: string): MemberPasswordValidation {
  if (
    password.length < MEMBER_PASSWORD_MIN_LENGTH
    || new TextEncoder().encode(password).byteLength > MEMBER_PASSWORD_MAX_UTF8_BYTES
    || !/[A-Za-z]/.test(password)
    || !/[0-9]/.test(password)
  ) {
    return { ok: false, code: 'WEAK_PASSWORD' };
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { ok: false, code: 'PASSWORD_MISMATCH' };
  }
  return { ok: true };
}

export function isMemberInviteToken(value: string): boolean {
  return new RegExp(`^${MEMBER_INVITE_PREFIX}[0-9a-f]{64}$`).test(value);
}

export function isLegacyMemberInviteToken(value: string): boolean {
  return value.startsWith('phm_') || value.startsWith('phm1_');
}

function classifyInviteValue(value: string): MemberInviteLocation {
  const token = value.trim();
  if (!token) return { kind: 'missing' };
  if (isMemberInviteToken(token)) return { kind: 'token', token };
  if (isLegacyMemberInviteToken(token)) return { kind: 'legacy', token };
  return { kind: 'missing' };
}

/**
 * Invite values are captured in memory only. The new URL uses a fragment so
 * browser history and server request logs do not receive the token.
 */
export function parseMemberInviteLocation(input: {
  pathname?: string;
  search?: string;
  hash?: string;
  legacyRouteToken?: string;
}): MemberInviteLocation {
  const hash = new URLSearchParams((input.hash ?? '').replace(/^#/, ''));
  const search = new URLSearchParams((input.search ?? '').replace(/^\?/, ''));
  if (input.legacyRouteToken) return { kind: 'legacy', token: '' };
  if (search.has('invite')) return { kind: 'invalid' };
  const fragmentInvite = hash.get('invite');
  if (fragmentInvite) return classifyInviteValue(fragmentInvite);
  return { kind: 'missing' };
}

export function buildTrustedMemberInviteUrl(token: string, publicWebUrl = 'https://dashboard-phantoms.vercel.app'): string {
  if (!isMemberInviteToken(token)) throw new Error('INVALID_TOKEN');
  const url = new URL(publicWebUrl);
  const explicitLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(explicitLocal && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SERVER_CONFIG');
  }
  return `${url.origin}/join#invite=${token}`;
}

export const MEMBER_AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: 'راجع البريد وكلمة المرور ورمز الدعوة ثم حاول مرة أخرى.',
  INVALID_TOKEN: 'رمز الدعوة غير صالح أو لم يعد متاحاً.',
  WRONG_EMAIL: 'البريد الإلكتروني لا يطابق الدعوة المخصصة لهذا العضو.',
  EXPIRED: 'انتهت صلاحية الدعوة. تواصل مع مسؤول الفريق لإصدار دعوة جديدة.',
  REVOKED: 'تم إلغاء هذه الدعوة. تواصل مع مسؤول الفريق.',
  ALREADY_USED: 'تم استخدام هذه الدعوة من قبل. تواصل مع مسؤول الفريق إذا كنت تحتاج مراجعة.',
  MEMBER_DISABLED: 'هذه العضوية غير مفعّلة حالياً. تواصل مع مسؤول الفريق.',
  MEMBER_NOT_FOUND: 'لم نتمكن من العثور على العضوية المطلوبة.',
  IDENTITY_CONFLICT: 'تعذر مطابقة هوية الحساب مع العضوية. تواصل مع مسؤول الفريق.',
  PASSWORD_ALREADY_SET: 'تم إعداد كلمة مرور لهذا الحساب بالفعل. تواصل مع مسؤول الفريق.',
  PASSWORD_MISMATCH: 'كلمتا المرور غير متطابقتين.',
  WEAK_PASSWORD: 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل، وألا تتجاوز 72 بايتاً بترميز UTF-8، وتحتوي على حرف إنجليزي ورقم.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.',
  SERVER_CONFIG: 'الخدمة غير متاحة حالياً. تواصل مع مسؤول النظام.',
  SERVER_UNAVAILABLE: 'تعذر الوصول لخدمة التسجيل. حاول مرة أخرى لاحقاً.',
  REVIEW_REQUIRED: 'تحتاج هذه الدعوة إلى مراجعة مسؤول الفريق قبل إكمالها.',
  UNAUTHORIZED: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
};

export function memberAuthErrorMessage(code: string, fallback = 'تعذر إكمال العملية. حاول مرة أخرى أو تواصل مع مسؤول الفريق.'): string {
  return MEMBER_AUTH_ERROR_MESSAGES[code] ?? fallback;
}

export function isMemberInviteId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** FunctionsHttpError keeps the safe endpoint JSON on context, not error.code. */
export async function readMemberEndpointCode(value: unknown): Promise<string> {
  if (!value || typeof value !== 'object') return 'SERVER_UNAVAILABLE';
  const row = value as { code?: unknown; context?: unknown };
  if (typeof row.code === 'string' && Object.hasOwn(MEMBER_AUTH_ERROR_MESSAGES, row.code)) return row.code;
  const context = row.context as { clone?: () => { json: () => Promise<unknown> } } | undefined;
  try {
    if (typeof context?.clone === 'function') {
      const body = await context.clone().json();
      if (body && typeof body === 'object') {
        const code = (body as { code?: unknown }).code;
        if (typeof code === 'string' && Object.hasOwn(MEMBER_AUTH_ERROR_MESSAGES, code)) return code;
      }
    }
  } catch {
    // Never display the HTTP response, exception or server-supplied text.
  }
  return 'SERVER_UNAVAILABLE';
}

export function memberPasswordRequirements(): string[] {
  return [
    `${MEMBER_PASSWORD_MIN_LENGTH} حرفاً على الأقل، وحتى ${MEMBER_PASSWORD_MAX_UTF8_BYTES} بايتاً بترميز UTF-8`,
    'حرف إنجليزي واحد على الأقل',
    'رقم واحد على الأقل',
  ];
}

export function generateMemberDeviceToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface MemberPasswordAccess {
  member_id: number;
  email: string;
  auth_user_id: string;
  active: boolean;
  password_ready: boolean;
}

export function parseMemberPasswordAccess(value: unknown): MemberPasswordAccess | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const candidate = row as Record<string, unknown>;
  if (
    typeof candidate.member_id !== 'number'
    || !Number.isSafeInteger(candidate.member_id)
    || typeof candidate.email !== 'string'
    || typeof candidate.auth_user_id !== 'string'
    || typeof candidate.active !== 'boolean'
    || typeof candidate.password_ready !== 'boolean'
  ) return null;
  return {
    member_id: candidate.member_id,
    email: normalizeAuthEmail(candidate.email),
    auth_user_id: candidate.auth_user_id,
    active: candidate.active,
    password_ready: candidate.password_ready,
  };
}
