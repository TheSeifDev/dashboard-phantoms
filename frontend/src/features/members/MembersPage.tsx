import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Link2, Settings2, UserPlus, Users } from 'lucide-react';
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
import type { MemberFiltersValue } from './MemberToolbar';
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

import { memberSearchText } from './member-profile-display';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { useAdminAccess } from '../admin/access/api';
import { useOwnerAppUsage } from '../app-usage/api';
import type { AppUsageDisplay } from '../app-usage/MemberAppUsageDetails';
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
    search: '',
    work_conditions: 'ALL',
    device: 'ALL',
    alexandria: 'ALL',
  });
  const [editing, setEditing] = useState<Member | null>(null);
  const [drawerMember, setDrawerMember] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberInsert>(emptyMember);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customFieldsModalOpen, setCustomFieldsModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(12);
  const scheduleDelete = useMemberDeletionStore((state) => state.scheduleDelete);
  const pendingDeleteMap = useMemberDeletionStore((state) => state.pendingMap);

  const customFields = customFieldsQuery.data ?? [];
  const hasActiveFilters =
    filters.search.trim() !== '' ||
    filters.work_conditions !== 'ALL' ||
    filters.device !== 'ALL' ||
    filters.alexandria !== 'ALL';

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

  const visibleMembers = useMemo(
    () =>
      (query.data ?? []).filter((member) => {
        if (pendingDeleteMap[member.id]) return false;
        const term = filters.search.trim().toLowerCase();
        const matchesText = !term || memberSearchText(member).includes(term);
        const matchesWorkConditions =
          filters.work_conditions === 'ALL' || member.work_conditions === filters.work_conditions;
        const matchesDevice =
          filters.device === 'ALL' || (member.device ?? '').includes(filters.device);
        const matchesAlexandria =
          filters.alexandria === 'ALL' || member.can_go_alexandria === (filters.alexandria === 'YES');
        return matchesText && matchesWorkConditions && matchesDevice && matchesAlexandria;
      }),
    [filters, query.data, pendingDeleteMap],
  );

  // العودة لأول صفحة عند تغير الفلاتر أو البيانات أو حجم الصفحة
  useEffect(() => {
    setPage(0);
  }, [filters, pageSize, query.data?.length]);

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

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyMember, custom_fields: {} });
    setFormError('');
    setDialogOpen(true);
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
    scheduleDelete(
      target,
      (id) => remove.mutateAsync(id),
      DELETE_UNDO_MS,
      (cause) => logError(cause, 'MembersPage.deleteMember'),
    );
  };

  const askDelete = (member: Member) => {
    setDrawerMember(null);
    setMemberToDelete(member);
  };

  return (
    <section className="flex min-w-0 w-full flex-col gap-4" id="page-members" dir={dir}>
      {/* Brand Header */}
      <div className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]"
              aria-hidden="true"
            >
              <Users size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-[var(--fs-xl)] font-black text-[var(--text)]">{t("دليل الأعضاء وجاهزيتهم", "Members and readiness")}</h1>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                {t("حالة الشغل والأجهزة والاستعداد للنزول الميداني —", "Work status, devices, and field readiness —")}{' '}
                <span className="font-bold tabular-nums text-[var(--link)]">{number(query.data?.length ?? 0)}</span> {t("عضو مسجّل.", "registered members.")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
            <Button
              onClick={openNew}
              icon={<UserPlus size={18} aria-hidden="true" />}
              variant="primary"
              className="whitespace-nowrap"
            >
              {t('إضافة عضو', 'Add member')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setInviteModalOpen(true)}
              icon={<Link2 size={17} aria-hidden="true" />}
              className="whitespace-nowrap"
            >
              {t('رابط تسجيل عضو', 'Registration link')}
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] p-3">
          <p className="min-w-0 flex-1 text-xs leading-6 text-[var(--text-muted)]">{t('بيانات الدراسة والتواصل ظاهرة في كل بطاقة والملف. العضو يستكمل المعلومات المطلوبة من إعداداته؛ يمكنك تجربة الحقول بأمان دون الدخول بحسابه.', 'Academic and contact information appears in every card and profile. Members complete required information in their Settings; you can safely try the fields without signing in as them.')}</p>
          <Link to="/admin/members/experience" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--link)]">{t('معاينة وتجربة واجهة العضو', 'Preview member experience')}</Link>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs font-bold text-[var(--text-muted)]">
            {t('إدارة الحقول الإضافية وملفات البيانات', 'Manage custom fields and member data')}
          </span>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Button
              variant="secondary"
              onClick={() => setCustomFieldsModalOpen(true)}
              icon={<Settings2 size={16} aria-hidden="true" />}
              fullOnMobile
              className="col-span-2 whitespace-nowrap sm:col-span-1"
            >
              {t('الحقول المخصصة', 'Custom fields')}{customFields.length > 0 ? ` (${number(customFields.length)})` : ''}
            </Button>
            <MemberExcelActions members={query.data ?? []} customFields={customFields} />
          </div>
        </div>
      </div>

      <MemberJoinReviewQueue />

      {isOwner && usageQuery.isError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" role="status"><p className="min-w-0 flex-1 text-xs leading-6 text-[var(--text-muted)]">{t('مؤشر استخدام التطبيق غير متاح حاليًا. لا يعني هذا أن الأعضاء لم يستخدموه؛ يلزم تفعيل schema الجديدة أو إعادة المحاولة.', 'App-use evidence is currently unavailable. This does not mean members have not used it; the new schema must be enabled or the request retried.')}</p><Button variant="secondary" onClick={() => { void usageQuery.refetch(); }}>{t('إعادة المحاولة', 'Retry')}</Button></div>}

      {/* Filters Section */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] sm:p-4">
        <MemberToolbar
          workConditions={workConditions}
          value={filters}
          onChange={setFilters}
          resultCount={visibleMembers.length}
          totalCount={query.data?.length ?? 0}
        />
      </div>

      {/* Main Content Area */}
      <div className="min-w-0 w-full rounded-[var(--radius-lg)] bg-transparent">
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
            <div className="mb-4">
              <MemberCards
                members={pageMembers}
                customFields={customFields}
                appUsage={appUsage}
                onView={setDrawerMember}
                onEdit={openEdit}
                onDelete={askDelete}
              />
            </div>

            {/* Pagination */}
            <nav
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-sm)] sm:px-6"
              aria-label={t('التنقل بين الصفحات', 'Pagination')}
            >
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="flex items-center gap-2 text-sm font-bold text-[var(--text-muted)]"
                  htmlFor="member-page-size"
                >
                  {t('لكل صفحة', 'Per page')}
                  <select
                    id="member-page-size"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="h-[var(--touch)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text)] outline-none focus-visible:border-[var(--primary)]"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm font-bold tabular-nums text-[var(--text-muted)]" role="status">
                  {t('عرض', 'Showing')} {number(rangeStart)}–{number(rangeEnd)} {t('من', 'of')} {number(visibleMembers.length)}
                </p>
              </div>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="inline-flex size-[var(--touch)] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 disabled:opacity-50"
                  aria-label={t('الصفحة السابقة', 'Previous page')}
                >
                  {dir === 'rtl' ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
                </button>
                <span className="text-sm font-bold tabular-nums text-[var(--text)]" aria-current="page">
                  {t('صفحة', 'Page')} {number(safePage + 1)} {t('من', 'of')} {number(totalPages)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="inline-flex size-[var(--touch)] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 disabled:opacity-50"
                  aria-label={t('الصفحة التالية', 'Next page')}
                >
                  {dir === 'rtl' ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                </button>
              </span>
            </nav>
          </>
        ) : hasActiveFilters ? (
          <div className="py-12">
            <EmptyState
              title={t('لا توجد نتائج مطابقة', 'No matching members')}
              description={t('لم نعثر على أعضاء يطابقون البحث والفلاتر الحالية. امسح الفلاتر أو عدّلها لرؤية المزيد.', 'No members match the current search and filters. Clear or adjust them to see more results.')}
            />
          </div>
        ) : query.data?.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
            <EmptyState
              title={t('لا يوجد أعضاء بعد', 'No members yet')}
              description={t('ابدأ بإضافة عضو يدويًا أو أنشئ رابط تسجيل ليقدّم العضو بياناته بنفسه.', 'Add a member manually or create a registration link so they can submit their own details.')}
            />
            <Button onClick={openNew} icon={<UserPlus size={17} aria-hidden="true" />}>
              {t('إضافة أول عضو', 'Add the first member')}
            </Button>
          </div>
        ) : (
          <div className="py-12">
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
        title={t('تأكيد مسح العضو', 'Confirm member deletion')}
        itemName={memberToDelete?.full_name}
        description={
          memberToDelete
            ? t(`سيُطلب حذف ${memberToDelete.full_name} بعد 5 ثوانٍ يمكنك خلالها التراجع. لا يتم الحذف إلا بعد تأكيد الخادم؛ سجلات الدعوات أو الفرق أو المشروعات قد تمنعه لحماية التاريخ. هذا لا يحذف حساب تسجيل الدخول ولا يلغي Admin.`, `Deletion of ${memberToDelete.full_name} will be requested after a 5-second undo window. It is complete only after server confirmation; invitation, team or project history may block it. This does not delete the sign-in account or revoke Admin access.`)
            : undefined
        }
        confirmLabel={t('مسح نهائي', 'Delete permanently')}
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
