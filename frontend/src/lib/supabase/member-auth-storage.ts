/** Deliberately independent from the admin `sb-*` namespace. */
export const MEMBER_AUTH_STORAGE_KEY = 'phantoms-member-auth';
export const MEMBER_REMEMBER_KEY = 'phantoms_member_remember';

export interface MemberStoragePair {
  local: Storage | null;
  session: Storage | null;
}

export interface MemberRememberTransition {
  ok: boolean;
  migrated: boolean;
  requiresReauthentication: boolean;
}

const unavailableStorage = (): Storage | null => null;

function browserStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    const value = globalThis[name];
    return value && typeof value.getItem === 'function' ? value : unavailableStorage();
  } catch {
    return unavailableStorage();
  }
}

export function getMemberStoragePair(): MemberStoragePair {
  return {
    local: browserStorage('localStorage'),
    session: browserStorage('sessionStorage'),
  };
}

function read(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeAndVerify(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    return false;
  }
}

function remove(storage: Storage | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

function removeIfUnchanged(storage: Storage | null, key: string, expected: string): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(key) !== expected) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

/**
 * The preference is shared in localStorage. A missing marker retains the
 * historical durable default, but an inaccessible store fails closed to
 * temporary mode so an unknown preference cannot restore a durable session.
 */
export function getMemberRemember(storage: Storage | null = getMemberStoragePair().local): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MEMBER_REMEMBER_KEY) !== '0';
  } catch {
    return false;
  }
}

/**
 * Move only the Supabase member Auth value between the two browser stores.
 * The destination is verified before the old copy is removed. A failed or
 * ambiguous transition never silently leaves a usable persistent member copy
 * as the temporary-mode fallback.
 */
export function transitionMemberRemember(
  remember: boolean,
  stores: MemberStoragePair = getMemberStoragePair(),
): MemberRememberTransition {
  const { local, session } = stores;
  const persistent = read(local, MEMBER_AUTH_STORAGE_KEY);
  const temporary = read(session, MEMBER_AUTH_STORAGE_KEY);

  if (remember) {
    let migrated = false;
    if (temporary !== null) {
      if (!writeAndVerify(local, MEMBER_AUTH_STORAGE_KEY, temporary)) {
        // Keep no newly-created persistent value if the reverse migration is
        // only partially complete. The existing temporary copy is harmless.
        removeIfUnchanged(local, MEMBER_AUTH_STORAGE_KEY, temporary);
        return { ok: false, migrated: false, requiresReauthentication: true };
      }
      migrated = true;
      if (!removeIfUnchanged(session, MEMBER_AUTH_STORAGE_KEY, temporary)) {
        // localStorage is now verified, but a stale temporary copy could not
        // be removed. Reauthentication is safer than claiming a clean switch.
        return { ok: false, migrated: true, requiresReauthentication: true };
      }
    }

    if (!writeAndVerify(local, MEMBER_REMEMBER_KEY, '1')) {
      return { ok: false, migrated, requiresReauthentication: true };
    }
    return { ok: true, migrated, requiresReauthentication: false };
  }

  let migrated = false;
  if (persistent !== null) {
    if (!writeAndVerify(session, MEMBER_AUTH_STORAGE_KEY, persistent)) {
      // Where possible, destroy the old durable copy rather than allowing a
      // later temporary-mode read to resurrect it. Only the member Auth key is
      // touched here; admin and application keys remain intact.
      removeIfUnchanged(local, MEMBER_AUTH_STORAGE_KEY, persistent);
      return { ok: false, migrated: false, requiresReauthentication: true };
    }
    migrated = true;
    if (!removeIfUnchanged(local, MEMBER_AUTH_STORAGE_KEY, persistent)) {
      // Temporary reads never consult localStorage, but a failed cleanup is an
      // incomplete transition and must not be hidden from the UI.
      return { ok: false, migrated, requiresReauthentication: true };
    }
  }

  if (!writeAndVerify(local, MEMBER_REMEMBER_KEY, '0')) {
    // If the marker cannot be persisted, remove the old durable copy when it
    // is still present. The caller will revoke the in-memory member session.
    if (persistent !== null) removeIfUnchanged(local, MEMBER_AUTH_STORAGE_KEY, persistent);
    return { ok: false, migrated, requiresReauthentication: true };
  }

  return { ok: true, migrated, requiresReauthentication: false };
}

/**
 * Storage adapter used by the member Supabase client. Temporary mode is
 * deliberately session-only; it never falls back to localStorage.
 */
export const memberAuthStorage: Storage = {
  get length() {
    const stores = getMemberStoragePair();
    return read(stores.local, MEMBER_AUTH_STORAGE_KEY) !== null
      || read(stores.session, MEMBER_AUTH_STORAGE_KEY) !== null
      ? 1
      : 0;
  },
  clear() {
    // Supabase only needs getItem/setItem/removeItem. Never clear app storage.
  },
  getItem(key: string): string | null {
    const stores = getMemberStoragePair();
    if (!getMemberRemember(stores.local)) {
      return read(stores.session, key);
    }
    return read(stores.local, key) ?? read(stores.session, key);
  },
  key(index: number): string | null {
    if (index !== 0) return null;
    return this.length === 1 ? MEMBER_AUTH_STORAGE_KEY : null;
  },
  removeItem(key: string): void {
    const stores = getMemberStoragePair();
    remove(stores.local, key);
    remove(stores.session, key);
  },
  setItem(key: string, value: string): void {
    const stores = getMemberStoragePair();
    const remember = getMemberRemember(stores.local);
    const destination = remember ? stores.local : stores.session;
    const stale = remember ? stores.session : stores.local;

    if (!writeAndVerify(destination, key, value)) {
      throw new Error('Member authentication storage is unavailable');
    }
    const staleValue = read(stale, key);
    if (staleValue !== null && !remove(stale, key)) {
      throw new Error('Member authentication storage cleanup is unavailable');
    }
  },
};
