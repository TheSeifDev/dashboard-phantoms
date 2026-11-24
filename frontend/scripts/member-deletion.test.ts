import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DELETION_CONFIRM_WORDS,
  MEMBER_DELETION_REASON_MAX,
  deletionConfirmationMatches,
  isDeletionRequestId,
  isDeletionStatus,
  memberDeletionErrorMessage,
} from '../src/features/members/member-deletion-rules.ts';

test('deletion confirmation requires the exact word for the active locale', () => {
  assert.equal(deletionConfirmationMatches('حذف', 'ar'), true);
  assert.equal(deletionConfirmationMatches('  حذف  ', 'ar'), true);
  assert.equal(deletionConfirmationMatches('حذف نهائي', 'ar'), false);
  assert.equal(deletionConfirmationMatches('احذف', 'ar'), false);
  assert.equal(deletionConfirmationMatches('', 'ar'), false);
  assert.equal(deletionConfirmationMatches('DELETE', 'en'), true);
  assert.equal(deletionConfirmationMatches('delete', 'en'), true);
  assert.equal(deletionConfirmationMatches('  DeLeTe ', 'en'), true);
  assert.equal(deletionConfirmationMatches('delete my account', 'en'), false);
  assert.equal(deletionConfirmationMatches('حذف', 'en'), false);
  assert.equal(deletionConfirmationMatches(DELETION_CONFIRM_WORDS.ar, 'ar'), true);
  assert.equal(DELETION_CONFIRM_WORDS.en, 'DELETE');
  assert.equal(MEMBER_DELETION_REASON_MAX, 1000);
});

test('deletion status and request id guards reject unknown shapes', () => {
  for (const status of ['pending', 'approved', 'rejected', 'cancelled', 'completed']) {
    assert.equal(isDeletionStatus(status), true);
  }
  for (const value of ['PENDING', 'deleted', '', null, undefined, 3, {}, ['pending']]) {
    assert.equal(isDeletionStatus(value), false);
  }
  assert.equal(isDeletionRequestId('c3e63630-3c29-40e6-a240-d85830d37052'), true);
  assert.equal(isDeletionRequestId('C3E63630-3C29-40E6-A240-D85830D37052'), true);
  assert.equal(isDeletionRequestId('c3e63630-3c29-40e6-a240'), false);
  assert.equal(isDeletionRequestId('not-a-uuid'), false);
  assert.equal(isDeletionRequestId(null), false);
});

test('every known deletion error code has a distinct Arabic and English message', () => {
  const codes = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'MEMBER_NOT_FOUND',
    'MEMBER_NOT_ACTIVE',
    'OWNER_CANNOT_DELETE_ACCOUNT',
    'DELETION_REQUEST_EXISTS',
    'DELETION_REQUEST_NOT_FOUND',
    'DELETION_REQUEST_NOT_PENDING',
    'DELETION_REQUEST_NOT_APPROVED',
    'DELETION_REQUEST_INCOMPLETE',
    'SELF_DELETION_FORBIDDEN',
    'OWNER_DELETION_FORBIDDEN',
    'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS',
    'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR',
    'MEMBER_DELETION_DELETE_FAILED',
    'DELETION_IDENTITY_RESIDUAL',
    'DELETION_IDENTIFIER_RESIDUAL',
    'DELETION_JSON_IDENTITY_RESIDUAL',
    'AUTH_DELETE_FAILED',
    'DELETION_TARGET_MISSING',
    'COMPLETION_MARK_FAILED',
    'ACCESS_CHECK_FAILED',
    'INVALID_REQUEST_ID',
    'METHOD_NOT_ALLOWED',
    'SERVER_CONFIG',
    'DELETION_FAILED',
    'request_failed',
  ] as const;
  const arabic = new Set<string>();
  for (const code of codes) {
    const ar = memberDeletionErrorMessage(code, 'ar');
    const en = memberDeletionErrorMessage(code, 'en');
    assert.ok(ar.length > 10, `${code} needs an Arabic message`);
    assert.ok(en.length > 10, `${code} needs an English message`);
    assert.notEqual(ar, en, `${code} should be localised`);
    assert.match(ar, /[\u0600-\u06FF]/, `${code} Arabic message should be Arabic text`);
    arabic.add(ar);
  }
  // كودات البقايا الثلاثة بتشترك في نفس الرسالة لأن التصرف المطلوب واحد.
  assert.equal(arabic.size, codes.length - 2, 'each code should map to its own Arabic message');
});

test('rejection and handover errors explain what the admin must do', () => {
  assert.match(memberDeletionErrorMessage('DELETION_OWNED_WORK_WITHOUT_SUCCESSOR', 'ar'), /نقل الملكية/);
  assert.match(memberDeletionErrorMessage('AUTH_DELETE_FAILED', 'ar'), /إعادة المحاولة/);
  assert.match(memberDeletionErrorMessage('DELETION_JSON_IDENTITY_RESIDUAL', 'en'), /reference/i);
  assert.match(memberDeletionErrorMessage('MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS', 'en'), /binding/i);
});
