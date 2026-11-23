import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, Layers3, Pause, Pencil, Play, Plus, Save, Search, ShieldCheck, Trash2, UserCog, UserPlus, UsersRound, X } from 'lucide-react';
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
import type { TeamPermission, TeamPermissions, TeamAdminCandidate, TeamAdminRole, TeamOverview } from '../../types/db';
import { TEAM_PERMISSION_OPTIONS } from '../admin/access/permissions';
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
import './teams-management.css';

const ROLES: TeamAdminRole[] = ['head', 'monitor'];
const EMPTY_PERMISSIONS = Object.fromEntries(
  TEAM_PERMISSION_OPTIONS.map(({ key }) => [key, false]),
) as TeamPermissions;
type TeamStatusFilter = 'all' | 'active' | 'disabled';

const PERMISSION_COPY: Record<TeamPermission, { ar: string; en: string; descriptionAr: string; descriptionEn: string }> = {
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

function TeamAdminSeat({ team, role, candidates, isOwner }: {
  team: TeamOverview;
  role: TeamAdminRole;
  candidates: TeamAdminCandidate[];
  isOwner: boolean;
}) {
  const { t } = useLocale();
  const existing = team.assignments.find((assignment) => assignment.role === role);
  const eligible = candidates.filter((candidate) => candidate.global_role === null);
  const [userId, setUserId] = useState(existing?.user_id ?? '');
  const [permissions, setPermissions] = useState<TeamPermissions>(existing?.permissions ?? EMPTY_PERMISSIONS);
  const setSeat = useSetTeamAdminSeat();

  useEffect(() => {
    setUserId(existing?.user_id ?? '');
    setPermissions(existing?.permissions ?? EMPTY_PERMISSIONS);
  }, [existing?.id, existing?.user_id, existing?.permissions]);

  const setPermission = (key: TeamPermission) => {
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
    <section className="teams-seat-editor" aria-label={roleLabel(role, t)}>
      <label className="teams-field">
        {t('حساب Auth موجود', 'Existing Auth account')}
        <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!isOwner || !team.is_active || setSeat.isPending}>
          <option value="">{t('اختار مسؤولًا', 'Select a manager')}</option>
          {eligible.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.member_name ? `${candidate.member_name} · ` : ''}{candidate.email}</option>)}
        </select>
      </label>
      <p className="teams-help">{t('التعيين يضيف مساحة الفريق فقط ولا ينشئ حساب Admin عامًا. الشخص ممكن يتعيّن في فرق مختلفة، لكن مش في المقعدين داخل نفس الفريق.', 'This grants team-only access and never creates a global Admin. A person may be assigned to other teams, but cannot hold both seats in this team.')}</p>
      <fieldset disabled={!isOwner || !team.is_active || setSeat.isPending} className="teams-permissions">
        <legend>{t('الصلاحيات داخل الفريق', 'Permissions inside this team')}</legend>
        {TEAM_PERMISSION_OPTIONS.map(({ key }) => (
          <label key={key} className={`teams-permission ${permissions[key] ? 'teams-permission--selected' : ''}`}>
            <input type="checkbox" checked={permissions[key]} onChange={() => setPermission(key)} />
            <span><strong>{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</strong><small>{t(PERMISSION_COPY[key].descriptionAr, PERMISSION_COPY[key].descriptionEn)}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="teams-editor-actions">
        <Button type="button" icon={<Save size={15} aria-hidden="true" />} onClick={() => void save()} isLoading={setSeat.isPending} disabled={!team.is_active || !isOwner}>
          {t('حفظ المقعد', 'Save seat')}
        </Button>
        {existing && <Button type="button" variant="ghost" className="teams-remove-action" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => void clear()} isLoading={setSeat.isPending} disabled={!isOwner}>
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
  const [memberFilter, setMemberFilter] = useState('');
  const existingIds = useMemo(() => new Set(members.data?.filter((member) => member.membership_status === 'active').map((member) => member.member_id) ?? []), [members.data]);
  const available = (candidates.data ?? []).filter((member) => !existingIds.has(member.member_id) && member.membership_status !== 'pending' && member.work_status === 'active');
  const visibleMembers = (members.data ?? []).filter((member) => {
    const query = memberFilter.trim().toLocaleLowerCase();
    return !query || `${member.full_name} ${member.email} ${membershipStatusLabel(member.membership_status, t)}`.toLocaleLowerCase().includes(query);
  });

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
    <div className="teams-roster-body">
      <div className="teams-roster-heading">
        <h3>{t('إدارة عضويات الفريق', 'Manage team memberships')}</h3>
        {members.data && <Badge variant="neutral">{number(members.data.filter((member) => member.membership_status === 'active').length)} {t('أعضاء نشطون', 'active members')}</Badge>}
      </div>
      <div className="teams-member-add">
        <label className="teams-field">
          {t('إضافة عضو موجود إلى هذا الفريق', 'Add an existing member to this team')}
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={addMember.isPending || !team.is_active}>
            <option value="">{t('اختار عضوًا', 'Select a member')}</option>
            {available.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name} · {member.email}</option>)}
          </select>
        </label>
        <Button type="button" icon={<UserPlus size={16} aria-hidden="true" />} onClick={() => void add()} disabled={!selected || !team.is_active} isLoading={addMember.isPending}>
          {t('إضافة للفريق', 'Add to team')}
        </Button>
      </div>
      <p className="teams-help">{t('العضوية مرتبطة بهذا الفريق فقط. يمكن للشخص نفسه الانضمام لفرق أخرى من غير إنشاء حساب أو ملف مكرر.', 'Membership is limited to this team. The same person can join other teams without another account or profile.')}</p>
      {candidates.isPending && <p role="status" className="teams-help">{t('جارٍ تحميل الأعضاء المتاحين للإضافة…', 'Loading members available to add…')}</p>}
      {candidates.isError && <ErrorState message={t('تعذر تحميل قائمة الأعضاء المتاحين.', 'Could not load the members available to add.')} onRetry={() => { void candidates.refetch(); }} />}
      {candidates.data && available.length === 0 && <p className="teams-inline-empty">{t('لا يوجد عضو نشط مؤهل للإضافة حاليًا. الإضافة لا تنقل العضو من فريق آخر.', 'No eligible active member is available to add right now. Adding someone never moves them out of another team.')}</p>}
      {members.isPending && <CardSkeletons count={1} />}
      {members.isError && <ErrorState message={t('تعذر تحميل أعضاء الفريق.', 'Could not load team memberships.')} onRetry={() => { void members.refetch(); }} />}
      {members.data?.length === 0 && <EmptyState title={t('لسه مفيش أعضاء مسندين للفريق', 'No members are assigned to this team yet')} description={t('إضافة عضو هنا لا تنقله من فريق آخر.', 'Adding a member here does not remove them from another team.')} />}
      {members.data && members.data.length > 0 && <>
        <label className="teams-field">{t('البحث في أعضاء هذا الفريق', 'Search this team’s members')}<input type="search" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} placeholder={t('الاسم أو البريد أو الحالة', 'Name, email, or status')} /></label>
        {visibleMembers.length === 0
          ? <p role="status" className="teams-inline-empty">{t('مافيش أعضاء مطابقين للبحث ده. جرّب اسمًا أو بريدًا أو حالة أخرى.', 'No team members match this search. Try a different name, email, or status.')}</p>
          : <div className="teams-member-list">
            {visibleMembers.map((member) => (
              <article key={member.member_id} className="teams-member-row">
                <div className="teams-member-identity">
                  <span className="teams-member-avatar" aria-hidden="true">{member.full_name.trim().slice(0, 1)}</span>
                  <div><p className="teams-member-name">{member.full_name}</p><p className="teams-member-email" dir="ltr">{member.email}</p></div>
                </div>
                <div className="teams-member-actions">
                  <Badge variant={member.membership_status === 'active' ? 'success' : member.membership_status === 'pending' ? 'warning' : 'neutral'}>{membershipStatusLabel(member.membership_status, t)}</Badge>
                  {member.membership_status === 'pending' && <Button type="button" icon={<ShieldCheck size={14} aria-hidden="true" />} onClick={() => void decide(member.member_id, 'approve')} isLoading={reviewMember.isPending}>{t('موافقة', 'Approve')}</Button>}
                  {member.membership_status === 'active' && <Button type="button" variant="secondary" icon={<Pause size={14} aria-hidden="true" />} onClick={() => void decide(member.member_id, 'suspend')} isLoading={reviewMember.isPending}>{t('إيقاف هذا الفريق', 'Suspend here')}</Button>}
                  {member.membership_status !== 'removed' && <Button type="button" variant="ghost" className="teams-remove-action" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void decide(member.member_id, 'remove')} isLoading={reviewMember.isPending}>{t('إزالة من الفريق', 'Remove here')}</Button>}
                  {(member.membership_status === 'removed' || member.membership_status === 'suspended') && available.some((candidate) => candidate.member_id === member.member_id) && <Button type="button" variant="secondary" icon={<Play size={14} aria-hidden="true" />} onClick={() => { setSelected(String(member.member_id)); }} disabled={!team.is_active}>{t('إعادة الإضافة', 'Re-add')}</Button>}
                </div>
              </article>
            ))}
          </div>}
      </>}
    </div>
  );
}

function TeamCard({ team, candidates, isOwner }: { team: TeamOverview; candidates: TeamAdminCandidate[]; isOwner: boolean }) {
  const { t, number } = useLocale();
  const toggle = useSetTeamActive();
  const updateDetails = useUpdateTeamDetails();
  const [pendingDisable, setPendingDisable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [draftName, setDraftName] = useState(team.name);
  const [draftSlug, setDraftSlug] = useState(team.slug);
  const assignedSeats = ROLES.filter((role) => team.assignments.some((assignment) => assignment.role === role)).length;
  useEffect(() => {
    if (!editing) {
      setDraftName(team.name);
      setDraftSlug(team.slug);
    }
  }, [editing, team.name, team.slug]);

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
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
    <Card className={`teams-card ${!team.is_active ? 'teams-card--disabled' : ''}`} aria-label={team.name}>
      <div className="teams-card-header">
        <div className="teams-card-identity">
          <span className="teams-card-mark" aria-hidden="true"><Layers3 size={23} strokeWidth={1.6} /></span>
          <div className="teams-card-title">
            <div className="teams-card-title-line"><h2>{team.name}</h2><Badge variant={team.is_active ? 'success' : 'neutral'}>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</Badge></div>
            <p className="teams-card-slug" dir="ltr">/{team.slug}</p>
          </div>
        </div>
        <div className="teams-card-actions">
          {isOwner && !editing && <Button type="button" variant="ghost" icon={<Pencil size={15} aria-hidden="true" />} onClick={() => setEditing(true)}>{t('تعديل الاسم', 'Edit details')}</Button>}
          {isOwner && <Button type="button" variant="secondary" icon={team.is_active ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} onClick={() => team.is_active ? setPendingDisable(true) : void setActive(true)} isLoading={toggle.isPending}>
            {team.is_active ? t('إيقاف الفريق', 'Disable team') : t('تفعيل الفريق', 'Enable team')}
          </Button>}
          {isOwner && team.is_active && <Link to={`/team/${team.team_id}`} className="teams-workspace-link">{t('فتح مساحة الفريق', 'Open team workspace')}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
        </div>
      </div>
      <div className="teams-card-meta">
        <span className="teams-meta"><UsersRound size={15} aria-hidden="true" /><span className="teams-meta-copy"><strong>{number(team.member_count)}</strong><small>{t('عضوية نشطة', 'active memberships')}</small></span></span>
        <span className="teams-meta"><UserCog size={15} aria-hidden="true" /><span className="teams-meta-copy"><strong>{number(assignedSeats)}/{number(ROLES.length)}</strong><small>{t('مقاعد مُعيّنة', 'seats assigned')}</small></span></span>
        <span className="teams-card-scope"><ShieldCheck size={14} aria-hidden="true" />{t('صلاحيات هذا الفريق فقط', 'Team-only access')}</span>
      </div>
      {editing && <form onSubmit={(event) => void saveDetails(event)} className="teams-edit-form">
        <label className="teams-field">{t('اسم الفريق', 'Team name')}<input value={draftName} onChange={(event) => setDraftName(event.target.value)} required minLength={2} maxLength={80} /></label>
        <label className="teams-field">{t('معرّف URL', 'URL slug')}<input value={draftSlug} onChange={(event) => setDraftSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" /></label>
        <div className="teams-editor-actions">
          <Button type="submit" icon={<Save size={16} aria-hidden="true" />} isLoading={updateDetails.isPending}>{t('حفظ', 'Save')}</Button>
          <Button type="button" variant="ghost" icon={<X size={16} aria-hidden="true" />} onClick={() => setEditing(false)} disabled={updateDetails.isPending}>{t('إلغاء', 'Cancel')}</Button>
        </div>
      </form>}
      <div className="teams-seats">
        {ROLES.map((role) => {
          const assignment = team.assignments.find((item) => item.role === role);
          return <details key={role} className="teams-seat">
            <summary className="teams-seat-summary">
              <span className={`teams-seat-avatar ${assignment ? 'teams-seat-avatar--assigned' : ''}`} aria-hidden="true"><UserCog size={18} strokeWidth={1.6} /></span>
              <span className="teams-seat-copy"><strong>{roleLabel(role, t)}</strong><small dir={assignment ? 'ltr' : undefined}>{assignment?.email ?? t('اختار مسؤولًا وحدد صلاحياته', 'Choose a manager and set permissions')}</small></span>
              <span className="teams-seat-status"><Badge variant={assignment ? 'success' : 'neutral'}>{assignment ? t('مُعيّن', 'Assigned') : t('المقعد متاح', 'Seat available')}</Badge><ChevronDown className="teams-chevron" size={16} aria-hidden="true" /></span>
            </summary>
            <TeamAdminSeat team={team} role={role} candidates={candidates} isOwner={isOwner} />
          </details>;
        })}
      </div>
      {team.is_active ? <details className="teams-roster" open={rosterOpen} onToggle={(event) => setRosterOpen(event.currentTarget.open)}>
        <summary className="teams-roster-summary"><span><UsersRound size={17} aria-hidden="true" /><strong>{t('عضوية الأعضاء في الفريق', 'Team member memberships')}</strong></span><span className="teams-roster-summary-end">{number(team.member_count)}<ChevronDown className="teams-chevron" size={16} aria-hidden="true" /></span></summary>
        {rosterOpen && <TeamMemberRoster team={team} />}
      </details> : <p className="teams-disabled-note"><Pause size={14} aria-hidden="true" />{t('الوصول متوقف. فعّل الفريق لإدارة عضوياته؛ الحسابات والفرق الأخرى لا تتأثر.', 'Access is paused. Enable this team to manage memberships; accounts and other teams are unaffected.')}</p>}
      <ConfirmDialog isOpen={pendingDisable} onClose={() => setPendingDisable(false)} onConfirm={() => void setActive(false)} title={t('إيقاف الفريق؟', 'Disable this team?')} description={t('سيتوقف وصول Heads/Monitors لهذا الفريق فقط. عضوية Auth والفرق الأخرى لا تتأثر، ويمكن إعادة التفعيل.', 'Team access for its Heads/Monitors will stop. Auth accounts and other teams are unaffected, and this can be reversed.')} confirmLabel={t('إيقاف الفريق', 'Disable team')} isPending={toggle.isPending} pendingLabel={t('بيتم الإيقاف...', 'Disabling…')} />
    </Card>
  );
}

export default function TeamsManagementPage() {
  const { t, dir, number } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const ownerConfirmed = access.data?.is_owner === true;
  const teams = useOwnerTeams(ownerConfirmed);
  const candidates = useTeamAdminCandidates(ownerConfirmed);
  const createTeam = useCreateTeam();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const allTeams = teams.data ?? [];
  const activeCount = allTeams.filter((team) => team.is_active).length;
  const membershipCount = allTeams.reduce((total, team) => total + team.member_count, 0);
  const seatCount = allTeams.reduce((total, team) => total + ROLES.filter((role) => team.assignments.some((assignment) => assignment.role === role)).length, 0);
  const visibleTeams = allTeams.filter((team) => {
    if (statusFilter === 'active' && !team.is_active) return false;
    if (statusFilter === 'disabled' && team.is_active) return false;
    const query = teamFilter.trim().toLocaleLowerCase();
    const assignments = team.assignments.map((assignment) => assignment.email).join(' ');
    const status = team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled');
    return !query || `${team.name} ${team.slug} ${assignments} ${status}`.toLocaleLowerCase().includes(query);
  });
  const statusOptions: { value: TeamStatusFilter; label: string; count: number }[] = [
    { value: 'all', label: t('كل الفرق', 'All teams'), count: allTeams.length },
    { value: 'active', label: t('نشط', 'Active'), count: activeCount },
    { value: 'disabled', label: t('متوقف', 'Disabled'), count: allTeams.length - activeCount },
  ];
  const metrics = [
    { label: t('إجمالي الفرق', 'Total teams'), value: allTeams.length, hint: t('مساحات عمل مستقلة', 'Independent workspaces'), icon: Layers3 },
    { label: t('الفرق النشطة', 'Active teams'), value: activeCount, hint: t('الوصول متاح الآن', 'Access enabled now'), icon: ShieldCheck },
    { label: t('عضويات نشطة', 'Active memberships'), value: membershipCount, hint: t('يمكن احتساب العضو في عدة فرق', 'Members may count in multiple teams'), icon: UsersRound },
    { label: t('مقاعد مُعيّنة', 'Assigned seats'), value: seatCount, hint: t('Head وMonitor لكل فريق', 'Head & Monitor per team'), icon: UserCog },
  ];

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
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
  const clearFilters = () => {
    setTeamFilter('');
    setStatusFilter('all');
  };

  if (access.isPending || (access.isFetching && !access.data)) return <CardSkeletons count={2} />;
  if (access.isError) return <ErrorState message={t('تعذر التحقق من صلاحية Owner.', 'Could not verify Owner access.')} onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.is_owner) return <EmptyState title={t('إدارة الفرق للمالك فقط', 'Team management is restricted to the owner')} description={t('تعيين Head/Monitor وتغيير الصلاحيات يتم من Owner فقط.', 'Only the Owner can assign Heads/Monitors or change their permissions.')} />;

  return (
    <div className="teams-management" dir={dir}>
      <PageHeader
        icon={<Layers3 size={22} aria-hidden="true" />}
        title={t('إدارة الفرق الداخلية', 'Internal teams')}
        description={t('فرق مستقلة وصلاحيات واضحة: عيّن Head وMonitor، أضف الأعضاء، وافتح مساحة كل فريق. كل تعيين هنا يخص هذا الفريق فقط.', 'Independent teams with clear permissions: assign a Head and Monitor, add members, and open each team’s workspace. Every assignment here stays inside that team.')}
        actions={<>
          <span className="teams-owner-label"><ShieldCheck size={14} aria-hidden="true" />{t('تحكم المالك', 'Owner controls')}</span>
          <Button type="button" icon={<Plus size={17} aria-hidden="true" />} onClick={() => { setCreating(true); nameInput.current?.focus(); }} aria-expanded={creating} aria-controls="teams-create">{t('فريق جديد', 'New team')}</Button>
        </>}
      />
      <section className="teams-overview" aria-label={t('ملخص الفرق', 'Teams overview')} aria-busy={teams.isPending}>
        {metrics.map(({ label, value, hint, icon: Icon }, index) => <div className="teams-metric" key={label}>
          <div className="teams-metric-label"><span>{label}</span><Icon size={16} strokeWidth={1.6} aria-hidden="true" /></div>
          <strong className={index === 1 ? 'teams-metric-active' : ''}>{teams.data ? number(value) : '—'}</strong>
          <small>{hint}</small>
        </div>)}
      </section>
      <details id="teams-create" className="teams-create" open={creating} onToggle={(event) => setCreating(event.currentTarget.open)}>
        <summary><span className="teams-create-title"><Plus size={16} aria-hidden="true" /><strong>{t('إنشاء فريق', 'Create team')}</strong><small>{t('مساحة جديدة، بدون نقل بيانات', 'A new workspace, no data moved')}</small></span><ChevronDown className="teams-chevron" size={17} aria-hidden="true" /></summary>
        <div className="teams-create-body">
          <form onSubmit={(event) => void create(event)} className="teams-create-form">
            <label className="teams-field">{t('اسم الفريق', 'Team name')}<input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} placeholder={t('مثال: Software', 'e.g. Software')} /></label>
            <label className="teams-field">{t('معرّف URL', 'URL slug')}<input value={slug} onChange={(event) => setSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" placeholder="software" /></label>
            <Button type="submit" icon={<Plus size={17} aria-hidden="true" />} isLoading={createTeam.isPending} disabled={!access.data.is_owner}>{t('إنشاء فريق', 'Create team')}</Button>
          </form>
          <p className="teams-help">{t('لكل فريق Head وMonitor بصلاحيات تختارها أنت. Software وHardware وAI أمثلة جاهزة وفارغة. السجلات القديمة تفضل غير معيّنة لحد ما تسندها صراحة.', 'Each team has a Head and Monitor with permissions you choose. Software, Hardware, and AI are empty starter teams. Legacy records remain unassigned until explicitly classified.')}</p>
        </div>
      </details>
      <section className="teams-directory" aria-labelledby="teams-directory-title">
        <div className="teams-panel">
        <div className="teams-directory-heading"><h2 id="teams-directory-title">{t('فرقك', 'Your teams')}</h2><p aria-live="polite" aria-atomic="true">{teams.data ? t(`عرض ${number(visibleTeams.length)} من ${number(allTeams.length)} فريق`, `Showing ${number(visibleTeams.length)} of ${number(allTeams.length)} teams`) : t('جارٍ تحميل الفرق…', 'Loading teams…')}</p></div>
        {teams.data && teams.data.length > 0 && <div className="teams-toolbar">
          <div className="teams-search"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="teams-search-input">{t('البحث عن فريق', 'Find a team')}</label><input id="teams-search-input" type="search" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} placeholder={t('اسم الفريق أو المعرّف أو بريد المسؤول…', 'Team name, slug, or manager email…')} />{teamFilter && <button type="button" onClick={() => setTeamFilter('')} aria-label={t('مسح البحث', 'Clear search')}><X size={16} aria-hidden="true" /></button>}</div>
          <div className="teams-status-filters" role="group" aria-label={t('تصفية حسب حالة الفريق', 'Filter by team status')}>
            {statusOptions.map(({ value, label, count }) => <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{number(count)}</span></button>)}
          </div>
        </div>}
        {teams.isPending && <CardSkeletons count={3} />}
        {teams.isError && <ErrorState message={t('تعذر تحميل الفرق وتعييناتها.', 'Could not load teams and assignments.')} onRetry={() => { void teams.refetch(); }} />}
        {candidates.isError && <ErrorState message={t('تعذر تحميل حسابات التعيين.', 'Could not load assignment candidates.')} onRetry={() => { void candidates.refetch(); }} />}
        {teams.data?.length === 0 && <div className="teams-directory-empty"><EmptyState title={t('مفيش فرق لسه', 'No teams yet')} description={t('أنشئ أول فريق، ثم عيّن مسؤوليه وأضف أعضاءه.', 'Create your first team, then assign its managers and add members.')} /><Button type="button" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>{t('فريق جديد', 'New team')}</Button></div>}
        {teams.data && teams.data.length > 0 && visibleTeams.length === 0 && <div className="teams-no-results"><Search size={25} strokeWidth={1.5} aria-hidden="true" /><p role="status">{t('مافيش فرق مطابقة للبحث والتصفية.', 'No teams match your search and filters.')}</p><p className="teams-help">{t('جرّب اسمًا أو معرّفًا أو بريدًا آخر، أو غيّر حالة الفريق.', 'Try another name, slug, or email, or choose a different team status.')}</p><Button type="button" variant="secondary" onClick={clearFilters}>{t('مسح التصفية', 'Clear filters')}</Button></div>}
        <div className="teams-card-list">{visibleTeams.map((team) => <TeamCard key={team.team_id} team={team} candidates={candidates.data ?? []} isOwner={access.data?.is_owner === true} />)}</div>
        </div>
      </section>
      <aside className="teams-security-note"><ShieldCheck size={17} aria-hidden="true" /><div><strong>{t('صلاحيات مستقلة، حساب واحد', 'Separate permissions. One account.')}</strong><p>{t('الأعضاء يقدروا ينضموا لأكثر من فريق. Head/Monitor لا يحصل على صلاحيات Admin عامة؛ إزالة تعيينه لا تحذف حسابه أو عضوياته الأخرى. الصلاحيات لا تفتح بيانات قبل اكتمال حماية مسارها في الخادم.', 'Members can belong to multiple teams. Heads/Monitors are not added to admin_accounts. Revoking one team assignment does not delete sign-in or other memberships. A permission will not expose data until that server path is fully scoped.')}</p></div></aside>
    </div>
  );
}
