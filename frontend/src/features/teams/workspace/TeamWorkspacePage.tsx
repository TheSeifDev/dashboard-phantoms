import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Bell,
  ClipboardList,
  FileText,
  Layers3,
  LayoutDashboard,
  LogOut,
  Moon,
  NotebookPen,
  Plus,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PageHeader } from '../../../components/ui/PageHeader';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { LanguageToggle } from '../../../i18n/LanguageToggle';
import { useLocale } from '../../../i18n/useLocale';
import { toAppError } from '../../../lib/supabase/errors';
import { supabase } from '../../../lib/supabase/client';
import { useAuthStore } from '../../../store/auth';
import { toast } from '../../../store/toast';
import { useThemeStore } from '../../../store/theme';
import type {
  TeamPermission,
  AnnouncementPriority,
  MemberCustomFieldType,
  MemberEvaluationGrade,
  TeamMemberSummary,
  TeamMembershipStatus,
  TaskTrackingEntry,
} from '../../../types/db';
import { safeHref } from '../../../lib/validators';
import { useAdminAccess } from '../../admin/access/api';
import {
  createWorkspaceAnnouncement,
  createWorkspaceCustomField,
  createWorkspaceEvaluation,
  createWorkspaceNote,
  createWorkspaceTask,
  deleteWorkspaceAnnouncement,
  deleteWorkspaceEvaluation,
  deleteWorkspaceNote,
  deleteWorkspaceTask,
  listWorkspaceAnnouncements,
  listWorkspaceCustomFieldValues,
  listWorkspaceCustomFields,
  listWorkspaceEvaluations,
  listWorkspaceFeatureRoster,
  listWorkspaceNotes,
  listWorkspaceRanking,
  listWorkspaceRoster,
  listWorkspaceTasks,
  reviewWorkspaceMember,
  reviewWorkspaceTask,
  setWorkspaceAnnouncementActive,
  setWorkspaceCustomFieldValue,
  teamWorkspaceKey,
  type TeamWorkspaceSection,
  type WorkspaceAnnouncement,
  type WorkspaceCustomField,
  type WorkspaceCustomFieldValue,
  type WorkspaceEvaluation,
  type WorkspaceNote,
  type WorkspaceRankingEntry,
  type WorkspaceRosterEntry,
  type WorkspaceTask,
} from './api';
import { workspaceTeamEntries } from '../access';

const LedgerBoard = lazy(() => import('../../ledger/LedgerBoard').then((module) => ({ default: module.LedgerBoard })));

const FEATURE_FOR_SECTION: Record<TeamWorkspaceSection, TeamPermission> = {
  tasks: 'tasks',
  members: 'members',
  notes: 'notes',
  ranking: 'ranking',
  announcements: 'announcements',
  'custom-fields': 'members',
  ledger: 'members',
};
const SECTION_DEFS: Array<{ id: TeamWorkspaceSection; titleAr: string; titleEn: string; icon: ReactNode }> = [
  { id: 'tasks', titleAr: 'المهام', titleEn: 'Tasks', icon: <ClipboardList size={17} aria-hidden="true" /> },
  { id: 'members', titleAr: 'الأعضاء', titleEn: 'Members', icon: <UsersRound size={17} aria-hidden="true" /> },
  { id: 'notes', titleAr: 'الملاحظات', titleEn: 'Notes', icon: <NotebookPen size={17} aria-hidden="true" /> },
  { id: 'ranking', titleAr: 'الترتيب والتقييمات', titleEn: 'Ranking & evaluations', icon: <Award size={17} aria-hidden="true" /> },
  { id: 'announcements', titleAr: 'الإعلانات', titleEn: 'Announcements', icon: <Bell size={17} aria-hidden="true" /> },
  { id: 'custom-fields', titleAr: 'الحقول المخصصة', titleEn: 'Custom fields', icon: <FileText size={17} aria-hidden="true" /> },
  { id: 'ledger', titleAr: 'الخزنة', titleEn: 'Ledger', icon: <Wallet size={17} aria-hidden="true" /> },
];
const CAPABILITY_DEFS: Array<{ key: TeamPermission; ar: string; en: string }> = [
  { key: 'dashboard', ar: 'لوحة الفريق', en: 'Team dashboard' },
  { key: 'members', ar: 'الأعضاء والحقول', en: 'Members & fields' },
  { key: 'tasks', ar: 'المهام', en: 'Tasks' },
  { key: 'ranking', ar: 'الترتيب والتقييمات', en: 'Ranking & evaluations' },
  { key: 'notes', ar: 'الملاحظات', en: 'Notes' },
  { key: 'announcements', ar: 'الإعلانات', en: 'Announcements' },
  { key: 'whatsapp', ar: 'واتساب', en: 'WhatsApp' },
  { key: 'ai_assistant', ar: 'المساعد الذكي', en: 'AI assistant' },
];
const MEMBERSHIP_STATUSES: Record<TeamMembershipStatus, [string, string]> = {
  pending: ['بانتظار المراجعة', 'Pending review'],
  active: ['نشط في الفريق', 'Active in team'],
  suspended: ['موقوف في الفريق', 'Suspended in team'],
  removed: ['أزيل من الفريق', 'Removed from team'],
};
const GRADES: Array<{ value: MemberEvaluationGrade; ar: string; en: string }> = [
  { value: 'excellent', ar: 'ممتاز', en: 'Excellent' },
  { value: 'very_good', ar: 'جيد جداً', en: 'Very good' },
  { value: 'good', ar: 'جيد', en: 'Good' },
  { value: 'needs_improvement', ar: 'يحتاج تحسين', en: 'Needs improvement' },
  { value: 'warning', ar: 'تنبيه', en: 'Warning' },
];
const FIELD_TYPES: Array<{ value: MemberCustomFieldType; ar: string; en: string }> = [
  { value: 'short_text', ar: 'نص قصير', en: 'Short text' },
  { value: 'long_text', ar: 'نص طويل', en: 'Long text' },
  { value: 'number', ar: 'رقم', en: 'Number' },
  { value: 'date', ar: 'تاريخ', en: 'Date' },
  { value: 'yes_no', ar: 'نعم أو لا', en: 'Yes or no' },
  { value: 'select', ar: 'اختيار من قائمة', en: 'Select' },
];
const PRIORITIES: Array<{ value: AnnouncementPriority; ar: string; en: string }> = [
  { value: 'normal', ar: 'عادي', en: 'Normal' },
  { value: 'low', ar: 'منخفض', en: 'Low' },
  { value: 'high', ar: 'مهم', en: 'High' },
  { value: 'urgent', ar: 'عاجل', en: 'Urgent' },
];

function isWorkspaceSection(value: unknown): value is TeamWorkspaceSection {
  return value === 'tasks' || value === 'members' || value === 'notes'
    || value === 'ranking' || value === 'announcements' || value === 'custom-fields'
    || value === 'ledger';
}

function memberIsActive(member: { membership_status: TeamMembershipStatus; work_status?: string | null }): boolean {
  return member.membership_status === 'active'
    && (member.work_status === undefined || member.work_status === 'active');
}

function membershipLabel(status: TeamMembershipStatus, t: (ar: string, en: string) => string) {
  return t(...MEMBERSHIP_STATUSES[status]);
}

function inputClass(extra = '') {
  return `min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] ${extra}`;
}

function invalidateScope(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  teamId: string,
  section: TeamWorkspaceSection,
) {
  return queryClient.invalidateQueries({ queryKey: teamWorkspaceKey(userId, teamId, section) });
}

function TeamRosterSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t, number } = useLocale();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ member: TeamMemberSummary; decision: 'approve' | 'suspend' | 'remove' } | null>(null);
  const roster = useQuery({
    queryKey: teamWorkspaceKey(userId, teamId, 'members'),
    queryFn: ({ signal }) => listWorkspaceRoster(teamId, signal),
    enabled: Boolean(userId && teamId),
    retry: false,
  });
  const review = useMutation({
    mutationFn: reviewWorkspaceMember,
    onSuccess: async () => {
      await Promise.all([
        invalidateScope(queryClient, userId, teamId, 'members'),
        invalidateScope(queryClient, userId, teamId, 'tasks'),
        invalidateScope(queryClient, userId, teamId, 'notes'),
        invalidateScope(queryClient, userId, teamId, 'ranking'),
        invalidateScope(queryClient, userId, teamId, 'custom-fields'),
      ]);
    },
  });
  const [memberFilter, setMemberFilter] = useState('');
  const confirmMembershipReview = async () => {
    if (!pending) return;
    try {
      await review.mutateAsync({ teamId, memberId: pending.member.member_id, decision: pending.decision });
      toast.success(pending.decision === 'approve'
        ? t('اتفعّلت العضوية في الفريق فقط.', 'Membership was activated for this team only.')
        : pending.decision === 'suspend'
          ? t('اتوقفت عضوية الفريق فقط.', 'Only this team membership was suspended.')
          : t('اتشالت العضوية من الفريق فقط؛ حساب العضو والفرق الأخرى ما اتغيروش.', 'Only this team membership was removed; the member account and other teams were unchanged.'));
      setPending(null);
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحدّث عضوية الفريق.', 'Could not update this team membership.')).message);
    }
  };
  if (roster.isPending) return <CardSkeletons count={2} />;
  if (roster.isError) return <ErrorState message={t('تعذر تحميل عضويات هذا الفريق.', 'Could not load this team’s memberships.')} onRetry={() => { void roster.refetch(); }} />;
  const members = roster.data ?? [];
  const activeCount = members.filter(memberIsActive).length;
  const visibleMembers = members.filter((member) => {
    const query = memberFilter.trim().toLocaleLowerCase();
    return !query || `${member.full_name} ${membershipLabel(member.membership_status, t)}`.toLocaleLowerCase().includes(query);
  });
  return (
    <div className="grid min-w-0 gap-4">
      <Card className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-black">{t('عضويات هذا الفريق', 'Memberships in this team')}</h2>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-extrabold">{number(activeCount)} {t('أعضاء نشطون', 'active members')}</span>
        </div>
        <p className="text-sm leading-6 text-[var(--text-muted)]">{t('الإجراءات هنا تغيّر عضوية الفريق فقط. لا تعدّل الملف الأساسي أو حساب الدخول أو عضويات الفرق الأخرى.', 'Actions here change only this team membership. They do not edit the canonical profile, sign-in account, or other team memberships.')}</p>
        {members.length > 0 && <label className="grid gap-1 text-xs font-bold">{t('البحث في أعضاء هذا الفريق', 'Search this team’s members')}<input type="search" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} placeholder={t('الاسم أو حالة العضوية', 'Name or membership status')} className={inputClass('text-sm')} /></label>}
        {members.length === 0
          ? <EmptyState title={t('لا توجد عضويات مسندة لهذا الفريق', 'No memberships assigned to this team')} description={t('سيظهر هنا الأعضاء بعد إسنادهم للفريق من إدارة الفرق.', 'Members appear here after the Owner assigns them to this team.')} />
          : visibleMembers.length === 0
            ? <p role="status" className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm leading-6 text-[var(--text-muted)]">{t('مافيش أعضاء مطابقين للبحث ده. جرّب اسمًا أو حالة أخرى.', 'No team members match this search. Try a different name or status.')}</p>
            : <div className="grid gap-2">
            {visibleMembers.map((member) => (
              <article key={member.member_id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-extrabold">{member.full_name}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{membershipLabel(member.membership_status, t)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {member.membership_status === 'pending' && <Button type="button" onClick={() => setPending({ member, decision: 'approve' })} disabled={review.isPending}>{t('موافقة للفريق', 'Approve for team')}</Button>}
                  {member.membership_status === 'active' && <Button type="button" variant="secondary" onClick={() => setPending({ member, decision: 'suspend' })} disabled={review.isPending}>{t('إيقاف هنا', 'Suspend here')}</Button>}
                  {member.membership_status !== 'removed' && <Button type="button" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setPending({ member, decision: 'remove' })} disabled={review.isPending}>{t('إزالة من الفريق', 'Remove from team')}</Button>}
                </div>
              </article>
            ))}
          </div>}
      </Card>
      <ConfirmDialog
        isOpen={Boolean(pending)}
        onClose={() => { if (!review.isPending) setPending(null); }}
        onConfirm={() => { void confirmMembershipReview(); }}
        title={pending?.decision === 'approve' ? t('تفعيل عضوية الفريق؟', 'Activate this team membership?') : pending?.decision === 'suspend' ? t('إيقاف العضوية في هذا الفريق؟', 'Suspend membership in this team?') : t('إزالة العضوية من هذا الفريق؟', 'Remove membership from this team?')}
        itemName={pending?.member.full_name}
        description={t('لن يتغير حساب الدخول أو الملف الأساسي أو أي عضوية أخرى.', 'The sign-in account, canonical profile, and any other membership will remain unchanged.')}
        confirmLabel={pending?.decision === 'approve' ? t('موافقة', 'Approve') : pending?.decision === 'suspend' ? t('إيقاف هنا', 'Suspend here') : t('إزالة من الفريق', 'Remove from team')}
        isPending={review.isPending}
        pendingLabel={t('جارٍ الحفظ…', 'Saving…')}
      />
    </div>
  );
}

function TaskDeleteButton({ task, onDelete, pending }: { task: WorkspaceTask; onDelete: (taskId: number) => Promise<void>; pending: boolean }) {
  const { t } = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return <>
    <Button type="button" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setConfirmOpen(true)} disabled={pending}>{t('حذف المهمة', 'Delete task')}</Button>
    <ConfirmDialog isOpen={confirmOpen} onClose={() => { if (!pending) setConfirmOpen(false); }} onConfirm={() => { void onDelete(task.id).then(() => setConfirmOpen(false)); }} title={t('حذف مهمة الفريق؟', 'Delete this team task?')} itemName={task.title} description={t('سيُحذف سجل المهمة المحدد لهذا الفريق فقط.', 'Only this team-scoped task record will be deleted.')} confirmLabel={t('حذف المهمة', 'Delete task')} isPending={pending} pendingLabel={t('جارٍ الحذف…', 'Deleting…')} />
  </>;
}

function TaskSubmissionReview({
  task,
  member,
  status,
  entry,
  note,
  onNoteChange,
  onReview,
  pending,
}: {
  task: WorkspaceTask;
  member: WorkspaceRosterEntry;
  status: 'under_review' | 'approved';
  entry: TaskTrackingEntry;
  note: string;
  onNoteChange: (value: string) => void;
  onReview: (task: WorkspaceTask, memberId: number, action: 'approve' | 'revoke' | 'revision', note: string) => Promise<void>;
  pending: boolean;
}) {
  const { t } = useLocale();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  return <div className="grid min-w-0 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span className="break-words text-sm font-extrabold">{member.full_name}</span>
      <span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs font-bold">{status === 'under_review' ? t('بانتظار المراجعة', 'Awaiting review') : status}</span>
    </div>
    {entry.submitted_at && <p className="text-xs text-[var(--text-muted)]">{t('وقت التسليم (من الخادم):', 'Submitted (server time):')} {new Date(entry.submitted_at).toLocaleString()}</p>}
    {entry.submission_description && <p className="whitespace-pre-line rounded-lg border border-[var(--border)] p-3 text-sm leading-6"><strong>{t('وصف الإنجاز:', 'Completed work:')}</strong> {entry.submission_description}</p>}
    {(entry.submission_notes || entry.note) && <p className="whitespace-pre-line rounded-lg border border-[var(--border)] p-3 text-sm leading-6"><strong>{t(entry.status === 'revision_requested' ? 'توجيه التعديل:' : 'ملاحظات العضو:', entry.status === 'revision_requested' ? 'Revision instructions:' : 'Member notes:')}</strong> {entry.status === 'revision_requested' ? entry.note : entry.submission_notes ?? entry.note}</p>}
    {entry.usefulness_stars != null && <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{t('الاستفادة:', 'Usefulness:')} {'★'.repeat(entry.usefulness_stars)}{'☆'.repeat(5-entry.usefulness_stars)} ({entry.usefulness_stars}/5) · {t('الصعوبة:', 'Difficulty:')} {entry.difficulty === 'easy' ? t('سهل', 'Easy') : entry.difficulty === 'medium' ? t('متوسط', 'Medium') : entry.difficulty === 'hard' ? t('صعب', 'Hard') : '—'}</p>}
    {(entry.submission_links ?? (entry.submission_url ? [{ label: '', url: entry.submission_url }] : [])).map((link, index) => { const href = safeHref(link.url); return href ? <a key={`${href}-${index}`} href={href} target="_blank" rel="noreferrer noopener" className="break-all text-sm font-bold text-[var(--link)]">{link.label || href}</a> : null; })}
    <label className="grid gap-1 text-xs font-bold">{status === 'approved' ? t('سبب إلغاء الاعتماد (مطلوب)', 'Reason for revoking approval (required)') : t('ملاحظة للعضو عند طلب التعديل', 'Member note for a revision request')}
      <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={2} maxLength={1000} className={inputClass('min-h-20')} />
    </label>
    <div className="flex flex-wrap gap-2">
      {status === 'under_review' ? <>
        <Button type="button" variant="secondary" onClick={() => { void onReview(task, member.member_id, 'revision', note); }} disabled={pending || note.trim().length < 3}>{t('طلب تعديل', 'Request revision')}</Button>
        <Button type="button" onClick={() => { void onReview(task, member.member_id, 'approve', ''); }} isLoading={pending} loadingText={t('جارٍ الاعتماد…', 'Approving…')}>{t('اعتماد التسليم', 'Approve submission')}</Button>
      </> : <Button type="button" variant="danger" onClick={() => setConfirmRevoke(true)} disabled={pending || note.trim().length < 3}>{t('إلغاء الاعتماد', 'Revoke approval')}</Button>}
    </div>
    <ConfirmDialog isOpen={confirmRevoke} onClose={() => { if (!pending) setConfirmRevoke(false); }} onConfirm={() => { void onReview(task, member.member_id, 'revoke', note).then(() => setConfirmRevoke(false)); }} title={t('إلغاء اعتماد الفريق؟', 'Revoke team approval?')} itemName={member.full_name} description={t('سيتغير مقياس الفريق فقط، ولن يتغير ترتيب العضو العام.', 'Only this team metric will change; the member’s global rank remains untouched.')} confirmLabel={t('إلغاء الاعتماد', 'Revoke approval')} isPending={pending} pendingLabel={t('جارٍ الإلغاء…', 'Revoking…')} />
  </div>;
}

function TeamTasksSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t, number } = useLocale();
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: teamWorkspaceKey(userId, teamId, 'tasks'),
    queryFn: ({ signal }) => listWorkspaceTasks(teamId, signal),
    enabled: Boolean(userId && teamId),
    retry: false,
  });
  const roster = useQuery({
    queryKey: [...teamWorkspaceKey(userId, teamId, 'tasks'), 'active-roster'],
    queryFn: ({ signal }) => listWorkspaceFeatureRoster(teamId, 'tasks', signal),
    enabled: Boolean(userId && teamId),
    retry: false,
  });
  const activeMembers = useMemo(() => (roster.data ?? []).filter(memberIsActive), [roster.data]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [bonus, setBonus] = useState('0');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [taskFilter, setTaskFilter] = useState('');
  const create = useMutation({
    mutationFn: createWorkspaceTask,
    onSuccess: async () => {
      await Promise.all([
        invalidateScope(queryClient, userId, teamId, 'tasks'),
        invalidateScope(queryClient, userId, teamId, 'ranking'),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: ({ taskId }: { taskId: number }) => deleteWorkspaceTask(teamId, taskId),
    onSuccess: async () => {
      await Promise.all([
        invalidateScope(queryClient, userId, teamId, 'tasks'),
        invalidateScope(queryClient, userId, teamId, 'ranking'),
      ]);
    },
  });
  const review = useMutation({
    mutationFn: reviewWorkspaceTask,
    onSuccess: async () => {
      await Promise.all([
        invalidateScope(queryClient, userId, teamId, 'tasks'),
        invalidateScope(queryClient, userId, teamId, 'ranking'),
      ]);
    },
  });
  useEffect(() => {
    const valid = new Set(activeMembers.map((member) => String(member.member_id)));
    setSelectedIds((current) => current.filter((id) => valid.has(id)));
  }, [activeMembers]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const parsedBonus = Number(bonus);
    if (cleanTitle.length < 3 || selectedIds.length === 0 || !Number.isInteger(parsedBonus) || parsedBonus < 0 || parsedBonus > 50) {
      toast.warning(t('اكتب عنوانًا من 3 أحرف، واختر عضوًا نشطًا واحدًا على الأقل، وحدد بونصًا صحيحًا من 0 إلى 50.', 'Enter a title of at least 3 characters, select at least one active member, and choose a whole bonus from 0 to 50.'));
      return;
    }
    if (deadline && deadline < new Date().toISOString().slice(0, 10)) {
      toast.warning(t('اختار النهارده أو تاريخًا لاحقًا للموعد النهائي.', 'Choose today or a future deadline.'));
      return;
    }
    try {
      await create.mutateAsync({ teamId, title: cleanTitle, description: description.trim() || null, deadlineDate: deadline || null, assignedTo: selectedIds, bonusPoints: parsedBonus });
      setTitle(''); setDescription(''); setDeadline(''); setBonus('0'); setSelectedIds([]);
      toast.success(t('اتعملت مهمة مسندة لأعضاء الفريق النشطين المختارين فقط.', 'The task was created for only the selected active team members.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش ننشئ مهمة الفريق.', 'Could not create this team task.')).message);
    }
  };
  const deleteTask = async (taskId: number) => {
    try {
      await remove.mutateAsync({ taskId });
      toast.success(t('اتحذفت مهمة الفريق.', 'The team task was deleted.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحذف مهمة الفريق.', 'Could not delete this team task.')).message);
    }
  };
  const decide = async (task: WorkspaceTask, memberId: number, action: 'approve' | 'revoke' | 'revision', note: string) => {
    if ((action === 'revision' || action === 'revoke') && note.trim().length < 3) return;
    try {
      await review.mutateAsync({ teamId, taskId: task.id, memberId, action, reason: action === 'approve' ? null : note.trim() });
      setReviewNotes((current) => ({ ...current, [`${task.id}:${memberId}`]: '' }));
      toast.success(action === 'approve' ? t('اتعتمد تسليم العضو في الفريق.', 'The member’s submission was approved in this team.') : action === 'revoke' ? t('اتلغى الاعتماد داخل الفريق فقط.', 'Approval was revoked within this team only.') : t('اتبعت ملاحظة التعديل للعضو.', 'The revision request was sent to the member.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نراجع التسليم.', 'Could not review this submission.')).message);
    }
  };
  const assignedToMember = (task: WorkspaceTask, memberId: number) =>
    task.assigned_to === 'ALL' || (Array.isArray(task.assigned_to) && task.assigned_to.includes(String(memberId)));
  const reviewEntries = (task: WorkspaceTask) => activeMembers.flatMap((member) => {
    const entry = task.tracking?.[String(member.member_id)];
    if (!assignedToMember(task, member.member_id) || !entry) return [];
    return entry.status === 'under_review' || entry.status === 'approved' ? [{ member, status: entry.status, entry }] : [];
  });
  const visibleTasks = (tasks.data ?? []).filter((task) => {
    const query = taskFilter.trim().toLocaleLowerCase();
    return !query || `${task.title} ${task.description ?? ''}`.toLocaleLowerCase().includes(query);
  });
  if (tasks.isPending || roster.isPending) return <CardSkeletons count={2} />;
  if (tasks.isError) return <ErrorState message={t('تعذر تحميل مهام هذا الفريق.', 'Could not load this team’s tasks.')} onRetry={() => { void tasks.refetch(); }} />;
  if (roster.isError) return <ErrorState message={t('تعذر التحقق من أعضاء الفريق النشطين للمهام.', 'Could not verify active team members for tasks.')} onRetry={() => { void roster.refetch(); }} />;
  return <div className="grid min-w-0 gap-4">
    <Card className="grid gap-4">
      <div><h2 className="text-base font-black">{t('إنشاء مهمة للفريق', 'Create a team task')}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('تظهر قائمة الاستهداف أعضاء العضوية النشطة فقط. الاختيار يُحفظ لهذه المهمة دون تعديل سجلات مهام الفرق الأخرى.', 'Assignment choices include only active memberships. The selection is saved for this task without changing tasks in other teams.')}</p></div>
      <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm font-bold sm:col-span-2">{t('عنوان المهمة', 'Task title')}<input className={inputClass()} value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={200} /></label>
        <details className="rounded-xl border border-[var(--border)] p-3 sm:col-span-2">
          <summary className="min-h-11 cursor-pointer rounded-lg py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">{t('تفاصيل إضافية اختيارية', 'Optional task details')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-sm font-bold sm:col-span-2">{t('التفاصيل (اختياري)', 'Details (optional)')}<textarea className={inputClass('min-h-24')} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={3000} /></label>
            <label className="grid min-w-0 gap-1.5 text-sm font-bold">{t('موعد نهائي (اختياري)', 'Deadline (optional)')}<input type="date" className={inputClass()} value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDeadline(event.target.value)} /></label>
            <label className="grid min-w-0 gap-1.5 text-sm font-bold">{t('بونص الاعتماد (0–50)', 'Approval bonus (0–50)')}<input type="number" min={0} max={50} step={1} className={inputClass()} value={bonus} onChange={(event) => setBonus(event.target.value)} /></label>
          </div>
        </details>
        {activeMembers.length === 0
          ? <p className="rounded-xl border border-[var(--border)] p-3 text-sm leading-6 text-[var(--text-muted)] sm:col-span-2">{t('لا يوجد أعضاء نشطون في هذا الفريق لاختيارهم.', 'There are no active team members to assign yet.')}</p>
          : <fieldset className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-bold">{t('الأعضاء النشطون المستهدفون', 'Active members to assign')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {activeMembers.map((member) => <label key={member.member_id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold"><input type="checkbox" className="size-5 shrink-0 accent-[var(--primary)]" checked={selectedIds.includes(String(member.member_id))} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, String(member.member_id)] : current.filter((id) => id !== String(member.member_id)))} /><span className="min-w-0 break-words">{member.full_name}</span></label>)}
            </div>
            <p className="text-xs text-[var(--text-muted)]">{number(selectedIds.length)} {t('مختارون', 'selected')}</p>
          </fieldset>}
        <div className="sm:col-span-2"><Button type="submit" icon={<Plus size={16} aria-hidden="true" />} isLoading={create.isPending} disabled={activeMembers.length === 0 || selectedIds.length === 0}>{t('إنشاء المهمة', 'Create task')}</Button></div>
      </form>
    </Card>
    {(tasks.data ?? []).length > 0 && <label className="grid gap-1 text-xs font-bold">{t('البحث في مهام هذا الفريق', 'Search this team’s tasks')}<input type="search" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} placeholder={t('عنوان المهمة أو تفاصيلها', 'Task title or details')} className={inputClass('text-sm')} /></label>}
    {tasks.data?.length === 0
      ? <EmptyState title={t('لا توجد مهام لهذا الفريق', 'No tasks for this team yet')} description={t('أنشئ أول مهمة من النموذج أعلاه.', 'Create the first task using the form above.')} />
      : visibleTasks.length === 0
        ? <p role="status" className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm leading-6 text-[var(--text-muted)]">{t('مافيش مهام مطابقة للبحث ده. جرّب عنوانًا أو تفاصيل أخرى.', 'No tasks match this search. Try a different title or details.')}</p>
        : <div className="grid min-w-0 gap-3">
        {visibleTasks.map((task) => {
          const assignedMembers = activeMembers.filter((member) => assignedToMember(task, member.member_id));
          const reviews = reviewEntries(task);
          return <Card key={task.id} className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><h3 className="break-words font-black">{task.title}</h3>{task.description && <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-[var(--text-2)]">{task.description}</p>}<p className="mt-2 text-xs text-[var(--text-muted)]">{task.deadline_date ? `${t('الموعد النهائي:', 'Deadline:')} ${task.deadline_date}` : t('من غير موعد نهائي', 'No deadline')} · {number(assignedMembers.length)} {t('أعضاء نشطون مسند إليهم', 'active assignees')}</p></div>
              <TaskDeleteButton task={task} onDelete={deleteTask} pending={remove.isPending} />
            </div>
            {reviews.length > 0 && <div className="grid gap-2 border-t border-[var(--border)] pt-3"><h4 className="text-sm font-extrabold">{t('تسليمات تحتاج مراجعة', 'Submissions to review')}</h4>{reviews.map(({ member, status, entry }) => {
              const key = `${task.id}:${member.member_id}`;
              return <TaskSubmissionReview key={key} task={task} member={member} status={status} entry={entry} note={reviewNotes[key] ?? ''} onNoteChange={(value) => setReviewNotes((current) => ({ ...current, [key]: value }))} onReview={decide} pending={review.isPending} />;
            })}</div>}
          </Card>;
        })}
      </div>}
  </div>;
}

function TeamNotesSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: teamWorkspaceKey(userId, teamId, 'notes'), queryFn: ({ signal }) => listWorkspaceNotes(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const roster = useQuery({ queryKey: [...teamWorkspaceKey(userId, teamId, 'notes'), 'active-roster'], queryFn: ({ signal }) => listWorkspaceFeatureRoster(teamId, 'notes', signal), enabled: Boolean(userId && teamId), retry: false });
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceNote | null>(null);
  const create = useMutation({ mutationFn: createWorkspaceNote, onSuccess: () => invalidateScope(queryClient, userId, teamId, 'notes') });
  const remove = useMutation({ mutationFn: ({ id }: { id: number }) => deleteWorkspaceNote(teamId, id), onSuccess: () => invalidateScope(queryClient, userId, teamId, 'notes') });
  const activeMembers = (roster.data ?? []).filter(memberIsActive);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim().length < 1) return;
    try {
      await create.mutateAsync({ teamId, text: text.trim(), memberId: target ? Number(target) : null });
      setText(''); setTarget(''); toast.success(t('اتحفظت الملاحظة في مساحة الفريق.', 'The note was saved to this team workspace.'));
    } catch (error) { toast.error(toAppError(error, t('معرفناش نحفظ الملاحظة.', 'Could not save the note.')).message); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await remove.mutateAsync({ id: deleteTarget.id }); setDeleteTarget(null); toast.success(t('اتحذفت الملاحظة من الفريق.', 'The team note was deleted.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش نحذف الملاحظة.', 'Could not delete the note.')).message); }
  };
  if (notes.isPending || roster.isPending) return <CardSkeletons count={2} />;
  if (notes.isError || roster.isError) return <ErrorState message={t('تعذر تحميل ملاحظات الفريق أو الأعضاء النشطين.', 'Could not load this team’s notes or active members.')} onRetry={() => { void notes.refetch(); void roster.refetch(); }} />;
  return <div className="grid min-w-0 gap-4">
    <Card className="grid gap-3"><h2 className="text-base font-black">{t('ملاحظة جديدة', 'New note')}</h2><form onSubmit={(event) => void submit(event)} className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-bold">{t('المحتوى', 'Note text')}<textarea value={text} onChange={(event) => setText(event.target.value)} required maxLength={2000} rows={4} className={inputClass('min-h-28')} /></label>
      <label className="grid gap-1.5 text-sm font-bold">{t('العضو (اختياري)', 'Member (optional)')}<select value={target} onChange={(event) => setTarget(event.target.value)} className={inputClass()}><option value="">{t('كل الفريق', 'Entire team')}</option>{activeMembers.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name}</option>)}</select></label>
      <div><Button type="submit" icon={<Plus size={16} aria-hidden="true" />} isLoading={create.isPending} disabled={!text.trim()}>{t('حفظ الملاحظة', 'Save note')}</Button></div>
    </form></Card>
    {(notes.data ?? []).length === 0 ? <EmptyState title={t('لا توجد ملاحظات للفريق', 'No team notes yet')} description={t('الملاحظات هنا منفصلة عن السجلات القديمة غير المسندة.', 'Notes here are separate from historical unassigned records.')} /> : <div className="grid gap-3">{(notes.data ?? []).map((note) => <Card key={note.id} className="grid gap-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="whitespace-pre-line break-words text-sm leading-7">{note.text}</p><p className="mt-2 text-xs text-[var(--text-muted)]">{note.target_name ? `${t('موجّهة إلى:', 'For:')} ${note.target_name}` : t('موجّهة للفريق', 'For the team')}</p></div><Button type="button" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setDeleteTarget(note)} disabled={remove.isPending}>{t('حذف', 'Delete')}</Button></div></Card>)}</div>}
    <ConfirmDialog isOpen={Boolean(deleteTarget)} onClose={() => { if (!remove.isPending) setDeleteTarget(null); }} onConfirm={() => { void confirmDelete(); }} title={t('حذف ملاحظة الفريق؟', 'Delete this team note?')} description={t('لن تتأثر الملاحظات أو البيانات خارج هذا الفريق.', 'Notes and data outside this team will not be affected.')} confirmLabel={t('حذف الملاحظة', 'Delete note')} isPending={remove.isPending} pendingLabel={t('جارٍ الحذف…', 'Deleting…')} />
  </div>;
}

function TeamRankingSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t, number, date } = useLocale();
  const queryClient = useQueryClient();
  const ranking = useQuery({ queryKey: teamWorkspaceKey(userId, teamId, 'ranking'), queryFn: ({ signal }) => listWorkspaceRanking(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const evaluations = useQuery({ queryKey: [...teamWorkspaceKey(userId, teamId, 'ranking'), 'evaluations'], queryFn: ({ signal }) => listWorkspaceEvaluations(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const roster = useQuery({ queryKey: [...teamWorkspaceKey(userId, teamId, 'ranking'), 'active-roster'], queryFn: ({ signal }) => listWorkspaceFeatureRoster(teamId, 'ranking', signal), enabled: Boolean(userId && teamId), retry: false });
  const [memberId, setMemberId] = useState('');
  const [title, setTitle] = useState('');
  const [grade, setGrade] = useState<MemberEvaluationGrade>('very_good');
  const [points, setPoints] = useState('0');
  const [feedback, setFeedback] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEvaluation | null>(null);
  const activeMembers = (roster.data ?? []).filter(memberIsActive);
  const create = useMutation({ mutationFn: createWorkspaceEvaluation, onSuccess: async () => Promise.all([invalidateScope(queryClient, userId, teamId, 'ranking'), invalidateScope(queryClient, userId, teamId, 'tasks')]) });
  const remove = useMutation({ mutationFn: ({ id }: { id: number }) => deleteWorkspaceEvaluation(teamId, id), onSuccess: () => invalidateScope(queryClient, userId, teamId, 'ranking') });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim(); const cleanFeedback = feedback.trim(); const parsedPoints = Number(points);
    if (!memberId || cleanTitle.length < 1 || cleanFeedback.length < 1 || !Number.isInteger(parsedPoints) || parsedPoints < -10 || parsedPoints > 20) {
      toast.warning(t('اختار عضوًا نشطًا، واكتب عنوانًا وملاحظات، وحدد نقاطًا صحيحة من -10 إلى 20.', 'Choose an active member, enter a title and feedback, and use whole points from -10 to 20.'));
      return;
    }
    try {
      await create.mutateAsync({ teamId, memberId: Number(memberId), title: cleanTitle, grade, points: parsedPoints, feedback: cleanFeedback });
      setTitle(''); setPoints('0'); setFeedback(''); toast.success(t('اتسجل التقييم في الفريق فقط.', 'The evaluation was recorded for this team only.'));
    } catch (error) { toast.error(toAppError(error, t('معرفناش نحفظ التقييم.', 'Could not save the evaluation.')).message); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await remove.mutateAsync({ id: deleteTarget.id }); setDeleteTarget(null); toast.success(t('اتحذف التقييم من الفريق.', 'The team evaluation was deleted.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش نحذف التقييم.', 'Could not delete the evaluation.')).message); }
  };
  if (ranking.isPending || evaluations.isPending || roster.isPending) return <CardSkeletons count={2} />;
  if (ranking.isError || evaluations.isError || roster.isError) return <ErrorState message={t('تعذر تحميل الترتيب أو تقييمات الفريق.', 'Could not load this team’s ranking or evaluations.')} onRetry={() => { void ranking.refetch(); void evaluations.refetch(); void roster.refetch(); }} />;
  return <div className="grid min-w-0 gap-4">
    <Card className="grid gap-3"><div><h2 className="text-base font-black">{t('ترتيب الفريق', 'Team ranking')}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{t('يعرض نقاط ومقاييس هذا الفريق فقط؛ لا يغيّر الترتيب العام للأعضاء.', 'Shows this team’s metrics only; it does not alter members’ global ranking.')}</p></div>{(ranking.data ?? []).length === 0 ? <EmptyState title={t('لا توجد نتائج ترتيب بعد', 'No ranking results yet')} description={t('سيظهر الأعضاء النشطون بعد تسجيل نشاط داخل هذا الفريق.', 'Active members appear as team activity is recorded.')} /> : <div className="grid gap-2">{(ranking.data ?? []).map((entry: WorkspaceRankingEntry, index: number) => <article key={entry.member_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3"><div className="min-w-0"><span className="me-2 inline-grid size-8 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-black text-[var(--primary)]">{number(index + 1)}</span><span className="break-words text-sm font-extrabold">{entry.full_name}</span></div><div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full border border-[var(--border)] px-2 py-1">{number(entry.completion_rank)} {t('نقطة', 'points')}</span><span className="rounded-full border border-[var(--border)] px-2 py-1">{number(entry.bonus_points)} {t('بونص', 'bonus')}</span></div></article>)}</div>}</Card>
    <Card className="grid gap-4"><div><h2 className="text-base font-black">{t('تقييم جديد', 'New evaluation')}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('التقييم مرتبط بعضو نشط في هذا الفريق ولا يُرسل إشعارًا خارجيًا.', 'The evaluation targets an active member of this team and does not send an external notification.')}</p></div><form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-bold">{t('العضو النشط', 'Active member')}<select value={memberId} onChange={(event) => setMemberId(event.target.value)} required className={inputClass()}><option value="">{t('اختار عضوًا', 'Select a member')}</option>{activeMembers.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-bold">{t('الدرجة', 'Grade')}<select value={grade} onChange={(event) => setGrade(event.target.value as MemberEvaluationGrade)} className={inputClass()}>{GRADES.map((item) => <option key={item.value} value={item.value}>{t(item.ar, item.en)}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-bold">{t('النقاط (-10 إلى 20)', 'Points (-10 to 20)')}<input type="number" min={-10} max={20} step={1} value={points} onChange={(event) => setPoints(event.target.value)} className={inputClass()} /></label>
      <label className="grid gap-1.5 text-sm font-bold">{t('عنوان التقييم', 'Evaluation title')}<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} className={inputClass()} /></label>
      <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">{t('الملاحظات', 'Feedback')}<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} required maxLength={3000} rows={3} className={inputClass('min-h-24')} /></label>
      <div className="sm:col-span-2"><Button type="submit" icon={<Plus size={16} aria-hidden="true" />} isLoading={create.isPending} disabled={!activeMembers.length}>{t('حفظ التقييم', 'Save evaluation')}</Button></div>
    </form></Card>
    {(evaluations.data ?? []).length === 0 ? <EmptyState title={t('لا توجد تقييمات للفريق', 'No team evaluations yet')} description={t('استخدم النموذج لإضافة أول تقييم.', 'Use the form above to add the first evaluation.')} /> : <div className="grid gap-3">{(evaluations.data ?? []).map((evaluation: WorkspaceEvaluation) => <Card key={evaluation.id} className="grid min-w-0 gap-2"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-extrabold">{evaluation.title}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{activeMembers.find((member) => member.member_id === evaluation.member_id)?.full_name ?? t('عضو غير نشط', 'Inactive member')} · {t(GRADES.find((item) => item.value === evaluation.grade)?.ar ?? evaluation.grade, GRADES.find((item) => item.value === evaluation.grade)?.en ?? evaluation.grade)} · {date(evaluation.created_at, { dateStyle: 'medium' })}</p></div><Button type="button" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setDeleteTarget(evaluation)} disabled={remove.isPending}>{t('حذف', 'Delete')}</Button></div><p className="whitespace-pre-line break-words text-sm leading-6">{evaluation.feedback}</p></Card>)}</div>}
    <ConfirmDialog isOpen={Boolean(deleteTarget)} onClose={() => { if (!remove.isPending) setDeleteTarget(null); }} onConfirm={() => { void confirmDelete(); }} title={t('حذف تقييم الفريق؟', 'Delete this team evaluation?')} description={t('سيُحذف التقييم المحدد داخل هذا الفريق فقط.', 'Only this evaluation in this team will be deleted.')} confirmLabel={t('حذف التقييم', 'Delete evaluation')} isPending={remove.isPending} pendingLabel={t('جارٍ الحذف…', 'Deleting…')} />
  </div>;
}

function TeamAnnouncementsSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t, date } = useLocale();
  const queryClient = useQueryClient();
  const announcements = useQuery({ queryKey: teamWorkspaceKey(userId, teamId, 'announcements'), queryFn: ({ signal }) => listWorkspaceAnnouncements(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [priority, setPriority] = useState<AnnouncementPriority>('normal'); const [deleteTarget, setDeleteTarget] = useState<WorkspaceAnnouncement | null>(null);
  const create = useMutation({ mutationFn: createWorkspaceAnnouncement, onSuccess: () => invalidateScope(queryClient, userId, teamId, 'announcements') });
  const setActive = useMutation({ mutationFn: setWorkspaceAnnouncementActive, onSuccess: () => invalidateScope(queryClient, userId, teamId, 'announcements') });
  const remove = useMutation({ mutationFn: ({ id }: { id: number }) => deleteWorkspaceAnnouncement(teamId, id), onSuccess: () => invalidateScope(queryClient, userId, teamId, 'announcements') });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const cleanTitle = title.trim(); const cleanContent = content.trim();
    if (cleanTitle.length < 2 || cleanContent.length < 2) { toast.warning(t('اكتب عنوانًا ومحتوى صحيحين للإعلان.', 'Enter a valid announcement title and message.')); return; }
    try {
      await create.mutateAsync({ teamId, title: cleanTitle, content: cleanContent, priority });
      setTitle(''); setContent(''); setPriority('normal'); toast.success(t('اتنشر الإعلان داخل مساحة الفريق.', 'The announcement was published in this team workspace.'));
    } catch (error) { toast.error(toAppError(error, t('معرفناش ننشر الإعلان.', 'Could not publish the announcement.')).message); }
  };
  const updateActive = async (item: WorkspaceAnnouncement) => {
    try { await setActive.mutateAsync({ teamId, announcementId: item.id, active: !item.is_active }); toast.success(item.is_active ? t('اتوقف الإعلان داخل الفريق.', 'The announcement was deactivated for this team.') : t('اتفعّل الإعلان داخل الفريق.', 'The announcement was activated for this team.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش نغير حالة الإعلان.', 'Could not change the announcement state.')).message); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await remove.mutateAsync({ id: deleteTarget.id }); setDeleteTarget(null); toast.success(t('اتحذف الإعلان من الفريق.', 'The team announcement was deleted.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش نحذف الإعلان.', 'Could not delete the announcement.')).message); }
  };
  if (announcements.isPending) return <CardSkeletons count={2} />;
  if (announcements.isError) return <ErrorState message={t('تعذر تحميل إعلانات الفريق.', 'Could not load this team’s announcements.')} onRetry={() => { void announcements.refetch(); }} />;
  return <div className="grid min-w-0 gap-4">
    <Card className="grid gap-3"><div><h2 className="text-base font-black">{t('إعلان جديد للفريق', 'New team announcement')}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('الجمهور هو أعضاء الفريق النشطون، وتُحفظ قائمة المستلمين كلقطة عند النشر. لا يتم إرسال بريد أو واتساب أو إشعار خارجي من هذه الصفحة.', 'The audience is active team members, and recipients are snapshotted at publication. This page does not send email, WhatsApp, or external notifications.')}</p></div>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-bold">{t('العنوان', 'Title')}<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} className={inputClass()} /></label>
        <label className="grid gap-1.5 text-sm font-bold">{t('الأولوية', 'Priority')}<select value={priority} onChange={(event) => setPriority(event.target.value as AnnouncementPriority)} className={inputClass()}>{PRIORITIES.map((item) => <option key={item.value} value={item.value}>{t(item.ar, item.en)}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">{t('المحتوى', 'Message')}<textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={10000} rows={4} className={inputClass('min-h-28')} /></label>
        <div className="sm:col-span-2"><Button type="submit" icon={<Plus size={16} aria-hidden="true" />} isLoading={create.isPending}>{t('نشر للفريق', 'Publish to team')}</Button></div>
      </form>
    </Card>
    {(announcements.data ?? []).length === 0
      ? <EmptyState title={t('لا توجد إعلانات للفريق', 'No team announcements yet')} description={t('استخدم النموذج أعلاه لنشر إعلان للفريق.', 'Use the form above to publish an announcement to the team.')} />
      : <div className="grid gap-3">{(announcements.data ?? []).map((item: WorkspaceAnnouncement) => <Card key={item.id} className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="break-words font-black">{item.title}</h3><p className="mt-1 whitespace-pre-line break-words text-sm leading-6">{item.content}</p><p className="mt-2 text-xs text-[var(--text-muted)]">{date(item.created_at, { dateStyle: 'medium' })} · {item.recipient_count} {t('مستلم من لقطة النشر', 'snapshotted recipients')} · {item.read_count} {t('قرأوا', 'read')}</p></div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { void updateActive(item); }} isLoading={setActive.isPending}>{item.is_active ? t('إيقاف داخل الفريق', 'Deactivate for team') : t('تفعيل داخل الفريق', 'Activate for team')}</Button><Button type="button" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setDeleteTarget(item)} disabled={remove.isPending}>{t('حذف', 'Delete')}</Button></div>
        </div>
        <span className="w-fit rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-bold">{item.is_active ? t('نشط', 'Active') : t('متوقف', 'Inactive')} · {t(PRIORITIES.find((candidate) => candidate.value === item.priority)?.ar ?? item.priority, PRIORITIES.find((candidate) => candidate.value === item.priority)?.en ?? item.priority)}</span>
      </Card>)}</div>}
    <ConfirmDialog isOpen={Boolean(deleteTarget)} onClose={() => { if (!remove.isPending) setDeleteTarget(null); }} onConfirm={() => { void confirmDelete(); }} title={t('حذف إعلان الفريق؟', 'Delete this team announcement?')} description={t('الإعلان وقائمة مستلميه الخاصة بهذا الفريق فقط هي المتأثرة.', 'Only this team’s announcement and its recipient snapshot are affected.')} confirmLabel={t('حذف الإعلان', 'Delete announcement')} isPending={remove.isPending} pendingLabel={t('جارٍ الحذف…', 'Deleting…')} />
  </div>;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function TeamCustomFieldsSection({ userId, teamId }: { userId: string; teamId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const fields = useQuery({ queryKey: teamWorkspaceKey(userId, teamId, 'custom-fields'), queryFn: ({ signal }) => listWorkspaceCustomFields(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const roster = useQuery({ queryKey: [...teamWorkspaceKey(userId, teamId, 'custom-fields'), 'active-roster'], queryFn: ({ signal }) => listWorkspaceRoster(teamId, signal), enabled: Boolean(userId && teamId), retry: false });
  const [memberId, setMemberId] = useState(''); const [label, setLabel] = useState(''); const [fieldType, setFieldType] = useState<MemberCustomFieldType>('short_text'); const [optionsText, setOptionsText] = useState(''); const [draftValues, setDraftValues] = useState<Record<number, string>>({});
  const activeMembers = (roster.data ?? []).filter(memberIsActive);
  const values = useQuery({ queryKey: [...teamWorkspaceKey(userId, teamId, 'custom-fields'), 'values', memberId], queryFn: ({ signal }) => listWorkspaceCustomFieldValues(teamId, Number(memberId), signal), enabled: Boolean(userId && teamId && memberId), retry: false });
  const create = useMutation({ mutationFn: createWorkspaceCustomField, onSuccess: () => invalidateScope(queryClient, userId, teamId, 'custom-fields') });
  const setValue = useMutation({ mutationFn: setWorkspaceCustomFieldValue, onSuccess: () => invalidateScope(queryClient, userId, teamId, 'custom-fields') });
  const fieldValues = useMemo(() => new Map((values.data ?? []).map((item: WorkspaceCustomFieldValue) => [item.field_id, item.value])), [values.data]);
  useEffect(() => {
    const next: Record<number, string> = {};
    for (const [id, value] of fieldValues) next[id] = displayValue(value);
    setDraftValues(next);
  }, [fieldValues]);
  const submitField = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const cleanLabel = label.trim();
    const options = optionsText.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!cleanLabel || cleanLabel.length > 120 || (fieldType === 'select' && (options.length === 0 || options.length > 100 || options.some((option) => option.length > 120) || new Set(options).size !== options.length))) {
      toast.warning(t('اكتب اسمًا للحقل، ولنوع القائمة اكتب خيارات غير فارغة وغير مكررة، كل خيار في سطر.', 'Enter a field label; for a select field, provide unique non-empty options, one per line.'));
      return;
    }
    try { await create.mutateAsync({ teamId, label: cleanLabel, type: fieldType, options: fieldType === 'select' ? options : [] }); setLabel(''); setOptionsText(''); toast.success(t('اتعمل تعريف الحقل داخل الفريق فقط.', 'The field definition was created for this team only.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش ننشئ الحقل.', 'Could not create the field.')).message); }
  };
  const parseFieldValue = (field: WorkspaceCustomField): string | number | boolean | null => {
    const input = draftValues[field.id] ?? '';
    if (!input) return null;
    if (field.field_type === 'number') { const value = Number(input); return Number.isFinite(value) ? value : null; }
    if (field.field_type === 'yes_no') return input === 'true';
    return input;
  };
  const saveField = async (field: WorkspaceCustomField) => {
    if (!memberId) return;
    const value = parseFieldValue(field);
    if (value === null) { toast.warning(t('أدخل قيمة متوافقة مع نوع الحقل قبل الحفظ.', 'Enter a value compatible with the field type before saving.')); return; }
    if (field.field_type === 'select' && (typeof value !== 'string' || !field.options.includes(value))) { toast.warning(t('اختار قيمة من الخيارات المعرفة.', 'Choose one of the defined options.')); return; }
    if (field.field_type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) { toast.warning(t('اكتب تاريخًا صحيحًا.', 'Enter a valid date.')); return; }
    try { await setValue.mutateAsync({ teamId, memberId: Number(memberId), fieldId: field.id, value }); toast.success(t('اتحفظت قيمة الحقل لهذا الفريق.', 'The value was saved for this team.')); }
    catch (error) { toast.error(toAppError(error, t('معرفناش نحفظ القيمة.', 'Could not save the value.')).message); }
  };
  if (fields.isPending || roster.isPending) return <CardSkeletons count={2} />;
  if (fields.isError || roster.isError) return <ErrorState message={t('تعذر تحميل حقول الفريق أو أعضائه النشطين.', 'Could not load this team’s fields or active members.')} onRetry={() => { void fields.refetch(); void roster.refetch(); }} />;
  return <div className="grid min-w-0 gap-4">
    <Card className="grid gap-3"><div><h2 className="text-base font-black">{t('تعريف حقل للفريق', 'Create a team field')}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('تعريفات الحقول وقيمها هنا مستقلة عن custom_fields والملف الأساسي للعضو.', 'Field definitions and values here are separate from the member’s canonical profile and custom_fields.')}</p></div><form onSubmit={(event) => void submitField(event)} className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-bold">{t('اسم الحقل', 'Field label')}<input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={120} className={inputClass()} /></label><label className="grid gap-1.5 text-sm font-bold">{t('نوع الحقل', 'Field type')}<select value={fieldType} onChange={(event) => setFieldType(event.target.value as MemberCustomFieldType)} className={inputClass()}>{FIELD_TYPES.map((item) => <option key={item.value} value={item.value}>{t(item.ar, item.en)}</option>)}</select></label>{fieldType === 'select' && <label className="grid gap-1.5 text-sm font-bold sm:col-span-2">{t('الخيارات (كل خيار في سطر)', 'Options (one per line)')}<textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} rows={3} required className={inputClass('min-h-24')} /></label>}<div className="sm:col-span-2"><Button type="submit" icon={<Plus size={16} aria-hidden="true" />} isLoading={create.isPending}>{t('إنشاء الحقل', 'Create field')}</Button></div></form></Card>
    <Card className="grid gap-3"><div><h2 className="text-base font-black">{t('قيم حقول الفريق', 'Team field values')}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('اختر عضوًا نشطًا لحفظ قيمة منفصلة في هذا الفريق.', 'Select an active member to save a value scoped to this team.')}</p></div><label className="grid gap-1.5 text-sm font-bold">{t('العضو النشط', 'Active member')}<select value={memberId} onChange={(event) => setMemberId(event.target.value)} className={inputClass()}><option value="">{t('اختار عضوًا', 'Select a member')}</option>{activeMembers.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name}</option>)}</select></label>{memberId && values.isPending && <CardSkeletons count={1} />}{memberId && values.isError && <ErrorState message={t('تعذر تحميل قيم الحقول.', 'Could not load field values.')} onRetry={() => { void values.refetch(); }} />}{memberId && fields.data?.length === 0 && <EmptyState title={t('لا توجد حقول معرفة للفريق', 'No fields are defined for this team')} description={t('أنشئ حقلًا من النموذج السابق أولًا.', 'Create a field using the form above first.')} />}{memberId && values.data && (fields.data ?? []).length > 0 && <div className="grid gap-3">{(fields.data ?? []).map((field: WorkspaceCustomField) => <label key={field.id} className="grid gap-1.5 text-sm font-bold">{field.label}{field.field_type === 'long_text' ? <textarea value={draftValues[field.id] ?? ''} onChange={(event) => setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))} rows={3} className={inputClass('min-h-24')} /> : field.field_type === 'yes_no' ? <select value={draftValues[field.id] ?? ''} onChange={(event) => setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))} className={inputClass()}><option value="">{t('لم يتم التحديد', 'Not set')}</option><option value="true">{t('نعم', 'Yes')}</option><option value="false">{t('لا', 'No')}</option></select> : field.field_type === 'select' ? <select value={draftValues[field.id] ?? ''} onChange={(event) => setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))} className={inputClass()}><option value="">{t('اختار قيمة', 'Select a value')}</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'} value={draftValues[field.id] ?? ''} onChange={(event) => setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))} maxLength={field.field_type === 'short_text' ? 200 : undefined} className={inputClass()} />}<Button type="button" variant="secondary" icon={<Save size={15} aria-hidden="true" />} onClick={() => { void saveField(field); }} isLoading={setValue.isPending}>{t('حفظ القيمة', 'Save value')}</Button></label>)}</div>}</Card>
  </div>;
}

/** الخزنة داخل مساحة الفريق — نفس لوحة الإدارة بالكامل، محصورة على تيم العضو. */
function TeamLedgerSection() {
  return (
    <div className="min-w-0">
      <Suspense fallback={<CardSkeletons count={2} />}>
        <LedgerBoard />
      </Suspense>
    </div>
  );
}

function WorkspacePanel({ section, userId, teamId }: { section: TeamWorkspaceSection; userId: string; teamId: string }) {
  switch (section) {
    case 'tasks': return <TeamTasksSection userId={userId} teamId={teamId} />;
    case 'members': return <TeamRosterSection userId={userId} teamId={teamId} />;
    case 'notes': return <TeamNotesSection userId={userId} teamId={teamId} />;
    case 'ranking': return <TeamRankingSection userId={userId} teamId={teamId} />;
    case 'announcements': return <TeamAnnouncementsSection userId={userId} teamId={teamId} />;
    case 'custom-fields': return <TeamCustomFieldsSection userId={userId} teamId={teamId} />;
    case 'ledger': return <TeamLedgerSection />;
  }
}

export default function TeamWorkspacePage() {
  const { t, dir } = useLocale();
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clear);
  const { theme, toggle } = useThemeStore();
  const access = useAdminAccess(user?.id ?? null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { teamId: routeTeamId } = useParams<{ teamId?: string }>();
  const teamEntries = useMemo(() => workspaceTeamEntries(access.data), [access.data]);
  const currentTeam = teamEntries.find((team) => team.team_id === routeTeamId) ?? (!routeTeamId ? teamEntries[0] : undefined);
  const permittedSections = useMemo(() => SECTION_DEFS.filter((section) => currentTeam?.permissions[FEATURE_FOR_SECTION[section.id]] === true), [currentTeam]);
  const [section, setSection] = useState<TeamWorkspaceSection>('tasks');
  const availableKey = permittedSections.map((item) => item.id).join('|');
  const teamScopeId = currentTeam?.team_id ?? routeTeamId ?? '';

  useEffect(() => {
    if (!access.data || access.isError) return;
    if ((!access.data.is_admin && !access.data.is_team_admin) || teamEntries.length === 0) { navigate('/admin/login', { replace: true }); return; }
    if (!currentTeam) { navigate(`/team/${teamEntries[0].team_id}`, { replace: true }); return; }
  }, [access.data, access.isError, currentTeam, navigate, teamEntries]);

  useEffect(() => {
    if (permittedSections.some((item) => item.id === section)) return;
    setSection(permittedSections[0]?.id ?? 'tasks');
  }, [availableKey, permittedSections, section]);

  useEffect(() => {
    if (!user?.id || !teamScopeId) return;
    const scope = ['team-workspace', user.id, teamScopeId] as const;
    const allowed = new Set(permittedSections.map((item) => item.id));
    if (access.isError || !currentTeam) {
      void queryClient.cancelQueries({ queryKey: scope });
      queryClient.removeQueries({ queryKey: scope });
      return;
    }
    for (const query of queryClient.getQueryCache().findAll({ queryKey: scope })) {
      const querySection = query.queryKey[3];
      if (isWorkspaceSection(querySection) && !allowed.has(querySection)) {
        void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
        queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  }, [access.isError, currentTeam, permittedSections, queryClient, teamScopeId, user?.id]);

  useEffect(() => {
    if (!user?.id || !teamScopeId) return;
    const scope = ['team-workspace', user.id, teamScopeId] as const;
    return () => {
      void queryClient.cancelQueries({ queryKey: scope });
      queryClient.removeQueries({ queryKey: scope });
    };
  }, [queryClient, teamScopeId, user?.id]);

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearAuth();
      navigate('/admin/login', { replace: true });
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نسجل الخروج. الجلسة فضلت محفوظة.', 'Could not sign out. The session remains active.')).message);
    }
  };

  if (access.isPending || access.isFetching) return <CardSkeletons count={2} />;
  if (access.isError) return <ErrorState message={t('تعذر التحقق من صلاحية الفريق. لم يتم عرض بيانات مخزنة.', 'Could not verify team access. Cached team data is not displayed.')} onRetry={() => { void access.refetch(); }} />;
  if (!user) return <EmptyState title={t('يلزم تسجيل الدخول', 'Sign-in required')} description={t('سجّل الدخول بحساب Head أو Monitor مخصص لفريق نشط.', 'Sign in with a Head or Monitor account assigned to an active team.')} />;
  if ((!access.data?.is_admin && !access.data?.is_team_admin) || teamEntries.length === 0) return <EmptyState title={t('لا توجد تعيينات فريق نشطة', 'No active team assignments')} description={t('مساحة العمل متاحة فقط لحساب Head أو Monitor معيّن لفريق نشط.', 'The workspace is available only to a Head or Monitor assigned to an active team.')} />;
  if (!currentTeam) return <CardSkeletons count={1} />;
  const activeSection = permittedSections.find((item) => item.id === section)?.id ?? permittedSections[0]?.id;
  const roleName = currentTeam.role === null ? t('إدارة النظام العام', 'Global administration') : currentTeam.role === 'head' ? t('Head · رئيس الفريق', 'Head') : t('Monitor · المتابع', 'Monitor');
  return <div className="mx-auto grid w-full min-w-0 max-w-6xl gap-4 px-3 pb-8 sm:px-5" dir={dir}>
    <Card className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><Layers3 size={20} aria-hidden="true" /></span><div className="min-w-0"><p className="text-xs font-black">{t('صلاحية ضمن الفريق المحدد', 'Scoped to selected team')}</p><p className="mt-0.5 text-xs text-[var(--text-muted)]">{roleName} · <bdi dir="ltr">{currentTeam.slug}</bdi></p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="team-workspace-picker">{t('اختار الفريق', 'Select team')}</label>
        <select id="team-workspace-picker" value={currentTeam.team_id} onChange={(event) => navigate(`/team/${event.target.value}`)} className="min-h-11 min-w-32 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold sm:flex-none" aria-label={t('الفريق المعيّن', 'Assigned team')}>
          {teamEntries.map((team) => <option key={team.team_id} value={team.team_id}>{team.name} · {team.role === null ? t('إدارة عامة', 'Global admin') : team.role === 'head' ? t('رئيس الفريق', 'Head') : t('المتابع', 'Monitor')}</option>)}
        </select>
        {currentTeam.role !== null && (
          <Link
            to={`/admin/teams/${currentTeam.team_id}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-extrabold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <LayoutDashboard size={16} aria-hidden="true" />
            {t('لوحة الفريق', 'Team console')}
          </Link>
        )}
        <LanguageToggle />
        <Button type="button" variant="secondary" className="!min-w-11 !px-3" onClick={toggle} aria-label={theme === 'dark' ? t('استخدم المظهر الفاتح', 'Use light theme') : t('استخدم المظهر الداكن', 'Use dark theme')}>{theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Button>
        <Button type="button" variant="secondary" icon={<LogOut size={16} aria-hidden="true" />} onClick={() => { void logout(); }}>{t('خروج', 'Sign out')}</Button>
      </div>
    </Card>
    <PageHeader icon={<ShieldCheck size={23} aria-hidden="true" />} title={currentTeam.name} description={t('مساحة منفصلة لهذا الفريق. كل قائمة وإجراء هنا مرتبطان بهذا الفريق فقط.', 'A separate workspace for this team. Every list and action here is scoped to this team only.')} />
    <section aria-labelledby="team-capabilities-heading" className="grid min-w-0 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div><h2 id="team-capabilities-heading" className="text-sm font-black">{t('صلاحيات الفريق المحدد', 'Permissions for the selected team')}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('الحالة أدناه تخص هذا التعيين فقط. تبديل الفريق يغيّر الصلاحيات المعروضة ولا يدمجها.', 'These statuses describe this team assignment only. Switching teams changes the displayed grants; permissions are not combined.')}</p></div>
      <div className="flex flex-wrap gap-2">
        {CAPABILITY_DEFS.map((item) => {
          const granted = currentTeam.permissions[item.key] === true;
          return <span key={item.key} aria-label={`${t(item.ar, item.en)}: ${granted ? t('ممنوحة', 'Granted') : t('غير ممنوحة', 'Not granted')}`} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${granted ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
            <span>{t(item.ar, item.en)}</span><span aria-hidden="true" className="opacity-75">{granted ? t('ممنوحة', 'Granted') : t('غير ممنوحة', 'Not granted')}</span>
          </span>;
        })}
      </div>
    </section>
    <div role="tablist" aria-label={t('أقسام مساحة الفريق', 'Team workspace sections')} onKeyDown={(event) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || permittedSections.length === 0) return;
      const currentIndex = permittedSections.findIndex((item) => item.id === activeSection);
      if (currentIndex < 0) return;
      const movesForward = event.key === (dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
      const nextIndex = (currentIndex + (movesForward ? 1 : -1) + permittedSections.length) % permittedSections.length;
      setSection(permittedSections[nextIndex].id);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
      event.preventDefault();
    }} className="flex min-w-0 flex-wrap gap-2">
      {permittedSections.map((item) => <button key={item.id} id={`team-workspace-tab-${item.id}`} type="button" role="tab" aria-selected={activeSection === item.id} aria-controls="team-workspace-panel" tabIndex={activeSection === item.id ? 0 : -1} onClick={() => setSection(item.id)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] ${activeSection === item.id ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>{item.icon}{t(item.titleAr, item.titleEn)}</button>)}
    </div>
    <section id="team-workspace-panel" role="tabpanel" aria-labelledby={activeSection ? `team-workspace-tab-${activeSection}` : undefined} aria-label={t(SECTION_DEFS.find((item) => item.id === activeSection)?.titleAr ?? '', SECTION_DEFS.find((item) => item.id === activeSection)?.titleEn ?? '')} tabIndex={0} className="min-w-0">
      {activeSection ? <WorkspacePanel key={`${user.id}:${currentTeam.team_id}:${activeSection}`} section={activeSection} userId={user.id} teamId={currentTeam.team_id} /> : <EmptyState title={t('لا توجد أقسام مفعّلة لهذا الفريق', 'No sections are enabled for this team')} description={t('اختار فريقًا آخر أو اطلب من المالك تفعيل صلاحيات هذا الفريق.', 'Choose another team or ask the Owner to enable this team’s permissions.')} />}
    </section>
    {currentTeam.permissions.ai_assistant === true && <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-muted)]">{t('المساعد الذكي للفريق غير مفعّل بعد في مساحة الفريق.', 'Team AI assistant is not enabled in the team workspace yet.')}</p>}
    {currentTeam.permissions.whatsapp === true && <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-muted)]">{t('تكامل WhatsApp للفريق غير مفعّل بعد في مساحة الفريق.', 'Team WhatsApp is not enabled in the team workspace yet.')}</p>}
  </div>;
}
