import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';
import {
  ArrowUpRight, Check, ChevronDown, Crown, Layers3, Pause, Pencil, Play, Plus, Save, Search,
  ShieldCheck, Trash2, UserCog, UserPlus, UsersRound, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useLocale } from '../../i18n/useLocale';
import type {
  TeamPermission, TeamPermissions, TeamAdminCandidate, TeamAdminRole, TeamMembershipStatus, TeamOverview,
} from '../../types/db';
import { TEAM_PERMISSION_OPTIONS } from '../admin/access/permissions';
import { useAdminAccess } from '../admin/access/api';
import {
  useAddTeamMember, useCreateTeam, useOwnerTeamMemberCandidates, useOwnerTeamMembers, useOwnerTeams,
  useReviewTeamMember, useSetTeamActive, useSetTeamAdminSeat, useTeamAdminCandidates, useUpdateTeamDetails,
} from './api';
import './teams-management.css';

const ROLES: TeamAdminRole[] = ['head', 'monitor'];
const EMPTY_PERMISSIONS = Object.fromEntries(TEAM_PERMISSION_OPTIONS.map(({ key }) => [key, false])) as TeamPermissions;
type TeamStatusFilter = 'all' | 'active' | 'disabled';
type MemberFilter = 'all' | TeamMembershipStatus;

const PERMISSION_COPY: Record<TeamPermission, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة الفريق', en: 'Team dashboard' },
  members: { ar: 'الأعضاء', en: 'Members' },
  tasks: { ar: 'المهام', en: 'Tasks' },
  ranking: { ar: 'الترتيب والتقييمات', en: 'Ranking & evaluations' },
  notes: { ar: 'الملاحظات', en: 'Notes' },
  announcements: { ar: 'الإعلانات', en: 'Announcements' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  ai_assistant: { ar: 'المساعد الذكي', en: 'AI assistant' },
};

const MEMBERSHIP_COPY: Record<TeamMembershipStatus, { ar: string; en: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  active: { ar: 'نشط', en: 'Active', tone: 'success' },
  pending: { ar: 'بانتظار المراجعة', en: 'Pending review', tone: 'warning' },
  suspended: { ar: 'موقوف', en: 'Suspended', tone: 'neutral' },
  removed: { ar: 'أزيل', en: 'Removed', tone: 'danger' },
};

function roleCopy(role: TeamAdminRole) {
  return role === 'head'
    ? { ar: 'رئيس الفريق', en: 'Team Head', tag: 'Head', hintAr: 'مسؤول عن اتجاه الفريق وقراراته.', hintEn: 'Owns the team direction and decisions.' }
    : { ar: 'المتابع', en: 'Monitor', tag: 'Monitor', hintAr: 'يتابع الالتزام والتسليم داخل الفريق.', hintEn: 'Tracks commitment and delivery inside the team.' };
}

function initials(value: string) {
  const clean = value.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.slice(0, 1)).join('').toUpperCase();
}

function motionAllowed() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** GSAP entrance for the detail panel whenever the selected team changes. */
function usePanelMotion(ref: React.RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const targets = root.querySelectorAll<HTMLElement>('[data-tms-anim]');
    if (targets.length === 0) return;
    const timeline = gsap.timeline();
    timeline.fromTo(
      targets,
      { y: 14, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.42, stagger: 0.05, ease: 'power2.out', clearProps: 'transform,opacity' },
    );
    return () => { timeline.kill(); };
  }, [ref, key]);
}

/* ------------------------------------------------------------------ */
/* Seat card: Head / Monitor                                            */
/* ------------------------------------------------------------------ */
function SeatCard({ team, role, candidates, isOwner }: {
  team: TeamOverview;
  role: TeamAdminRole;
  candidates: TeamAdminCandidate[];
  isOwner: boolean;
}) {
  const { t } = useLocale();
  const copy = roleCopy(role);
  const existing = team.assignments.find((assignment) => assignment.role === role);
  const eligible = candidates.filter((candidate) => candidate.global_role === null);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(existing?.user_id ?? '');
  const [permissions, setPermissions] = useState<TeamPermissions>(existing?.permissions ?? EMPTY_PERMISSIONS);
  const setSeat = useSetTeamAdminSeat();

  useEffect(() => {
    setUserId(existing?.user_id ?? '');
    setPermissions(existing?.permissions ?? EMPTY_PERMISSIONS);
  }, [existing?.id, existing?.user_id, existing?.permissions]);

  const enabled = TEAM_PERMISSION_OPTIONS.filter(({ key }) => (existing?.permissions ?? EMPTY_PERMISSIONS)[key]);
  const draftEnabled = TEAM_PERMISSION_OPTIONS.filter(({ key }) => permissions[key]);
  const personLabel = existing
    ? (candidates.find((candidate) => candidate.user_id === existing.user_id)?.member_name || existing.email)
    : '';

  const save = async () => {
    if (!userId) {
      toast.error(t('اختار حسابًا للمنصب قبل الحفظ.', 'Choose an account for this seat before saving.'));
      return;
    }
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId, permissions });
      setOpen(false);
      toast.success(t('اتحفظ التعيين وصلاحياته لهذا الفريق فقط.', 'Assignment and permissions saved for this team only.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ تعيين الفريق.', 'Could not save the team assignment.')).message);
    }
  };

  const clear = async () => {
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId: null, permissions: null });
      setOpen(false);
      setUserId('');
      setPermissions(EMPTY_PERMISSIONS);
      toast.success(t('اتشال تعيين المنصب بس؛ حساب الدخول والفرق التانية ما اتلمستش.', 'Only this team assignment was removed; the sign-in and other team assignments remain.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نشيل التعيين.', 'Could not remove the assignment.')).message);
    }
  };

  return (
    <article className={`tms-seat${existing ? ' is-filled' : ' is-empty'}${open ? ' is-open' : ''}`} data-tms-anim>
      <header className="tms-seat-head">
        <span className={`tms-seat-tag tms-seat-tag--${role}`}>
          {role === 'head' ? <Crown size={13} aria-hidden="true" /> : <UserCog size={13} aria-hidden="true" />}
          {copy.tag}
        </span>
        <span className="tms-seat-state">
          {existing
            ? <><Check size={13} aria-hidden="true" />{t('مُعيّن', 'Assigned')}</>
            : <>{t('المقعد متاح', 'Seat open')}</>}
        </span>
      </header>

      {existing ? (
        <>
          <div className="tms-seat-person">
            <span className="tms-avatar" aria-hidden="true">{initials(personLabel || existing.email)}</span>
            <div className="tms-seat-person-copy">
              <strong>{personLabel || t('حساب مُعيّن', 'Assigned account')}</strong>
              <small dir="ltr">{existing.email}</small>
            </div>
          </div>
          <p className="tms-seat-hint">{t(copy.hintAr, copy.hintEn)}</p>
          <div className="tms-chips" aria-label={t('صلاحيات هذا المقعد', 'Seat permissions')}>
            {enabled.length === 0
              ? <span className="tms-chip tms-chip--muted">{t('بدون صلاحيات', 'No permissions')}</span>
              : <>
                {enabled.slice(0, 4).map(({ key }) => <span key={key} className="tms-chip">{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</span>)}
                {enabled.length > 4 && <span className="tms-chip tms-chip--muted">+{enabled.length - 4}</span>}
              </>}
          </div>
          <footer className="tms-seat-foot">
            <button type="button" className="tms-link" onClick={() => setOpen((value) => !value)} disabled={!isOwner} aria-expanded={open}>
              <Pencil size={13} aria-hidden="true" />{open ? t('إغلاق التعديل', 'Close editor') : t('تعديل المقعد', 'Edit seat')}
            </button>
            <button type="button" className="tms-link tms-link--danger" onClick={() => void clear()} disabled={!isOwner || setSeat.isPending}>
              <Trash2 size={13} aria-hidden="true" />{t('إزالة', 'Remove')}
            </button>
          </footer>
        </>
      ) : (
        <>
          <p className="tms-seat-hint">{t(copy.hintAr, copy.hintEn)}</p>
          <div className="tms-seat-empty">
            <span className="tms-avatar tms-avatar--ghost" aria-hidden="true"><UserCog size={18} strokeWidth={1.6} /></span>
            <div>
              <strong>{t(`مفيش ${copy.ar} متعيّن`, `No ${copy.en} assigned`)}</strong>
              <small>{t('التعيين بيفتح مساحة الفريق فقط، من غير حساب Admin عام.', 'Team-only access, never a global Admin account.')}</small>
            </div>
          </div>
          <footer className="tms-seat-foot">
            <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)} disabled={!isOwner} aria-expanded={open}>
              {open ? t('إغلاق', 'Close') : t(`تعيين ${copy.ar}`, `Assign ${copy.en}`)}
            </Button>
          </footer>
        </>
      )}

      {open && (
        <div className="tms-seat-editor">
          <label className="tms-field">
            <span>{t('حساب Auth موجود', 'Existing Auth account')}</span>
            <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!isOwner || !team.is_active || setSeat.isPending}>
              <option value="">{t('اختار مسؤولًا', 'Select a manager')}</option>
              {eligible.map((candidate) => (
                <option key={candidate.user_id} value={candidate.user_id}>
                  {candidate.member_name ? `${candidate.member_name} · ` : ''}{candidate.email}
                </option>
              ))}
            </select>
          </label>
          <div className="tms-perm-head">
            <strong>{t('الصلاحيات داخل الفريق', 'Permissions inside this team')}</strong>
            <span>{draftEnabled.length}/{TEAM_PERMISSION_OPTIONS.length}</span>
          </div>
          <div className="tms-perms">
            {TEAM_PERMISSION_OPTIONS.map(({ key }) => (
              <label key={key} className={`tms-perm${permissions[key] ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={permissions[key]}
                  onChange={() => setPermissions((current) => ({ ...current, [key]: !current[key] }))}
                  disabled={!isOwner || !team.is_active || setSeat.isPending}
                />
                <span>{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</span>
              </label>
            ))}
          </div>
          <div className="tms-seat-editor-actions">
            <Button type="button" icon={<Save size={15} aria-hidden="true" />} onClick={() => void save()} isLoading={setSeat.isPending} disabled={!team.is_active || !isOwner}>
              {t('حفظ المقعد', 'Save seat')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={setSeat.isPending}>{t('إلغاء', 'Cancel')}</Button>
          </div>
          <p className="tms-note">{t('التعيين يضيف مساحة الفريق فقط. الشخص ممكن يتعيّن في فرق مختلفة، لكن مش في المقعدين داخل نفس الفريق.', 'This grants team-only access and never creates a global Admin. A person may serve other teams, but cannot hold both seats in the same team.')}</p>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Member roster                                                       */
/* ------------------------------------------------------------------ */
function MemberRoster({ team }: { team: TeamOverview }) {
  const { t, number } = useLocale();
  const members = useOwnerTeamMembers(team.team_id);
  const candidates = useOwnerTeamMemberCandidates(team.team_id);
  const addMember = useAddTeamMember();
  const reviewMember = useReviewTeamMember();
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MemberFilter>('all');

  const all = members.data ?? [];
  const counts = useMemo(() => ({
    all: all.length,
    active: all.filter((member) => member.membership_status === 'active').length,
    pending: all.filter((member) => member.membership_status === 'pending').length,
    suspended: all.filter((member) => member.membership_status === 'suspended').length,
    removed: all.filter((member) => member.membership_status === 'removed').length,
  }), [all]);
  const activeIds = useMemo(() => new Set(all.filter((member) => member.membership_status === 'active').map((member) => member.member_id)), [all]);
  const available = (candidates.data ?? []).filter((member) => !activeIds.has(member.member_id) && member.membership_status !== 'pending' && member.work_status === 'active');
  const visible = all.filter((member) => {
    if (filter !== 'all' && member.membership_status !== filter) return false;
    const text = query.trim().toLocaleLowerCase();
    return !text || `${member.full_name} ${member.email}`.toLocaleLowerCase().includes(text);
  });

  const add = async () => {
    if (!selected) return;
    try {
      const status = await addMember.mutateAsync({ teamId: team.team_id, memberId: Number(selected) });
      setSelected('');
      toast.success(status === 'active'
        ? t('اتضاف العضو للفريق. يقدر يبقى في فرق تانية كمان.', 'Member added to this team. They may also belong to other teams.')
        : t('اتسجلت عضوية الفريق للمراجعة.', 'Team membership is pending review.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نضيف العضوية.', 'Could not add this membership.')).message);
    }
  };

  const decide = async (memberId: number, decision: 'approve' | 'suspend' | 'remove') => {
    try {
      await reviewMember.mutateAsync({ teamId: team.team_id, memberId, decision });
      toast.success(decision === 'approve'
        ? t('اتفعّلت العضوية في الفريق.', 'Membership activated for this team.')
        : decision === 'suspend'
          ? t('اتوقفت عضوية الفريق بس.', 'Only this team membership was suspended.')
          : t('اتشالت العضوية من الفريق؛ حساب العضو والفرق التانية سليمين.', 'Membership removed from this team; the member account and other teams remain intact.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نغير العضوية.', 'Could not update the membership.')).message);
    }
  };

  const filters: { key: MemberFilter; label: string; count: number }[] = [
    { key: 'all', label: t('الكل', 'All'), count: counts.all },
    { key: 'active', label: t('نشط', 'Active'), count: counts.active },
    { key: 'pending', label: t('بانتظار المراجعة', 'Pending'), count: counts.pending },
    { key: 'suspended', label: t('موقوف', 'Suspended'), count: counts.suspended },
    { key: 'removed', label: t('أزيل', 'Removed'), count: counts.removed },
  ];

  return (
    <section className="tms-members" data-tms-anim aria-labelledby={`tms-members-${team.team_id}`}>
      <header className="tms-block-head">
        <div>
          <span className="tms-kicker"><UsersRound size={14} aria-hidden="true" />{t('تسجيل الأعضاء', 'Member enrollment')}</span>
          <h3 id={`tms-members-${team.team_id}`}>{t('عضوية الأعضاء في الفريق', 'Team memberships')}</h3>
        </div>
        <div className="tms-member-totals">
          <span><strong>{number(counts.active)}</strong>{t('نشط', 'active')}</span>
          <span className={counts.pending > 0 ? 'is-warn' : ''}><strong>{number(counts.pending)}</strong>{t('بالانتظار', 'pending')}</span>
        </div>
      </header>

      <div className="tms-add-row">
        <label className="tms-field">
          <span>{t('إضافة عضو موجود لهذا الفريق', 'Add an existing member to this team')}</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={addMember.isPending || !team.is_active}>
            <option value="">{t('اختار عضوًا', 'Select a member')}</option>
            {available.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name} · {member.email}</option>)}
          </select>
        </label>
        <Button type="button" icon={<UserPlus size={16} aria-hidden="true" />} onClick={() => void add()} disabled={!selected || !team.is_active} isLoading={addMember.isPending}>
          {t('إضافة', 'Add')}
        </Button>
      </div>

      <p className="tms-note">{t('العضوية مرتبطة بهذا الفريق فقط. يمكن للشخص نفسه الانضمام لفرق أخرى من غير إنشاء حساب أو ملف مكرر.', 'Membership is limited to this team, so the same person can join other teams without another account or profile.')}</p>
      {candidates.isPending && <p role="status" className="tms-note">{t('جارٍ تحميل الأعضاء المتاحين للإضافة…', 'Loading members available to add…')}</p>}
      {candidates.isError && <ErrorState message={t('تعذر تحميل قائمة الأعضاء المتاحين.', 'Could not load the members available to add.')} onRetry={() => { void candidates.refetch(); }} />}
      {candidates.data && available.length === 0 && <p className="tms-note">{t('مفيش عضو نشط مؤهل للإضافة دلوقتي. الإضافة مش بتنقل العضو من فريق تاني.', 'No eligible active member is available to add right now. Adding someone never moves them out of another team.')}</p>}

      {members.isPending && <CardSkeletons count={1} />}
      {members.isError && <ErrorState message={t('تعذر تحميل أعضاء الفريق.', 'Could not load team memberships.')} onRetry={() => { void members.refetch(); }} />}
      {members.data?.length === 0 && <EmptyState title={t('لسه مفيش أعضاء في الفريق', 'No members are assigned to this team yet')} description={t('إضافة عضو هنا لا تنقله من فريق آخر.', 'Adding a member here does not remove them from another team.')} />}

      {all.length > 0 && (
        <>
          <div className="tms-member-tools">
            <div className="tms-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث بالاسم أو البريد…', 'Search name or email…')} aria-label={t('البحث في أعضاء الفريق', 'Search team members')} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={t('مسح البحث', 'Clear search')}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="tms-filter-chips" role="group" aria-label={t('تصفية حسب حالة العضوية', 'Filter by membership status')}>
              {filters.map(({ key, label, count }) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}<span>{number(count)}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0
            ? <p role="status" className="tms-note">{t('مافيش أعضاء مطابقين للبحث أو التصفية.', 'No members match this search or filter.')}</p>
            : <ul className="tms-member-list">
              {visible.map((member) => {
                const copy = MEMBERSHIP_COPY[member.membership_status];
                return (
                  <li key={member.member_id} className="tms-member">
                    <span className="tms-avatar tms-avatar--sm" aria-hidden="true">{initials(member.full_name)}</span>
                    <div className="tms-member-copy">
                      <strong>{member.full_name}</strong>
                      <small dir="ltr">{member.email}</small>
                    </div>
                    <Badge variant={copy.tone}>{t(copy.ar, copy.en)}</Badge>
                    <div className="tms-member-actions">
                      {member.membership_status === 'pending' && <button type="button" className="tms-link" onClick={() => void decide(member.member_id, 'approve')} disabled={reviewMember.isPending}><ShieldCheck size={13} aria-hidden="true" />{t('موافقة', 'Approve')}</button>}
                      {member.membership_status === 'active' && <button type="button" className="tms-link" onClick={() => void decide(member.member_id, 'suspend')} disabled={reviewMember.isPending}><Pause size={13} aria-hidden="true" />{t('إيقاف', 'Suspend')}</button>}
                      {member.membership_status !== 'removed' && <button type="button" className="tms-link tms-link--danger" onClick={() => void decide(member.member_id, 'remove')} disabled={reviewMember.isPending}><Trash2 size={13} aria-hidden="true" />{t('إزالة', 'Remove')}</button>}
                      {(member.membership_status === 'removed' || member.membership_status === 'suspended') && available.some((candidate) => candidate.member_id === member.member_id) && (
                        <button type="button" className="tms-link" onClick={() => setSelected(String(member.member_id))} disabled={!team.is_active}><Play size={13} aria-hidden="true" />{t('إعادة الإضافة', 'Re-add')}</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Team detail panel                                                   */
/* ------------------------------------------------------------------ */
function TeamDetail({ team, candidates, isOwner }: { team: TeamOverview; candidates: TeamAdminCandidate[]; isOwner: boolean }) {
  const { t, number, dir } = useLocale();
  const toggle = useSetTeamActive();
  const updateDetails = useUpdateTeamDetails();
  const [editing, setEditing] = useState(false);
  const [pendingDisable, setPendingDisable] = useState(false);
  const [draftName, setDraftName] = useState(team.name);
  const [draftSlug, setDraftSlug] = useState(team.slug);
  const panelRef = useRef<HTMLDivElement>(null);
  const assignedSeats = ROLES.filter((role) => team.assignments.some((assignment) => assignment.role === role)).length;

  usePanelMotion(panelRef, team.team_id);

  useEffect(() => {
    setEditing(false);
    setDraftName(team.name);
    setDraftSlug(team.slug);
  }, [team.team_id, team.name, team.slug]);

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
    <div className="tms-detail" ref={panelRef} dir={dir}>
      <header className="tms-detail-head" data-tms-anim>
        <div className="tms-detail-identity">
          <span className={`tms-mark${team.is_active ? '' : ' is-off'}`} aria-hidden="true"><Layers3 size={24} strokeWidth={1.6} /></span>
          <div>
            <div className="tms-detail-title">
              <h2>{team.name}</h2>
              <Badge variant={team.is_active ? 'success' : 'neutral'}>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</Badge>
            </div>
            <p className="tms-slug" dir="ltr">/{team.slug}</p>
          </div>
        </div>
        <div className="tms-detail-actions">
          {isOwner && team.is_active && (
            <Link to={`/team/${team.team_id}`} className="tms-cta">
              {t('مساحة الفريق', 'Team workspace')}<ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          )}
          {isOwner && <Button type="button" variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing((value) => !value)}>{t('تعديل', 'Edit')}</Button>}
          {isOwner && (
            <Button
              type="button"
              variant="secondary"
              icon={team.is_active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              onClick={() => team.is_active ? setPendingDisable(true) : void setActive(true)}
              isLoading={toggle.isPending}
            >
              {team.is_active ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}
            </Button>
          )}
        </div>
      </header>

      <div className="tms-detail-stats" data-tms-anim>
        <span><UsersRound size={15} aria-hidden="true" /><strong>{number(team.member_count)}</strong>{t('عضو', 'members')}</span>
        <span><UserCog size={15} aria-hidden="true" /><strong>{number(assignedSeats)}/{ROLES.length}</strong>{t('مقاعد مُعيّنة', 'seats assigned')}</span>
        <span><ShieldCheck size={15} aria-hidden="true" />{t('صلاحيات هذا الفريق فقط', 'Team-only access')}</span>
      </div>

      {editing && (
        <form onSubmit={(event) => void saveDetails(event)} className="tms-edit-form" data-tms-anim>
          <label className="tms-field"><span>{t('اسم الفريق', 'Team name')}</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} required minLength={2} maxLength={80} /></label>
          <label className="tms-field"><span>{t('معرّف URL', 'URL slug')}</span><input value={draftSlug} onChange={(event) => setDraftSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" /></label>
          <div className="tms-edit-actions">
            <Button type="submit" icon={<Save size={15} aria-hidden="true" />} isLoading={updateDetails.isPending}>{t('حفظ', 'Save')}</Button>
            <Button type="button" variant="ghost" icon={<X size={15} aria-hidden="true" />} onClick={() => setEditing(false)} disabled={updateDetails.isPending}>{t('إلغاء', 'Cancel')}</Button>
          </div>
        </form>
      )}

      <section className="tms-leadership" aria-labelledby={`tms-lead-${team.team_id}`}>
        <header className="tms-block-head" data-tms-anim>
          <div>
            <span className="tms-kicker"><Crown size={14} aria-hidden="true" />{t('تسجيل القيادة', 'Leadership enrollment')}</span>
            <h3 id={`tms-lead-${team.team_id}`}>{t('Head وMonitor', 'Head & Monitor')}</h3>
          </div>
          <p className="tms-block-hint">{t('كل مقعد بياخد صلاحياته لوحده جوه الفريق ده.', 'Each seat carries its own permissions inside this team.')}</p>
        </header>
        <div className="tms-seat-grid">
          {ROLES.map((role) => <SeatCard key={`${team.team_id}-${role}`} team={team} role={role} candidates={candidates} isOwner={isOwner} />)}
        </div>
      </section>

      {team.is_active
        ? <MemberRoster team={team} />
        : <p className="tms-disabled" data-tms-anim><Pause size={15} aria-hidden="true" />{t('الوصول متوقف. فعّل الفريق لإدارة عضوياته؛ الحسابات والفرق الأخرى لا تتأثر.', 'Access is paused. Enable this team to manage memberships; accounts and other teams are unaffected.')}</p>}

      <ConfirmDialog
        isOpen={pendingDisable}
        onClose={() => setPendingDisable(false)}
        onConfirm={() => void setActive(false)}
        title={t('إيقاف الفريق؟', 'Disable this team?')}
        description={t('سيتوقف وصول Heads/Monitors لهذا الفريق فقط. عضوية Auth والفرق الأخرى لا تتأثر، ويمكن إعادة التفعيل.', 'Team access for its Heads/Monitors will stop. Auth accounts and other teams are unaffected, and this can be reversed.')}
        confirmLabel={t('إيقاف الفريق', 'Disable team')}
        isPending={toggle.isPending}
        pendingLabel={t('بيتم الإيقاف...', 'Disabling…')}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function TeamsManagementPage() {
  const { t, dir, number } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const ownerConfirmed = access.data?.owner_authority === true;
  const teams = useOwnerTeams(ownerConfirmed);
  const candidates = useTeamAdminCandidates(ownerConfirmed);
  const createTeam = useCreateTeam();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLUListElement>(null);

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
  const selected = visibleTeams.find((team) => team.team_id === selectedId) ?? visibleTeams[0] ?? null;

  const statusOptions: { value: TeamStatusFilter; label: string; count: number }[] = [
    { value: 'all', label: t('الكل', 'All'), count: allTeams.length },
    { value: 'active', label: t('نشط', 'Active'), count: activeCount },
    { value: 'disabled', label: t('متوقف', 'Disabled'), count: allTeams.length - activeCount },
  ];
  const metrics = [
    { label: t('إجمالي الفرق', 'Total teams'), value: allTeams.length, hint: t('مساحات مستقلة', 'Independent workspaces'), icon: Layers3 },
    { label: t('الفرق النشطة', 'Active teams'), value: activeCount, hint: t('الوصول متاح الآن', 'Access enabled now'), icon: ShieldCheck },
    { label: t('عضويات نشطة', 'Active memberships'), value: membershipCount, hint: t('العضو ممكن يكون في فرق كتير', 'Members may join several teams'), icon: UsersRound },
    { label: t('مقاعد مُعيّنة', 'Assigned seats'), value: seatCount, hint: t('Head وMonitor لكل فريق', 'Head & Monitor per team'), icon: UserCog },
  ];

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || !motionAllowed()) return;
    const items = rail.querySelectorAll<HTMLElement>('.tms-team');
    if (items.length === 0) return;
    const timeline = gsap.timeline();
    timeline.fromTo(items, { x: 10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, stagger: 0.04, ease: 'power2.out', clearProps: 'transform,opacity' });
    return () => { timeline.kill(); };
  }, [visibleTeams.length, statusFilter]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const teamId = await createTeam.mutateAsync({ slug: slug.trim().toLowerCase(), name: name.trim() });
      setName('');
      setSlug('');
      if (teamId) setSelectedId(teamId);
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
  if (!access.data?.owner_authority) return <EmptyState title={t('إدارة الفرق للمالك فقط', 'Team management is restricted to the owner')} description={t('تعيين Head/Monitor وتغيير الصلاحيات يتم من Owner فقط.', 'Only the Owner can assign Heads/Monitors or change their permissions.')} />;

  return (
    <div className="teams-management" dir={dir}>
      <PageHeader
        icon={<Layers3 size={22} aria-hidden="true" />}
        title={t('إدارة الفرق الداخلية', 'Internal teams')}
        description={t('اختار فريق من القائمة، عيّن Head وMonitor بصلاحياتهم، وسجّل الأعضاء في نفس الشاشة.', 'Pick a team, assign its Head and Monitor with their permissions, and enroll members in one screen.')}
        actions={<>
          <span className="tms-owner"><ShieldCheck size={14} aria-hidden="true" />{t('تحكم المالك', 'Owner controls')}</span>
          <Button type="button" icon={<Plus size={17} aria-hidden="true" />} onClick={() => { setCreating(true); nameInput.current?.focus(); }} aria-expanded={creating} aria-controls="teams-create">{t('فريق جديد', 'New team')}</Button>
        </>}
      />

      <section className="tms-metrics" aria-label={t('ملخص الفرق', 'Teams overview')} aria-busy={teams.isPending}>
        {metrics.map(({ label, value, hint, icon: Icon }, index) => (
          <div className="tms-metric" key={label}>
            <span className="tms-metric-icon" aria-hidden="true"><Icon size={15} strokeWidth={1.7} /></span>
            <div>
              <span className="tms-metric-label">{label}</span>
              <strong className={index === 1 ? 'is-accent' : ''}>{teams.data ? number(value) : '—'}</strong>
              <small>{hint}</small>
            </div>
          </div>
        ))}
      </section>

      <details id="teams-create" className="tms-create" open={creating} onToggle={(event) => setCreating(event.currentTarget.open)}>
        <summary>
          <span className="tms-create-title"><Plus size={16} aria-hidden="true" /><strong>{t('إنشاء فريق', 'Create team')}</strong><small>{t('مساحة جديدة، بدون نقل بيانات', 'A new workspace, no data moved')}</small></span>
          <ChevronDown className="tms-chevron" size={17} aria-hidden="true" />
        </summary>
        <div className="tms-create-body">
          <form onSubmit={(event) => void create(event)} className="tms-create-form">
            <label className="tms-field"><span>{t('اسم الفريق', 'Team name')}</span><input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} placeholder={t('مثال: Software', 'e.g. Software')} /></label>
            <label className="tms-field"><span>{t('معرّف URL', 'URL slug')}</span><input value={slug} onChange={(event) => setSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" placeholder="software" /></label>
            <Button type="submit" icon={<Plus size={17} aria-hidden="true" />} isLoading={createTeam.isPending} disabled={!access.data.owner_authority}>{t('إنشاء فريق', 'Create team')}</Button>
          </form>
          <p className="tms-note">{t('لكل فريق Head وMonitor بصلاحيات تختارها أنت. السجلات القديمة تفضل غير معيّنة لحد ما تسندها صراحة.', 'Each team has a Head and Monitor with permissions you choose. Legacy records remain unassigned until explicitly classified.')}</p>
        </div>
      </details>

      {teams.isPending && <CardSkeletons count={2} />}
      {teams.isError && <ErrorState message={t('تعذر تحميل الفرق وتعييناتها.', 'Could not load teams and assignments.')} onRetry={() => { void teams.refetch(); }} />}
      {candidates.isError && <ErrorState message={t('تعذر تحميل حسابات التعيين.', 'Could not load assignment candidates.')} onRetry={() => { void candidates.refetch(); }} />}

      {teams.data?.length === 0 && (
        <div className="tms-empty">
          <EmptyState title={t('مفيش فرق لسه', 'No teams yet')} description={t('أنشئ أول فريق، ثم عيّن مسؤوليه وأضف أعضاءه.', 'Create your first team, then assign its managers and add members.')} />
          <Button type="button" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>{t('فريق جديد', 'New team')}</Button>
        </div>
      )}

      {allTeams.length > 0 && (
        <div className="tms-shell">
          <aside className="tms-rail" aria-label={t('قائمة الفرق', 'Teams list')}>
            <div className="tms-rail-head">
              <h2>{t('فرقك', 'Your teams')}</h2>
              <span>{number(visibleTeams.length)}/{number(allTeams.length)}</span>
            </div>
            <div className="tms-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} placeholder={t('اسم الفريق أو بريد المسؤول…', 'Team name or manager email…')} aria-label={t('البحث عن فريق', 'Find a team')} />
              {teamFilter && <button type="button" onClick={() => setTeamFilter('')} aria-label={t('مسح البحث', 'Clear search')}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="tms-status-filters" role="group" aria-label={t('تصفية حسب حالة الفريق', 'Filter by team status')}>
              {statusOptions.map(({ value, label, count }) => (
                <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}<span>{number(count)}</span></button>
              ))}
            </div>

            {visibleTeams.length === 0
              ? <div className="tms-rail-empty"><p role="status">{t('مافيش فرق مطابقة.', 'No teams match.')}</p><Button type="button" variant="secondary" onClick={clearFilters}>{t('مسح التصفية', 'Clear filters')}</Button></div>
              : <ul className="tms-team-list" ref={railRef}>
                {visibleTeams.map((team) => {
                  const head = team.assignments.find((assignment) => assignment.role === 'head');
                  const monitor = team.assignments.find((assignment) => assignment.role === 'monitor');
                  const isSelected = selected?.team_id === team.team_id;
                  return (
                    <li key={team.team_id}>
                      <button type="button" className={`tms-team${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedId(team.team_id)} aria-pressed={isSelected}>
                        <span className={`tms-team-mark${team.is_active ? '' : ' is-off'}`} aria-hidden="true">{initials(team.name)}</span>
                        <span className="tms-team-copy">
                          <span className="tms-team-name">{team.name}<i className={team.is_active ? 'is-on' : 'is-off'} aria-hidden="true" /></span>
                          <small dir="ltr">/{team.slug}</small>
                          <span className="tms-team-meta">
                            <span>{number(team.member_count)} {t('عضو', 'members')}</span>
                            <span>{head ? t('Head مُعيّن', 'Head set') : t('Head فاضي', 'Head open')}</span>
                            <span>{monitor ? t('Monitor مُعيّن', 'Monitor set') : t('Monitor فاضي', 'Monitor open')}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>}
          </aside>

          <div className="tms-panel">
            {selected
              ? <TeamDetail key={selected.team_id} team={selected} candidates={candidates.data ?? []} isOwner={access.data?.owner_authority === true} />
              : <p className="tms-note">{t('اختار فريق من القائمة عشان تدير مقاعده وأعضائه.', 'Pick a team from the list to manage its seats and members.')}</p>}
          </div>
        </div>
      )}

      <aside className="tms-security">
        <ShieldCheck size={17} aria-hidden="true" />
        <div>
          <strong>{t('صلاحيات مستقلة، حساب واحد', 'Separate permissions. One account.')}</strong>
          <p>{t('الأعضاء يقدروا ينضموا لأكثر من فريق. Head/Monitor مش بياخدوا صلاحيات Admin عامة، وإزالة تعيينهم مش بتحذف حساباتهم. أي صلاحية مش بتفتح بيانات قبل ما مسارها يتأمّن في الخادم.', 'Members can belong to multiple teams. Heads/Monitors never receive global Admin rights, and revoking a seat does not delete their accounts. A permission never exposes data until its server path is fully scoped.')}</p>
        </div>
      </aside>
    </div>
  );
}
