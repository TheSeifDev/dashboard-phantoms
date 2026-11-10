import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateSingleKey,
  getMigratedStorageItem,
  runLocalStorageMigration,
} from '../src/lib/storageMigration';

// In-memory mock of Web Storage
function createMockStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));

  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    get length(): number {
      return store.size;
    },
    _raw(): Record<string, string> {
      return Object.fromEntries(store.entries());
    },
  } as unknown as Storage;
}

test('PHANTOMS LocalStorage Compatibility Migration Suite', async (t) => {
  await t.test('1. Single key migration: writes new key and removes old key upon verification', () => {
    const mock = createMockStorage({
      mock_legacy_token: 'secret-token-xyz-123',
    });

    const success = migrateSingleKey('mock_legacy_token', 'phantoms_device_token', mock);
    assert.equal(success, true);

    // Verify new key exists with exact value
    assert.equal(mock.getItem('phantoms_device_token'), 'secret-token-xyz-123');
    // Verify old key was cleanly removed
    assert.equal(mock.getItem('mock_legacy_token'), null);
  });

  await t.test('2. Idempotency: does not overwrite existing PHANTOMS key', () => {
    const mock = createMockStorage({
      phantoms_device_token: 'new-valid-token',
      mock_stale_token: 'old-stale-token',
    });

    const success = migrateSingleKey('mock_stale_token', 'phantoms_device_token', mock);
    assert.equal(success, true);
    // Value remains the new one
    assert.equal(mock.getItem('phantoms_device_token'), 'new-valid-token');
    // Old key cleaned up
    assert.equal(mock.getItem('mock_stale_token'), null);
  });

  await t.test('3. On-the-fly accessor: getMigratedStorageItem migrates transparently', () => {
    const mock = createMockStorage({
      mock_legacy_item: 'device-token-abc-999',
    });

    // Access using new key with fallback
    const val = getMigratedStorageItem('phantoms_device_token', 'mock_legacy_item', mock);
    assert.equal(val, 'device-token-abc-999');

    // Key is now migrated in mock
    assert.equal(mock.getItem('phantoms_device_token'), 'device-token-abc-999');
    assert.equal(mock.getItem('mock_legacy_item'), null);
  });

  await t.test('4. Error safety: preserves old key if setItem throws (quota exceeded)', () => {
    const errorStorage = {
      getItem(key: string): string | null {
        return key === 'critical_key' ? 'critical-session-token' : null;
      },
      setItem(_key: string, _val: string): void {
        throw new Error('QuotaExceededError');
      },
      removeItem(_key: string): void {
        throw new Error('Should not be called if write failed');
      },
    } as unknown as Storage;

    const migrated = migrateSingleKey('critical_key', 'phantoms_device_token', errorStorage);
    assert.equal(migrated, false);
    // Old token was NOT lost
    assert.equal(errorStorage.getItem('critical_key'), 'critical-session-token');
  });

  await t.test('5. Empty sweep: runLocalStorageMigration runs without error', () => {
    const mock = createMockStorage({
      phantoms_device_token: 'token-1',
    });

    const res = runLocalStorageMigration(mock);
    assert.equal(res.count, 0);
    assert.equal(mock.getItem('phantoms_device_token'), 'token-1');
  });
});
