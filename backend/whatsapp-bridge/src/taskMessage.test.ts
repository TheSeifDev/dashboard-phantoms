import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from './taskMessage.js';

test('normalizes Egyptian mobile numbers to international format', () => {
  assert.equal(normalizePhone('010 1234 5678'), '201012345678');
  assert.equal(normalizePhone('+20 101 234 5678'), '201012345678');
});

test('rejects missing or malformed phone numbers', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone('20-abc'), null);
});
