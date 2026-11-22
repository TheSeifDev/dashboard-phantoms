import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, CircleMinus, Eye, Link2, MoreHorizontal, Settings2, UserCheck, UserPlus, Users, X } from 'lucide-react';
import type { Member, MemberInsert } from '../../types/db';
import { useMembers, useAddMember, useUpdateMember, useDeleteMember } from './api';
import { useMemberCustomFields } from './customFieldsApi';
import { useNotes } from '../notes/api';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { MemberToolbar } from './MemberToolbar';
import { EMPTY_MEMBER_FILTERS, type MemberFiltersValue } from './MemberToolbar';
import { MemberCards } from './MemberCards';
import { MemberProfileModal } from './MemberProfileModal';
import { MemberEditor } from './MemberEditor';
import { MemberCustomFieldsModal } from './MemberCustomFieldsModal';
import { MemberInviteModal } from './MemberInviteModal';
import { MemberJoinReviewQueue } from './MemberJoinReviewQueue';
import { MemberExcelActions } from './MemberExcelActions';
import { sanitizeText, isValidEmail, isValidEgyptianPhone } from '../../lib/validators';
import { handleSupabaseError, logError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useMemberDeletionStore } from '../../store/memberDeletion';
import { MemberDeletionError, type MemberDeletionErrorCode } from './member-delete-errors';

import { hasRequiredMemberInformation, memberSearchText } from './member-profile-display';
import { MemberProfileReminderAction } from './MemberProfileReminderAction';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { useAdminAccess } from '../admin/access/api';
import { useOwnerAppUsage } from '../app-usage/api';
import type { AppUsageDisplay } from '../app-usage/MemberAppUsageDetails';
import './member-directory.css';
const emptyMember: MemberInsert = {
  email: '',
  full_name: '',
  completion_rank: null,
  team_notes: null,
  residence: '',
  work_conditions: '',
  bio: '',
  phone: '',
  device: 'لابتوب',
  gender: '',
  meeting_attendance: null,
  work_status: 'active',
  can_go_alexandria: false,
  custom_fields: {},
};

const PAGE_SIZES = [12, 24, 48] as const;
const DELETE_UNDO_MS = 5000;

function memberDeletionIssueCopy(code: MemberDeletionErrorCode, t: (arabic: string, english: string) => string) {
  switch (code) {
    case 'member_delete_dependency_invitations':
      return {
        title: t('الحذف العادي موقوف لحفظ سجل الدعوات', 'Standard deletion is blocked to preserve invitation history'),
        description: t(
          'الخادم رفض حذف سجل العضو لأن دعوة محفوظة ما زالت مرتبطة به. لم يُحذف سجل العضو. لا تحذف الدعوة يدويًا ولا تغيّر قيد قاعدة البيانات. هذا الإجراء يخص سجل الملف فقط، ولا يحذف حساب الدخول أو يزيل صلاحية Admin.',
          'The server rejected deletion of this member record because a saved invitation still references it. The member record was not deleted. Do not delete the invitation manually or change a database constraint. This action affects only the profile record; it does not delete the sign-in account or revoke Admin access.',
        ),
      };
    case 'member_delete_dependency_team':
    case 'member_delete_dependency_projects':
    case 'member_delete_dependency_other':
      return {
        title: t('تعذر حذف سجل العضو بسبب سجل مرتبط', 'The member record is linked to another record'),
        description: t(
          'رفض الخادم حذف سجل الملف لحماية البيانات المرتبطة. لم يُحذف السجل؛ راجع الارتباط المناسب ولا تحذف بيانات فريق أو مشروع مشترك يدويًا.',
          'The server rejected profile-record deletion to protect linked data. The record was not deleted; review the relevant relationship and do not manually remove shared team or project data.',
        ),
      };
    case 'member_delete_no_match':
      return {
        title: t('لم يتأكد حذف سجل مطابق', 'No matching record deletion was confirmed'),
        description: t('لم يؤكد الخادم حذف سجل واحد مطابق. حدّث القائمة وتحقق من حالة العضو قبل إعادة المحاولة.', 'The server did not confirm deletion of exactly one matching record. Refresh the list and check the member status before retrying.'),
      };
    case 'member_delete_permission':
      return {
        title: t('تعذّر الحذف بسبب الصلاحيات', 'Deletion was blocked by permissions'),
        description: t('لم يتأكد حذف سجل العضو. حدّث الجلسة وراجع صلاحيات الإدارة قبل المحاولة مرة أخرى.', 'Deletion of the member record was not confirmed. Refresh your session and review administrator access before trying again.'),
      };
    case 'member_delete_missing_schema':
      return {
        title: t('مسار الحذف غير متاح حاليًا', 'The deletion path is currently unavailable'),
        description: t('لم يتأكد حذف سجل العضو. تواصل مع مسؤول النظام؛ لا تحاول تعديل قاعدة البيانات يدويًا.', 'Deletion of the member record was not confirmed. Contact the system administrator; do not modify the database manually.'),
      };
    case 'member_delete_unknown':
    default:
      return {
        title: t('نتيجة الحذف غير مؤكدة', 'Deletion outcome is not confirmed'),
        description: t('تعذّر تأكيد النتيجة. حدّث القائمة قبل أي إعادة محاولة؛ لم نعرض نجاحًا أو تفاصيل تقنية خام.', 'The outcome could not be confirmed. Refresh the list before retrying; no success or raw technical details are shown.'),
      };
  }
}

export default function MembersPage() {
  const { t, number, dir } = useLocale();
  const query = useMembers();
  const customFieldsQuery = useMemberCustomFields();
  const notesQuery = useNotes();
  const add = useAddMember();
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const access = useAdminAccess(ownerId);
  const isOwner = Boolean(ownerId) && access.data?.is_owner === true && !access.isError && access.isFetchedAfterMount;
  const update = useUpdateMember();
  const remove = useDeleteMember();
  const [filters, setFilters] = useState<MemberFiltersValue>({
    ...EMPTY_MEMBER_FILTERS,
  });
  const [editing, setEditing] = useState<Member | null>(null);
  const [drawerMember, setDrawerMember] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberInsert>(emptyMember);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customFieldsModalOpen, setCustomFieldsModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [deletionIssue, setDeletionIssue] = useState<{ member: Member; code: MemberDeletionErrorCode } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(12);
  const actionsMenuRef = useRef<HTMLDetailsElement>(null);
  const mountedRef = useRef(false);
  const scheduleDelete = useMemberDeletionStore((state) => state.scheduleDelete);
  const pendingDeleteMap = useMemberDeletionStore((state) => state.pendingMap);

  const customFields = customFieldsQuery.data ?? [];
  const hasActiveFilters =
    filters.search.trim() !== '' ||
    filters.work_conditions !== 'ALL' ||
    filters.device !== 'ALL' ||
    filters.alexandria !== 'ALL' ||
    filters.activity !== 'ALL' ||
    filters.information !== 'ALL';

  const workConditions = useMemo(
    () => [
      ...new Set(
        (query.data ?? [])
          .map((member) => member.work_conditions)
          .filter((c): c is string => Boolean(c)),
      ),
    ],
    [query.data],
  );

  const memberMetrics = useMemo(() => {
    const members = query.data ?? [];
    const activeCount = members.filter((member) => member.work_status === 'active').length;
    return {
      total: members.length,
      active: activeCount,
      inactive: members.length - activeCount,
      incomplete: members.filter((member) => !hasRequiredMemberInformation(member)).length,
    };
  }, [query.data]);

  const visibleMembers = useMemo(
    () => {
      const filtered = (query.data ?? []).filter((member) => {
        if (pendingDeleteMap[member.id]) return false;
        const term = filters.search.trim().toLowerCase();
        const matchesText = !term || memberSearchText(member).includes(term);
        const matchesWorkConditions =
          filters.work_conditions === 'ALL' || member.work_conditions === filters.work_conditions;
        const matchesDevice =
          filters.device === 'ALL' || (member.device ?? '').includes(filters.device);
        const matchesAlexandria =
          filters.alexandria === 'ALL' || member.can_go_alexandria === (filters.alexandria === 'YES');
        const matchesActivity = filters.activity === 'ALL' ||
          (filters.activity === 'ACTIVE' ? member.work_status === 'active' : member.work_status !== 'active');
        const informationComplete = hasRequiredMemberInformation(member);
        const matchesInformation = filters.information === 'ALL' ||
          (filters.information === 'COMPLETE' ? informationComplete : !informationComplete);
        return matchesText && matchesWorkConditions && matchesDevice && matchesAlexandria && matchesActivity && matchesInformation;
      });
      const byName = (left: Member, right: Member) => left.full_name.localeCompare(right.full_name, 'ar');
      switch (filters.sort) {
        case 'newest':
          return [...filtered].sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''));
        case 'oldest':
          return [...filtered].sort((left, right) => (left.created_at ?? '').localeCompare(right.created_at ?? ''));
        case 'incomplete':
          return [...filtered].sort((left, right) => {
            const gap = Number(hasRequiredMemberInformation(left)) - Number(hasRequiredMemberInformation(right));
            return gap !== 0 ? gap : byName(left, right);
          });
        default:
          return [...filtered].sort(byName);
      }
    },
    [filters, query.data, pendingDeleteMap],
  );

  // العودة لأول صفحة عند تغير الفلاتر أو البيانات أو حجم الصفحة
  useEffect(() => {
    setPage(0);
  }, [filters, pageSize, query.data?.length]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(visibleMembers.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageMembers = visibleMembers.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const rangeStart = visibleMembers.length ? safePage * pageSize + 1 : 0;
  const rangeEnd = Math.min(visibleMembers.length, safePage * pageSize + pageSize);
  const usageIds = [...pageMembers.map((member) => member.id), ...(drawerMember ? [drawerMember.id] : [])];
  const usageQuery = useOwnerAppUsage(ownerId, isOwner, usageIds);
  const usageStatus = usageQuery.isError ? 'unavailable' : usageQuery.isPending || !usageQuery.isFetchedAfterMount ? 'checking' : 'ready';
  const appUsage: Record<number, AppUsageDisplay> | undefined = isOwner
    ? Object.fromEntries(usageIds.map((id) => [id, { status: usageStatus, usage: usageStatus === 'ready' ? usageQuery.data?.find((row) => row.member_id === id) : undefined }]))
    : undefined;
  const deletionIssueCopy = deletionIssue ? memberDeletionIssueCopy(deletionIssue.code, t) : null;

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyMember, custom_fields: {} });
    setFormError('');
    setDialogOpen(true);
  };

  const closeActionsMenu = () => {
    if (actionsMenuRef.current) actionsMenuRef.current.open = false;
  };

  const openEdit = (member: Member) => {
    setDrawerMember(null);
    setEditing(member);
    setForm({
      email: member.email,
      full_name: member.full_name,
      completion_rank: member.completion_rank,
      team_notes: member.team_notes,
      residence: member.residence ?? '',
      work_conditions: member.work_conditions ?? '',
      bio: member.bio ?? '',
      phone: member.phone ?? '',
      device: member.device ?? 'لابتوب',
      gender: member.gender ?? '',
      meeting_attendance: member.meeting_attendance,
      work_status: member.work_status ?? 'active',
      can_go_alexandria: member.can_go_alexandria,
      custom_fields: member.custom_fields ? { ...member.custom_fields } : {},
    });
    setFormError('');
    setDialogOpen(true);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');

    const trimmedName = sanitizeText(form.full_name.trim());
    const trimmedEmail = form.email.trim().toLowerCase();

    if (!trimmedName || !trimmedEmail) {
      setFormError(t('الاسم والبريد الإلكتروني لازم يتكتبوا.', 'Name and email are required.'));
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFormError(t('البريد الإلكتروني مش صالح. لازم يكون فيه @ ونطاق صحيح.', 'Enter a valid email address.'));
      return;
    }

    const trimmedPhone = (form.phone || '').trim();
    if (trimmedPhone && !isValidEgyptianPhone(trimmedPhone)) {
      setFormError(t('رقم الهاتف مش صالح. استخدم رقم مصري صحيح: 01xxxxxxxxx أو +20xxxxxxxxxx.', 'Enter a valid Egyptian phone number (01xxxxxxxxx or +20xxxxxxxxxx).'));
      return;
    }

    try {
      const cleanedForm: MemberInsert = {
        ...form,
        full_name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone || null,
        bio: sanitizeText(form.bio || ''),
        custom_fields: form.custom_fields ?? {},
      };

      if (editing) await update.mutateAsync({ id: editing.id, ...cleanedForm });
      else await add.mutateAsync(cleanedForm);
      setDialogOpen(false);
      toast.success(editing ? t('بيانات العضو اتحفظت بنجاح.', 'Member details saved.') : t('العضو الجديد اتسجّل بنجاح.', 'Member added successfully.'));
    } catch (cause) {
      logError(cause, 'MembersPage.save');
      const error = handleSupabaseError(cause);
      setFormError(error.message);
    }
  };

  // حذف مؤجل 5 ثوانٍ مع تراجع — يُدار عبر store عام للحفاظ على مؤقت التراجع عبر التنقل ومنع الحذف الإجباري عند unmount
  const confirmDelete = () => {
    const target = memberToDelete;
    if (!target) return;
    setMemberToDelete(null);
    setDeletionIssue(null);
    scheduleDelete(
      target,
      (id) => remove.mutateAsync(id),
      DELETE_UNDO_MS,
      (cause) => {
        logError(cause, 'MembersPage.deleteMember');
        if (!mountedRef.current) return;
        setDeletionIssue({
          member: target,
          code: cause instanceof MemberDeletionError ? cause.code : 'member_delete_unknown',
        });
      },
      () => {
        if (mountedRef.current) setDeletionIssue(null);
      },
    );
  };

  const askDelete = (member: Member) => {
    setDrawerMember(null);
    setMemberToDelete(member);
  };

  const openOwnerErasureOptions = (memberId: number) => {
    const panel = document.getElementById(`member-owner-actions-${memberId}`);
    if (!panel || panel.tagName !== 'DETAILS') return;
    const details = panel as HTMLDetailsElement;
    details.open = true;
    const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    details.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };

  return (
    <section className="member-dir" id="page-members" dir={dir}>
      <header className="member-dir-hero glass-card">
        <div className="member-dir-hero-copy">
          <p className="member-dir-eyebrow">
            <span className="live-dot" aria-hidden="true" />
            PHANTOMS · {t('دليل الأعضاء', 'MEMBER DIRECTORY')}
          </p>
          <h1 className="member-dir-title">{t('دليل الأعضاء وجاهزيتهم', 'Members and readiness')}</h1>
          <p className="member-dir-subtitle">
            {t(
              'حالة الشغل، الأجهزة، الاستعداد للنزول الميداني واكتمال البيانات — كل عضو في بطاقة واحدة واضحة، مع فلاتر سريعة توصل للي محتاجه في ثانية.',
              'Work status, devices, field readiness and profile completeness — every member in one clear card, with quick filters that get you there in seconds.',
            )}
          </p>
          <ul className="member-dir-chips" aria-label={t('ملخص سريع', 'Quick summary')}>
            <li data-tone="blue">
              {t(`${number(memberMetrics.total)} عضو مسجّل`, `${number(memberMetrics.total)} registered`)}
            </li>
            <li data-tone="green">
              {t(`${number(memberMetrics.active)} نشط`, `${number(memberMetrics.active)} active`)}
            </li>
            <li data-tone="amber">
              {t(`${number(memberMetrics.incomplete)} يحتاج بيانات`, `${number(memberMetrics.incomplete)} need info`)}
            </li>
          </ul>
        </div>

        <div className="member-dir-actions">
          <Button onClick={openNew} icon={<UserPlus size={17} aria-hidden="true" />} variant="primary" className="member-dir-cta whitespace-nowrap">
            {t('إضافة عضو', 'Add member')}
          </Button>
          <Button variant="secondary" onClick={() => setInviteModalOpen(true)} icon={<Link2 size={16} aria-hidden="true" />} className="member-dir-cta whitespace-nowrap">
            {t('رابط التسجيل', 'Registration link')}
          </Button>
          <details className="member-dir-menu" ref={actionsMenuRef}>
            <summary className="member-dir-menu-trigger" aria-label={t('مزيد من إجراءات الدليل', 'More directory actions')}>
              <MoreHorizontal size={18} aria-hidden="true" />
              <span>{t('المزيد', 'More')}</span>
            </summary>
            <div className="member-dir-menu-panel" onClick={closeActionsMenu}>
              <p className="member-dir-menu-label">{t('أدوات الدليل', 'Directory tools')}</p>
              <button
                type="button"
                className="member-dir-menu-item"
                onClick={() => setCustomFieldsModalOpen(true)}
              >
                <Settings2 size={16} aria-hidden="true" />
                <span>{t('الحقول المخصصة', 'Custom fields')}</span>
                {customFields.length > 0 && <em>{number(customFields.length)}</em>}
              </button>
              <MemberProfileReminderAction members={query.data ?? []} />
              <MemberExcelActions members={query.data ?? []} customFields={customFields} />
              <Link to="/admin/members/experience" className="member-dir-menu-item">
                <Eye size={16} aria-hidden="true" />
                <span>{t('معاينة واجهة العضو', 'Preview member experience')}</span>
              </Link>
            </div>
          </details>
        </div>
      </header>

      <div className="member-dir-stats" aria-label={t('ملخص دليل الأعضاء', 'Member directory summary')}>
        {[
          {
            key: 'all',
            label: t('كل الأعضاء', 'All members'),
            note: t('السجل الكامل', 'Whole roster'),
            value: memberMetrics.total,
            Icon: Users,
            tone: 'blue',
            selected: !hasActiveFilters,
            onClick: () => setFilters({ ...EMPTY_MEMBER_FILTERS, sort: filters.sort }),
          },
          {
            key: 'active',
            label: t('نشطون', 'Active'),
            note: t('جاهزون للعمل', 'Ready to work'),
            value: memberMetrics.active,
            Icon: UserCheck,
            tone: 'green',
            selected: filters.activity === 'ACTIVE',
            onClick: () => setFilters((current) => ({ ...current, activity: current.activity === 'ACTIVE' ? 'ALL' : 'ACTIVE' })),
          },
          {
            key: 'incomplete',
            label: t('يلزم استكمال بياناتهم', 'Need information'),
            note: t('بيانات ناقصة', 'Missing details'),
            value: memberMetrics.incomplete,
            Icon: AlertTriangle,
            tone: 'amber',
            selected: filters.information === 'MISSING',
            onClick: () => setFilters((current) => ({ ...current, information: current.information === 'MISSING' ? 'ALL' : 'MISSING' })),
          },
          {
            key: 'inactive',
            label: t('غير نشطين', 'Inactive'),
            note: t('خارج الخدمة', 'Out of service'),
            value: memberMetrics.inactive,
            Icon: CircleMinus,
            tone: 'red',
            selected: filters.activity === 'INACTIVE',
            onClick: () => setFilters((current) => ({ ...current, activity: current.activity === 'INACTIVE' ? 'ALL' : 'INACTIVE' })),
          },
        ].map(({ key, label, note, value, Icon, tone, selected, onClick }) => (
          <button
            key={key}
            type="button"
            className="member-dir-stat"
            data-tone={tone}
            onClick={onClick}
            disabled={query.data === undefined || query.isError}
            aria-pressed={selected}
          >
            <span className="member-dir-stat-top">
              <span className="member-dir-stat-label">{label}</span>
              <span className="member-dir-stat-icon" aria-hidden="true"><Icon /></span>
            </span>
            <span className="member-dir-stat-figure">
              <span className="member-dir-stat-value">{query.data === undefined || query.isError ? '—' : number(value)}</span>
              <span className="member-dir-stat-note">{note}</span>
            </span>
            <span className="member-dir-stat-meter" aria-hidden="true">
              <span
                style={{
                  width: query.data === undefined || query.isError || !memberMetrics.total
                    ? '0%'
                    : `${Math.round((value / memberMetrics.total) * 100)}%`,
                }}
              />
            </span>
          </button>
        ))}
      </div>

      {deletionIssue && deletionIssueCopy && (
        <section className="member-dir-notice" role="alert" aria-live="assertive" aria-atomic="true">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div className="grid min-w-0 flex-1 gap-1">
            <h2>{deletionIssueCopy.title}</h2>
            <p className="text-xs font-bold text-[var(--text-2)]">{deletionIssue.member.full_name}</p>
            <p>{deletionIssueCopy.description}</p>
            {deletionIssue.code === 'member_delete_dependency_invitations' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isOwner ? (
                  <>
                    <p className="text-xs leading-5 text-[var(--text-2)]">
                      {t('فتح معاينة المالك لا يحذف شيئًا. راجع الهدف والأثر أولًا؛ التنفيذ النهائي اختياري ويحتاج تأكيدًا منفصلًا.', 'Opening the owner preview deletes nothing. Review the target and impact first; permanent execution is optional and needs separate confirmation.')}
                    </p>
                    <button
                      type="button"
                      onClick={() => openOwnerErasureOptions(deletionIssue.member.id)}
                      aria-controls={`member-owner-actions-${deletionIssue.member.id}`}
                      className="member-dir-button"
                    >
                      {t('افتح معاينة المالك الآمنة', 'Open safe owner preview')}
                    </button>
                  </>
                ) : (
                  <p className="text-xs leading-5 text-[var(--text-2)]">
                    {t('إجراء المعاينة النهائية متاح للمالك فقط. اطلب من Owner مراجعة هذا السجل.', 'The permanent-erasure preview is available to the Owner only. Ask the Owner to review this record.')}
                  </p>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setDeletionIssue(null)} className="member-dir-dismiss" aria-label={t('إغلاق التنبيه', 'Dismiss alert')}>
            <X size={16} aria-hidden="true" />
          </button>
        </section>
      )}

      <MemberJoinReviewQueue />

      {isOwner && usageQuery.isError && (
        <div className="member-dir-notice" role="status">
          <p className="min-w-0 flex-1">
            {t('مؤشر استخدام التطبيق غير متاح حاليًا. لا يعني هذا أن الأعضاء لم يستخدموه؛ يلزم تفعيل schema الجديدة أو إعادة المحاولة.', 'App-use evidence is currently unavailable. This does not mean members have not used it; the new schema must be enabled or the request retried.')}
          </p>
          <Button variant="secondary" onClick={() => { void usageQuery.refetch(); }}>{t('إعادة المحاولة', 'Retry')}</Button>
        </div>
      )}

      <MemberToolbar
        workConditions={workConditions}
        value={filters}
        onChange={setFilters}
        resultCount={visibleMembers.length}
        totalCount={query.data?.length ?? 0}
      />

      <div className="min-w-0 w-full">
        {query.isLoading ? (
          <div className="py-6">
            <CardSkeletons count={6} />
          </div>
        ) : query.isError ? (
          <div className="py-6">
            <ErrorState
              message={t('معرفناش نحمّل سجلات الأعضاء.', 'Could not load member records.')}
              onRetry={() => {
                void query.refetch();
              }}
            />
          </div>
        ) : visibleMembers.length ? (
          <>
            <MemberCards
              members={pageMembers}
              customFields={customFields}
              appUsage={appUsage}
              isOwner={isOwner}
              currentOwnerUserId={ownerId}
              onView={setDrawerMember}
              onEdit={openEdit}
              onDelete={askDelete}
            />

            <nav className="member-dir-pagination glass-card mt-3" aria-label={t('التنقل بين الصفحات', 'Pagination')}>
              <div className="member-dir-pagination-group">
                <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-muted)]" htmlFor="member-page-size">
                  {t('لكل صفحة', 'Per page')}
                  <select
                    id="member-page-size"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="member-dir-page-size"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <p role="status">
                  {t('عرض', 'Showing')} {number(rangeStart)}–{number(rangeEnd)} {t('من', 'of')} {number(visibleMembers.length)}
                </p>
              </div>
              <span className="member-dir-pagination-group">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="member-dir-page-button"
                  aria-label={t('الصفحة السابقة', 'Previous page')}
                >
                  {dir === 'rtl' ? <ChevronRight size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
                </button>
                <p aria-current="page">
                  {t('صفحة', 'Page')} {number(safePage + 1)} {t('من', 'of')} {number(totalPages)}
                </p>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="member-dir-page-button"
                  aria-label={t('الصفحة التالية', 'Next page')}
                >
                  {dir === 'rtl' ? <ChevronLeft size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
                </button>
              </span>
            </nav>
          </>
        ) : hasActiveFilters ? (
          <div className="member-dir-empty">
            <EmptyState
              title={t('لا توجد نتائج مطابقة', 'No matching members')}
              description={t('لم نعثر على أعضاء يطابقون البحث والفلاتر الحالية. امسح الفلاتر أو عدّلها لرؤية المزيد.', 'No members match the current search and filters. Clear or adjust them to see more results.')}
            />
          </div>
        ) : query.data?.length === 0 ? (
          <div className="member-dir-empty">
            <EmptyState
              title={t('لا يوجد أعضاء بعد', 'No members yet')}
              description={t('ابدأ بإضافة عضو يدويًا أو أنشئ رابط تسجيل ليقدّم العضو بياناته بنفسه.', 'Add a member manually or create a registration link so they can submit their own details.')}
            />
            <Button onClick={openNew} icon={<UserPlus size={17} aria-hidden="true" />}>
              {t('إضافة أول عضو', 'Add the first member')}
            </Button>
          </div>
        ) : (
          <div className="member-dir-empty">
            <EmptyState
              title={t('لا يوجد أعضاء ظاهرون الآن', 'No members are visible right now')}
              description={t('قد تكون بعض السجلات بانتظار اكتمال إجراء الحذف. حدّث القائمة بعد انتهاء الإجراء.', 'Some records may be pending deletion. Refresh the list after that action completes.')}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(memberToDelete)}
        onClose={() => setMemberToDelete(null)}
        onConfirm={confirmDelete}
        title={t('تأكيد حذف سجل العضو', 'Confirm member profile record deletion')}
        itemName={memberToDelete?.full_name}
        description={
          memberToDelete
            ? t(`سيُطلب حذف ${memberToDelete.full_name} بعد 5 ثوانٍ يمكنك خلالها التراجع. لا يتم الحذف إلا بعد تأكيد الخادم؛ سجلات الدعوات أو الفرق أو المشروعات قد تمنعه لحماية التاريخ. هذا لا يحذف حساب تسجيل الدخول ولا يلغي Admin.`, `Deletion of ${memberToDelete.full_name} will be requested after a 5-second undo window. It is complete only after server confirmation; invitation, team or project history may block it. This does not delete the sign-in account or revoke Admin access.`)
            : undefined
        }
        confirmLabel={t('حذف سجل العضو فقط', 'Delete profile record only')}
        isPending={false}
        pendingLabel={t('بنمسح...', 'Deleting...')}
      />

      <MemberProfileModal
        isOpen={Boolean(drawerMember)}
        member={drawerMember}
        customFields={customFields}
        appUsage={drawerMember ? appUsage?.[drawerMember.id] : undefined}
        notes={notesQuery.data ?? []}
        onClose={() => setDrawerMember(null)}
        onEdit={openEdit}
        onDelete={askDelete}
      />

      <MemberEditor
        isOpen={dialogOpen}
        isSaving={add.isPending || update.isPending}
        member={editing}
        value={form}
        customFields={customFields}
        error={formError}
        onChange={setForm}
        onClose={() => setDialogOpen(false)}
        onSubmit={save}
        onManageCustomFields={() => setCustomFieldsModalOpen(true)}
        onOpenInviteModal={() => {
          setDialogOpen(false);
          setInviteModalOpen(true);
        }}
      />

      <MemberCustomFieldsModal
        isOpen={customFieldsModalOpen}
        fields={customFields}
        onClose={() => setCustomFieldsModalOpen(false)}
      />

      <MemberInviteModal
        isOpen={inviteModalOpen}
        onClose={() => {
          setInviteModalOpen(false);
          void query.refetch();
        }}
      />
    </section>
  );
}
