import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_AUTH_STORAGE_KEY,
  MEMBER_REMEMBER_KEY,
  memberAuthStorage,
  transitionMemberRemember,
  type MemberStoragePair,
} from '../src/lib/supabase/member-auth-storage';

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();
  failWrites = false;
  failRemoves = false;

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void {
    if (this.failRemoves) throw new Error('remove blocked');
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('write blocked');
    this.values.set(key, String(value));
  }
}

function pair(
  local: Record<string, string> = {},
  session: Record<string, string> = {},
): MemberStoragePair & { local: FakeStorage; session: FakeStorage } {
  return { local: new FakeStorage(local), session: new FakeStorage(session) };
}

function withBrowserStorage<T>(
  local: Storage,
  session: Storage,
  callback: () => T,
): T {
  const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
  try {
    return callback();
  } finally {
    if (localDescriptor) Object.defineProperty(globalThis, 'localStorage', localDescriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
    if (sessionDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionDescriptor);
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
}

test('temporary member reads never restore an old persistent Auth copy', () => {
  const stores = pair({
    [MEMBER_REMEMBER_KEY]: '0',
    [MEMBER_AUTH_STORAGE_KEY]: 'old-local-session',
  });

  withBrowserStorage(stores.local, stores.session, () => {
    assert.equal(memberAuthStorage.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  });

  // A reload-like empty sessionStorage has the same safe result.
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), 'old-local-session');
});

test('an unreadable preference fails closed even when the persistent Auth key is readable', () => {
  const stores = pair({
    [MEMBER_REMEMBER_KEY]: '0',
    [MEMBER_AUTH_STORAGE_KEY]: 'must-not-restore',
  });
  const read = stores.local.getItem.bind(stores.local);
  stores.local.getItem = (key) => {
    if (key === MEMBER_REMEMBER_KEY) throw new Error('preference read blocked');
    return read(key);
  };
  withBrowserStorage(stores.local, stores.session, () => {
    assert.equal(memberAuthStorage.getItem(MEMBER_AUTH_STORAGE_KEY), null);
    stores.session.setItem(MEMBER_AUTH_STORAGE_KEY, 'temporary-only');
    assert.equal(memberAuthStorage.getItem(MEMBER_AUTH_STORAGE_KEY), 'temporary-only');
  });
});

test('fresh temporary login writes only the session store', () => {
  const stores = pair({ [MEMBER_REMEMBER_KEY]: '0' });
  withBrowserStorage(stores.local, stores.session, () => {
    memberAuthStorage.setItem(MEMBER_AUTH_STORAGE_KEY, 'fresh-session');
  });
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), 'fresh-session');
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), null);
});

test('remember-off transition verifies the temporary write before deleting persistence', () => {
  const stores = pair({
    [MEMBER_REMEMBER_KEY]: '1',
    [MEMBER_AUTH_STORAGE_KEY]: 'live-member-session',
  });

  const result = transitionMemberRemember(false, stores);
  assert.deepEqual(result, { ok: true, migrated: true, requiresReauthentication: false });
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), 'live-member-session');
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  assert.equal(stores.local.getItem(MEMBER_REMEMBER_KEY), '0');
});

test('failed temporary write removes the old member copy and requires reauthentication', () => {
  const stores = pair({
    [MEMBER_REMEMBER_KEY]: '1',
    [MEMBER_AUTH_STORAGE_KEY]: 'member-session-that-must-not-return',
  });
  stores.session.failWrites = true;
  stores.local.setItem('phantoms_admin_auth', 'independent-admin-session');

  const result = transitionMemberRemember(false, stores);
  assert.equal(result.ok, false);
  assert.equal(result.requiresReauthentication, true);
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  assert.equal(stores.local.getItem('phantoms_admin_auth'), 'independent-admin-session');
});

test('inaccessible remember preference does not silently keep a durable member session', () => {
  const stores = pair({
    [MEMBER_REMEMBER_KEY]: '1',
    [MEMBER_AUTH_STORAGE_KEY]: 'member-session-without-preference',
  });
  stores.local.failWrites = true;

  const result = transitionMemberRemember(false, stores);
  assert.equal(result.ok, false);
  assert.equal(result.requiresReauthentication, true);
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), null);
});

test('reverse transition moves only the temporary member Auth session to persistence', () => {
  const stores = pair(
    { [MEMBER_REMEMBER_KEY]: '0' },
    { [MEMBER_AUTH_STORAGE_KEY]: 'temporary-member-session' },
  );

  const result = transitionMemberRemember(true, stores);
  assert.deepEqual(result, { ok: true, migrated: true, requiresReauthentication: false });
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), 'temporary-member-session');
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  assert.equal(stores.local.getItem(MEMBER_REMEMBER_KEY), '1');
});

test('refresh writes follow the active policy and clean the opposite member store', () => {
  const stores = pair({ [MEMBER_REMEMBER_KEY]: '1' });
  withBrowserStorage(stores.local, stores.session, () => {
    memberAuthStorage.setItem(MEMBER_AUTH_STORAGE_KEY, 'refreshed-persistent');
  });
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), 'refreshed-persistent');
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), null);

  stores.local.setItem(MEMBER_REMEMBER_KEY, '0');
  withBrowserStorage(stores.local, stores.session, () => {
    memberAuthStorage.setItem(MEMBER_AUTH_STORAGE_KEY, 'refreshed-temporary');
  });
  assert.equal(stores.session.getItem(MEMBER_AUTH_STORAGE_KEY), 'refreshed-temporary');
  assert.equal(stores.local.getItem(MEMBER_AUTH_STORAGE_KEY), null);
});

test('shared preference changes cannot make another tab restore local Auth data', () => {
  const sharedLocal = new FakeStorage({
    [MEMBER_REMEMBER_KEY]: '1',
    [MEMBER_AUTH_STORAGE_KEY]: 'shared-member-session',
    phantoms_admin_auth: 'independent-admin-session',
  });
  const tabA = { local: sharedLocal, session: new FakeStorage() };
  const tabB = { local: sharedLocal, session: new FakeStorage() };

  assert.equal(transitionMemberRemember(false, tabA).ok, true);
  assert.equal(tabA.session.getItem(MEMBER_AUTH_STORAGE_KEY), 'shared-member-session');
  assert.equal(tabB.session.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  withBrowserStorage(tabB.local, tabB.session, () => {
    assert.equal(memberAuthStorage.getItem(MEMBER_AUTH_STORAGE_KEY), null);
  });
  assert.equal(sharedLocal.getItem('phantoms_admin_auth'), 'independent-admin-session');
});
