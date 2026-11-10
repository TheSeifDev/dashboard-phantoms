// =====================================================
// مخزن الجلسة — مصدر واحد للحقيقة: supabase.auth
//
// سابقاً كانت الجلسة تُحفظ في مفتاح localStorage مخصص بالتوازي مع تخزين supabase-js نفسه،
// فكان النسختان تنفصلان بعد أول تجديد Token — هنا نعتمد supabase.auth كمصدر وحيد ونرصد أحداثه.
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

/** هل العضو اختار الحفظ الدائم؟ الافتراضي نعم للحفاظ على السلوك الحالي */
export const getMemberRemember = (): boolean => {
  try {
    const primary = localStorage.getItem(MEMBER_REMEMBER_KEY);
    if (primary !== null) return primary !== '0';
    return true;
  } catch {
    return true;
  }
};

export const setMemberRemember = (remember: boolean): void => {
  try {
    localStorage.setItem(MEMBER_REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    // ignore
  }
};

/** هل الإدارة اختارت الحفظ الدائم؟ الافتراضي نعم */
export const getAdminRemember = (): boolean => {
  try {
    const primary = localStorage.getItem(ADMIN_REMEMBER_KEY);
    if (primary !== null) return primary !== '0';
    return true;
  } catch {
    return true;
  }
};

export const setAdminRemember = (remember: boolean): void => {
  try {
    localStorage.setItem(ADMIN_REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    // ignore
  }
};

function readFromBoth(key: string): string | null {
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
  return null;
}

function writeByRemember(key: string, value: string, remember: boolean): void {
  try {
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
}

function removeFromBoth(key: string): void {
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
}

/** رمز الجهاز لهذا المتصفح — إثبات ملكية سجل العضو في RPCs العضوية */
export const getDeviceToken = (): string | null => {
  try {
    const raw = readFromBoth(DEVICE_TOKEN_KEY);
    if (!raw || raw.length > 128) return null;
    return raw;
  } catch {
    return null;
  }
};

export const setDeviceToken = (token: string, remember?: boolean): void => {
  try {
    if (!token || token.length > 128) return;
    writeByRemember(DEVICE_TOKEN_KEY, token, remember ?? getMemberRemember());
  } catch {
    // ignore
  }
};

export const clearDeviceToken = (): void => {
  removeFromBoth(DEVICE_TOKEN_KEY);
};

const getInitialMember = (): Member | null => {
  try {
    const raw = readFromBoth(SAVED_MEMBER_KEY);
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
    // رمز الجهاز يعيش في مفتاح مستقل (phantoms_device_token) ويُمرر لكل RPC عضوية.
    // remember=false تعني sessionStorage (تُمسح مع قفل التاب) — remember=true تعني localStorage.
    const sanitized = member ? ({ ...member, session_token: null } as Member) : null;
    const wantRemember = remember ?? getMemberRemember();

    if (sanitized) {
      writeByRemember(SAVED_MEMBER_KEY, JSON.stringify(sanitized), wantRemember);
    } else {
      removeFromBoth(SAVED_MEMBER_KEY);
    }
    set({ currentMember: sanitized });
  },
  logoutMember: () => {
    removeFromBoth(SAVED_MEMBER_KEY);
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
