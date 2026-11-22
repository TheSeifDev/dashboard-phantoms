import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpLeft,
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Gift,
  Laptop,
  MapPin,
  Smartphone,
} from 'lucide-react';
import type { Member, MemberEvaluation, Task } from '../../types/db';
import { usePWA } from '../../hooks/usePWA';
import { formatSigned } from '../../lib/arabic';
import { useLocale } from '../../i18n/useLocale';
import { isRunningInNativeApk } from '../../lib/capacitor';
import { isOverdue } from '../../lib/dateUtils';
import { PhantomsSymbol } from '../../components/brand/PhantomsLogo';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
import { HeroHexCluster } from '../dashboard/HeroHexCluster';
import { GithubMark } from '../dashboard/GithubMark';
import { resolveGithubHandle } from '../dashboard/github';

const ACTIONABLE = new Set(['pending', 'in_progress', 'revision_requested']);

function greeting(t: (arabic: string, english: string) => string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(new Date()));
  if (hour < 5) return t('سهرانين؟ أهلًا بيك', 'Burning the midnight oil');
  if (hour < 12) return t('صباح الخير', 'Good morning');
  if (hour < 18) return t('يومك سعيد', 'Good afternoon');
  return t('مساء الخير', 'Good evening');
}

function QuickAction({ label, icon, onClick, to, tone = 'neutral' }: { label: string; icon: ReactNode; onClick?: () => void; to?: string; tone?: 'primary' | 'neutral' }) {
  const { dir } = useLocale();
  const Arrow = dir === 'rtl' ? ArrowUpLeft : ArrowUpRight;
  const className = `dashboard-quick-action dashboard-quick-action-${tone} ${tone === 'primary' ? 'btn-shine' : ''}`;
  const inner = (
    <>
      <span className="dashboard-quick-action-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <Arrow size={14} aria-hidden="true" />
    </>
  );
  if (to) return <Link to={to} className={className}>{inner}</Link>;
  return <button type="button" className={className} onClick={onClick}>{inner}</button>;
}

/** هيرو العضو بنفس شكل هيرو لوحة الإدارة: عنوان + شيبس حالة + إجراءات سريعة + الهيكس. */
export function MemberHero({
  member,
  tasks,
  evaluations,
  onToggleField,
  isUpdating,
  totalBonus,
  bonusInfinite = false,
  bonusLoading = false,
  bonusError = false,
  bonusStateLoading = false,
  bonusStateError = false,
}: {
  member: Member;
  tasks: Task[];
  evaluations: MemberEvaluation[];
  onToggleField: () => void;
  isUpdating: boolean;
  totalBonus?: number | null;
  bonusInfinite?: boolean;
  bonusLoading?: boolean;
  bonusError?: boolean;
  bonusStateLoading?: boolean;
  bonusStateError?: boolean;
}) {
  const { isSubscribed, subscribeToPush, sendTestNotification } = usePWA({
    memberId: member.id,
    memberEmail: member.email,
  });
  const { t, dir, number, date } = useLocale();
  const navigate = useNavigate();
  const memberId = String(member.id);
  const statusOf = (task: Task) => task.tracking?.[memberId]?.status ?? 'pending';
  const underReview = tasks.filter((task) => statusOf(task) === 'under_review').length;
  const approved = tasks.filter((task) => statusOf(task) === 'approved').length;
  const open = tasks.filter((task) => ACTIONABLE.has(statusOf(task))).length;
  const overdue = tasks.filter((task) => ACTIONABLE.has(statusOf(task)) && task.has_deadline && isOverdue(task.deadline_date)).length;
  const unreadEvaluations = evaluations.filter((item) => !item.read_at).length;
  const githubHandle = resolveGithubHandle({ portfolio_url: member.portfolio_url ?? null, custom_fields: member.custom_fields ?? undefined });
  const bonusText = bonusError || bonusStateError
    ? t('غير متاح', 'Unavailable')
    : bonusInfinite
      ? '∞'
      : typeof totalBonus === 'number'
        ? formatSigned(totalBonus)
        : '—';
  const today = useMemo(() => new Date().toISOString(), []);

  return (
    <header className="dashboard-hero glass-card" dir={dir} data-reveal aria-labelledby="member-name">
      <div className="dashboard-hero-copy">
        <div className="dashboard-hero-brand">
          <span className="dashboard-brand-mark" aria-hidden="true"><PhantomsSymbol size="sm" /></span>
          <p className="dashboard-eyebrow">
            <span className="live-dot" aria-hidden="true" />
            {greeting(t)} · {t('بوابة العضو', 'MEMBER PORTAL')}
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar
            member={member}
            name={member.full_name}
            size={112}
            className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[var(--glass-hairline)] bg-[var(--glass-bg-soft)] text-lg font-black text-[var(--text)] sm:size-14"
          />
          <div className="min-w-0">
            <h1 id="member-name" dir="auto" className="dashboard-hero-title truncate">{member.full_name}</h1>
            <p className="dashboard-hero-subtitle" dir="auto">
              {member.bio || t('عضو شاطر ومبدع في الفريق', 'A valued and creative team member')}
            </p>
          </div>
        </div>

        <ul className="dashboard-hero-chips" aria-label={t('حالتك اليوم', 'Your status today')}>
          <li data-tone="amber"><Clock3 size={14} aria-hidden="true" />{t(`${number(underReview)} تحت المراجعة`, `${number(underReview)} under review`)}</li>
          <li data-tone="red"><CalendarClock size={14} aria-hidden="true" />{t(`${number(overdue)} متأخرة`, `${number(overdue)} overdue`)}</li>
          <li data-tone="violet">
            <Gift size={14} aria-hidden="true" />
            {bonusLoading || bonusStateLoading
              ? t('بنحمّل النقاط', 'Loading points')
              : `${t('نقاطي', 'Points')}: ${bonusText}`}
          </li>
          <li>
            {githubHandle ? <GithubMark size={14} /> : <Laptop size={14} aria-hidden="true" />}
            {githubHandle ? t('GitHub مربوط', 'GitHub linked') : t(`${member.device || t('مش متحدد', 'No device')}`, `${member.device || 'No device'}`)}
          </li>
        </ul>

        <div className="dashboard-page-tools">
          <time className="dashboard-today" dateTime={today}>{date(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
          <nav className="dashboard-quick-actions portal-hero-actions" aria-label={t('إجراءات سريعة', 'Quick actions')}>
            <QuickAction tone="primary" label={t('مهامي', 'My tasks')} icon={<CheckCircle2 size={16} />} to="/portal?tab=TASKS" />
            <QuickAction label={t('تقييماتي', 'My evaluations')} icon={<Clock3 size={16} />} to="/portal?tab=EVALUATIONS" />
            <QuickAction
              label={isSubscribed ? t('الإشعارات شغالة', 'Notifications on') : t('شغّل الإشعارات', 'Enable notifications')}
              icon={isSubscribed ? <BellRing size={16} /> : <Bell size={16} />}
              onClick={subscribeToPush}
            />
            {!isRunningInNativeApk() && (
              <QuickAction label={t('تطبيق الموبايل', 'Mobile app')} icon={<Smartphone size={16} />} to="/download" />
            )}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleField}
            disabled={isUpdating}
            aria-pressed={member.can_go_alexandria}
            aria-busy={isUpdating}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--glass-hairline)] bg-[var(--glass-bg-soft)] px-3 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            <MapPin size={14} aria-hidden="true" />
            {t('جاهزية النزول', 'Field availability')}
            <span aria-live="polite" className="text-[var(--text)]">
              {isUpdating ? t('جارٍ التحديث…', 'Updating…') : member.can_go_alexandria ? t('جاهز', 'Available') : t('مش جاهز', 'Unavailable')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { void sendTestNotification(); }}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--glass-hairline)] bg-[var(--glass-bg-soft)] px-3 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
          >
            <BellRing size={14} aria-hidden="true" />
            {t('جرّب الإشعار', 'Test notification')}
          </button>
          {unreadEvaluations > 0 && (
            <button
              type="button"
              onClick={() => navigate('/portal?tab=EVALUATIONS')}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--glass-hairline)] bg-[var(--glass-bg-soft)] px-3 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            >
              {t(`${number(unreadEvaluations)} تقييم جديد`, `${number(unreadEvaluations)} new evaluation`)}
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="dashboard-hero-visual"
        onClick={() => navigate('/portal?tab=TASKS')}
        aria-label={t('افتح مهامي', 'Open my tasks')}
      >
        <HeroHexCluster
          heat={Math.max(1, Math.min(4, approved))}
          value={number(open)}
          caption={t('مهام شغالة', 'active tasks')}
        />
      </button>
    </header>
  );
}