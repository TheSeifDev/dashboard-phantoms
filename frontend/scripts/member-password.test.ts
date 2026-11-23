import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTrustedMemberInviteUrl,
  isLegacyMemberInviteToken,
  isMemberInviteId,
  isMemberInviteToken,
  memberAuthErrorMessage,
  parseMemberInviteLocation,
  parseMemberPasswordAccess,
  readMemberEndpointCode,
  memberPasswordRequirements,
  validateMemberPassword,
} from '../src/features/auth/member-password.ts';

test('member password rules require 12 characters, a letter and digit, and at most 72 UTF-8 bytes', () => {
  assert.deepEqual(validateMemberPassword('short1'), { ok: false, code: 'WEAK_PASSWORD' });
  assert.deepEqual(validateMemberPassword('abcdefghijkl'), { ok: false, code: 'WEAK_PASSWORD' });
  assert.deepEqual(validateMemberPassword('abcdefghij1'), { ok: false, code: 'WEAK_PASSWORD' });
  assert.deepEqual(validateMemberPassword('abcdefghijk1'), { ok: true });
  assert.deepEqual(validateMemberPassword('abcdefghijk1', 'different123'), { ok: false, code: 'PASSWORD_MISMATCH' });
  assert.deepEqual(validateMemberPassword('a'.repeat(129) + '1'), { ok: false, code: 'WEAK_PASSWORD' });
  assert.deepEqual(validateMemberPassword(`A1${'é'.repeat(35)}`), { ok: true });
  assert.deepEqual(validateMemberPassword(`A1${'é'.repeat(36)}`), { ok: false, code: 'WEAK_PASSWORD' });
  assert.match(memberPasswordRequirements().join(' '), /72.*UTF-8/);
  assert.match(memberAuthErrorMessage('WEAK_PASSWORD'), /72.*UTF-8/);
});

test('new invitation tokens are exactly phpw_ plus 64 lowercase hex characters', () => {
  const token = `phpw_${'a1'.repeat(32)}`;
  assert.equal(isMemberInviteToken(token), true);
  assert.equal(isMemberInviteToken(`${token}x`), false);
  assert.equal(isMemberInviteToken(token.toUpperCase()), false);
  assert.equal(isLegacyMemberInviteToken('phm1_old-token'), true);
});

test('fragment and legacy route tokens are captured as transient parser values', () => {
  const token = `phpw_${'b2'.repeat(32)}`;
  assert.deepEqual(parseMemberInviteLocation({ pathname: '/join', hash: `#invite=${token}` }), { kind: 'token', token });
  assert.deepEqual(parseMemberInviteLocation({ pathname: '/join/old', legacyRouteToken: 'phm1_old-token' }), { kind: 'legacy', token: '' });
  assert.deepEqual(parseMemberInviteLocation({ legacyRouteToken: token }), { kind: 'legacy', token: '' });
  assert.deepEqual(parseMemberInviteLocation({ search: `?invite=${token}` }), { kind: 'invalid' });
  assert.deepEqual(parseMemberInviteLocation({ search: `?invite=${token}`, hash: `#invite=${token}` }), { kind: 'invalid' });
  assert.deepEqual(parseMemberInviteLocation({ pathname: '/join' }), { kind: 'missing' });
});

test('member access parser fails closed for incomplete identity records', () => {
  const access = parseMemberPasswordAccess({
    member_id: 7,
    email: ' Member@Example.COM ',
    auth_user_id: 'auth-7',
    active: true,
    password_ready: true,
  });
  assert.deepEqual(access, { member_id: 7, email: 'member@example.com', auth_user_id: 'auth-7', active: true, password_ready: true, must_change_password: false });
  assert.equal(parseMemberPasswordAccess({ member_id: 7, email: 'member@example.com', active: true }), null);
  assert.equal(parseMemberPasswordAccess({ ...access, must_change_password: true })?.must_change_password, true);
  assert.equal(parseMemberPasswordAccess({ ...access, must_change_password: 'yes' })?.must_change_password, false);
});

test('member errors use allowlisted generic messages and never expose backend details', () => {
  const message = memberAuthErrorMessage('SERVER_UNAVAILABLE');
  assert.equal(message.includes('access_token'), false);
  assert.equal(message.includes('SQL'), false);
  assert.equal(memberAuthErrorMessage('unknown-code'), 'تعذر إكمال العملية. حاول مرة أخرى أو تواصل مع مسؤول الفريق.');
});

test('real HTTP error context yields only allowlisted expiration and revocation codes', async () => {
  for (const code of ['EXPIRED', 'REVOKED', 'ALREADY_USED', 'RATE_LIMITED']) {
    const context = new Response(JSON.stringify({ code, message: 'private server details' }), { status: 400 });
    assert.equal(await readMemberEndpointCode({ context }), code);
    assert.equal(context.bodyUsed, false, 'error extraction must not consume the original response');
  }
  assert.equal(await readMemberEndpointCode({ context: new Response('private malformed details', { status: 500 }) }), 'SERVER_UNAVAILABLE');
  assert.equal(await readMemberEndpointCode({ code: 'constructor' }), 'SERVER_UNAVAILABLE');
  assert.equal(await readMemberEndpointCode({ context: new Response(JSON.stringify({ code: 'private arbitrary code' })) }), 'SERVER_UNAVAILABLE');
});

test('invitation identifiers remain UUID strings, never member numeric IDs', () => {
  assert.equal(isMemberInviteId('d0ce45c4-1d54-4be0-8f24-6873237888a1'), true);
  assert.equal(isMemberInviteId('123'), false);
  assert.equal(isMemberInviteId('d0ce45c4-1d54-4be0-8f24-6873237888a1 trailing'), false);
});

test('private invitation links use only an explicit validated application origin', () => {
  const token = `phpw_${'c3'.repeat(32)}`;
  assert.equal(buildTrustedMemberInviteUrl(token), `https://dashboard-phantoms.vercel.app/join#invite=${token}`);
  assert.equal(buildTrustedMemberInviteUrl(token, 'http://localhost:5173'), `http://localhost:5173/join#invite=${token}`);
  assert.equal(buildTrustedMemberInviteUrl(token, undefined, 'reset'), `https://dashboard-phantoms.vercel.app/reset#invite=${token}`);
  assert.equal(buildTrustedMemberInviteUrl(token, 'http://localhost:5173', 'enroll'), `http://localhost:5173/join#invite=${token}`);
  for (const origin of ['http://unapproved.example', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?invite=x', 'javascript:alert(1)']) {
    assert.throws(() => buildTrustedMemberInviteUrl(token, origin));
  }
  // No window/current-origin input is consulted; preview/embedded hosts cannot substitute themselves.
  assert.equal(buildTrustedMemberInviteUrl(token, 'https://dashboard-phantoms.vercel.app/'), buildTrustedMemberInviteUrl(token));
});
