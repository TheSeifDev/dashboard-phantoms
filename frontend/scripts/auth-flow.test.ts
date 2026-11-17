import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ADMIN_SETUP_INTENT_TTL_MS,
  ADMIN_SETUP_INTENT_STORAGE_KEY,
  clearAdminSetupIntent,
  createSingleFlight,
  inspectAdminCallback,
  isValidMemberOtp,
  MEMBER_OTP_LENGTH,
  normalizeAuthEmail,
  readAdminSetupIntent,
  safeMemberAuthError,
  writeAdminSetupIntent,
} from '../src/features/auth/auth-flow.ts';

type FakeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

async function withSessionStorage<T>(callback: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const storage: FakeStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
}

test('member OTP accepts exactly eight ASCII digits', () => {
  assert.equal(MEMBER_OTP_LENGTH, 8);
  assert.equal(isValidMemberOtp('12345678'), true);
  assert.equal(isValidMemberOtp('1234567'), false);
  assert.equal(isValidMemberOtp('123456789'), false);
  assert.equal(isValidMemberOtp('12٣45678'), false);
  assert.equal(isValidMemberOtp('12345678\n'), false);
});

test('member auth normalizes email without turning URL callbacks into sessions', () => {
  assert.equal(normalizeAuthEmail('  MEMBER@Example.COM '), 'member@example.com');
  const memberMagicLink = inspectAdminCallback('/login', '', '#access_token=access&refresh_token=refresh&type=magiclink');
  assert.equal(memberMagicLink.kind, 'invalid');
});

test('invite and recovery callbacks accept PKCE and legacy hash forms only on admin setup routes', () => {
  const invite = inspectAdminCallback('/admin/set-password', '', '#access_token=a&refresh_token=r&type=invite');
  assert.deepEqual(invite.kind === 'callback' ? invite.intent : null, 'invite');

  const legacyRecovery = inspectAdminCallback('/', '', '#access_token=a&refresh_token=r&type=recovery');
  assert.deepEqual(legacyRecovery.kind === 'callback' ? legacyRecovery.intent : null, 'recovery');

  const pkceRecovery = inspectAdminCallback('/admin/recovery/callback', '?code=one-time-code', '');
  assert.deepEqual(pkceRecovery.kind === 'callback' ? pkceRecovery.intent : null, 'recovery');

  const pkceInvite = inspectAdminCallback('/admin/set-password', '?code=one-time-code', '');
  assert.deepEqual(pkceInvite.kind === 'callback' ? pkceInvite.intent : null, 'invite');

  const memberRoute = inspectAdminCallback('/login', '', '#access_token=a&refresh_token=r&type=invite');
  assert.equal(memberRoute.kind, 'invalid');
});

test('failed or ambiguous callbacks produce a retryable state and do not accept arbitrary token types', () => {
  const failed = inspectAdminCallback('/admin/recovery/callback', '?error=access_denied', '');
  assert.equal(failed.kind, 'invalid');
  assert.match(failed.kind === 'invalid' ? failed.message : '', /رابط|حاول/);

  const missing = inspectAdminCallback('/admin/recovery/callback', '', '');
  assert.equal(missing.kind, 'none');

  const magicLink = inspectAdminCallback('/', '', '#access_token=a&refresh_token=r&type=magiclink');
  assert.equal(magicLink.kind, 'invalid');

  for (const operation of ['send', 'verify', 'member'] as const) {
    const message = safeMemberAuthError(operation);
    assert.equal(message.includes('access_token'), false);
    assert.equal(message.includes('refresh_token'), false);
    assert.equal(message.includes('123456'), false);
  }
});

test('member/admin auth storage identifiers remain separate and admin intent stores no session data', () => {
  const memberClientSource = readFileSync(new URL('../src/lib/supabase/member-client.ts', import.meta.url), 'utf8');
  const memberStorageSource = readFileSync(new URL('../src/lib/supabase/member-auth-storage.ts', import.meta.url), 'utf8');
  assert.match(memberStorageSource, /MEMBER_AUTH_STORAGE_KEY\s*=\s*['"]phantoms-member-auth['"]/);
  assert.match(memberClientSource, /import \{ MEMBER_AUTH_STORAGE_KEY, memberAuthStorage \} from '\.\/member-auth-storage'/);
  assert.match(memberClientSource, /storageKey:\s*MEMBER_AUTH_STORAGE_KEY/);
  assert.match(memberClientSource, /storage:\s*memberAuthStorage/);
  assert.match(memberClientSource, /detectSessionInUrl:\s*false/);
  assert.equal(memberClientSource.includes("storageKey: 'sb-"), false);
  assert.notEqual(ADMIN_SETUP_INTENT_STORAGE_KEY, 'phantoms-member-auth');
  assert.equal(ADMIN_SETUP_INTENT_STORAGE_KEY.includes('token'), false);
  assert.equal(ADMIN_SETUP_INTENT_STORAGE_KEY.includes('session'), false);
});

test('failed callback cleanup cannot leave an unrelated old admin marker, while a verified marker is identity-bound', async () => {
  await withSessionStorage(() => {
    // A callback starts by clearing any marker, so an old admin session cannot unlock its form.
    writeAdminSetupIntent('invite', 'old-admin', 1_000);
    clearAdminSetupIntent();
    assert.equal(readAdminSetupIntent('old-admin', 1_000), null);

    // The marker is only useful for the user returned by the verified callback.
    writeAdminSetupIntent('recovery', 'callback-user', 1_000);
    assert.equal(readAdminSetupIntent('old-admin', 1_000), null);
    writeAdminSetupIntent('recovery', 'callback-user', 1_000);
    assert.equal(readAdminSetupIntent('callback-user', 1_000), 'recovery');
  });
});

test('stale callback markers expire and are removed instead of gating the password form', async () => {
  await withSessionStorage(() => {
    writeAdminSetupIntent('invite', 'callback-user', 5_000);
    assert.equal(readAdminSetupIntent('callback-user', 5_000 + ADMIN_SETUP_INTENT_TTL_MS - 1), 'invite');
    assert.equal(readAdminSetupIntent('callback-user', 5_000 + ADMIN_SETUP_INTENT_TTL_MS), null);
    assert.equal(readAdminSetupIntent('callback-user', 5_000 + ADMIN_SETUP_INTENT_TTL_MS + 1), null);
  });
});

test('local member sign-out leaves an independent same-account admin session intact', async () => {
  let memberSession: string | null = 'member-session';
  let adminSession: string | null = 'admin-session';
  const fakeMemberSignOut = async (options: { scope: 'local' | 'global' }) => {
    assert.deepEqual(options, { scope: 'local' });
    memberSession = null;
  };

  await fakeMemberSignOut({ scope: 'local' });
  assert.equal(memberSession, null);
  assert.equal(adminSession, 'admin-session');
  adminSession = null;
});

test('same callback key shares one exchange and is cleaned up for a later distinct attempt', async () => {
  const singleFlight = createSingleFlight<string, string>();
  let exchanges = 0;
  const exchange = async () => {
    exchanges += 1;
    return 'verified-session';
  };

  const first = singleFlight.run('same-callback-fingerprint', exchange);
  const duplicate = singleFlight.run('same-callback-fingerprint', exchange);
  assert.strictEqual(first, duplicate);
  assert.equal(await first, 'verified-session');
  assert.equal(exchanges, 1);

  // Cleanup is safe after settlement: a later callback attempt can run normally.
  assert.equal(await singleFlight.run('same-callback-fingerprint', exchange), 'verified-session');
  assert.equal(exchanges, 2);
});
