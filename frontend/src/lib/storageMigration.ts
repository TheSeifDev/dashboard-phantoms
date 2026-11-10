/**
 * =========================================================================
 * PHANTOMS LocalStorage & Device Session Management
 * =========================================================================
 * Safely manages storage keys and provides migration utilities for PHANTOMS.
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

export const STATIC_KEY_MIGRATION: Record<string, string> = {};

export const PREFIX_KEY_MIGRATION: [RegExp, (match: RegExpMatchArray) => string][] = [];

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
 * Runs a complete one-time sweep of storage keys according to defined migration tables.
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
