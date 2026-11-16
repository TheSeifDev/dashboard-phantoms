import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/db';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  ?? 'placeholder-anon-key';

/** Deliberately not an `sb-` key: admin storage migration must never touch member auth. */
export const MEMBER_AUTH_STORAGE_KEY = 'phantoms-member-auth';
const MEMBER_REMEMBER_KEY = 'phantoms_member_remember';

const memberStorage: Storage = {
  get length() {
    try {
      return localStorage.length + sessionStorage.length;
    } catch {
      return 0;
    }
  },
  clear() {
    // Supabase only uses getItem/setItem/removeItem; avoid clearing unrelated app data.
  },
  getItem(key: string): string | null {
    try {
      const remember = localStorage.getItem(MEMBER_REMEMBER_KEY) !== '0';
      return remember
        ? localStorage.getItem(key) ?? sessionStorage.getItem(key)
        : sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  key(index: number): string | null {
    try {
      return localStorage.key(index) ?? sessionStorage.key(index);
    } catch {
      return null;
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore unavailable browser storage.
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore unavailable browser storage.
    }
  },
  setItem(key: string, value: string): void {
    try {
      const remember = localStorage.getItem(MEMBER_REMEMBER_KEY) !== '0';
      if (remember) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore unavailable browser storage; Supabase will surface auth failures normally.
    }
  },
};

export const memberSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: MEMBER_AUTH_STORAGE_KEY,
    storage: memberStorage,
  },
});
