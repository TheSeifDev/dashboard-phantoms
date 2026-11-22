import { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, X } from 'lucide-react';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useCompactViewport } from '../../hooks/useMediaQuery';
import { useLocale } from '../../i18n/useLocale';
import { TaskStreakHeatmap, type PersonInfo } from '../dashboard/TaskStreakHeatmap';
import { ContributionTrendPanel, CrewPulse, Panel } from '../dashboard/DashboardWidgets';
import { PersonAvatar } from '../dashboard/PersonAvatar';
import { GithubMark } from '../dashboard/GithubMark';
import { readGithubSyncPreference, writeGithubSyncPreference } from '../dashboard/github';
import { getCairoDate } from '../dashboard/taskContributions';
import { useGithubTeamCalendars } from '../dashboard/useGithubTeam';
import type { GithubLink } from '../dashboard/teamActivity';
import { buildMemberTeamActivity } from './memberInsights';
import { useMemberTeamInsights } from './useMemberTeamInsights';

/** ملخص اليوم للعضو: اعتمادات اليوم + مساهمات GitHub بالأسماء والأفاتار (مفيش بيانات إدارية). */
function MemberDaySummary({ date, approvals, shares, people, onClose }: {
  date: string;
  approvals: number;
  shares: Array<{ memberId: number; handle: string; count: number }>;
  people: ReadonlyMap<number, PersonInfo>;
  onClose: () => void;
}) {
  const { t, number, date: formatDate } = useLocale();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const githubTotal = shares.reduce((total, share) => total + share.count, 0);
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--graphite-900)_55%,transparent)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t(`تفاصيل ${date}`, `Details for ${date}`)}
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h3 className="text-base font-black">{formatDate(new Date(`${date}T12:00:00.000Z`), { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {t(`${number(approvals)} اعتماد · ${number(githubTotal)} مساهمة GitHub`, `${number(approvals)} approvals · ${number(githubTotal)} GitHub contributions`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--glass-hairline)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-bg-soft)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={t('إغلاق', 'Close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {shares.length > 0 ? (
          <ul className="mt-4 grid gap-2">
            {shares.map((share) => {
              const person = people.get(share.memberId);
              return (
                <li key={`${share.memberId}-${share.handle}`} className="flex items-center gap-3 rounded-xl border border-[var(--glass-hairline)] px-3 py-2">
                  <PersonAvatar id={share.memberId} name={person?.name ?? share.handle} handle={share.handle} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{person?.name ?? share.handle}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-black text-[var(--text-secondary)]">
                    <GithubMark size={13} />{number(share.count)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {t('مفيش مساهمات GitHub مسجّلة في اليوم ده.', 'No GitHub contributions recorded on this day.')}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * مساهمات الفريق ونبض الفريق واتجاه المساهمات — نفس مكوّنات لوحة الإدارة
 * بالحرف، بس البيانات جاية من RPC مسموحة للعضو (اعتمادات الفريق من السجل
 * من غير ما العضو يقرأ جدول المهام أو السجل نفسه)، ومساهمات GitHub بتتجاب
 * من التقويم العام للحسابات المربوطة زي ما الإدارة بتعمل بالظبط.
 */
export function MemberTeamInsights() {
  const { t } = useLocale();
  const compact = useCompactViewport();
  const currentYear = Number(getCairoDate().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [githubEnabled, setGithubEnabled] = useState(readGithubSyncPreference);
  const years = useMemo(
    () => Array.from({ length: Math.min(currentYear, 5) }, (_, index) => currentYear - index).reverse(),
    [currentYear],
  );
  const query = useMemberTeamInsights(year);
  const links = useMemo<GithubLink[]>(
    () => (query.data?.roster ?? []).map((person) => ({ memberId: person.memberId, handle: person.githubHandle })),
    [query.data],
  );
  const github = useGithubTeamCalendars(links, year, currentYear, githubEnabled && links.length > 0);
  const activity = useMemo(
    () => (query.data ? buildMemberTeamActivity(query.data, { calendars: github.calendars, enabled: githubEnabled }) : null),
    [query.data, github.calendars, githubEnabled],
  );
  const people = useMemo(() => {
    const map = new Map<number, PersonInfo>();
    for (const person of query.data?.roster ?? []) map.set(person.memberId, { name: person.fullName, handle: person.githubHandle });
    for (const person of query.data?.people ?? []) {
      const known = map.get(person.memberId);
      map.set(person.memberId, { name: person.fullName, handle: known?.handle ?? person.githubHandle });
    }
    return map;
  }, [query.data]);
  const toggleGithub = useCallback(() => {
    setGithubEnabled((value) => {
      writeGithubSyncPreference(!value);
      return !value;
    });
  }, []);
  const openDay = useCallback((date: string) => setOpenDate(date), []);
  const closeDay = useCallback(() => setOpenDate(null), []);

  if (query.isLoading || !query.data || !activity) {
    if (query.isError) {
      return (
        <ErrorState
          message={t('معرفناش نحمّل مساهمات الفريق. جرّب تاني بعد شوية.', 'We could not load team contributions. Please try again shortly.')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return <CardSkeletons count={2} />;
  }

  const openDayData = openDate ? activity.byDate.get(openDate) : undefined;

  return (
    <div className="grid gap-5" data-testid="member-team-insights">
      <TaskStreakHeatmap
        contributions={query.data.contributions}
        activity={activity}
        year={year}
        memberName={null}
        years={years}
        memberOptions={[]}
        selectedMemberId={null}
        onYearChange={setYear}
        onMemberChange={() => undefined}
        people={people}
        github={{
          linked: links.length,
          connected: github.connected,
          failed: github.failed,
          loading: github.loading,
          enabled: githubEnabled,
          onToggle: toggleGithub,
        }}
        onOpenDay={openDay}
        isRefreshing={query.isPlaceholderData || github.isFetching}
        compact={compact}
      />

      <div className="dashboard-bento">
        <Panel
          className="bento-pulse"
          title={t('نبض الفريق', 'Team pulse')}
          subtitle={t('الأكثر اعتمادًا هذا العام', 'Most approvals this year')}
          icon={<Radar size={18} />}
          tone="violet"
        >
          <CrewPulse activity={activity} people={people} onOpenDay={openDay} compact={compact} />
        </Panel>
        <ContributionTrendPanel contributions={query.data.contributions} activity={activity} compact={compact} />
      </div>

      {openDate ? (
        <MemberDaySummary
          date={openDate}
          approvals={openDayData?.approvals ?? 0}
          shares={openDayData?.githubBy ?? []}
          people={people}
          onClose={closeDay}
        />
      ) : null}
    </div>
  );
}