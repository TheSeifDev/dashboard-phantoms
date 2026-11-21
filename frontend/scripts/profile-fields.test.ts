import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_MEMBER_PROFILE,
  normalizeAcademicNumber,
  deriveMemberUniversityEmail,
  validateMemberProfile,
} from '../src/features/members/profile-fields.ts';

function validProfile() {
  return {
    ...EMPTY_MEMBER_PROFILE,
    fullName: '  Member Test  ',
    phone: '+20 (123) 456-789',
    academicNumber: '٠١۲۳۴۵۶۷',
    academicGroup: 'Computer Science',
    specialization: 'software',
  };
}

test('academic number normalization maps Arabic and Persian digits without losing leading zeroes', () => {
  assert.equal(normalizeAcademicNumber('  ٠١۲۳۴۵۶۷  '), '01234567');
});

test('university email uses the required batechu.com domain and keeps leading zeros', () => {
  assert.equal(deriveMemberUniversityEmail(' ٠٠۱۲۳ '), '00123@batechu.com');
  assert.equal(deriveMemberUniversityEmail(''), '');
  assert.equal(deriveMemberUniversityEmail('12x'), '');
  assert.equal(deriveMemberUniversityEmail('1'.repeat(33)), '');
});

test('profile validator requires exactly 12 string keys and returns normalized profile', () => {
  const result = validateMemberProfile(validProfile());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.profile).sort(), Object.keys(EMPTY_MEMBER_PROFILE).sort());
  assert.equal(result.profile.fullName, 'Member Test');
  assert.equal(result.profile.academicNumber, '01234567');
  assert.equal(result.profile.linkedinUrl, '');
  assert.equal(result.profile.portfolioUrl, '');

  const extra = validateMemberProfile({ ...validProfile(), extra: '' });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.code, 'INVALID_KEYS');
});

test('profile validator enforces required phone, academic identity, specialization, and controls/lengths', () => {
  for (const [field, value, code] of [
    ['phone', '', 'REQUIRED'],
    ['academicNumber', '', 'REQUIRED'],
    ['academicGroup', '', 'REQUIRED'],
    ['specialization', '', 'INVALID_OPTION'],
    ['fullName', 'bad\nname', 'CONTROL_CHARACTERS'],
    ['academicNumber', '123456789012345678901234567890123', 'INVALID_FORMAT'],
  ] as const) {
    const result = validateMemberProfile({ ...validProfile(), [field]: value });
    assert.equal(result.ok, false, field);
    if (!result.ok) {
      assert.equal(result.field, field);
      assert.equal(result.code, code);
    }
  }

  const phone = validateMemberProfile({ ...validProfile(), phone: '+20-123' });
  assert.equal(phone.ok, false);
  if (!phone.ok) assert.equal(phone.field, 'phone');
});

test('profile validator keeps legacy optional allowlists and canonicalizes safe links', () => {
  const result = validateMemberProfile({
    ...validProfile(),
    device: 'unsupported',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.field, 'device');

  const links = validateMemberProfile({
    ...validProfile(),
    linkedinUrl: ' https://www.linkedin.com/in/member#fragment ',
  });
  assert.equal(links.ok, false);
  if (!links.ok) assert.equal(links.field, 'linkedinUrl');

  const canonical = validateMemberProfile({
    ...validProfile(),
    linkedinUrl: 'https://www.linkedin.com/in/member',
    portfolioUrl: 'https://portfolio.example/path',
  });
  assert.equal(canonical.ok, true);
  if (canonical.ok) {
    assert.equal(canonical.profile.linkedinUrl, 'https://www.linkedin.com/in/member');
    assert.equal(canonical.profile.portfolioUrl, 'https://portfolio.example/path');
  }

  for (const portfolioUrl of ['http://portfolio.example', 'https://localhost/me', 'https://127.0.0.1/me', 'https://192.168.1.2/me', 'https://8.8.8.8/me', 'https://portfolio', 'https://portfolio.example:8443/path', 'https://app.localhost/path', 'https://under_score.example/path']) {
    const unsafe = validateMemberProfile({ ...validProfile(), portfolioUrl });
    assert.equal(unsafe.ok, false, portfolioUrl);
    if (!unsafe.ok) assert.equal(unsafe.field, 'portfolioUrl');
  }
});
