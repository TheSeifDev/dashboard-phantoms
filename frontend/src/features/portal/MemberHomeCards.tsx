import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  ClipboardCheck,
  Cog,
  Users,
  ListChecks,
  FolderKanban,
} from 'lucide-react';
import AnnouncementsAPI from '../../lib/api/announcements';
import type { Member, MemberEvaluation, Task } from '../../types/db';
import { isOverdue } from '../../lib/dateUtils';
import { useLocale } from '../../i18n/useLocale';
import { useMemberTeams } from './useMemberTeams';
import { useMemberProjectRoles } from './useMemberProjectRoles';
import { hasRequiredMemberInformation, missingMemberProfileFields } from '../members/member-profile-display';
import type { NotificationTargetTab } from '../../lib/notifications';
import './portal-home.css';

type HomeCardTone = 'neutral' | 'accent' | 'warn' | 'success';

interface HomeCardProps {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  action?: { label: string; onClick?: () => void; to?: string };
  tone?: HomeCardTone;
  loading?: boolean;
}

const TONE_CLASS: Record<HomeCardTone, string> = {
  neutral: 'text-[var(--text)]',
  accent: 'text-[var(--link)]',
  warn: 'text-[var(--danger-text)]',
  success: 'text-[var(--success-text)]',
};

function HomeCard({ icon, title, value, hint, action, tone = 'neutral', loading }: HomeCardProps) {
  // Same KPI card anatomy as the admin dashboard so both surfaces read as one product.
  const kpiTone = tone === 'warn' ? 'red' : tone === 'success' ? 'green' : tone === 'accent' ? 'violet' : undefined;
  return (
    <article className="kpi-card glass-card" data-tone={kpiTone} data-tilt="4" data-reveal>
      <div className="kpi-head">
        <span className="kpi-icon" aria-hidden="true">{icon}</span>
        <span className="kpi-title">{title}</span>
      </div>
      <div className="kpi-body">
        <div className="kpi-value-row">
          {loading ? (
            <span className="block h-7 w-24 animate-pulse rounded-md bg-[var(--glass-bg-soft)]" aria-hidden="true" />
          ) : (
            <strong className={`kpi-value ${TONE_CLASS[tone]}`}>{value}</strong>
          )}
        </div>
      </div>
      {hint ? <span className="kpi-detail line-clamp-2">{hint}</span> : null}
      {action ? (
        action.to ? (
          <Link
            to={action.to}
            className="mt-auto inline-flex items-center gap-1 self-start text-xs font-black text-[var(--link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            {action.label}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-auto inline-flex items-center gap-1 self-start text-xs font-black text-[var(--link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            {action.label}
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        )
      ) : null}
    </article>
  );
}

interface MemberHomeCardsProps {
  member: Member;
  tasks: Task[];
  evaluations: MemberEvaluation[];
  bonus: number | null;
  onOpenTab: (tab: NotificationTargetTab) => void;
}

const ACTIONABLE = new Set(['pending', 'in_progress', 'revision_requested']);

/** لوحة "الرئيسية" للعضو: كل اللي محتاج يعرفه في نظرة واحدة قبل ما ينزل يشتغل. */
export function MemberHomeCards({ member, tasks, evaluations, bonus, onOpenTab }: MemberHomeCardsProps) {
  const { t, number, date } = useLocale();
  const memberId = String(member.id);
  const teamsQuery = useMemberTeams(member.id);
  const projectRoles = useMemberProjectRoles(member.id);

  const announcementsQuery = useQuery({
    queryKey: ['member-announcements-home', member.id],
    staleTime: 60_000,
    queryFn: () => AnnouncementsAPI.getMemberAnnouncements(member.id),
  });

  const announcements = announcementsQuery.data ?? [];
  const unreadAnnouncements = announcements.filter((item) => !item.is_read && !item.is_dismissed);
  const latestAnnouncement = announcements[0] ?? null;

  const statusOf = (task: Task) => task.tracking?.[memberId]?.status ?? 'pending';
  const openTasks = tasks.filter((task) => ACTIONABLE.has(statusOf(task)));
  const underReview = tasks.filter((task) => statusOf(task) === 'under_review');
  const approved = tasks.filter((task) => statusOf(task) === 'approved');
  const overdue = openTasks.filter((task) => task.has_deadline && isOverdue(task.deadline_date));

  const unreadEvaluations = evaluations.filter((item) => !item.read_at);
  const latestEvaluation = evaluations[0] ?? null;
  const teams = teamsQuery.data ?? [];
  const activeTeams = teams.filter((team) => team.status === 'approved' || team.status === 'active');
  const profileReady = hasRequiredMemberInformation(member);
  const missingFields = profileReady ? 0 : missingMemberProfileFields(member).length;

  return (
    <section aria-label={t('ملخص حسابك', 'Your account summary')} className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-base font-black">{t('نظرة سريعة', 'At a glance')}</h2>
        <p className="text-xs text-[var(--text-muted)]">
          {t('كل اللي محتاج تعرفه قبل ما تبدأ', 'Everything you need before you start')}
        </p>
      </div>

      <div className="kpi-grid kpi-grid--trio">
        <HomeCard
          icon={<ClipboardCheck size={18} />}
          title={t('تقييماتي وملاحظات الأداء', 'My evaluations')}
          value={
            unreadEvaluations.length > 0
              ? t(`${number(unreadEvaluations.length)} جديد`, `${number(unreadEvaluations.length)} new`)
              : evaluations.length > 0
                ? number(evaluations.length)
                : t('لسه مفيش', 'None yet')
          }
          hint={
            latestEvaluation
              ? `${latestEvaluation.title} · ${date(latestEvaluation.created_at)}`
              : t('أول ما تتقيّم هتلاقيها هنا.', 'They will show up here once you are evaluated.')
          }
          action={{ label: t('افتح التقييمات', 'Open evaluations'), onClick: () => onOpenTab('EVALUATIONS') }}
          tone={unreadEvaluations.length > 0 ? 'accent' : 'neutral'}
          loading={false}
        />

        <HomeCard
          icon={<ListChecks size={18} />}
          title={t('مهامي ونقاطي', 'My tasks and points')}
          value={
            openTasks.length > 0
              ? t(`${number(openTasks.length)} مهمة شغالة`, `${number(openTasks.length)} active`)
              : t('مفيش مهام شغالة', 'No active tasks')
          }
          hint={t(
            `نقاطي: ${bonus === null ? '—' : number(bonus)} · مستنية المراجعة: ${number(underReview.length)} · اتعتمدت: ${number(approved.length)}`,
            `Points: ${bonus === null ? '—' : number(bonus)} · Awaiting review: ${number(underReview.length)} · Approved: ${number(approved.length)}`,
          )}
          action={{ label: t('روح للمهام', 'Go to tasks'), onClick: () => onOpenTab('TASKS') }}
          tone="accent"
        />

        <HomeCard
          icon={<AlertTriangle size={18} />}
          title={t('المهام المتأخرة', 'Overdue tasks')}
          value={overdue.length > 0 ? number(overdue.length) : t('مفيش تأخير', 'None')}
          hint={
            overdue.length > 0
              ? overdue
                  .slice(0, 2)
                  .map((task) => task.title)
                  .join(' · ')
              : t('كل مهامك في وقتها — كمّل كده.', 'Everything is on time.')
          }
          action={overdue.length > 0 ? { label: t('شوف المتأخر', 'See overdue'), onClick: () => onOpenTab('TASKS') } : undefined}
          tone={overdue.length > 0 ? 'warn' : 'success'}
        />

        <HomeCard
          icon={<BellRing size={18} />}
          title={t('الإعلانات', 'Announcements')}
          value={
            unreadAnnouncements.length > 0
              ? t(`${number(unreadAnnouncements.length)} غير مقروء`, `${number(unreadAnnouncements.length)} unread`)
              : announcements.length > 0
                ? number(announcements.length)
                : t('مفيش جديد', 'Nothing new')
          }
          hint={latestAnnouncement ? latestAnnouncement.title : t('مفيش إعلانات جديدة.', 'No new announcements.')}
          action={{ label: t('افتح الإعلانات', 'Open announcements'), onClick: () => onOpenTab('ANNOUNCEMENTS') }}
          tone={unreadAnnouncements.length > 0 ? 'accent' : 'neutral'}
          loading={announcementsQuery.isLoading}
        />

        <HomeCard
          icon={<Users size={18} />}
          title={t('الفريق الداخلي', 'My internal team')}
          value={
            teamsQuery.isLoading
              ? '…'
              : activeTeams.length > 0
                ? activeTeams.map((team) => team.name).join(' · ')
                : t('مش متوزع', 'Unassigned')
          }
          hint={
            teams.length > activeTeams.length && activeTeams.length >= 0
              ? t('في عضوية مستنية موافقة الإدارة.', 'A membership is awaiting approval.')
              : t('AI · Software · Hardware', 'AI · Software · Hardware')
          }
          action={{ label: t('افتح الفريق', 'Open team'), to: '/portal/team' }}
          tone={activeTeams.length > 0 ? 'accent' : 'neutral'}
          loading={teamsQuery.isLoading}
        />

        <HomeCard
          icon={<FolderKanban size={18} />}
          title={t('مشروعات الويب', 'Web projects')}
          value={
            projectRoles.isLoading
              ? '…'
              : projectRoles.total === 0
                ? t('مفيش مشروعات', 'No projects')
                : projectRoles.isLead
                  ? t(`قائد ${number(projectRoles.ledProjects.length)} · عضو ${number(projectRoles.memberProjects.length)}`, `Lead ${number(projectRoles.ledProjects.length)} · member ${number(projectRoles.memberProjects.length)}`)
                  : t(`عضو في ${number(projectRoles.memberProjects.length)} مشروع`, `Member of ${number(projectRoles.memberProjects.length)}`)
          }
          hint={
            projectRoles.isLead
              ? t('كقائد عندك نفس صلاحيات المالك جوه مساحة المشروع.', 'As lead you get owner-level access inside the project workspace.')
              : t('مهامك وتسليماتك وتقاريرك في مساحة المشروع.', 'Your tasks, deliverables and reports live in the project workspace.')
          }
          action={{ label: t('افتح مشروعات الويب', 'Open web projects'), to: '/portal/projects' }}
          tone={projectRoles.isLead ? 'accent' : 'neutral'}
          loading={projectRoles.isLoading}
        />

      </div>

      {/* Full-width row: keeps the 3-up grid even and turns the profile nudge into a CTA. */}
      <Link
        to="/portal/settings"
        className="portal-settings-row glass-card transition-colors hover:bg-[var(--surface-2)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true">
          <Cog size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">{t('الحساب والإعدادات', 'Account and settings')}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">
            {profileReady
              ? t('بياناتك كاملة — تقدر تعدّل أي وقت.', 'Your profile is complete.')
              : t('كمّل بياناتك عشان تظهر في الفريق وتستلم المهام.', 'Complete your profile to appear in the team.')}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${
            profileReady
              ? 'border-[var(--success-border,var(--border))] text-[var(--success-text)]'
              : 'border-[var(--warn-border,var(--border))] text-[var(--warn-text,var(--text))]'
          }`}
        >
          {profileReady ? t('مكتمل', 'Complete') : t(`ناقص ${number(missingFields)}`, `${number(missingFields)} missing`)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black text-[var(--link)]">
          {t('افتح الإعدادات', 'Open settings')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </Link>
    </section>
  );
}
