/**
 * =========================================================================
 * PHANTOMS LocalStorage & Device Session Migration
 * =========================================================================
 * Safely migrates legacy `wasla_*` storage keys to `phantoms_*` keys.
 * 
 * Rules:
 * 1. Checks if new key exists.
 * 2. If absent, reads old key.
 * 3. Writes value to new key.
 * 4. Verifies new value was stored (read-back comparison).
 * 5. Removes old key ONLY after successful verification.
 * 6. Never throws on QuotaExceeded or restricted storage environments.
 * 7. NEVER logs or prints secret/token values.
 * =========================================================================
 */

export const STATIC_KEY_MIGRATION: Record<string, string> = {
  wasla_device_token: 'phantoms_device_token',
  wasla_member_session: 'phantoms_member_session',
  wasla_admin_remember: 'phantoms_admin_remember',
  wasla_member_remember: 'phantoms_member_remember',
  wasla_notif_sound_enabled: 'phantoms_notif_sound_enabled',
  wasla_push_key_fp: 'phantoms_push_key_fp',
  wasla_member_custom_fields_v1: 'phantoms_member_custom_fields_v1',
};

export const PREFIX_KEY_MIGRATION: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^wasla_notif_snapshot_v2_(.+)$/, (m) => `phantoms_notif_snapshot_v2_${m[1]}`],
  [/^wasla_notifications_v2_(.+)$/, (m) => `phantoms_notifications_v2_${m[1]}`],
  [/^wasla_apk_notif_enabled_(.+)$/, (m) => `phantoms_apk_notif_enabled_${m[1]}`],
  [/^wasla_apk_perm_prompted_(.+)$/, (m) => `phantoms_apk_perm_prompted_${m[1]}`],
];

/**
 * Migrates a single key safely with write-verification before deletion.
 */
export function migrateSingleKey(
  oldKey: string,
  newKey: string,
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage),
): boolean {
  if (!storage || typeof storage.getItem !== 'function') return false;

  try {
    const existingNewVal = storage.getItem(newKey);
    const oldVal = storage.getItem(oldKey);

    // If new key already exists, clean up leftover old key safely
    if (existingNewVal !== null) {
      if (oldVal !== null) {
        storage.removeItem(oldKey);
      }
      return true;
    }

    // If old key does not exist, nothing to migrate
    if (oldVal === null) {
      return false;
    }

    // Copy to new key
    storage.setItem(newKey, oldVal);

    // Verify written data matches before removing legacy key
    const verifiedVal = storage.getItem(newKey);
    if (verifiedVal === oldVal) {
      storage.removeItem(oldKey);
      return true;
    }

    return false;
  } catch {
    // Storage quota or security error — keep old key intact so session is never lost
    return false;
  }
}

/**
 * Accessor that prefers newKey but falls back and seamlessly migrates oldKey on the fly.
 */
export function getMigratedStorageItem(
  newKey: string,
  oldKey: string,
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage),
): string | null {
  if (!storage || typeof storage.getItem !== 'function') return null;

  try {
    const newVal = storage.getItem(newKey);
    if (newVal !== null) {
      return newVal;
    }

    const oldVal = storage.getItem(oldKey);
    if (oldVal !== null) {
      // Migrate on the fly
      migrateSingleKey(oldKey, newKey, storage);
      return oldVal;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Runs a complete one-time sweep of all localStorage keys.
 */
export function runLocalStorageMigration(
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage),
): { migrated: string[]; count: number } {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.key !== 'function') {
    return { migrated: [], count: 0 };
  }

  const migrated: string[] = [];

  try {
    // 1. Static keys
    for (const [oldKey, newKey] of Object.entries(STATIC_KEY_MIGRATION)) {
      if (storage.getItem(oldKey) !== null) {
        if (migrateSingleKey(oldKey, newKey, storage)) {
          migrated.push(newKey);
        }
      }
    }

    // 2. Dynamic prefixed keys
    const totalKeys = storage.length;
    const keysToCheck: string[] = [];
    for (let i = 0; i < totalKeys; i++) {
      const k = storage.key(i);
      if (k) keysToCheck.push(k);
    }

    for (const key of keysToCheck) {
      for (const [regex, targetBuilder] of PREFIX_KEY_MIGRATION) {
        const match = key.match(regex);
        if (match) {
          const targetKey = targetBuilder(match);
          if (migrateSingleKey(key, targetKey, storage)) {
            migrated.push(targetKey);
          }
          break;
        }
      }
    }
  } catch {
    // Silent catch — never block application bootstrap
  }

  return { migrated, count: migrated.length };
}
