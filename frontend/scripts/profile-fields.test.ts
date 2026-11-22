import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_MEMBER_PROFILE,
  normalizeAcademicNumber,
  deriveMemberUniversityEmail,
  missingProfileFields,
  validateMemberProfile,
} from '../src/features/members/profile-fields.ts';

function validProfile() {
  return {
    ...EMPTY_MEMBER_PROFILE,
    fullName: '  Member Test  ',
    phone: '+20 (123) 456-789',
    residence: 'Cairo',
    workConditions: 'Remote, evenings only',
    bio: 'Frontend member',
    device: 'لابتوب',
    gender: 'ذكر',
    academicNumber: '٠١۲۳۴۵۶۷',
    academicGroup: 'Computer Science',
    specialization: 'software',
    linkedinUrl: 'https://www.linkedin.com/in/member',
    portfolioUrl: 'https://portfolio.example/path',
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
  assert.equal(result.profile.linkedinUrl, 'https://www.linkedin.com/in/member');
  assert.equal(result.profile.portfolioUrl, 'https://portfolio.example/path');

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

test('every additional profile field is mandatory for everyone', () => {
  for (const field of ['residence', 'workConditions', 'bio', 'device', 'gender', 'linkedinUrl', 'portfolioUrl'] as const) {
    const empty = validateMemberProfile({ ...validProfile(), [field]: '' });
    assert.equal(empty.ok, false, field);
    if (!empty.ok) {
      assert.equal(empty.field, field);
      assert.equal(empty.code, 'REQUIRED');
    }
    const blank = validateMemberProfile({ ...validProfile(), [field]: '   ' });
    assert.equal(blank.ok, false, `${field} whitespace`);
    if (!blank.ok) assert.equal(blank.code, 'REQUIRED');
  }

  for (const [field, length] of [['residence', 161], ['workConditions', 2001], ['bio', 4001]] as const) {
    const long = validateMemberProfile({ ...validProfile(), [field]: 'x'.repeat(length) });
    assert.equal(long.ok, false, field);
    if (!long.ok) assert.equal(long.code, 'TOO_LONG');
  }

  const controls = validateMemberProfile({ ...validProfile(), bio: 'bad\u0000bio' });
  assert.equal(controls.ok, false);
  if (!controls.ok) assert.equal(controls.code, 'CONTROL_CHARACTERS');
});

test('profile validator keeps enumerated allowlists and canonicalizes safe links', () => {
  const device = validateMemberProfile({ ...validProfile(), device: 'unsupported' });
  assert.equal(device.ok, false);
  if (!device.ok) assert.equal(device.field, 'device');

  const gender = validateMemberProfile({ ...validProfile(), gender: 'other' });
  assert.equal(gender.ok, false);
  if (!gender.ok) assert.equal(gender.field, 'gender');

  const links = validateMemberProfile({ ...validProfile(), linkedinUrl: ' https://www.linkedin.com/in/member#fragment ' });
  assert.equal(links.ok, false);
  if (!links.ok) assert.equal(links.field, 'linkedinUrl');

  const nonLinkedin = validateMemberProfile({ ...validProfile(), linkedinUrl: 'https://example.com/member' });
  assert.equal(nonLinkedin.ok, false);
  if (!nonLinkedin.ok) assert.equal(nonLinkedin.field, 'linkedinUrl');

  const canonical = validateMemberProfile(validProfile());
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

test('missingProfileFields lists every empty value plus the first invalid one', () => {
  assert.deepEqual(missingProfileFields(validProfile()), []);
  assert.deepEqual(missingProfileFields(EMPTY_MEMBER_PROFILE), [...Object.keys(EMPTY_MEMBER_PROFILE)]);
  assert.deepEqual(missingProfileFields({ ...validProfile(), residence: '  ', device: '' }), ['residence', 'device']);
  assert.deepEqual(missingProfileFields({ ...validProfile(), portfolioUrl: 'http://portfolio.example' }), ['portfolioUrl']);
  assert.deepEqual(missingProfileFields({ ...validProfile(), device: 'legacy device' }), ['device']);
});
