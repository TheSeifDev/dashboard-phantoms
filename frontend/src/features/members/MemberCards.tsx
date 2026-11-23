import type { Member, MemberCustomField } from '../../types/db';
import { formatCustomFieldValue, getMemberCustomFieldValue } from './customFieldsApi';
import { DeviceChips, ReadinessChip, WorkStatusChip } from './MemberCells';
import { memberSpecializationLabel } from './member-profile-display';
import { MemberAcademicDetails, MemberInformationStatus, MemberMissingFields } from './MemberAcademicDetails';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
import { OwnerMemberErasure } from './OwnerMemberErasure';
import { ChevronDown, Eye, Mail, MapPin, Pencil, Phone, ShieldAlert, Trash2 } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { MemberAppUsageDetails, type AppUsageDisplay } from '../app-usage/MemberAppUsageDetails';

export function MemberCards({
  members,
  customFields = [],
  appUsage,
  teamsByMember,
  teamNames,
  isOwner = false,
  currentOwnerUserId = null,
  onView,
  onEdit,
  onDelete,
  onResetPassword,
}: {
  members: Member[];
  customFields?: MemberCustomField[];
  appUsage?: Record<number, AppUsageDisplay>;
  /** member_id → أكواد التيمات الداخلية النشطة */
  teamsByMember?: Record<number, string[]>;
  /** كود التيم → الاسم المعروض */
  teamNames?: Record<string, string>;
  isOwner?: boolean;
  currentOwnerUserId?: string | null;
  onView: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
  onResetPassword?: (member: Member) => void;
}) {
  const { t } = useLocale();
  const cardFields = customFields.filter((field) => field.show_in_card !== false);

  return (
    <ul className="member-dir-grid" aria-label={t('قائمة الأعضاء', 'Member list')}>
      {members.map((member) => {
        const specialization = memberSpecializationLabel(member.specialization);
        const memberTeams = teamsByMember?.[member.id] ?? [];
        return (
          <li key={member.id} id={`member-card-${member.id}`} className="member-dir-card glass-card">
            <div className="member-dir-card-head">
              <MemberAvatar member={member} name={member.full_name} className="member-dir-avatar" />
              <div className="member-dir-card-copy">
                <button type="button" className="member-dir-name" onClick={() => onView(member)} title={member.full_name}>
                  {member.full_name}
                </button>
                <span className="member-dir-meta">{specialization || t('التخصص مش محدد', 'Specialization not specified')}</span>
                {memberTeams.length > 0 && (
                  <span className="member-dir-teams">
                    {memberTeams.map((slug) => (
                      <span key={slug} className="member-dir-team" data-team={slug}>{teamNames?.[slug] ?? slug}</span>
                    ))}
                  </span>
                )}
                {(member.email || member.phone) && (
                  <span className="member-dir-contact">
                    {member.email && <span dir="ltr" title={member.email}><Mail aria-hidden="true" />{member.email}</span>}
                    {member.phone && <span dir="ltr"><Phone aria-hidden="true" />{member.phone}</span>}
                  </span>
                )}
              </div>
              <WorkStatusChip status={member.work_status} />
            </div>

            <div className="member-dir-body">
              <MemberInformationStatus member={member} />
              <MemberMissingFields member={member} />
              <MemberAcademicDetails member={member} />
              {appUsage?.[member.id] && <MemberAppUsageDetails compact display={appUsage[member.id]} />}
            </div>

            <dl className="member-dir-facts">
              <div>
                <dt><MapPin aria-hidden="true" />{t('الإقامة', 'Residence')}</dt>
                <dd>{member.residence || '—'}</dd>
              </div>
              <div>
                <dt>{t('النزول الميداني', 'Field availability')}</dt>
                <dd><ReadinessChip ready={Boolean(member.can_go_alexandria)} /></dd>
              </div>
              <div>
                <dt>{t('الأجهزة', 'Devices')}</dt>
                <dd><DeviceChips device={member.device} /></dd>
              </div>
              {cardFields.map((field) => (
                <div key={field.id}>
                  <dt title={field.label}>{field.label}</dt>
                  <dd>{formatCustomFieldValue(field, getMemberCustomFieldValue(member, field)) || '—'}</dd>
                </div>
              ))}
            </dl>

            <div className="member-dir-card-actions">
              <button type="button" className="member-dir-action member-dir-action--primary" onClick={() => onView(member)}>
                <Eye size={15} aria-hidden="true" /> {t('الملف', 'Profile')}
              </button>
              <button type="button" className="member-dir-action" onClick={() => onEdit(member)}>
                <Pencil size={15} aria-hidden="true" /> {t('تعديل', 'Edit')}
              </button>
              {onResetPassword && (
                <button
                  type="button"
                  className="member-dir-action member-dir-action--icon"
                  onClick={() => onResetPassword(member)}
                  aria-label={`${t('إعادة تعيين كلمة المرور', 'Reset password')} ${member.full_name}`}
                  title={t('إعادة تعيين كلمة المرور إلى 123456789', 'Reset the password to 123456789')}
                >
                  <KeyRound size={15} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="member-dir-action member-dir-action--icon"
                onClick={() => onDelete(member)}
                aria-label={`${t('حذف سجل العضو فقط', 'Delete profile record only')} ${member.full_name}`}
                title={t('حذف سجل العضو فقط', 'Delete profile record only')}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>

            {isOwner && (
              <details id={`member-owner-actions-${member.id}`} className="member-dir-owner">
                <summary>
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ShieldAlert size={15} aria-hidden="true" />
                    <span className="truncate">{t('إجراء المالك المتقدم', 'Advanced owner action')}</span>
                  </span>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className="member-dir-owner-body">
                  <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
                    {t(
                      'محو نهائي اختياري للهوية وحساب الدخول والبيانات الشخصية؛ يبدأ بمعاينة من الخادم ويتطلب تأكيدًا صريحًا.',
                      'Optional permanent erasure of identity, sign-in account and personal data; starts with a server preview and requires explicit confirmation.',
                    )}
                  </p>
                  <OwnerMemberErasure member={member} currentOwnerUserId={currentOwnerUserId} isOwner={isOwner} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
import { KeyRound } from 'lucide-react';
