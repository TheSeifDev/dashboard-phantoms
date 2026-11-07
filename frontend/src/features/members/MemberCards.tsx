import type { Member, MemberCustomField } from '../../types/db';
import { formatCustomFieldValue, getMemberCustomFieldValue } from './customFieldsApi';
import { DeviceChips, ReadinessChip, WorkStatusChip } from './MemberCells';
import { parseBio } from './memberDisplay';
import { Eye, MapPin, Pencil, Trash2 } from 'lucide-react';

export function MemberCards({
  members,
  customFields = [],
  onView,
  onEdit,
  onDelete,
}: {
  members: Member[];
  customFields?: MemberCustomField[];
  onView: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
}) {
  const cardFields = customFields.filter((f) => f.show_in_card !== false);

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3" aria-label="قائمة الأعضاء">
      {members.map((member) => {
        const { specialization } = parseBio(member.bio);
        return (
          <li
            key={member.id}
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
                  className="min-h-0 truncate text-start text-base font-black leading-7 text-[var(--text)] hover:text-[var(--link)] focus-visible:text-[var(--link)]"
                >
                  {member.full_name}
                </button>
                <span
                  className={`truncate text-sm leading-6 ${
                    specialization ? 'text-[var(--text-2)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {specialization || 'التخصص مش محدد'}
                </span>
              </div>
              <WorkStatusChip status={member.work_status} />
            </div>

            <dl className="grid gap-2 border-t border-[var(--border)] pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                  <MapPin size={14} aria-hidden="true" />
                  الإقامة
                </dt>
                <dd className="truncate font-bold text-[var(--text-2)]">{member.residence || '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs font-semibold text-[var(--text-muted)]">النزول الميداني</dt>
                <dd>
                  <ReadinessChip ready={Boolean(member.can_go_alexandria)} />
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-xs font-semibold text-[var(--text-muted)]">الأجهزة</dt>
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
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--primary-soft)] px-3 text-sm font-bold text-[var(--link)] transition-colors hover:bg-[var(--primary)] hover:text-white"
              >
                <Eye size={16} aria-hidden="true" /> الملف
              </button>
              <button
                type="button"
                onClick={() => onEdit(member)}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 text-sm font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <Pencil size={16} aria-hidden="true" /> تعديل
              </button>
              <button
                type="button"
                onClick={() => onDelete(member)}
                className="grid size-10 min-h-0 min-w-0 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                aria-label={`امسح ${member.full_name}`}
                title="مسح العضو"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
