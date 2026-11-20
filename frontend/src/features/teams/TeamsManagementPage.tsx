import { useEffect, useMemo, useState } from 'react';
import { Layers3, Pause, Pencil, Play, Plus, Save, ShieldCheck, Trash2, UserCog, UserPlus, UsersRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useLocale } from '../../i18n/useLocale';
import type { AdminPermission, AdminPermissions, TeamAdminCandidate, TeamAdminRole, TeamOverview } from '../../types/db';
import { ADMIN_PERMISSION_OPTIONS, FULL_ADMIN_PERMISSIONS } from '../admin/access/permissions';
import { useAdminAccess } from '../admin/access/api';
import {
  useAddTeamMember,
  useCreateTeam,
  useOwnerTeamMemberCandidates,
  useOwnerTeamMembers,
  useOwnerTeams,
  useReviewTeamMember,
  useSetTeamActive,
  useSetTeamAdminSeat,
  useTeamAdminCandidates,
  useUpdateTeamDetails,
} from './api';

const ROLES: TeamAdminRole[] = ['head', 'monitor'];
const EMPTY_PERMISSIONS = Object.fromEntries(
  Object.keys(FULL_ADMIN_PERMISSIONS).map((key) => [key, false]),
) as AdminPermissions;

const PERMISSION_COPY: Record<AdminPermission, { ar: string; en: string; descriptionAr: string; descriptionEn: string }> = {
  dashboard: { ar: 'لوحة الفريق', en: 'Team dashboard', descriptionAr: 'عرض ملخص هذا الفريق فقط.', descriptionEn: 'View this team’s dashboard only.' },
  members: { ar: 'الأعضاء', en: 'Members', descriptionAr: 'إدارة عضويات وبيانات هذا الفريق.', descriptionEn: 'Manage this team’s memberships and member data.' },
  tasks: { ar: 'المهام', en: 'Tasks', descriptionAr: 'إدارة ومراجعة مهام هذا الفريق.', descriptionEn: 'Manage and review this team’s tasks.' },
  ranking: { ar: 'الترتيب والتقييمات', en: 'Ranking & evaluations', descriptionAr: 'عرض ترتيب وتقييمات هذا الفريق.', descriptionEn: 'View this team’s ranking and evaluations.' },
  notes: { ar: 'الملاحظات', en: 'Notes', descriptionAr: 'إدارة ملاحظات هذا الفريق.', descriptionEn: 'Manage this team’s notes.' },
  announcements: { ar: 'الإعلانات', en: 'Announcements', descriptionAr: 'إدارة إعلانات هذا الفريق.', descriptionEn: 'Manage this team’s announcements.' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp', descriptionAr: 'إرسال رسائل للفريق المصرح به فقط.', descriptionEn: 'Send messages only to authorized team members.' },
  ai_assistant: { ar: 'المساعد الذكي', en: 'AI assistant', descriptionAr: 'استخدام سياق هذا الفريق فقط.', descriptionEn: 'Use this team’s context only.' },
};

function roleLabel(role: TeamAdminRole, t: (ar: string, en: string) => string) {
  return role === 'head' ? t('رئيس الفريق · Head', 'Team Head') : t('المتابع · Monitor', 'Team Monitor');
}

function membershipStatusLabel(status: 'pending' | 'active' | 'suspended' | 'removed', t: (ar: string, en: string) => string) {
  const copy = {
    pending: ['بانتظار المراجعة', 'Pending review'],
    active: ['نشط في الفريق', 'Active in team'],
    suspended: ['موقوف في الفريق', 'Suspended in team'],
    removed: ['أزيل من الفريق', 'Removed from team'],
  } as const;
  return t(copy[status][0], copy[status][1]);
}

function TeamAdminSeat({
  team,
  role,
  candidates,
  isOwner,
}: {
  team: TeamOverview;
  role: TeamAdminRole;
  candidates: TeamAdminCandidate[];
  isOwner: boolean;
}) {
  const { t } = useLocale();
  const existing = team.assignments.find((assignment) => assignment.role === role);
  const eligible = candidates.filter((candidate) => candidate.global_role === null);
  const [userId, setUserId] = useState(existing?.user_id ?? '');
  const [permissions, setPermissions] = useState<AdminPermissions>(existing?.permissions ?? EMPTY_PERMISSIONS);
  const setSeat = useSetTeamAdminSeat();

  useEffect(() => {
    setUserId(existing?.user_id ?? '');
    setPermissions(existing?.permissions ?? EMPTY_PERMISSIONS);
  }, [existing?.id, existing?.user_id, existing?.permissions]);

  const setPermission = (key: AdminPermission) => {
    setPermissions((current) => ({ ...current, [key]: !current[key] }));
  };

  const save = async () => {
    if (!userId) {
      toast.error(t('اختار حسابًا للمنصب قبل الحفظ.', 'Choose an account for this seat before saving.'));
      return;
    }
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId, permissions });
      toast.success(t('اتحفظ التعيين وصلاحياته لهذا الفريق فقط.', 'Assignment and permissions saved for this team only.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ تعيين الفريق.', 'Could not save the team assignment.')).message);
    }
  };

  const clear = async () => {
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId: null, permissions: null });
      setUserId('');
      setPermissions(EMPTY_PERMISSIONS);
      toast.success(t('اتشال تعيين المنصب بس؛ حساب الدخول والفرق التانية ما اتلمستش.', 'Only this team assignment was removed; the sign-in and other team assignments remain.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نشيل التعيين.', 'Could not remove the assignment.')).message);
    }
  };

  return (
    <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4" aria-label={roleLabel(role, t)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-black"><UserCog size={18} aria-hidden="true" />{roleLabel(role, t)}</h3>
        {existing ? <Badge variant="success">{t('مُعيّن', 'Assigned')}</Badge> : <Badge variant="neutral">{t('المقعد متاح', 'Seat available')}</Badge>}
      </div>
      <label className="grid gap-1.5 text-sm font-bold">
        {t('حساب Auth موجود', 'Existing Auth account')}
        <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!isOwner || !team.is_active || setSeat.isPending} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm">
          <option value="">{t('اختار مسؤولًا', 'Select a manager')}</option>
          {eligible.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.member_name ? `${candidate.member_name} · ` : ''}{candidate.email}</option>)}
        </select>
      </label>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{t('التعيين يضيف مساحة الفريق فقط ولا ينشئ حساب Admin عامًا. الشخص ممكن يتعيّن في فرق مختلفة، لكن مش في المقعدين داخل نفس الفريق.', 'This grants team-only access and never creates a global Admin. A person may be assigned to other teams, but cannot hold both seats in this team.')}</p>
      <fieldset disabled={!isOwner || !team.is_active || setSeat.isPending} className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-extrabold text-[var(--text-muted)]">{t('الصلاحيات داخل الفريق', 'Permissions inside this team')}</legend>
        {ADMIN_PERMISSION_OPTIONS.map(({ key }) => (
          <label key={key} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${permissions[key] ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)]'}`}>
            <input type="checkbox" checked={permissions[key]} onChange={() => setPermission(key)} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
            <span className="grid gap-0.5"><span className="text-xs font-extrabold">{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</span><span className="text-[11px] leading-4 text-[var(--text-muted)]">{t(PERMISSION_COPY[key].descriptionAr, PERMISSION_COPY[key].descriptionEn)}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" icon={<Save size={16} />} onClick={() => void save()} isLoading={setSeat.isPending} disabled={!team.is_active || !isOwner}>
          {t('حفظ المقعد', 'Save seat')}
        </Button>
        {existing && <Button type="button" variant="danger" icon={<Trash2 size={16} />} onClick={() => void clear()} isLoading={setSeat.isPending} disabled={!isOwner}>
          {t('إزالة التعيين فقط', 'Remove assignment only')}
        </Button>}
      </div>
    </section>
  );
}

function TeamMemberRoster({ team }: { team: TeamOverview }) {
  const { t, number } = useLocale();
  const members = useOwnerTeamMembers(team.team_id);
  const candidates = useOwnerTeamMemberCandidates(team.team_id);
  const addMember = useAddTeamMember();
  const reviewMember = useReviewTeamMember();
  const [selected, setSelected] = useState('');
  const existingIds = useMemo(() => new Set(members.data?.filter((member) => member.membership_status === 'active').map((member) => member.member_id) ?? []), [members.data]);
  const available = (candidates.data ?? []).filter((member) => !existingIds.has(member.member_id) && member.membership_status !== 'pending' && member.work_status === 'active');

  const add = async () => {
    if (!selected) return;
    try {
      const status = await addMember.mutateAsync({ teamId: team.team_id, memberId: Number(selected) });
      setSelected('');
      toast.success(status === 'active' ? t('اتضاف العضو للفريق. يقدر يبقى في فرق تانية كمان.', 'Member added to this team. They may also belong to other teams.') : t('اتسجلت عضوية الفريق للمراجعة.', 'Team membership is pending review.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نضيف العضوية.', 'Could not add this membership.')).message);
    }
  };

  const decide = async (memberId: number, decision: 'approve' | 'suspend' | 'remove') => {
    try {
      await reviewMember.mutateAsync({ teamId: team.team_id, memberId, decision });
      toast.success(decision === 'approve' ? t('اتفعّلت العضوية في الفريق.', 'Membership activated for this team.') : decision === 'suspend' ? t('اتوقفت عضوية الفريق بس.', 'Only this team membership was suspended.') : t('اتشالت العضوية من الفريق؛ حساب العضو والفرق التانية سليمين.', 'Membership removed from this team; the member account and other teams remain intact.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نغير العضوية.', 'Could not update the membership.')).message);
    }
  };

  return (
    <div className="grid gap-3 border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-black">{t('عضوية الأعضاء في الفريق', 'Team member memberships')}</h3>
        <Badge variant="neutral">{number(members.data?.filter((member) => member.membership_status === 'active').length ?? 0)} {t('أعضاء نشطون', 'active members')}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-xs font-bold">
          {t('إضافة عضو موجود إلى هذا الفريق', 'Add an existing member to this team')}
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={addMember.isPending || !team.is_active} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm">
            <option value="">{t('اختار عضوًا', 'Select a member')}</option>
            {available.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name} · {member.email}</option>)}
          </select>
        </label>
        <Button type="button" icon={<UserPlus size={16} />} onClick={() => void add()} disabled={!selected || !team.is_active} isLoading={addMember.isPending} className="self-end">
          {t('إضافة للفريق', 'Add to team')}
        </Button>
      </div>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{t('العضوية مرتبطة بهذا الفريق فقط. يمكن للشخص نفسه الانضمام لفرق أخرى من غير إنشاء حساب أو ملف مكرر.', 'Membership is limited to this team. The same person can join other teams without another account or profile.')}</p>
      {members.isPending && <CardSkeletons count={1} />}
      {members.isError && <ErrorState message={t('تعذر تحميل أعضاء الفريق.', 'Could not load team memberships.')} onRetry={() => { void members.refetch(); }} />}
      {members.data?.length === 0 && <EmptyState title={t('لسه مفيش أعضاء مسندين للفريق', 'No members are assigned to this team yet')} description={t('إضافة عضو هنا لا تنقله من فريق آخر.', 'Adding a member here does not remove them from another team.')} />}
      {members.data && members.data.length > 0 && <div className="grid gap-2">
        {members.data.map((member) => (
          <article key={member.member_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="min-w-0"><p className="truncate text-sm font-extrabold">{member.full_name}</p><p className="break-all text-xs text-[var(--text-muted)]" dir="ltr">{member.email}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={member.membership_status === 'active' ? 'success' : member.membership_status === 'pending' ? 'warning' : 'neutral'}>{membershipStatusLabel(member.membership_status, t)}</Badge>
              {member.membership_status === 'pending' && <Button type="button" icon={<ShieldCheck size={14} />} onClick={() => void decide(member.member_id, 'approve')} isLoading={reviewMember.isPending}>{t('موافقة', 'Approve')}</Button>}
              {member.membership_status === 'active' && <Button type="button" variant="secondary" icon={<Pause size={14} />} onClick={() => void decide(member.member_id, 'suspend')} isLoading={reviewMember.isPending}>{t('إيقاف هذا الفريق', 'Suspend here')}</Button>}
              {member.membership_status !== 'removed' && <Button type="button" variant="danger" icon={<Trash2 size={14} />} onClick={() => void decide(member.member_id, 'remove')} isLoading={reviewMember.isPending}>{t('إزالة من الفريق', 'Remove here')}</Button>}
              {(member.membership_status === 'removed' || member.membership_status === 'suspended') && available.some((candidate) => candidate.member_id === member.member_id) && <Button type="button" variant="secondary" icon={<Play size={14} />} onClick={() => { setSelected(String(member.member_id)); }} disabled={!team.is_active}>{t('إعادة الإضافة', 'Re-add')}</Button>}
            </div>
          </article>
        ))}
      </div>}
    </div>
  );
}

function TeamCard({ team, candidates, isOwner }: { team: TeamOverview; candidates: TeamAdminCandidate[]; isOwner: boolean }) {
  const { t } = useLocale();
  const toggle = useSetTeamActive();
  const updateDetails = useUpdateTeamDetails();
  const [pendingDisable, setPendingDisable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(team.name);
  const [draftSlug, setDraftSlug] = useState(team.slug);
  useEffect(() => {
    if (!editing) {
      setDraftName(team.name);
      setDraftSlug(team.slug);
    }
  }, [editing, team.name, team.slug]);

  const saveDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateDetails.mutateAsync({ teamId: team.team_id, name: draftName.trim(), slug: draftSlug.trim().toLowerCase() });
      setEditing(false);
      toast.success(t('اتحدث اسم الفريق ومعرّفه.', 'Team name and slug updated.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحدّث تفاصيل الفريق.', 'Could not update team details.')).message);
    }
  };
  const setActive = async (active: boolean) => {
    try {
      await toggle.mutateAsync({ teamId: team.team_id, active });
      setPendingDisable(false);
      toast.success(active ? t('اتفعّل الفريق.', 'Team enabled.') : t('اتوقف الفريق؛ ما اتحذفش.', 'Team disabled, not deleted.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نغير حالة الفريق.', 'Could not change the team state.')).message);
    }
  };
  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]"><Layers3 size={22} aria-hidden="true" /></span>
          <div className="min-w-0"><h2 className="truncate text-lg font-black">{team.name}</h2><p className="mt-1 text-xs text-[var(--text-muted)]" dir="ltr">{team.slug}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={team.is_active ? 'success' : 'neutral'}>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</Badge>
          {isOwner && team.is_active && <Link to={`/team/${team.team_id}`} className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">{t('فتح مساحة الفريق', 'Open team workspace')}</Link>}
          {isOwner && !editing && <Button type="button" variant="secondary" icon={<Pencil size={15} />} onClick={() => setEditing(true)}>{t('تعديل الاسم', 'Edit details')}</Button>}
          {isOwner && <Button type="button" variant="secondary" icon={team.is_active ? <Pause size={15} /> : <Play size={15} />} onClick={() => team.is_active ? setPendingDisable(true) : void setActive(true)} isLoading={toggle.isPending}>
            {team.is_active ? t('إيقاف الفريق', 'Disable team') : t('تفعيل الفريق', 'Enable team')}
          </Button>}
        </div>
      </div>
      {editing && <form onSubmit={(event) => void saveDetails(event)} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <label className="grid gap-1 text-xs font-bold">{t('اسم الفريق', 'Team name')}<input value={draftName} onChange={(event) => setDraftName(event.target.value)} required minLength={2} maxLength={80} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <label className="grid gap-1 text-xs font-bold">{t('معرّف URL', 'URL slug')}<input value={draftSlug} onChange={(event) => setDraftSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" icon={<Save size={16} />} isLoading={updateDetails.isPending}>{t('حفظ', 'Save')}</Button>
          <Button type="button" variant="ghost" icon={<X size={16} />} onClick={() => setEditing(false)} disabled={updateDetails.isPending}>{t('إلغاء', 'Cancel')}</Button>
        </div>
      </form>}
      <div className="grid gap-4 xl:grid-cols-2">
        {ROLES.map((role) => <TeamAdminSeat key={role} team={team} role={role} candidates={candidates} isOwner={isOwner} />)}
      </div>
      {team.is_active && <TeamMemberRoster team={team} />}
      <ConfirmDialog isOpen={pendingDisable} onClose={() => setPendingDisable(false)} onConfirm={() => void setActive(false)} title={t('إيقاف الفريق؟', 'Disable this team?')} description={t('سيتوقف وصول Heads/Monitors لهذا الفريق فقط. عضوية Auth والفرق الأخرى لا تتأثر، ويمكن إعادة التفعيل.', 'Team access for its Heads/Monitors will stop. Auth accounts and other teams are unaffected, and this can be reversed.')} confirmLabel={t('إيقاف الفريق', 'Disable team')} isPending={toggle.isPending} pendingLabel={t('بيتم الإيقاف...', 'Disabling…')} />
    </Card>
  );
}

export default function TeamsManagementPage() {
  const { t, dir } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const ownerConfirmed = access.data?.is_owner === true;
  const teams = useOwnerTeams(ownerConfirmed);
  const candidates = useTeamAdminCandidates(ownerConfirmed);
  const createTeam = useCreateTeam();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await createTeam.mutateAsync({ slug: slug.trim().toLowerCase(), name: name.trim() });
      setName('');
      setSlug('');
      toast.success(t('اتعمل الفريق من غير ما ننقل له بيانات قديمة.', 'Team created without assigning any legacy data.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش ننشئ الفريق.', 'Could not create the team.')).message);
    }
  };

  if (access.isPending || (access.isFetching && !access.data)) return <CardSkeletons count={2} />;
  if (access.isError) return <ErrorState message={t('تعذر التحقق من صلاحية Owner.', 'Could not verify Owner access.')} onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.is_owner) return <EmptyState title={t('إدارة الفرق للمالك فقط', 'Team management is restricted to the owner')} description={t('تعيين Head/Monitor وتغيير الصلاحيات يتم من Owner فقط.', 'Only the Owner can assign Heads/Monitors or change their permissions.')} />;

  return (
    <div className="grid gap-4" dir={dir}>
      <PageHeader icon={<UsersRound size={24} />} title={t('إدارة الفرق الداخلية', 'Internal teams')} description={t('لكل فريق Head وMonitor بصلاحيات تختارها أنت. العضو يقدر يكون في أكتر من فريق، وحسابات Admin العامة تفضل منفصلة.', 'Each team has a Head and Monitor with permissions you choose. Members can belong to multiple teams; global Admin accounts remain separate.')} />
      <Card>
        <form onSubmit={(event) => void create(event)} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1.5 text-sm font-bold">{t('اسم الفريق', 'Team name')}<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" placeholder={t('مثال: Software', 'e.g. Software')} /></label>
          <label className="grid gap-1.5 text-sm font-bold">{t('معرّف URL', 'URL slug')}<input value={slug} onChange={(event) => setSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" placeholder="software" /></label>
          <Button type="submit" icon={<Plus size={17} />} isLoading={createTeam.isPending} disabled={!access.data.is_owner}>{t('إنشاء فريق', 'Create team')}</Button>
        </form>
        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{t('Software وHardware وAI أمثلة جاهزة وفارغة. السجلات القديمة تفضل غير معيّنة لحد ما تسندها صراحة.', 'Software, Hardware, and AI are empty starter teams. Legacy records remain unassigned until explicitly classified.')}</p>
      </Card>
      {teams.isPending && <CardSkeletons count={3} />}
      {teams.isError && <ErrorState message={t('تعذر تحميل الفرق وتعييناتها.', 'Could not load teams and assignments.')} onRetry={() => { void teams.refetch(); }} />}
      {candidates.isError && <ErrorState message={t('تعذر تحميل حسابات التعيين.', 'Could not load assignment candidates.')} onRetry={() => { void candidates.refetch(); }} />}
      {teams.data?.length === 0 && <EmptyState title={t('مفيش فرق لسه', 'No teams yet')} description={t('أنشئ أول فريق من النموذج أعلى الصفحة.', 'Create the first team using the form above.')} />}
      {teams.data?.map((team) => <TeamCard key={team.team_id} team={team} candidates={candidates.data ?? []} isOwner={access.data?.is_owner === true} />)}
      <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-muted)]"><ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{t('Head/Monitor مش بيتضافوا لـadmin_accounts؛ سحب تعيين فريق ما بيحذفش حساب الدخول ولا عضوياته الأخرى. الصلاحيات لا تفتح أي بيانات قبل اكتمال حماية المسار المقابل في الخادم.', 'Heads/Monitors are not added to admin_accounts. Revoking one team assignment does not delete sign-in or other memberships. A permission will not expose data until that server path is fully scoped.')}</p></div>
    </div>
  );
}
