import type { Member } from '../../types/db';
import {
  EMPTY_MEMBER_PROFILE,
  deriveMemberUniversityEmail,
  missingProfileFields,
  validateMemberProfile,
  type MemberProfileField,
  type MemberProfileInput,
} from './profile-fields';

/** A fully valid synthetic profile: link checks override exactly one field. */
const VALIDATION_BASE: MemberProfileInput = {
  ...EMPTY_MEMBER_PROFILE,
  fullName: 'Validation Base',
  phone: '+201000000000',
  residence: 'Cairo',
  workConditions: 'Validation',
  bio: 'Validation',
  device: 'لابتوب',
  gender: 'ذكر',
  academicNumber: '0001',
  academicGroup: 'Validation',
  specialization: 'software',
  linkedinUrl: 'https://www.linkedin.com/in/validation',
  portfolioUrl: 'https://example.com/validation',
};

export function memberSpecializationLabel(value: Member['specialization']): string {
  return ({ software: 'Software', hardware: 'Hardware', ai: 'AI' } as const)[value as 'software' | 'hardware' | 'ai'] ?? '';
}

/** Project a member row onto the twelve self-service profile fields. */
export function memberProfileInput(member: Member): MemberProfileInput {
  return {
    ...EMPTY_MEMBER_PROFILE,
    fullName: member.full_name ?? '',
    phone: member.phone ?? '',
    residence: member.residence ?? '',
    workConditions: member.work_conditions ?? '',
    bio: member.bio ?? '',
    device: member.device ?? '',
    gender: member.gender ?? '',
    academicNumber: member.academic_number ?? '',
    academicGroup: member.academic_group ?? '',
    specialization: member.specialization ?? '',
    linkedinUrl: member.linkedin_url ?? '',
    portfolioUrl: member.portfolio_url ?? '',
  };
}

/** Display-only completeness. Member routing still uses its authoritative RPC. */
export function hasRequiredMemberInformation(member: Member): boolean {
  return validateMemberProfile(memberProfileInput(member)).ok
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email ?? '')
    && member.university_email === deriveMemberUniversityEmail(member.academic_number ?? '');
}

/** Fields an administrator still has to collect from this member. */
export function missingMemberProfileFields(member: Member): MemberProfileField[] {
  return missingProfileFields(memberProfileInput(member));
}

/** Never turn a legacy/raw value into an executable link. */
export function safeMemberProfessionalLink(value: string | null | undefined, kind: 'linkedin' | 'portfolio'): string | null {
  if (!value) return null;
  const key = kind === 'linkedin' ? 'linkedinUrl' : 'portfolioUrl';
  const result = validateMemberProfile({ ...VALIDATION_BASE, [key]: value });
  return result.ok ? result.profile[key] : null;
}

export function memberSearchText(member: Member): string {
  return [member.full_name, member.email, member.phone, member.residence, member.bio,
    member.academic_number, member.academic_group, member.specialization,
    member.university_email, member.linkedin_url, member.portfolio_url,
    ...Object.values(member.custom_fields ?? {}).filter((value) => value !== null && value !== undefined),
  ].filter(Boolean).join(' ').toLowerCase();
}
