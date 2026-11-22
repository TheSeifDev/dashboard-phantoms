import assert from 'node:assert/strict';
import test from 'node:test';
import { authFailureMessage, classifyAuthFailure, isConnectivityFailure } from '../src/features/auth/auth-errors';
import { SupabaseTransportError } from '../src/lib/supabase/transport';

const t = (arabic: string) => arabic;

test('classifyAuthFailure: بيانات غلط تفضل بيانات غلط', () => {
  const failure = classifyAuthFailure({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' });
  assert.equal(failure.kind, 'INVALID_CREDENTIALS');
  assert.equal(isConnectivityFailure(failure), false);
});

test('classifyAuthFailure: فشل الشبكة مش "كلمة مرور غلط"', () => {
  const failure = classifyAuthFailure(new TypeError('Failed to fetch'));
  assert.equal(failure.kind, 'NETWORK');
  assert.equal(isConnectivityFailure(failure), true);
});

test('classifyAuthFailure: مهلة النقل بتتصنف timeout', () => {
  const failure = classifyAuthFailure(new SupabaseTransportError('timeout', 'https://example.supabase.co'));
  assert.equal(failure.kind, 'TIMEOUT');
});

test('classifyAuthFailure: خطأ نقل غير معروف السبب يفضل شبكة', () => {
  const failure = classifyAuthFailure(new SupabaseTransportError('unreachable', 'https://example.supabase.co'));
  assert.equal(failure.kind, 'NETWORK');
});

test('classifyAuthFailure: 429 و5xx وapi key وemail not confirmed', () => {
  assert.equal(classifyAuthFailure({ status: 429, message: 'Request rate limit reached' }).kind, 'RATE_LIMITED');
  assert.equal(classifyAuthFailure({ status: 503, message: 'Service unavailable' }).kind, 'SERVER');
  assert.equal(classifyAuthFailure({ status: 401, message: 'Invalid API key' }).kind, 'INVALID_API_KEY');
  assert.equal(classifyAuthFailure({ status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' }).kind, 'EMAIL_NOT_CONFIRMED');
  assert.equal(classifyAuthFailure({ status: 0, message: 'Failed to fetch' }).kind, 'NETWORK');
  assert.equal(classifyAuthFailure(null).kind, 'UNKNOWN');
});

test('authFailureMessage: كل نوع فشل ليه رسالة مختلفة عن التانية', () => {
  const invalid = authFailureMessage({ kind: 'INVALID_CREDENTIALS', status: 400, message: '' }, t);
  const network = authFailureMessage({ kind: 'NETWORK', status: null, message: '' }, t);
  const timeout = authFailureMessage({ kind: 'TIMEOUT', status: null, message: '' }, t);
  const rate = authFailureMessage({ kind: 'RATE_LIMITED', status: 429, message: '' }, t);

  assert.match(invalid, /البريد الإلكتروني أو كلمة المرور/);
  assert.match(network, /مش قادرين نوصل/);
  assert.match(timeout, /بطيء/);
  assert.match(rate, /محاولات دخول كتير/);
  assert.notEqual(invalid, network);
  assert.notEqual(network, timeout);
});

test('authFailureMessage: النوع المجهول بيرجع الرسالة الاحتياطية', () => {
  const message = authFailureMessage({ kind: 'UNKNOWN', status: null, message: 'x' }, t, 'معرفناش نتصل بالخادم.');
  assert.equal(message, 'معرفناش نتصل بالخادم.');
});
