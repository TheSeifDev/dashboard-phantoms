import { useEffect, useMemo, useRef, useState } from 'react';
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
import { MemberExcelActions } from './MemberExcelActions';
import { sanitizeText, isValidEmail, isValidEgyptianPhone } from '../../lib/validators';
import { handleSupabaseError, logError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';

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
  const query = useMembers();
  const customFieldsQuery = useMemberCustomFields();
  const notesQuery = useNotes();
  const add = useAddMember();
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
  const deleteTimer = useRef<number | null>(null);

  const customFields = customFieldsQuery.data ?? [];

  useEffect(
    () => () => {
      if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    },
    [],
  );

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
        const term = filters.search.trim().toLowerCase();
        const customValuesText = Object.values(member.custom_fields ?? {})
          .filter((v) => v !== null && v !== undefined)
          .join(' ');
        const matchesText =
          !term ||
          `${member.full_name} ${member.email} ${member.phone ?? ''} ${member.residence ?? ''} ${member.bio ?? ''} ${customValuesText}`
            .toLowerCase()
            .includes(term);
        const matchesWorkConditions =
          filters.work_conditions === 'ALL' || member.work_conditions === filters.work_conditions;
        const matchesDevice =
          filters.device === 'ALL' || (member.device ?? '').includes(filters.device);
        const matchesAlexandria =
          filters.alexandria === 'ALL' || member.can_go_alexandria === (filters.alexandria === 'YES');
        return matchesText && matchesWorkConditions && matchesDevice && matchesAlexandria;
      }),
    [filters, query.data],
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
      custom_fields: { ...(member.custom_fields ?? {}) },
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
      setFormError('الاسم والبريد الإلكتروني لازم يتكتبوا.');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFormError('البريد الإلكتروني مش صالح. لازم يكون فيه @ ونطاق صحيح.');
      return;
    }

    const trimmedPhone = (form.phone || '').trim();
    if (trimmedPhone && !isValidEgyptianPhone(trimmedPhone)) {
      setFormError('رقم الهاتف مش صالح. استخدم رقم مصري صحيح: 01xxxxxxxxx أو +20xxxxxxxxxx.');
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
      toast.success(editing ? 'بيانات العضو اتحفظت بنجاح.' : 'العضو الجديد اتسجّل بنجاح.');
    } catch (cause) {
      logError(cause, 'MembersPage.save');
      const error = handleSupabaseError(cause);
      setFormError(error.message);
    }
  };

  // حذف مؤجل 5 ثوانٍ مع تراجع — نفس منطق الحذف الحالي دون تغيير semantics الخادم
  const confirmDelete = () => {
    const target = memberToDelete;
    if (!target) return;
    setMemberToDelete(null);
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = window.setTimeout(() => {
      deleteTimer.current = null;
      void remove.mutateAsync(target.id).then(
        () => toast.success(`${target.full_name} اتمسح نهائيًا.`),
        (cause: unknown) => toast.error(handleSupabaseError(cause).message || 'معرفناش نمسح العضو.'),
      );
    }, DELETE_UNDO_MS);
    toast.success(`${target.full_name} اتمسح.`, {
      durationMs: DELETE_UNDO_MS,
      action: {
        label: 'تراجع',
        onClick: () => {
          if (deleteTimer.current !== null) {
            window.clearTimeout(deleteTimer.current);
            deleteTimer.current = null;
          }
          toast.info('اتلغى الحذف.');
        },
      },
    });
  };

  const askDelete = (member: Member) => {
    setDrawerMember(null);
    setMemberToDelete(member);
  };

  return (
    <section className="flex min-w-0 w-full flex-col gap-4" id="page-members" dir="rtl">
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
              <h1 className="m-0 text-[var(--fs-xl)] font-black text-[var(--text)]">دليل الأعضاء وجاهزيتهم</h1>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                حالة الشغل والأجهزة والاستعداد للنزول الميداني —{' '}
                <span className="font-bold tabular-nums text-[var(--link)]">{query.data?.length ?? 0}</span> عضو مسجّل.
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
              إضافة عضو
            </Button>
            <Button
              variant="secondary"
              onClick={() => setInviteModalOpen(true)}
              icon={<Link2 size={17} aria-hidden="true" />}
              className="whitespace-nowrap"
            >
              رابط تسجيل عضو
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs font-bold text-[var(--text-muted)]">
            إدارة الحقول الإضافية وملفات البيانات
          </span>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Button
              variant="secondary"
              onClick={() => setCustomFieldsModalOpen(true)}
              icon={<Settings2 size={16} aria-hidden="true" />}
              fullOnMobile
              className="col-span-2 whitespace-nowrap sm:col-span-1"
            >
              الحقول المخصصة{customFields.length > 0 ? ` (${customFields.length})` : ''}
            </Button>
            <MemberExcelActions members={query.data ?? []} customFields={customFields} />
          </div>
        </div>
      </div>

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
              message="معرفناش نحمّل سجلات الأعضاء."
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
                onView={setDrawerMember}
                onEdit={openEdit}
                onDelete={askDelete}
              />
            </div>

            {/* Pagination */}
            <nav
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-sm)] sm:px-6"
              aria-label="التنقل بين الصفحات"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="flex items-center gap-2 text-sm font-bold text-[var(--text-muted)]"
                  htmlFor="member-page-size"
                >
                  لكل صفحة
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
                  عرض {rangeStart}–{rangeEnd} من {visibleMembers.length}
                </p>
              </div>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="inline-flex size-[var(--touch)] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
                  aria-label="الصفحة السابقة"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                <span className="text-sm font-bold tabular-nums text-[var(--text)]" aria-current="page">
                  صفحة {safePage + 1} من {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="inline-flex size-[var(--touch)] items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
                  aria-label="الصفحة التالية"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
              </span>
            </nav>
          </>
        ) : (
          <div className="py-12">
            <EmptyState title="مفيش تطابق" description="ملقيناش عضو مطابق لمعايير التصفية." />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(memberToDelete)}
        onClose={() => setMemberToDelete(null)}
        onConfirm={confirmDelete}
        title="تأكيد مسح العضو"
        itemName={memberToDelete?.full_name}
        description={
          memberToDelete
            ? `هيتم مسح ${memberToDelete.full_name} نهائيًا. تقدر تلغي الحذف خلال 5 ثواني من إشعار التأكيد.`
            : undefined
        }
        confirmLabel="مسح نهائي"
        isPending={false}
        pendingLabel="بنمسح..."
      />

      <MemberProfileModal
        isOpen={Boolean(drawerMember)}
        member={drawerMember}
        customFields={customFields}
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
