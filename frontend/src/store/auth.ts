// =====================================================
// مخزن الجلسة — مصدر واحد للحقيقة: supabase.auth
//
// سابقاً كانت الجلسة تُحفظ في مفتاح localStorage خاص (wasla_admin_session)
// بالتوازي مع تخزين supabase-js نفسه، فكان النسختان تنفصلان بعد أول
// تجديد Token — هنا نعتمد supabase.auth كمصدر وحيد ونرصد أحداثه.
//
// بوابة الأعضاء تبقى جلسة عميل (passwordless) كما في المخطط §8.1 —
// ترقيتها لـ Magic Link مدرجة في المرحلة 3 (Post-MVP).
// =====================================================
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import type { Member } from '../types/db';
import { supabase } from '../lib/supabase/client';

interface AuthState {
  // Admin State
  user: User | null;
  session: Session | null;
  /** true عند اكتمال فحص الجلسة الأولي — يمنع وميض إعادة التوجيه */
  ready: boolean;
  setSession: (session: Session | null) => void;
  setReady: () => void;
  clear: () => void;

  // Member Portal State
  currentMember: Member | null;
  setMember: (member: Member | null, remember?: boolean) => void;
  logoutMember: () => void;
}

const SAVED_MEMBER_KEY = 'phantoms_member_session';
const DEVICE_TOKEN_KEY = 'phantoms_device_token';
const MEMBER_REMEMBER_KEY = 'phantoms_member_remember';
const ADMIN_REMEMBER_KEY = 'phantoms_admin_remember';

const LEGACY_SAVED_MEMBER_KEY = 'wasla_member_session';
const LEGACY_DEVICE_TOKEN_KEY = 'wasla_device_token';
const LEGACY_MEMBER_REMEMBER_KEY = 'wasla_member_remember';
const LEGACY_ADMIN_REMEMBER_KEY = 'wasla_admin_remember';

/** هل العضو اختار الحفظ الدائم؟ الافتراضي نعم للحفاظ على السلوك الحالي */
export const getMemberRemember = (): boolean => {
  try {
    const primary = localStorage.getItem(MEMBER_REMEMBER_KEY);
    if (primary !== null) return primary !== '0';
    return localStorage.getItem(LEGACY_MEMBER_REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
};

export const setMemberRemember = (remember: boolean): void => {
  try {
    localStorage.setItem(MEMBER_REMEMBER_KEY, remember ? '1' : '0');
    try {
      localStorage.removeItem(LEGACY_MEMBER_REMEMBER_KEY);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
};

/** هل الإدارة اختارت الحفظ الدائم؟ الافتراضي نعم */
export const getAdminRemember = (): boolean => {
  try {
    const primary = localStorage.getItem(ADMIN_REMEMBER_KEY);
    if (primary !== null) return primary !== '0';
    return localStorage.getItem(LEGACY_ADMIN_REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
};

export const setAdminRemember = (remember: boolean): void => {
  try {
    localStorage.setItem(ADMIN_REMEMBER_KEY, remember ? '1' : '0');
    try {
      localStorage.removeItem(LEGACY_ADMIN_REMEMBER_KEY);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
};

function readFromBoth(key: string, legacyKey?: string): string | null {
  try {
    const s = sessionStorage.getItem(key);
    if (s !== null) return s;
  } catch {
    // ignore
  }
  try {
    const l = localStorage.getItem(key);
    if (l !== null) return l;
  } catch {
    // ignore
  }

  // Fallback to legacy key and perform on-the-fly migration
  if (legacyKey) {
    try {
      const legacySession = sessionStorage.getItem(legacyKey);
      if (legacySession !== null) {
        sessionStorage.setItem(key, legacySession);
        try { sessionStorage.removeItem(legacyKey); } catch {}
        return legacySession;
      }
    } catch {
      // ignore
    }
    try {
      const legacyLocal = localStorage.getItem(legacyKey);
      if (legacyLocal !== null) {
        localStorage.setItem(key, legacyLocal);
        try { localStorage.removeItem(legacyKey); } catch {}
        return legacyLocal;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function writeByRemember(key: string, value: string, remember: boolean, legacyKey?: string): void {
  try {
    if (remember) {
      localStorage.setItem(key, value);
      try {
        sessionStorage.removeItem(key);
        if (legacyKey) {
          localStorage.removeItem(legacyKey);
          sessionStorage.removeItem(legacyKey);
        }
      } catch {
        // ignore
      }
    } else {
      sessionStorage.setItem(key, value);
      try {
        localStorage.removeItem(key);
        if (legacyKey) {
          localStorage.removeItem(legacyKey);
          sessionStorage.removeItem(legacyKey);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function removeFromBoth(key: string, legacyKey?: string): void {
  try {
    localStorage.removeItem(key);
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(key);
    if (legacyKey) sessionStorage.removeItem(legacyKey);
  } catch {
    // ignore
  }
}

/** رمز الجهاز لهذا المتصفح — إثبات ملكية سجل العضو في RPCs العضوية */
export const getDeviceToken = (): string | null => {
  try {
    const raw = readFromBoth(DEVICE_TOKEN_KEY, LEGACY_DEVICE_TOKEN_KEY);
    if (!raw || raw.length > 128) return null;
    return raw;
  } catch {
    return null;
  }
};

export const setDeviceToken = (token: string, remember?: boolean): void => {
  try {
    if (!token || token.length > 128) return;
    writeByRemember(DEVICE_TOKEN_KEY, token, remember ?? getMemberRemember(), LEGACY_DEVICE_TOKEN_KEY);
  } catch {
    // ignore
  }
};

export const clearDeviceToken = (): void => {
  removeFromBoth(DEVICE_TOKEN_KEY, LEGACY_DEVICE_TOKEN_KEY);
};

const getInitialMember = (): Member | null => {
  try {
    const raw = readFromBoth(SAVED_MEMBER_KEY, LEGACY_SAVED_MEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Member;
    // إزالة token من التخزين المحلي لتقليل أثر سرقة الجلسة عبر XSS/الامتدادات
    if (parsed && 'session_token' in parsed) {
      (parsed as Member).session_token = null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  ready: false,
  setSession: (session) =>
    set({ session, user: session?.user ?? null, ready: true }),
  setReady: () => set({ ready: true }),
  clear: () => set({ session: null, user: null, ready: true }),

  currentMember: getInitialMember(),
  setMember: (member, remember?: boolean) => {
    // لا نحتفظ بـ session_token في أي تخزين أو state لتقليل سطح الهجوم.
    // رمز الجهاز يعيش في مفتاح مستقل (phantoms_device_token مع دعم التوافق wasla_device_token) ويُمرر لكل RPC عضوية.
    // remember=false تعني sessionStorage (تُمسح مع قفل التاب) — remember=true تعني localStorage.
    const sanitized = member ? ({ ...member, session_token: null } as Member) : null;
    const wantRemember = remember ?? getMemberRemember();

    if (sanitized) {
      writeByRemember(SAVED_MEMBER_KEY, JSON.stringify(sanitized), wantRemember, LEGACY_SAVED_MEMBER_KEY);
    } else {
      removeFromBoth(SAVED_MEMBER_KEY, LEGACY_SAVED_MEMBER_KEY);
    }
    set({ currentMember: sanitized });
  },
  logoutMember: () => {
    removeFromBoth(SAVED_MEMBER_KEY, LEGACY_SAVED_MEMBER_KEY);
    clearDeviceToken();
    set({ currentMember: null });
  },
}));

// ---- المزامنة مع supabase.auth (المصدر الوحيد) ----
// الفحص الأولي ثم رصد كل الأحداث (SIGN_IN / TOKEN_REFRESHED / SIGNED_OUT)
supabase.auth.getSession().then(({ data }) => {
  useAuthStore.getState().setSession(data.session);
});

supabase.auth.onAuthStateChange((_event, session) => {
  const state = useAuthStore.getState();
  state.setSession(session);
});
