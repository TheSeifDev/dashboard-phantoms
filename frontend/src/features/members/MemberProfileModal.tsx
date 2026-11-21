import { useMemo } from 'react';
import {
  Laptop,
  MapPin,
  Phone,
  Award,
  CheckCircle2,
  XCircle,
  Edit2,
  Shield,
  FileText,
  Briefcase,
  Trash2,
  Tag,
  GraduationCap,
  Mail,
  Link2,
} from 'lucide-react';
import type { Member, MemberCustomField, Note } from '../../types/db';
import { formatCustomFieldValue, getMemberCustomFieldValue, useMemberCustomFields } from './customFieldsApi';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { calculateBonus } from '../dashboard/metrics';
import { useLocale } from '../../i18n/useLocale';

interface MemberProfileModalProps {
  isOpen: boolean;
  member: Member | null;
  customFields?: MemberCustomField[];
  notes?: Note[];
  onClose: () => void;
  onEdit?: (member: Member) => void;
  onAdjustBonus?: (member: Member) => void;
  onDelete?: (member: Member) => void;
}

export function MemberProfileModal({
  isOpen,
  member,
  customFields,
  notes = [],
  onClose,
  onEdit,
  onAdjustBonus,
  onDelete,
}: MemberProfileModalProps) {
  const { t, number, dir } = useLocale();
  const { data: queriedFields } = useMemberCustomFields();
  const activeCustomFields = customFields ?? queriedFields ?? [];
  const bonus = useMemo(() => {
    if (!member) return 0;
    return calculateBonus(notes, member.id);
  }, [member, notes]);

  const memberNotes = useMemo(() => {
    if (!member) return [];
    return notes.filter((n) => n.target_member_id === member.id);
  }, [member, notes]);

  if (!member) return null;

  const d = (member.device || '').toLowerCase();
  const hasLaptop = d.includes('لاب') || d.includes('الاثنان') || d.includes('laptop');

  const customInfoItems = activeCustomFields.map((field) => {
    const rawVal = getMemberCustomFieldValue(member, field);
    const formatted = formatCustomFieldValue(field, rawVal);
    return {
      icon: Tag,
      label: field.label,
      val: formatted || t('مش محدد', 'Not specified'),
      dir: undefined,
      isAlex: false,
    };
  });

  const infoItems = [
    { icon: Phone, label: t('رقم الهاتف (WhatsApp)', 'WhatsApp phone number'), val: member.phone || t('مش متسجل', 'Not provided'), dir: 'ltr' as const, isAlex: false },
    { icon: GraduationCap, label: t('الرقم الأكاديمي', 'Academic number'), val: member.academic_number || t('يلزم الاستكمال', 'Completion required'), dir: 'ltr' as const, isAlex: false },
    { icon: GraduationCap, label: t('المجموعة', 'Academic group'), val: member.academic_group || t('يلزم الاستكمال', 'Completion required'), dir: undefined, isAlex: false },
    { icon: Briefcase, label: t('التخصص في التيم', 'Primary specialization'), val: member.specialization ? ({ software: 'Software', hardware: 'Hardware', ai: 'AI' }[member.specialization]) : t('يلزم الاستكمال', 'Completion required'), dir: 'ltr' as const, isAlex: false },
    { icon: Mail, label: t('البريد الجامعي', 'University email'), val: member.university_email || t('يظهر بعد الرقم الأكاديمي', 'Derived from academic number'), dir: 'ltr' as const, isAlex: false },
    { icon: Link2, label: 'LinkedIn', val: member.linkedin_url || t('غير مضاف (اختياري)', 'Not provided (optional)'), dir: 'ltr' as const, isAlex: false },
    { icon: Link2, label: 'GitHub / Portfolio / Behance', val: member.portfolio_url || t('غير مضاف (اختياري)', 'Not provided (optional)'), dir: 'ltr' as const, isAlex: false },
    { icon: MapPin, label: t('محل الإقامة', 'Residence'), val: member.residence || t('مش محدد', 'Not specified'), dir: undefined, isAlex: false },
    {
      icon: Laptop,
      label: t('العتاد وجاهزية اللابتوب', 'Equipment and laptop readiness'),
      val: `${member.device || t('بدون جهاز', 'No device')} ${hasLaptop ? t('(معاه لابتوب)', '(laptop available)') : ''}`,
      dir: undefined,
      isAlex: false,
    },
    {
      icon: member.can_go_alexandria ? CheckCircle2 : XCircle,
      label: t('النزول لاجتماع الإسكندرية', 'Alexandria in-person meetings'),
      val: member.can_go_alexandria ? t('جاهز للنزول الميداني', 'Available for field work') : t('مش متاح دلوقتي', 'Currently unavailable'),
      dir: undefined,
      isAlex: true,
    },
    { icon: Briefcase, label: t('ظروف العمل / الدراسة', 'Work / study conditions'), val: member.work_conditions || t('مفيش تفاصيل', 'No details'), dir: undefined, isAlex: false },
    { icon: Shield, label: t('رتبة الإنجاز', 'Completion rank'), val: member.completion_rank ? `#${number(member.completion_rank)}` : t('مش محدد', 'Not specified'), dir: undefined, isAlex: false },
    ...customInfoItems,
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("ملف العضو", "Member profile")} maxWidth="3xl">
      <div className="grid gap-5 text-start" dir={dir}>
        {/* Header Summary */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-xl font-black text-white">
              {member.full_name.trim().charAt(0)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-black text-[var(--text)]">{member.full_name}</h3>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                    member.work_status === 'active'
                      ? 'bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                  }`}
                >
                  {member.work_status === 'active' ? t('نشط', 'Active') : t('غير نشط', 'Inactive')}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]" dir="ltr">
                {member.email}
              </p>
            </div>
          </div>

          {/* Bonus Badge */}
          <div className="flex items-center gap-3 sm:flex-col sm:items-end">
            <div className="text-xs font-bold text-[var(--text-muted)]">{t("رصيد التقييم (البونص)", "Evaluation bonus balance")}</div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1 text-sm font-black ${
                  member.bonus_infinite === true
                    ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--link)]'
                    : bonus > 0
                    ? 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:border-[var(--success-border)] dark:bg-[var(--success-soft)] dark:text-[var(--success-text)]'
                    : bonus < 0
                    ? 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                }`}
              >
                <Award size={15} />
                {member.bonus_infinite === true ? (
                  <span aria-label={t("بونص غير محدود", "Unlimited bonus")}>{t("بونص غير محدود", "Unlimited bonus")}</span>
                ) : (
                  `${number(bonus)} ${t("نقطة", "points")}`
                )}
              </span>
              {onAdjustBonus && (
                <button
                  type="button"
                  onClick={() => onAdjustBonus(member)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--primary-ink)] hover:bg-[var(--primary-soft)]"
                >
                  {t('تعديل', 'Edit')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          {infoItems.map(({ icon: Icon, label, val, dir, isAlex }, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                  isAlex
                    ? member.can_go_alexandria
                      ? 'bg-[var(--success-soft)] text-[var(--success-text)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                }`}
              >
                <Icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-[var(--text-muted)]">{label}</span>
                <span className="block break-words text-sm font-semibold text-[var(--text)]" dir={dir}>
                  {val}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Bio */}
        {member.bio && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <span className="block text-xs font-bold text-[var(--text-muted)]">{t("نبذة / التخصص", "Bio / specialty")}</span>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text)]">{member.bio}</p>
          </div>
        )}

        {/* Team Notes */}
        {member.team_notes && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] p-3.5">
            <span className="block text-xs font-bold text-[var(--primary-ink)]">{t("ملاحظات الإدارة على العضو", "Admin notes about member")}</span>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text)]">{member.team_notes}</p>
          </div>
        )}

        {/* Recent Notes Thread */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <span className="mb-2 flex items-center gap-2 text-xs font-bold text-[var(--text-muted)]">
            <FileText size={14} />
            {t('سجل ملاحظات العضو', 'Member notes')} ({number(memberNotes.length)})
          </span>
          {memberNotes.length > 0 ? (
            <div className="max-h-36 divide-y divide-[var(--border)] overflow-y-auto">
              {memberNotes.slice(0, 5).map((n) => (
                <div key={n.id} className="py-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-[var(--text-2)]">
                    <span>{n.author || t('الإدارة', 'Admin')}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{n.date || ''}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[var(--text)]">{n.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">{t("مفيش ملاحظات متسجلة للعضو ده لسه.", "No notes have been recorded for this member yet.")}</p>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} fullOnMobile className="min-h-11">
              {t('إغلاق', 'Close')}
            </Button>
            {onEdit && (
              <Button
                onClick={() => {
                  onClose();
                  onEdit(member);
                }}
                icon={<Edit2 size={16} aria-hidden="true" />}
                fullOnMobile
                className="min-h-11"
              >
                {t('تعديل البيانات', 'Edit details')}
              </Button>
            )}
          </div>
          {onDelete && (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                onDelete(member);
              }}
              icon={<Trash2 size={16} aria-hidden="true" />}
              fullOnMobile
              className="min-h-11 border-[var(--danger-border)] text-[var(--danger)] hover:border-[var(--danger-border)] hover:bg-[var(--danger-soft)] dark:border-[var(--danger-border)] dark:hover:bg-[var(--danger-soft)]"
            >
              {t('مسح العضو', 'Delete member')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
