import type { Member } from '../../types/db';
import { EMPTY_MEMBER_PROFILE, deriveMemberUniversityEmail, validateMemberProfile } from './profile-fields';

export function memberSpecializationLabel(value: Member['specialization']): string {
  return ({ software: 'Software', hardware: 'Hardware', ai: 'AI' } as const)[value as 'software' | 'hardware' | 'ai'] ?? '';
}

/** Display-only completeness. Member routing still uses its authoritative RPC. */
export function hasRequiredMemberInformation(member: Member): boolean {
  const result = validateMemberProfile({
    ...EMPTY_MEMBER_PROFILE,
    fullName: member.full_name ?? '',
    phone: member.phone ?? '',
    academicNumber: member.academic_number ?? '',
    academicGroup: member.academic_group ?? '',
    specialization: member.specialization ?? '',
  });
  return result.ok
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email ?? '')
    && member.university_email === deriveMemberUniversityEmail(member.academic_number ?? '');
}

/** Never turn a legacy/raw value into an executable link. */
export function safeMemberProfessionalLink(value: string | null | undefined, kind: 'linkedin' | 'portfolio'): string | null {
  if (!value) return null;
  const key = kind === 'linkedin' ? 'linkedinUrl' : 'portfolioUrl';
  const result = validateMemberProfile({
    ...EMPTY_MEMBER_PROFILE,
    fullName: 'Link validation', phone: '+201000000000',
    academicNumber: '0001', academicGroup: 'Validation', specialization: 'software',
    [key]: value,
  });
  return result.ok ? result.profile[key] : null;
}

export function memberSearchText(member: Member): string {
  return [member.full_name, member.email, member.phone, member.residence, member.bio,
    member.academic_number, member.academic_group, member.specialization,
    member.university_email, member.linkedin_url, member.portfolio_url,
    ...Object.values(member.custom_fields ?? {}).filter((value) => value !== null && value !== undefined),
  ].filter(Boolean).join(' ').toLowerCase();
}
