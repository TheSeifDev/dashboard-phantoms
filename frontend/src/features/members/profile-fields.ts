export const MEMBER_PROFILE_KEYS = [
  'fullName',
  'phone',
  'residence',
  'workConditions',
  'bio',
  'device',
  'gender',
  'academicNumber',
  'academicGroup',
  'specialization',
  'linkedinUrl',
  'portfolioUrl',
] as const;

export type MemberProfileInput = Record<(typeof MEMBER_PROFILE_KEYS)[number], string>;
export type MemberProfileField = keyof MemberProfileInput;

export const EMPTY_MEMBER_PROFILE: MemberProfileInput = {
  fullName: '',
  phone: '',
  residence: '',
  workConditions: '',
  bio: '',
  device: '',
  gender: '',
  academicNumber: '',
  academicGroup: '',
  specialization: '',
  linkedinUrl: '',
  portfolioUrl: '',
};

export const MEMBER_DEVICE_OPTIONS = [
  'لابتوب',
  'كمبيوتر مكتبي (PC)',
  'بدون جهاز',
  'هاتف محمول',
  'لابتوب، هاتف محمول',
  'لابتوب، جهاز لوحي، هاتف محمول',
] as const;

export const MEMBER_GENDER_OPTIONS = ['ذكر', 'أنثى'] as const;
export const MEMBER_SPECIALIZATION_OPTIONS = ['software', 'hardware', 'ai'] as const;

/**
 * Every profile field is mandatory. Members whose stored profile misses any of
 * them are routed back to Settings and reminded until the profile is complete.
 */
export const MEMBER_REQUIRED_PROFILE_FIELDS = [...MEMBER_PROFILE_KEYS] as const;

/** Bilingual labels used by the completion reminder and inline error copy. */
export const MEMBER_PROFILE_FIELD_LABELS: Record<MemberProfileField, readonly [string, string]> = {
  fullName: ['الاسم الكامل', 'Full name'],
  phone: ['رقم WhatsApp', 'WhatsApp phone'],
  residence: ['محل الإقامة', 'Residence'],
  workConditions: ['ظروف العمل أو الدراسة', 'Work or study conditions'],
  bio: ['نبذة أو الدور', 'Bio or role'],
  device: ['الجهاز المتوفر', 'Available device'],
  gender: ['الجنس', 'Gender'],
  academicNumber: ['الرقم الأكاديمي', 'Academic number'],
  academicGroup: ['المجموعة الأكاديمية', 'Academic group'],
  specialization: ['التخصص', 'Specialization'],
  linkedinUrl: ['LinkedIn', 'LinkedIn'],
  portfolioUrl: ['GitHub / Portfolio / Behance', 'GitHub / Portfolio / Behance'],
};

// Deliberately reject invisible/control input, including C1 controls.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const PROFILE_KEYS = [...MEMBER_PROFILE_KEYS].sort();
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export type MemberProfileValidationCode =
  | 'INVALID_KEYS'
  | 'INVALID_TYPE'
  | 'REQUIRED'
  | 'TOO_LONG'
  | 'CONTROL_CHARACTERS'
  | 'INVALID_FORMAT'
  | 'INVALID_OPTION'
  | 'INVALID_URL';

export type MemberProfileValidationResult =
  | { ok: true; profile: MemberProfileInput }
  | { ok: false; field: MemberProfileField; message: string; code: MemberProfileValidationCode };

export function normalizeAcademicNumber(value: string): string {
  return String(value ?? '').trim().replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit))).replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
}

export function deriveMemberUniversityEmail(academicNumber: string): string {
  const normalized = normalizeAcademicNumber(academicNumber);
  return /^[0-9]{1,32}$/.test(normalized) ? `${normalized}@batechu.com` : '';
}

function fail(field: MemberProfileField, code: MemberProfileValidationCode, message: string): MemberProfileValidationResult {
  return { ok: false, field, code, message };
}

function isExactProfileObject(input: unknown): input is Record<MemberProfileField, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input).sort();
  return keys.length === PROFILE_KEYS.length && keys.every((key, index) => key === PROFILE_KEYS[index]);
}

function isDigitsOnly(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

function isIpv4(hostname: string): boolean {
  if (!/^\d+(?:\.\d+){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isUnsafePortfolioHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.includes(':')
    || isIpv4(normalized) || isPrivateIpv4(normalized) || !normalized.includes('.') || normalized.startsWith('.') || normalized.endsWith('.');
}

function canonicalHttpsUrl(value: string, field: MemberProfileField, kind: 'linkedin' | 'portfolio'): MemberProfileValidationResult {
  if (value === '') return fail(field, 'REQUIRED', 'This field is required.');
  if (value.length > 2048 || CONTROL_CHARACTERS.test(value)) return fail(field, value.length > 2048 ? 'TOO_LONG' : 'CONTROL_CHARACTERS', 'Use a safe HTTPS link.');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return fail(field, 'INVALID_URL', 'Use an absolute HTTPS link without credentials, fragments or a custom port.');
    const hostname = url.hostname.toLowerCase();
    if (kind === 'linkedin' && hostname !== 'linkedin.com' && hostname !== 'www.linkedin.com') return fail(field, 'INVALID_URL', 'Use a LinkedIn link from linkedin.com.');
    if (kind === 'portfolio' && (isUnsafePortfolioHostname(hostname) || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname))) return fail(field, 'INVALID_URL', 'Use a public portfolio domain.');
    const canonical = url.toString();
    if (canonical.length > 2048) return fail(field, 'TOO_LONG', 'Use a link no longer than 2048 characters.');
    return { ok: true, profile: { ...EMPTY_MEMBER_PROFILE, [field]: canonical } };
  } catch {
    return fail(field, 'INVALID_URL', 'Use an absolute HTTPS link.');
  }
}

function textField(
  profile: Record<MemberProfileField, string>,
  field: MemberProfileField,
  maxLength: number,
  required = false,
): MemberProfileValidationResult | null {
  const value = profile[field];
  if (required && value === '') return fail(field, 'REQUIRED', 'This field is required.');
  if (value.length > maxLength) return fail(field, 'TOO_LONG', `Use no more than ${maxLength} characters.`);
  if (CONTROL_CHARACTERS.test(value)) return fail(field, 'CONTROL_CHARACTERS', 'Control characters are not allowed.');
  return null;
}

export function validateMemberProfile(input: unknown): MemberProfileValidationResult {
  if (!isExactProfileObject(input)) return fail('fullName', 'INVALID_KEYS', 'Profile must contain exactly the supported fields.');
  if (Object.values(input).some((value) => typeof value !== 'string')) return fail('fullName', 'INVALID_TYPE', 'Profile fields must be strings.');

  const raw = input as Record<MemberProfileField, string>;
  const profile: MemberProfileInput = {
    fullName: raw.fullName.trim(),
    phone: raw.phone.trim(),
    residence: raw.residence.trim(),
    workConditions: raw.workConditions.trim(),
    bio: raw.bio.trim(),
    device: raw.device.trim(),
    gender: raw.gender.trim(),
    academicNumber: normalizeAcademicNumber(raw.academicNumber),
    academicGroup: raw.academicGroup.trim(),
    specialization: raw.specialization.trim(),
    linkedinUrl: raw.linkedinUrl.trim(),
    portfolioUrl: raw.portfolioUrl.trim(),
  };

  for (const [field, maxLength, required] of [
    ['fullName', 160, true],
    ['residence', 160, true],
    ['workConditions', 2000, true],
    ['bio', 4000, true],
    ['academicGroup', 80, true],
  ] as const) {
    const result = textField(profile, field, maxLength, required);
    if (result) return result;
  }

  if (profile.phone === '') return fail('phone', 'REQUIRED', 'This field is required.');
  if (profile.phone.length > 32 || !/^\+?[0-9 ()-]+$/.test(profile.phone) || profile.phone.replace(/\D/g, '').length < 7 || profile.phone.replace(/\D/g, '').length > 15) {
    return fail('phone', 'INVALID_FORMAT', 'Use 7 to 15 digits with an optional leading plus, spaces, parentheses, or hyphens.');
  }
  if (profile.academicNumber === '' || profile.academicNumber.length > 32 || !isDigitsOnly(profile.academicNumber)) {
    return fail('academicNumber', profile.academicNumber === '' ? 'REQUIRED' : 'INVALID_FORMAT', 'Use 1 to 32 digits.');
  }
  if (!MEMBER_SPECIALIZATION_OPTIONS.includes(profile.specialization as (typeof MEMBER_SPECIALIZATION_OPTIONS)[number])) return fail('specialization', 'INVALID_OPTION', 'Choose software, hardware, or AI.');
  if (profile.device === '') return fail('device', 'REQUIRED', 'This field is required.');
  if (!MEMBER_DEVICE_OPTIONS.includes(profile.device as (typeof MEMBER_DEVICE_OPTIONS)[number])) return fail('device', 'INVALID_OPTION', 'Choose a supported device option.');
  if (profile.gender === '') return fail('gender', 'REQUIRED', 'This field is required.');
  if (!MEMBER_GENDER_OPTIONS.includes(profile.gender as (typeof MEMBER_GENDER_OPTIONS)[number])) return fail('gender', 'INVALID_OPTION', 'Choose a supported gender option.');

  const linkedin = canonicalHttpsUrl(profile.linkedinUrl, 'linkedinUrl', 'linkedin');
  if (!linkedin.ok) return linkedin;
  const portfolio = canonicalHttpsUrl(profile.portfolioUrl, 'portfolioUrl', 'portfolio');
  if (!portfolio.ok) return portfolio;

  return {
    ok: true,
    profile: {
      ...profile,
      linkedinUrl: linkedin.profile.linkedinUrl,
      portfolioUrl: portfolio.profile.portfolioUrl,
    },
  };
}

/**
 * Fields a member still has to fill in. Empty values are reported first, then
 * the first structurally invalid value, so the reminder UI can list what is
 * blocking the workspace without duplicating validator rules.
 */
export function missingProfileFields(profile: MemberProfileInput): MemberProfileField[] {
  const missing = MEMBER_PROFILE_KEYS.filter((field) => String(profile[field] ?? '').trim() === '');
  const result = validateMemberProfile(profile);
  if (!result.ok && !missing.includes(result.field)) missing.push(result.field);
  return missing;
}
