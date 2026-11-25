import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowUpRight, Check, Crown, Gauge, Layers3, Palette, Pause, Pencil, Play, Plus,
  Save, Settings2, ShieldCheck, Sparkles, UserCog, UsersRound, X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useLocale } from '../../i18n/useLocale';
import type { TeamAccent } from '../../types/db';
import { useAdminAccess } from '../admin/access/api';
import { useOwnerTeamMembers, useOwnerTeams, useSetTeamActive, useTeamAdminCandidates, useUpdateTeamDetails } from './api';
import { useSaveTeamProfile, useTeamProfile } from './profileApi';
import { MemberRoster } from './components/MemberRoster';
import { SeatCard } from './components/SeatCard';
import { ROLES, initials, useStaggerIn } from './components/teamCopy';
import './teams-management.css';

type TeamTab = 'overview' | 'leadership' | 'members' | 'customize' | 'settings';

const ACCENTS: { value: TeamAccent; ar: string; en: string }[] = [
  { value: 'primary', ar: 'أحمر PHANTOMS', en: 'PHANTOMS red' },
  { value: 'violet', ar: 'بنفسجي', en: 'Violet' },
  { value: 'cyan', ar: 'سماوي', en: 'Cyan' },
  { value: 'amber', ar: 'ذهبي', en: 'Amber' },
];

const MAX_FOCUS = 6;

export default function TeamPage() {
  const { teamId = '' } = useParams();
  const { t, dir, number, date } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const ownerConfirmed = access.data?.owner_authority === true;
  const teams = useOwnerTeams(ownerConfirmed);
  const candidates = useTeamAdminCandidates(ownerConfirmed);
  const team = (teams.data ?? []).find((entry) => entry.team_id === teamId) ?? null;

  const profile = useTeamProfile(teamId, Boolean(teamId) && ownerConfirmed);
  const members = useOwnerTeamMembers(teamId);
  const toggle = useSetTeamActive();
  const updateDetails = useUpdateTeamDetails();
  const saveProfile = useSaveTeamProfile();

  const [tab, setTab] = useState<TeamTab>('overview');
  const [editing, setEditing] = useState(false);
  const [pendingDisable, setPendingDisable] = useState(false);
  const [draftName, setDraftName] = useState(team?.name ?? '');
  const [draftSlug, setDraftSlug] = useState(team?.slug ?? '');
  const [tagline, setTagline] = useState('');
  const [accent, setAccent] = useState<TeamAccent>('primary');
  const [focus, setFocus] = useState<string[]>([]);
  const [focusDraft, setFocusDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useStaggerIn(rootRef, `${teamId}-${tab}`);

  useEffect(() => {
    setEditing(false);
    setDraftName(team?.name ?? '');
    setDraftSlug(team?.slug ?? '');
    setTab('overview');
  }, [teamId, team?.name, team?.slug]);

  useEffect(() => {
    if (!profile.data) return;
    setTagline(profile.data.tagline);
    setAccent(profile.data.accent);
    setFocus(profile.data.focus_areas);
  }, [profile.data]);

  const stats = useMemo(() => {
    const all = members.data ?? [];
    return {
      members: all.length,
      active: all.filter((member) => member.membership_status === 'active').length,
      pending: all.filter((member) => member.membership_status === 'pending').length,
      suspended: all.filter((member) => member.membership_status === 'suspended').length,
    };
  }, [members.data]);

  const seatsAssigned = team ? ROLES.filter((role) => team.assignments.some((assignment) => assignment.role === role)).length : 0;

  const setActive = async (active: boolean) => {
    if (!team) return;
    try {
      await toggle.mutateAsync({ teamId: team.team_id, active });
      setPendingDisable(false);
      toast.success(active ? t('اتفعّل الفريق.', 'Team enabled.') : t('اتوقف الفريق؛ ما اتحذفش.', 'Team disabled, not deleted.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نغير حالة الفريق.', 'Could not change the team state.')).message);
    }
  };

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!team) return;
    try {
      await updateDetails.mutateAsync({ teamId: team.team_id, name: draftName.trim(), slug: draftSlug.trim().toLowerCase() });
      setEditing(false);
      toast.success(t('اتحدث اسم الفريق ومعرّفه.', 'Team name and slug updated.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحدّث تفاصيل الفريق.', 'Could not update team details.')).message);
    }
  };

  const addFocus = () => {
    const value = focusDraft.trim();
    if (!value) return;
    if (focus.length >= MAX_FOCUS) {
      toast.error(t(`الحد الأقصى ${MAX_FOCUS} محاور للفريق.`, `Up to ${MAX_FOCUS} focus areas per team.`));
      return;
    }
    if (focus.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setFocusDraft('');
      return;
    }
    setFocus((current) => [...current, value.slice(0, 40)]);
    setFocusDraft('');
  };

  const saveCustomization = async () => {
    if (!team) return;
    try {
      await saveProfile.mutateAsync({ teamId: team.team_id, tagline: tagline.trim(), accent, focusAreas: focus });
      toast.success(t('اتحفظ تخصيص الفريق. الشكل الجديد ظاهر على صفحته.', 'Team customization saved and applied to its page.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ تخصيص الفريق.', 'Could not save the team customization.')).message);
    }
  };

  if (access.isPending || (access.isFetching && !access.data) || teams.isPending) return <CardSkeletons count={2} />;
  if (access.isError) return <ErrorState message={t('تعذر التحقق من صلاحية Owner.', 'Could not verify Owner access.')} onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.owner_authority) {
    return <EmptyState title={t('إدارة الفرق للمالك فقط', 'Team management is restricted to the owner')} description={t('تعيين Head/Monitor وتغيير الصلاحيات يتم من Owner فقط.', 'Only the Owner can assign Heads/Monitors or change their permissions.')} />;
  }
  if (teams.isError) return <ErrorState message={t('تعذر تحميل بيانات الفريق.', 'Could not load the team.')} onRetry={() => { void teams.refetch(); }} />;
  if (!team) {
    return (
      <div className="teams-management" dir={dir}>
        <EmptyState
          title={t('الفريق مش موجود', 'This team does not exist')}
          description={t('يمكن اتحذف أو اللينك قديم. ارجع لقائمة الفرق.', 'It may have been removed or the link is outdated. Go back to the teams list.')}
          action={<Link to="/admin/teams" className="tms-back-link"><ArrowLeft size={15} aria-hidden="true" />{t('كل الفرق', 'All teams')}</Link>}
        />
      </div>
    );
  }

  const tabs: { key: TeamTab; label: string; icon: typeof Gauge; badge?: number }[] = [
    { key: 'overview', label: t('نظرة عامة', 'Overview'), icon: Gauge },
    { key: 'leadership', label: t('القيادة', 'Leadership'), icon: Crown, badge: ROLES.length - seatsAssigned },
    { key: 'members', label: t('الأعضاء', 'Members'), icon: UsersRound, badge: stats.pending },
    { key: 'customize', label: t('التخصيص', 'Customize'), icon: Palette },
    { key: 'settings', label: t('الإعدادات', 'Settings'), icon: Settings2 },
  ];

  return (
    <div className="teams-management tms-team-page" dir={dir} data-accent={accent} ref={rootRef}>
      <Link to="/admin/teams" className="tms-back-link" data-tm-anim>
        <ArrowLeft size={15} aria-hidden="true" />{t('كل الفرق', 'All teams')}
      </Link>

      <header className="tms-hero" data-tm-anim>
        <span className="tms-hero-glow" aria-hidden="true" />
        <span className={`tms-hero-mark${team.is_active ? '' : ' is-off'}`} aria-hidden="true">{initials(team.name)}</span>
        <div className="tms-hero-copy">
          <div className="tms-hero-title">
            <h1>{team.name}</h1>
            <Badge variant={team.is_active ? 'success' : 'neutral'}>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</Badge>
          </div>
          <p className="tms-hero-slug" dir="ltr">/{team.slug}</p>
          <p className="tms-hero-tagline">
            {profile.data?.tagline || t('مساحة فريق مستقلة داخل PHANTOMS — تقدر تخصص شكلها ووصفها من تاب التخصيص.', 'An independent PHANTOMS team space. Customize its look and description from the Customize tab.')}
          </p>
          {focus.length > 0 && (
            <div className="tms-chips tms-hero-focus">
              {focus.map((item) => <span key={item} className="tms-chip">{item}</span>)}
            </div>
          )}
        </div>
        <div className="tms-hero-actions">
          {team.is_active && (
            <Link to={`/team/${team.team_id}`} className="tms-cta">
              {t('مساحة الفريق', 'Team workspace')}<ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          )}
          <Button type="button" variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => { setTab('settings'); setEditing(true); }}>
            {t('تعديل', 'Edit')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={team.is_active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            onClick={() => { if (team.is_active) setPendingDisable(true); else void setActive(true); }}
            isLoading={toggle.isPending}
          >
            {team.is_active ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}
          </Button>
        </div>
      </header>

      <nav className="tms-tabs" role="tablist" aria-label={t('أقسام الفريق', 'Team sections')} data-tm-anim>
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tm-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`tm-panel-${key}`}
            className={tab === key ? 'is-active' : ''}
            onClick={() => setTab(key)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
            {badge && badge > 0 ? <span className="tms-tab-badge">{number(badge)}</span> : null}
          </button>
        ))}
      </nav>

      <div className="tms-tab-panel" id={`tm-panel-${tab}`} role="tabpanel" aria-labelledby={`tm-tab-${tab}`}>
        {tab === 'overview' && (
          <>
            <div className="tms-stat-grid">
              <article className="tms-stat" data-tm-anim>
                <span className="tms-stat-icon" aria-hidden="true"><UsersRound size={16} strokeWidth={1.7} /></span>
                <strong>{members.isPending ? '—' : number(stats.active)}</strong>
                <span>{t('عضو نشط', 'active members')}</span>
                <small>{t('من إجمالي', 'of')} {members.isPending ? '—' : number(stats.members)}</small>
              </article>
              <article className="tms-stat" data-tm-anim>
                <span className="tms-stat-icon" aria-hidden="true"><UserCog size={16} strokeWidth={1.7} /></span>
                <strong>{number(seatsAssigned)}/2</strong>
                <span>{t('مقاعد القيادة', 'leadership seats')}</span>
                <small>{seatsAssigned === 2 ? t('مكتملة', 'complete') : t('ناقص مقعد', 'one seat open')}</small>
              </article>
              <article className={`tms-stat${stats.pending > 0 ? ' is-warn' : ''}`} data-tm-anim>
                <span className="tms-stat-icon" aria-hidden="true"><ShieldCheck size={16} strokeWidth={1.7} /></span>
                <strong>{members.isPending ? '—' : number(stats.pending)}</strong>
                <span>{t('بانتظار المراجعة', 'pending review')}</span>
                <small>{stats.pending > 0 ? t('محتاج قرار', 'needs a decision') : t('مفيش طلبات', 'nothing waiting')}</small>
              </article>
              <article className="tms-stat" data-tm-anim>
                <span className="tms-stat-icon" aria-hidden="true"><Sparkles size={16} strokeWidth={1.7} /></span>
                <strong>{profile.data ? number(profile.data.focus_areas.length) : '—'}</strong>
                <span>{t('محاور الشغل', 'focus areas')}</span>
                <small>{t('تخصيص الفريق', 'team customization')}</small>
              </article>
            </div>

            {members.isError && <ErrorState message={t('تعذر تحميل أعضاء الفريق.', 'Could not load team memberships.')} onRetry={() => { void members.refetch(); }} />}

            <section className="tms-overview-grid">
              <article className="tms-panel-card" data-tm-anim>
                <header className="tms-block-head">
                  <div>
                    <span className="tms-kicker"><Crown size={14} aria-hidden="true" />{t('القيادة', 'Leadership')}</span>
                    <h3>{t('Head وMonitor', 'Head & Monitor')}</h3>
                  </div>
                </header>
                <ul className="tms-summary-list">
                  {ROLES.map((role) => {
                    const assignment = team.assignments.find((entry) => entry.role === role);
                    return (
                      <li key={role}>
                        <span className="tms-avatar tms-avatar--sm" aria-hidden="true">{assignment ? initials(assignment.email) : role === 'head' ? <Crown size={13} aria-hidden="true" /> : <UserCog size={13} aria-hidden="true" />}</span>
                        <div>
                          <strong>{role === 'head' ? t('رئيس الفريق', 'Team Head') : t('المتابع', 'Monitor')}</strong>
                          <small dir={assignment ? 'ltr' : undefined}>{assignment ? assignment.email : t('المقعد فاضي', 'Seat is open')}</small>
                        </div>
                        {assignment ? <Check size={15} aria-hidden="true" className="is-ok" /> : <span className="tms-chip tms-chip--muted">{t('فاضي', 'Open')}</span>}
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="tms-link" onClick={() => setTab('leadership')}>{t('إدارة المقاعد', 'Manage seats')}</button>
              </article>

              <article className="tms-panel-card" data-tm-anim>
                <header className="tms-block-head">
                  <div>
                    <span className="tms-kicker"><Layers3 size={14} aria-hidden="true" />{t('بيانات الفريق', 'Team facts')}</span>
                    <h3>{t('الملخص', 'Summary')}</h3>
                  </div>
                </header>
                <ul className="tms-facts">
                  <li><span>{t('المعرّف', 'Slug')}</span><b dir="ltr">/{team.slug}</b></li>
                  <li><span>{t('الحالة', 'Status')}</span><b>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</b></li>
                  <li><span>{t('عضويات موقوفة', 'Suspended memberships')}</span><b>{members.isPending ? '—' : number(stats.suspended)}</b></li>
                  <li><span>{t('آخر تحديث للتخصيص', 'Customization updated')}</span><b>{profile.data?.updated_at ? date(profile.data.updated_at) : t('لسه', 'Not yet')}</b></li>
                </ul>
                <div className="tms-panel-actions">
                  <Button type="button" variant="secondary" onClick={() => setTab('members')}>{t('فتح الأعضاء', 'Open members')}</Button>
                  <Button type="button" variant="ghost" onClick={() => setTab('customize')}>{t('تخصيص الفريق', 'Customize team')}</Button>
                </div>
              </article>
            </section>
          </>
        )}

        {tab === 'leadership' && (
          <section className="tms-leadership" aria-labelledby={`tms-lead-${team.team_id}`}>
            <header className="tms-block-head" data-tm-anim>
              <div>
                <span className="tms-kicker"><Crown size={14} aria-hidden="true" />{t('تسجيل القيادة', 'Leadership enrollment')}</span>
                <h3 id={`tms-lead-${team.team_id}`}>{t('Head وMonitor', 'Head & Monitor')}</h3>
              </div>
              <p className="tms-block-hint">{t('كل مقعد بياخد صلاحياته لوحده جوه الفريق ده.', 'Each seat carries its own permissions inside this team.')}</p>
            </header>
            {!team.is_active && <p className="tms-disabled" data-tm-anim><Pause size={15} aria-hidden="true" />{t('الوصول متوقف. فعّل الفريق عشان تعدّل مقاعده؛ تقدر تشيل تعيين موجود في أي وقت.', 'Access is paused. Enable this team to edit its seats; an existing assignment can still be removed.')}</p>}
            <div className="tms-seat-grid">
              {ROLES.map((role) => (
                <SeatCard key={`${team.team_id}-${role}`} team={team} role={role} candidates={candidates.data ?? []} isOwner={ownerConfirmed} />
              ))}
            </div>
            {candidates.isError && <ErrorState message={t('تعذر تحميل حسابات التعيين.', 'Could not load assignment candidates.')} onRetry={() => { void candidates.refetch(); }} />}
          </section>
        )}

        {tab === 'members' && (
          team.is_active
            ? <MemberRoster team={team} />
            : <p className="tms-disabled" data-tm-anim><Pause size={15} aria-hidden="true" />{t('الوصول متوقف. فعّل الفريق لإدارة عضوياته؛ الحسابات والفرق الأخرى لا تتأثر.', 'Access is paused. Enable this team to manage memberships; accounts and other teams are unaffected.')}</p>
        )}

        {tab === 'customize' && (
          <section className="tms-customize" aria-labelledby="tms-customize-title">
            <header className="tms-block-head" data-tm-anim>
              <div>
                <span className="tms-kicker"><Palette size={14} aria-hidden="true" />{t('تخصيص الفريق', 'Team customization')}</span>
                <h3 id="tms-customize-title">{t('خلي الصفحة على مزاج الفريق', 'Make the page fit this team')}</h3>
              </div>
              <p className="tms-block-hint">{t('الوصف واللون والمحاور بتظهر في رأس صفحة الفريق لكل اللي ليه وصول.', 'The tagline, accent, and focus areas show in the team page header for everyone with access.')}</p>
            </header>

            {profile.isPending && <CardSkeletons count={1} />}
            {profile.isError && <ErrorState message={t('تعذر تحميل تخصيص الفريق.', 'Could not load the team customization.')} onRetry={() => { void profile.refetch(); }} />}

            {!profile.isPending && !profile.isError && (
              <div className="tms-customize-grid">
                <article className="tms-panel-card" data-tm-anim>
                  <label className="tms-field">
                    <span>{t('وصف قصير للفريق', 'Short team tagline')}</span>
                    <textarea
                      value={tagline}
                      onChange={(event) => setTagline(event.target.value.slice(0, 160))}
                      rows={3}
                      maxLength={160}
                      placeholder={t('مثال: بنبني منتجات الـ Software الأساسية للفريق.', 'e.g. We build the core software products for the team.')}
                    />
                    <small className="tms-counter">{number(tagline.length)}/160</small>
                  </label>

                  <fieldset className="tms-accent-field">
                    <legend>{t('لون تمييز الفريق', 'Team accent')}</legend>
                    <div className="tms-accent-options">
                      {ACCENTS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`tms-accent-option${accent === option.value ? ' is-active' : ''}`}
                          data-accent={option.value}
                          aria-pressed={accent === option.value}
                          onClick={() => setAccent(option.value)}
                        >
                          <span className="tms-accent-dot" aria-hidden="true" />
                          {t(option.ar, option.en)}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </article>

                <article className="tms-panel-card" data-tm-anim>
                  <div className="tms-perm-head">
                    <strong>{t('محاور شغل الفريق', 'Team focus areas')}</strong>
                    <span>{number(focus.length)}/{MAX_FOCUS}</span>
                  </div>
                  <div className="tms-focus-add">
                    <input
                      value={focusDraft}
                      onChange={(event) => setFocusDraft(event.target.value.slice(0, 40))}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFocus(); } }}
                      placeholder={t('مثال: Backend، AI Research…', 'e.g. Backend, AI research…')}
                      aria-label={t('محور شغل جديد', 'New focus area')}
                    />
                    <Button type="button" variant="secondary" icon={<Plus size={15} aria-hidden="true" />} onClick={addFocus} disabled={focus.length >= MAX_FOCUS}>{t('إضافة', 'Add')}</Button>
                  </div>
                  {focus.length === 0
                    ? <p className="tms-note">{t('لسه مفيش محاور. ضيف لحد 6 محاور قصيرة تعرّف شغل الفريق.', 'No focus areas yet. Add up to 6 short areas that describe the team.')}</p>
                    : (
                      <ul className="tms-focus-list">
                        {focus.map((item) => (
                          <li key={item}>
                            <span>{item}</span>
                            <button type="button" onClick={() => setFocus((current) => current.filter((entry) => entry !== item))} aria-label={t(`حذف ${item}`, `Remove ${item}`)}>
                              <X size={13} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  <div className="tms-panel-actions">
                    <Button type="button" icon={<Save size={15} aria-hidden="true" />} onClick={() => void saveCustomization()} isLoading={saveProfile.isPending}>{t('حفظ التخصيص', 'Save customization')}</Button>
                    <Button type="button" variant="ghost" onClick={() => { setTagline(profile.data?.tagline ?? ''); setAccent(profile.data?.accent ?? 'primary'); setFocus(profile.data?.focus_areas ?? []); }} disabled={saveProfile.isPending}>{t('تراجع', 'Reset')}</Button>
                  </div>
                </article>
              </div>
            )}
          </section>
        )}

        {tab === 'settings' && (
          <section className="tms-settings" aria-labelledby="tms-settings-title">
            <header className="tms-block-head" data-tm-anim>
              <div>
                <span className="tms-kicker"><Settings2 size={14} aria-hidden="true" />{t('إعدادات الفريق', 'Team settings')}</span>
                <h3 id="tms-settings-title">{t('الاسم والحالة', 'Name and state')}</h3>
              </div>
              <p className="tms-block-hint">{t('تغيير الاسم أو المعرّف مش بيأثر على العضويات أو الصلاحيات.', 'Renaming or changing the slug does not affect memberships or permissions.')}</p>
            </header>

            <article className="tms-panel-card" data-tm-anim>
              {editing
                ? (
                  <form onSubmit={(event) => void saveDetails(event)} className="tms-edit-form">
                    <label className="tms-field"><span>{t('اسم الفريق', 'Team name')}</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} required minLength={2} maxLength={80} /></label>
                    <label className="tms-field"><span>{t('معرّف URL', 'URL slug')}</span><input value={draftSlug} onChange={(event) => setDraftSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" /></label>
                    <div className="tms-edit-actions">
                      <Button type="submit" icon={<Save size={15} aria-hidden="true" />} isLoading={updateDetails.isPending}>{t('حفظ', 'Save')}</Button>
                      <Button type="button" variant="ghost" icon={<X size={15} aria-hidden="true" />} onClick={() => setEditing(false)} disabled={updateDetails.isPending}>{t('إلغاء', 'Cancel')}</Button>
                    </div>
                  </form>
                )
                : (
                  <>
                    <ul className="tms-facts">
                      <li><span>{t('الاسم', 'Name')}</span><b>{team.name}</b></li>
                      <li><span>{t('المعرّف', 'Slug')}</span><b dir="ltr">/{team.slug}</b></li>
                      <li><span>{t('الحالة', 'Status')}</span><b>{team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}</b></li>
                    </ul>
                    <div className="tms-panel-actions">
                      <Button type="button" variant="secondary" icon={<Pencil size={15} aria-hidden="true" />} onClick={() => setEditing(true)}>{t('تعديل البيانات', 'Edit details')}</Button>
                      <Button
                        type="button"
                        variant={team.is_active ? 'danger' : 'primary'}
                        icon={team.is_active ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                        onClick={() => { if (team.is_active) setPendingDisable(true); else void setActive(true); }}
                        isLoading={toggle.isPending}
                      >
                        {team.is_active ? t('إيقاف الفريق', 'Disable team') : t('تفعيل الفريق', 'Enable team')}
                      </Button>
                    </div>
                  </>
                )}
              <p className="tms-note">{t('الإيقاف بيوقف وصول Heads/Monitors لهذا الفريق فقط؛ الحسابات والفرق الأخرى لا تتأثر، ويمكن إعادة التفعيل في أي وقت.', 'Disabling pauses access for this team only. Accounts and other teams are unaffected, and it can be re-enabled any time.')}</p>
            </article>
          </section>
        )}
      </div>

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
