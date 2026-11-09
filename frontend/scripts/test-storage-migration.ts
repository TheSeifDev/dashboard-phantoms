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
  await t.test('1. Static keys migration: writes new key and removes legacy key upon verification', () => {
    const mock = createMockStorage({
      wasla_device_token: 'secret-token-xyz-123',
      wasla_member_session: JSON.stringify({ id: 101, full_name: 'أحمد علي' }),
      wasla_admin_remember: '1',
      wasla_member_remember: '0',
      wasla_notif_sound_enabled: '1',
      wasla_push_key_fp: 'fp_abc123456',
      wasla_member_custom_fields_v1: JSON.stringify([{ id: 1, label: 'الفرع' }]),
    });

    const res = runLocalStorageMigration(mock);
    assert.equal(res.count, 7);

    // Verify all new keys exist with exact values
    assert.equal(mock.getItem('phantoms_device_token'), 'secret-token-xyz-123');
    assert.equal(JSON.parse(mock.getItem('phantoms_member_session')!).id, 101);
    assert.equal(mock.getItem('phantoms_admin_remember'), '1');
    assert.equal(mock.getItem('phantoms_member_remember'), '0');
    assert.equal(mock.getItem('phantoms_notif_sound_enabled'), '1');
    assert.equal(mock.getItem('phantoms_push_key_fp'), 'fp_abc123456');

    // Verify all legacy keys were cleanly removed
    assert.equal(mock.getItem('wasla_device_token'), null);
    assert.equal(mock.getItem('wasla_member_session'), null);
    assert.equal(mock.getItem('wasla_admin_remember'), null);
    assert.equal(mock.getItem('wasla_member_remember'), null);
    assert.equal(mock.getItem('wasla_notif_sound_enabled'), null);
    assert.equal(mock.getItem('wasla_push_key_fp'), null);
    assert.equal(mock.getItem('wasla_member_custom_fields_v1'), null);
  });

  await t.test('2. Dynamic member-prefixed keys migration', () => {
    const mock = createMockStorage({
      wasla_notif_snapshot_v2_101: JSON.stringify({ initialized: true, taskStates: { '1': 'done' } }),
      wasla_notifications_v2_101: JSON.stringify([{ id: 'n1', title: 'مهمة جديدة' }]),
      wasla_apk_notif_enabled_101: '1',
      wasla_apk_perm_prompted_101: '1',
      wasla_notifications_v2_202: JSON.stringify([{ id: 'n2', title: 'تقييم' }]),
    });

    const res = runLocalStorageMigration(mock);
    assert.equal(res.count, 5);

    assert.ok(mock.getItem('phantoms_notif_snapshot_v2_101')!.includes('initialized'));
    assert.ok(mock.getItem('phantoms_notifications_v2_101')!.includes('مهمة جديدة'));
    assert.equal(mock.getItem('phantoms_apk_notif_enabled_101'), '1');
    assert.equal(mock.getItem('phantoms_apk_perm_prompted_101'), '1');
    assert.ok(mock.getItem('phantoms_notifications_v2_202')!.includes('تقييم'));

    // Old dynamic keys gone
    assert.equal(mock.getItem('wasla_notif_snapshot_v2_101'), null);
    assert.equal(mock.getItem('wasla_notifications_v2_101'), null);
    assert.equal(mock.getItem('wasla_apk_notif_enabled_101'), null);
    assert.equal(mock.getItem('wasla_apk_perm_prompted_101'), null);
    assert.equal(mock.getItem('wasla_notifications_v2_202'), null);
  });

  await t.test('3. Idempotency: does not overwrite existing PHANTOMS key', () => {
    const mock = createMockStorage({
      phantoms_device_token: 'new-valid-token',
      wasla_device_token: 'old-stale-token',
    });

    const success = migrateSingleKey('wasla_device_token', 'phantoms_device_token', mock);
    assert.equal(success, true);
    // Value remains the new one
    assert.equal(mock.getItem('phantoms_device_token'), 'new-valid-token');
    // Old key cleaned up
    assert.equal(mock.getItem('wasla_device_token'), null);
  });

  await t.test('4. On-the-fly accessor: getMigratedStorageItem migrates transparently', () => {
    const mock = createMockStorage({
      wasla_device_token: 'device-token-abc-999',
    });

    // Access using new key
    const val = getMigratedStorageItem('phantoms_device_token', 'wasla_device_token', mock);
    assert.equal(val, 'device-token-abc-999');

    // Key is now migrated in mock
    assert.equal(mock.getItem('phantoms_device_token'), 'device-token-abc-999');
    assert.equal(mock.getItem('wasla_device_token'), null);
  });

  await t.test('5. Error safety: preserves old key if setItem throws (quota exceeded)', () => {
    const errorStorage = {
      getItem(key: string): string | null {
        return key === 'wasla_device_token' ? 'critical-session-token' : null;
      },
      setItem(_key: string, _val: string): void {
        throw new Error('QuotaExceededError');
      },
      removeItem(_key: string): void {
        throw new Error('Should not be called if write failed');
      },
    } as unknown as Storage;

    const migrated = migrateSingleKey('wasla_device_token', 'phantoms_device_token', errorStorage);
    assert.equal(migrated, false);
    // Old token was NOT lost
    assert.equal(errorStorage.getItem('wasla_device_token'), 'critical-session-token');
  });
});

