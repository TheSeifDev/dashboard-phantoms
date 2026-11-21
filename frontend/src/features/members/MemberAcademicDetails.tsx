import { CheckCircle2, GraduationCap, Info, Link2 } from 'lucide-react';
import type { Member } from '../../types/db';
import { useLocale } from '../../i18n/useLocale';
import { hasRequiredMemberInformation, memberSpecializationLabel, safeMemberProfessionalLink } from './member-profile-display';

export function MemberInformationStatus({ member }: { member: Member }) {
  const { t } = useLocale();
  const complete = hasRequiredMemberInformation(member);
  const Icon = complete ? CheckCircle2 : Info;
  return <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${complete ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--primary-soft)] text-[var(--primary-ink)]'}`}>
    <Icon size={14} aria-hidden="true" />
    {complete ? t('البيانات المطلوبة مكتملة', 'Required information complete') : t('يلزم استكمال البيانات', 'Information required')}
  </span>;
}

export function MemberAcademicDetails({ member, showSpecialization = false }: { member: Member; showSpecialization?: boolean }) {
  const { t } = useLocale();
  const missing = t('يلزم الاستكمال', 'Required');
  const rows = [
    { label: t('الرقم الأكاديمي', 'Academic number'), value: member.academic_number, ltr: true },
    { label: t('المجموعة', 'Academic group'), value: member.academic_group, ltr: false },
    ...(showSpecialization ? [{ label: t('التخصص', 'Specialization'), value: memberSpecializationLabel(member.specialization), ltr: true }] : []),
    { label: t('البريد الجامعي', 'University email'), value: member.university_email, ltr: true },
  ];
  const links = [
    { label: 'LinkedIn', url: safeMemberProfessionalLink(member.linkedin_url, 'linkedin') },
    { label: 'GitHub / Portfolio / Behance', url: safeMemberProfessionalLink(member.portfolio_url, 'portfolio') },
  ];
  return <div className="grid min-w-0 gap-3" aria-label={t('بيانات الدراسة والروابط', 'Academic information and links')}>
    <dl className="grid min-w-0 gap-2 text-sm">
      {rows.map(({ label, value, ltr }) => <div key={label} className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <dt className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]"><GraduationCap size={14} aria-hidden="true" />{label}</dt>
        <dd className="min-w-0 max-w-full break-all font-bold text-[var(--text-2)]" dir={ltr ? 'ltr' : undefined}>{value || missing}</dd>
      </div>)}
    </dl>
    <div className="flex min-w-0 flex-wrap gap-2">
      {links.map(({ label, url }) => url
        ? <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 text-xs font-bold text-[var(--link)]"><Link2 size={14} aria-hidden="true" /><span className="break-words">{label}</span></a>
        : <span key={label} className="self-center text-xs text-[var(--text-muted)]">{label}: {t('غير مضاف (اختياري)', 'not provided (optional)')}</span>)}
    </div>
  </div>;
}
