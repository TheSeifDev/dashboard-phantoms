import type { Member, MemberCustomField } from '../../types/db';
import { formatCustomFieldValue, getMemberCustomFieldValue } from './customFieldsApi';
import { DeviceChips, ReadinessChip, WorkStatusChip } from './MemberCells';
import { memberSpecializationLabel } from './member-profile-display';
import { MemberAcademicDetails, MemberInformationStatus } from './MemberAcademicDetails';
import { OwnerMemberErasure } from './OwnerMemberErasure';
import { ChevronDown, Eye, MapPin, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { MemberAppUsageDetails, type AppUsageDisplay } from '../app-usage/MemberAppUsageDetails';

export function MemberCards({
  members,
  customFields = [],
  appUsage,
  isOwner = false,
  currentOwnerUserId = null,
  onView,
  onEdit,
  onDelete,
}: {
  members: Member[];
  customFields?: MemberCustomField[];
  appUsage?: Record<number, AppUsageDisplay>;
  isOwner?: boolean;
  currentOwnerUserId?: string | null;
  onView: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
}) {
  const { t } = useLocale();
  const cardFields = customFields.filter((f) => f.show_in_card !== false);

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" aria-label={t('قائمة الأعضاء', 'Member list')}>
      {members.map((member) => {
        const specialization = memberSpecializationLabel(member.specialization);
        return (
          <li
            key={member.id}
            id={`member-card-${member.id}`}
            className="group flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] hover:border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] hover:shadow-[var(--shadow-md)] sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-lg font-black text-[var(--link)]"
                aria-hidden="true"
              >
                {member.full_name.trim().charAt(0)}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <button
                  type="button"
                  onClick={() => onView(member)}
                  className="min-h-0 truncate text-start text-base font-black leading-7 text-[var(--text)] hover:text-[var(--link)] focus-visible:text-[var(--link)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
                >
                  {member.full_name}
                </button>
                <span
                  className={`truncate text-sm leading-6 ${
                    specialization ? 'text-[var(--text-2)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {specialization || t('التخصص مش محدد', 'Specialization not specified')}
                </span>
                {(member.email || member.phone) && (
                  <span className="flex min-w-0 flex-wrap gap-x-2 text-xs leading-5 text-[var(--text-muted)]">
                    {member.email && <span className="max-w-full truncate" dir="ltr" title={member.email}>{member.email}</span>}
                    {member.phone && <span className="whitespace-nowrap" dir="ltr">{member.phone}</span>}
                  </span>
                )}
              </div>
              <WorkStatusChip status={member.work_status} />
            </div>

            <div className="grid min-w-0 gap-3 border-t border-[var(--border)] pt-3">
              <div><MemberInformationStatus member={member} /></div>
              <MemberAcademicDetails member={member} />
            </div>

            {appUsage?.[member.id] && <MemberAppUsageDetails compact display={appUsage[member.id]} />}

            <dl className="grid gap-2 border-t border-[var(--border)] pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                  <MapPin size={14} aria-hidden="true" />
                  {t('الإقامة', 'Residence')}
                </dt>
                <dd className="truncate font-bold text-[var(--text-2)]">{member.residence || '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs font-semibold text-[var(--text-muted)]">{t('النزول الميداني', 'Field availability')}</dt>
                <dd>
                  <ReadinessChip ready={Boolean(member.can_go_alexandria)} />
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-xs font-semibold text-[var(--text-muted)]">{t('الأجهزة', 'Devices')}</dt>
                <dd className="min-w-0">
                  <DeviceChips device={member.device} />
                </dd>
              </div>
              {cardFields.map((field) => {
                const rawVal = getMemberCustomFieldValue(member, field);
                const formatted = formatCustomFieldValue(field, rawVal);
                return (
                  <div key={field.id} className="flex items-center justify-between gap-3">
                    <dt className="truncate text-xs font-semibold text-[var(--text-muted)]">{field.label}</dt>
                    <dd className="truncate font-bold text-[var(--text-2)]">{formatted || '—'}</dd>
                  </div>
                );
              })}
            </dl>

            <div className="mt-auto flex items-center gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => onView(member)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--primary-soft)] px-3 text-sm font-bold text-[var(--link)] transition-colors hover:bg-[var(--primary)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              >
                <Eye size={16} aria-hidden="true" /> {t('الملف', 'Profile')}
              </button>
              <button
                type="button"
                onClick={() => onEdit(member)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 text-sm font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
              >
                <Pencil size={16} aria-hidden="true" /> {t('تعديل', 'Edit')}
              </button>
              <button
                type="button"
                onClick={() => onDelete(member)}
                className="grid size-11 min-h-0 min-w-0 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 dark:hover:bg-[var(--danger-soft)]"
                aria-label={`${t('حذف سجل العضو فقط', 'Delete profile record only')} ${member.full_name}`}
                title={t('حذف سجل العضو فقط', 'Delete profile record only')}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
            {isOwner && (
              <details id={`member-owner-actions-${member.id}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 text-sm font-bold text-[var(--text-2)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ShieldAlert size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate">{t('إجراء المالك المتقدم', 'Advanced owner action')}</span>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
                </summary>
                <div className="grid gap-2 border-t border-[var(--border)] p-3">
                  <p className="text-xs leading-5 text-[var(--text-muted)]">{t('محو نهائي اختياري للهوية وحساب الدخول والبيانات الشخصية؛ يبدأ بمعاينة من الخادم ويتطلب تأكيدًا صريحًا.', 'Optional permanent erasure of identity, sign-in account, and personal data; starts with a server preview and requires explicit confirmation.')}</p>
                  <OwnerMemberErasure
                    member={member}
                    currentOwnerUserId={currentOwnerUserId}
                    isOwner={isOwner}
                  />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
