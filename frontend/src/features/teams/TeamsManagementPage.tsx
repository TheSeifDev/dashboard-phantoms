import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight, Crown, Layers3, Plus, Search, ShieldCheck, UserCog, UsersRound, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useLocale } from '../../i18n/useLocale';
import type { TeamOverview } from '../../types/db';
import { useAdminAccess } from '../admin/access/api';
import { useCreateTeam, useOwnerTeams } from './api';
import { ROLES, countUp, initials, useStaggerIn } from './components/teamCopy';
import './teams-management.css';

type TeamStatusFilter = 'all' | 'active' | 'disabled';

function MetricValue({ value, format }: { value: number | null; format: (input: number) => string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (value === null) return;
    countUp(ref.current, value, format);
  }, [value, format]);
  return <strong ref={ref}>{value === null ? '—' : format(0)}</strong>;
}

function TeamCard({ team }: { team: TeamOverview }) {
  const { t, number } = useLocale();
  const head = team.assignments.find((assignment) => assignment.role === 'head');
  const monitor = team.assignments.find((assignment) => assignment.role === 'monitor');
  const seats = [head, monitor].filter(Boolean).length;

  return (
    <Link
      to={`/admin/teams/${team.team_id}`}
      className={`tms-card${team.is_active ? '' : ' is-off'}`}
      data-tm-anim
      aria-label={t(`افتح صفحة فريق ${team.name}`, `Open the ${team.name} team page`)}
    >
      <span className="tms-card-stripe" aria-hidden="true" />
      <header className="tms-card-head">
        <span className="tms-card-mark" aria-hidden="true">{initials(team.name)}</span>
        <div className="tms-card-identity">
          <strong>{team.name}</strong>
          <small dir="ltr">/{team.slug}</small>
        </div>
        <span className={`tms-card-status${team.is_active ? ' is-on' : ''}`}>
          <i aria-hidden="true" />
          {team.is_active ? t('نشط', 'Active') : t('متوقف', 'Disabled')}
        </span>
      </header>

      <div className="tms-card-seats">
        {ROLES.map((role) => {
          const assignment = role === 'head' ? head : monitor;
          const label = role === 'head' ? 'Head' : 'Monitor';
          const person = assignment?.email ?? '';
          return (
            <span key={role} className={`tms-card-seat${assignment ? ' is-filled' : ''}`}>
              {assignment
                ? <span className="tms-avatar tms-avatar--xs" aria-hidden="true">{initials(person)}</span>
                : <span className="tms-avatar tms-avatar--xs is-ghost" aria-hidden="true">{role === 'head' ? <Crown size={11} aria-hidden="true" /> : <UserCog size={11} aria-hidden="true" />}</span>}
              <span className="tms-card-seat-copy">
                <em>{label}</em>
                <b>{assignment ? (person.split('@')[0] || person) : t('مقعد فاضي', 'Seat open')}</b>
              </span>
            </span>
          );
        })}
      </div>

      <footer className="tms-card-foot">
        <span className="tms-card-count"><UsersRound size={14} aria-hidden="true" />{number(team.member_count)} {t('عضو', 'members')}</span>
        <span className="tms-card-count"><UserCog size={14} aria-hidden="true" />{number(seats)}/2 {t('مقاعد', 'seats')}</span>
        <span className="tms-card-open">{t('افتح الفريق', 'Open team')}<ArrowUpRight size={15} aria-hidden="true" /></span>
      </footer>
    </Link>
  );
}

export default function TeamsManagementPage() {
  const { t, dir, number } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const ownerConfirmed = access.data?.owner_authority === true;
  const teams = useOwnerTeams(ownerConfirmed);
  const createTeam = useCreateTeam();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const allTeams = teams.data ?? [];
  const activeCount = allTeams.filter((team) => team.is_active).length;
  const membershipCount = allTeams.reduce((total, team) => total + team.member_count, 0);
  const seatCount = allTeams.reduce(
    (total, team) => total + ROLES.filter((role) => team.assignments.some((assignment) => assignment.role === role)).length,
    0,
  );

  const visibleTeams = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return allTeams.filter((team) => {
      if (statusFilter === 'active' && !team.is_active) return false;
      if (statusFilter === 'disabled' && team.is_active) return false;
      if (!text) return true;
      const haystack = [team.name, team.slug, ...team.assignments.map((assignment) => assignment.email)].join(' ').toLocaleLowerCase();
      return haystack.includes(text);
    });
  }, [allTeams, query, statusFilter]);

  useStaggerIn(gridRef, `${visibleTeams.length}-${statusFilter}-${query}`);

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  const metrics = [
    { label: t('إجمالي الفرق', 'Total teams'), value: allTeams.length, hint: t('مساحات مستقلة', 'Independent workspaces'), icon: Layers3 },
    { label: t('الفرق النشطة', 'Active teams'), value: activeCount, hint: t('الوصول متاح الآن', 'Access enabled now'), icon: ShieldCheck },
    { label: t('عضويات نشطة', 'Active memberships'), value: membershipCount, hint: t('العضو ممكن يكون في فرق كتير', 'Members may join several teams'), icon: UsersRound },
    { label: t('مقاعد مُعيّنة', 'Assigned seats'), value: seatCount, hint: t('Head وMonitor لكل فريق', 'Head & Monitor per team'), icon: UserCog },
  ];

  const statusOptions: { value: TeamStatusFilter; label: string; count: number }[] = [
    { value: 'all', label: t('الكل', 'All'), count: allTeams.length },
    { value: 'active', label: t('نشط', 'Active'), count: activeCount },
    { value: 'disabled', label: t('متوقف', 'Disabled'), count: allTeams.length - activeCount },
  ];

  const closeCreate = () => {
    setCreating(false);
    setName('');
    setSlug('');
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await createTeam.mutateAsync({ slug: slug.trim().toLowerCase(), name: name.trim() });
      closeCreate();
      toast.success(t('اتعمل الفريق. افتح صفحته عشان تخصصه وتضيف أعضاءه.', 'Team created. Open its page to customize it and add members.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش ننشئ الفريق.', 'Could not create the team.')).message);
    }
  };

  if (access.isPending || (access.isFetching && !access.data)) return <CardSkeletons count={2} />;
  if (access.isError) return <ErrorState message={t('تعذر التحقق من صلاحية Owner.', 'Could not verify Owner access.')} onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.owner_authority) {
    return <EmptyState title={t('إدارة الفرق للمالك فقط', 'Team management is restricted to the owner')} description={t('تعيين Head/Monitor وتغيير الصلاحيات يتم من Owner فقط.', 'Only the Owner can assign Heads/Monitors or change their permissions.')} />;
  }

  return (
    <div className="teams-management" dir={dir}>
      <PageHeader
        icon={<Layers3 size={22} aria-hidden="true" />}
        title={t('الفرق الداخلية', 'Internal teams')}
        description={t('كل فريق ليه صفحة مستقلة فيها القيادة والأعضاء والتخصيص. من هنا بتشوف كل الفرق وبتفتح اللي عايزه.', 'Every team has its own page for leadership, members, and customization. See all teams here, then open the one you need.')}
        actions={<>
          <span className="tms-owner"><ShieldCheck size={14} aria-hidden="true" />{t('تحكم المالك', 'Owner controls')}</span>
          <Button type="button" icon={<Plus size={17} aria-hidden="true" />} onClick={() => setCreating(true)}>{t('فريق جديد', 'New team')}</Button>
        </>}
      />

      <section className="tms-metrics" aria-label={t('ملخص الفرق', 'Teams overview')} aria-busy={teams.isPending}>
        {metrics.map(({ label, value, hint, icon: Icon }, index) => (
          <div className={`tms-metric${index === 1 ? ' is-accent' : ''}`} key={label} data-tm-anim>
            <span className="tms-metric-icon" aria-hidden="true"><Icon size={15} strokeWidth={1.7} /></span>
            <div>
              <span className="tms-metric-label">{label}</span>
              <MetricValue value={teams.data ? value : null} format={number} />
              <small>{hint}</small>
            </div>
          </div>
        ))}
      </section>

      <div className="tms-toolbar" data-tm-anim>
        <div className="tms-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('ابحث باسم الفريق أو بريد المسؤول…', 'Search team name or manager email…')}
            aria-label={t('البحث عن فريق', 'Find a team')}
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('مسح البحث', 'Clear search')}><X size={14} aria-hidden="true" /></button>}
        </div>
        <div className="tms-segmented" role="group" aria-label={t('تصفية حسب حالة الفريق', 'Filter by team status')}>
          {statusOptions.map(({ value, label, count }) => (
            <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
              {label}<span>{number(count)}</span>
            </button>
          ))}
        </div>
      </div>

      {teams.isPending && <CardSkeletons count={2} />}
      {teams.isError && <ErrorState message={t('تعذر تحميل الفرق وتعييناتها.', 'Could not load teams and assignments.')} onRetry={() => { void teams.refetch(); }} />}

      {teams.data?.length === 0 && (
        <EmptyState
          title={t('مفيش فرق لسه', 'No teams yet')}
          description={t('أنشئ أول فريق، وبعدها افتح صفحته عشان تعيّن القيادة وتضيف الأعضاء وتخصص شكله.', 'Create your first team, then open its page to assign leadership, add members, and customize it.')}
          action={<Button type="button" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>{t('فريق جديد', 'New team')}</Button>}
        />
      )}

      {allTeams.length > 0 && visibleTeams.length === 0 && (
        <EmptyState
          title={t('مفيش فرق مطابقة للبحث', 'No teams match this search')}
          description={t('جرّب اسم تاني أو غيّر تصفية الحالة.', 'Try another name or change the status filter.')}
          action={<Button type="button" variant="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); }}>{t('مسح التصفية', 'Clear filters')}</Button>}
        />
      )}

      {visibleTeams.length > 0 && (
        <div className="tms-grid" ref={gridRef}>
          {visibleTeams.map((team) => <TeamCard key={team.team_id} team={team} />)}
        </div>
      )}

      <aside className="tms-security" data-tm-anim>
        <ShieldCheck size={17} aria-hidden="true" />
        <div>
          <strong>{t('صلاحيات مستقلة، حساب واحد', 'Separate permissions. One account.')}</strong>
          <p>{t('الأعضاء يقدروا ينضموا لأكثر من فريق. Head/Monitor مش بياخدوا صلاحيات Admin عامة، وإزالة تعيينهم مش بتحذف حساباتهم. أي صلاحية مش بتفتح بيانات قبل ما مسارها يتأمّن في الخادم.', 'Members can belong to multiple teams. Heads/Monitors never receive global Admin rights, and revoking a seat does not delete their accounts. A permission never exposes data until its server path is fully scoped.')}</p>
        </div>
      </aside>

      <Modal
        isOpen={creating}
        onClose={closeCreate}
        title={t('فريق جديد', 'New team')}
        subtitle={t('مساحة مستقلة، من غير نقل أي بيانات قديمة.', 'A clean workspace. No legacy data is moved.')}
        icon={<Layers3 size={18} aria-hidden="true" />}
        maxWidth="md"
        footer={<>
          <Button type="submit" form="teams-create-form" icon={<Plus size={16} aria-hidden="true" />} isLoading={createTeam.isPending}>{t('إنشاء الفريق', 'Create team')}</Button>
          <Button type="button" variant="ghost" onClick={closeCreate} disabled={createTeam.isPending}>{t('إلغاء', 'Cancel')}</Button>
        </>}
      >
        <form id="teams-create-form" onSubmit={(event) => void create(event)} className="tms-create-form">
          <label className="tms-field">
            <span>{t('اسم الفريق', 'Team name')}</span>
            <input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} placeholder={t('مثال: Software', 'e.g. Software')} />
          </label>
          <label className="tms-field">
            <span>{t('معرّف URL', 'URL slug')}</span>
            <input value={slug} onChange={(event) => setSlug(event.target.value)} required minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" dir="ltr" placeholder="software" />
          </label>
          <p className="tms-note">{t('بعد الإنشاء، افتح صفحة الفريق: هتلاقي فيها القيادة والأعضاء والتخصيص والإعدادات.', 'After creating it, open the team page for leadership, members, customization, and settings.')}</p>
        </form>
      </Modal>
    </div>
  );
}
