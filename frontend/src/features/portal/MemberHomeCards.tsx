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
} from 'lucide-react';
import AnnouncementsAPI from '../../lib/api/announcements';
import type { Member, MemberEvaluation, Task } from '../../types/db';
import { isOverdue } from '../../lib/dateUtils';
import { useLocale } from '../../i18n/useLocale';
import { useMemberTeams } from './useMemberTeams';
import { hasRequiredMemberInformation, missingMemberProfileFields } from '../members/member-profile-display';
import type { NotificationTargetTab } from '../../lib/notifications';

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
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true">
          {icon}
        </span>
        <h3 className="pt-1.5 text-sm font-black leading-tight text-[var(--text-muted)]">{title}</h3>
      </div>
      <div className="min-w-0">
        {loading ? (
          <span className="block h-7 w-24 animate-pulse rounded-md bg-[var(--surface-2)]" aria-hidden="true" />
        ) : (
          <p className={`truncate text-2xl font-black tabular-nums ${TONE_CLASS[tone]}`}>{value}</p>
        )}
        {hint ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p> : null}
      </div>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HomeCard
          icon={<ClipboardCheck size={18} />}
          title={t('تقييماتي وملاحظات الأداء', 'My evaluations')}
          value={unreadEvaluations.length > 0 ? t(`${number(unreadEvaluations.length)} جديد`, `${number(unreadEvaluations.length)} new`) : number(evaluations.length)}
          hint={
            latestEvaluation
              ? `${latestEvaluation.title} · ${date(latestEvaluation.created_at)}`
              : t('لسه مفيش تقييمات — أول ما تتقيّم هتلاقيها هنا.', 'No evaluations yet.')
          }
          action={{ label: t('افتح التقييمات', 'Open evaluations'), onClick: () => onOpenTab('EVALUATIONS') }}
          tone={unreadEvaluations.length > 0 ? 'accent' : 'neutral'}
          loading={false}
        />

        <HomeCard
          icon={<ListChecks size={18} />}
          title={t('مهامي ونقاطي', 'My tasks and points')}
          value={t(`${number(openTasks.length)} مهمة شغالة`, `${number(openTasks.length)} active`)}
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
          value={unreadAnnouncements.length > 0 ? t(`${number(unreadAnnouncements.length)} غير مقروء`, `${number(unreadAnnouncements.length)} unread`) : number(announcements.length)}
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
          tone={activeTeams.length > 0 ? 'accent' : 'neutral'}
          loading={teamsQuery.isLoading}
        />

        <HomeCard
          icon={<Cog size={18} />}
          title={t('الحساب والإعدادات', 'Account and settings')}
          value={profileReady ? t('مكتمل', 'Complete') : t(`ناقص ${number(missingFields)}`, `${number(missingFields)} missing`)}
          hint={
            profileReady
              ? t('بياناتك كاملة — تقدر تعدّل أي وقت.', 'Your profile is complete.')
              : t('كمّل بياناتك عشان تظهر في الفريق وتستلم المهام.', 'Complete your profile to appear in the team.')
          }
          action={{ label: t('افتح الإعدادات', 'Open settings'), to: '/portal/settings' }}
          tone={profileReady ? 'success' : 'warn'}
        />
      </div>
    </section>
  );
}
