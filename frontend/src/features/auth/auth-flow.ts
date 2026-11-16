export type AdminSetupIntent = 'invite' | 'recovery';
export const MEMBER_OTP_LENGTH = 8;

export const ADMIN_SETUP_INTENT_STORAGE_KEY = 'phantoms_admin_setup_intent';
export const ADMIN_SETUP_INTENT_TTL_MS = 10 * 60 * 1000;

export interface AdminSetupIntentMarker {
  intent: AdminSetupIntent;
  userId: string;
  expiresAt: number;
}

export type AdminCallbackInput =
  | { kind: 'none'; key: string }
  | { kind: 'callback'; key: string; intent: AdminSetupIntent; code?: string; accessToken?: string; refreshToken?: string }
  | { kind: 'invalid'; key: string; message: string };

const callbackPath = (pathname: string): AdminSetupIntent | null => {
  if (pathname === '/admin/recovery/callback') return 'recovery';
  return null;
};

const isSetupPath = (pathname: string): boolean =>
  pathname === '/admin/set-password' || pathname === '/' || pathname === '/admin/recovery/callback';

const getParam = (search: URLSearchParams, hash: URLSearchParams, name: string): string | null =>
  hash.get(name) ?? search.get(name);

const callbackFingerprint = (value: string): string => {
  // Keep callback material out of the in-memory dedupe key and anything that might be inspected.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function createSingleFlight<TKey, TValue>() {
  const pending = new Map<TKey, Promise<TValue>>();

  return {
    run(key: TKey, task: () => Promise<TValue>): Promise<TValue> {
      const existing = pending.get(key);
      if (existing) return existing;

      const promise = Promise.resolve().then(task);
      pending.set(key, promise);
      const cleanup = () => {
        if (pending.get(key) === promise) pending.delete(key);
      };
      // Attach both handlers so cleanup never creates an unhandled rejection.
      void promise.then(cleanup, cleanup);
      return promise;
    },
  };
}

/**
 * Reads callback material without allowing Supabase to auto-consume arbitrary URLs.
 * Tokens are returned only for immediate in-memory exchange; callers must not log or persist them.
 */
export function inspectAdminCallback(
  pathname: string,
  searchText: string,
  hashText: string,
): AdminCallbackInput {
  const search = new URLSearchParams(searchText.startsWith('?') ? searchText.slice(1) : searchText);
  const hash = new URLSearchParams(hashText.startsWith('#') ? hashText.slice(1) : hashText);
  const type = getParam(search, hash, 'type');
  const code = getParam(search, hash, 'code');
  const accessToken = getParam(search, hash, 'access_token');
  const refreshToken = getParam(search, hash, 'refresh_token');
  const error = getParam(search, hash, 'error') ?? getParam(search, hash, 'error_code');
  const hasCallbackMaterial = Boolean(type || code || accessToken || refreshToken || error);
  const key = `${pathname}|${callbackFingerprint(`${searchText}\u0000${hashText}`)}`;

  if (!hasCallbackMaterial) return { kind: 'none', key };
  if (!isSetupPath(pathname)) {
    return { kind: 'invalid', key, message: 'الرابط ده مش رابط دعوة أو استعادة كلمة مرور صالح.' };
  }
  if (error) {
    return { kind: 'invalid', key, message: 'رابط الدعوة أو الاستعادة فشل. اطلب رابطاً جديداً وحاول مرة أخرى.' };
  }

  const routeIntent = callbackPath(pathname);
  const hashIntent = type === 'invite' || type === 'recovery' ? type : null;
  const intent = routeIntent ?? hashIntent ?? (pathname === '/admin/set-password' && code ? 'invite' : null);

  if (type && !hashIntent) {
    return { kind: 'invalid', key, message: 'نوع رابط الدخول غير مدعوم هنا. استخدم رابط الإدارة المخصص.' };
  }
  if (routeIntent === 'recovery' && hashIntent && hashIntent !== 'recovery') {
    return { kind: 'invalid', key, message: 'رابط الدعوة لا يمكن استخدامه كاستعادة لكلمة المرور.' };
  }
  if (!intent || (!code && !(accessToken && refreshToken))) {
    return { kind: 'invalid', key, message: 'الرابط ناقص أو انتهت صلاحيته. اطلب رابطاً جديداً وحاول مرة أخرى.' };
  }

  return {
    kind: 'callback',
    key,
    intent,
    ...(code ? { code } : {}),
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

export const isValidMemberOtp = (value: string): boolean => value.length === MEMBER_OTP_LENGTH && /^\d+$/.test(value);

export const normalizeAuthEmail = (value: string): string => value.trim().toLowerCase();

export const safeMemberAuthError = (operation: 'send' | 'verify' | 'member'): string => {
  if (operation === 'send') return 'تعذر إرسال رمز التحقق. تأكد من البريد وحاول مرة أخرى.';
  if (operation === 'verify') return 'رمز التحقق غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً وحاول مرة أخرى.';
  return 'تم التحقق من البريد، لكن الحساب غير مسجل كعضو في الفريق.';
};

export const readAdminSetupIntent = (currentUserId: string | null, now = Date.now()): AdminSetupIntent | null => {
  try {
    const raw = sessionStorage.getItem(ADMIN_SETUP_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as Partial<AdminSetupIntentMarker>;
    if (
      (marker.intent !== 'invite' && marker.intent !== 'recovery')
      || typeof marker.userId !== 'string'
      || marker.userId.length === 0
      || marker.userId.length > 256
      || marker.userId !== currentUserId
      || typeof marker.expiresAt !== 'number'
      || !Number.isSafeInteger(marker.expiresAt)
      || marker.expiresAt <= now
    ) {
      sessionStorage.removeItem(ADMIN_SETUP_INTENT_STORAGE_KEY);
      return null;
    }
    return marker.intent;
  } catch {
    try {
      sessionStorage.removeItem(ADMIN_SETUP_INTENT_STORAGE_KEY);
    } catch {
      // Ignore unavailable browser storage.
    }
    return null;
  }
};

export const writeAdminSetupIntent = (intent: AdminSetupIntent, userId: string, now = Date.now()): void => {
  try {
    if (!userId || userId.length > 256) return;
    const marker: AdminSetupIntentMarker = {
      intent,
      userId,
      expiresAt: now + ADMIN_SETUP_INTENT_TTL_MS,
    };
    sessionStorage.setItem(ADMIN_SETUP_INTENT_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // A callback can still be completed in this tab if sessionStorage is unavailable.
  }
};

export const clearAdminSetupIntent = (): void => {
  try {
    sessionStorage.removeItem(ADMIN_SETUP_INTENT_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
};
