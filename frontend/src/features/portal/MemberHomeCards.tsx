import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, ClipboardCheck, ListChecks } from 'lucide-react';
import type { Member, MemberEvaluation, Task } from '../../types/db';
import { isOverdue } from '../../lib/dateUtils';
import { useLocale } from '../../i18n/useLocale';
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
  const kpiTone = tone === 'warn' ? 'red' : tone === 'success' ? 'cyan' : tone === 'accent' ? 'violet' : undefined;
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

/**
 * «نظرة سريعة» على الرئيسية: التقييمات والمهام والمتأخرات بس.
 * الإعلانات بقت مع الإشعارات في الهيدر، والفريق الداخلي ومشروعات الويب
 * والإعدادات ليها مداخل في السايدبار.
 */
export function MemberHomeCards({ member, tasks, evaluations, bonus, onOpenTab }: MemberHomeCardsProps) {
  const { t, number, date } = useLocale();
  const memberId = String(member.id);

  const statusOf = (task: Task) => task.tracking?.[memberId]?.status ?? 'pending';
  const openTasks = tasks.filter((task) => ACTIONABLE.has(statusOf(task)));
  const underReview = tasks.filter((task) => statusOf(task) === 'under_review');
  const approved = tasks.filter((task) => statusOf(task) === 'approved');
  const overdue = openTasks.filter((task) => task.has_deadline && isOverdue(task.deadline_date));

  const unreadEvaluations = evaluations.filter((item) => !item.read_at);
  const latestEvaluation = evaluations[0] ?? null;

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
      </div>
    </section>
  );
}