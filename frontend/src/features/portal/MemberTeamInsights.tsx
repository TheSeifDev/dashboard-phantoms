import { useMemo, useState } from 'react';
import { Radar } from 'lucide-react';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useCompactViewport } from '../../hooks/useMediaQuery';
import { useLocale } from '../../i18n/useLocale';
import { TaskStreakHeatmap, type PersonInfo } from '../dashboard/TaskStreakHeatmap';
import { ContributionTrendPanel, CrewPulse, Panel } from '../dashboard/DashboardWidgets';
import { getCairoDate } from '../dashboard/taskContributions';
import { buildMemberTeamActivity } from './memberInsights';
import { useMemberTeamInsights } from './useMemberTeamInsights';

/**
 * مساهمات الفريق ونبض الفريق واتجاه المساهمات — نفس مكوّنات لوحة الإدارة
 * بالحرف، بس البيانات جاية من RPC مسموحة للعضو (اعتمادات الفريق من السجل
 * من غير ما العضو يقرأ جدول المهام أو السجل نفسه).
 */
export function MemberTeamInsights() {
  const { t } = useLocale();
  const compact = useCompactViewport();
  const currentYear = Number(getCairoDate().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const years = useMemo(
    () => Array.from({ length: Math.min(currentYear, 5) }, (_, index) => currentYear - index).reverse(),
    [currentYear],
  );
  const query = useMemberTeamInsights(year);
  const activity = useMemo(() => (query.data ? buildMemberTeamActivity(query.data) : null), [query.data]);
  const people = useMemo(() => {
    const map = new Map<number, PersonInfo>();
    for (const person of query.data?.people ?? []) map.set(person.memberId, { name: person.fullName, handle: null });
    return map;
  }, [query.data]);

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
        github={{ linked: 0, connected: 0, failed: 0, loading: 0, enabled: false, onToggle: () => undefined }}
        // تفاصيل اليوم الكاملة (تسليمات/ملاحظات/GitHub) بيانات إدارية؛ خلية العضو بتعرض
        // العدد في الـ tooltip بس، فمفيش درج تفاصيل هنا.
        onOpenDay={() => undefined}
        isRefreshing={query.isPlaceholderData}
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
          <CrewPulse activity={activity} people={people} onOpenDay={() => undefined} compact={compact} />
        </Panel>
        <ContributionTrendPanel contributions={query.data.contributions} activity={activity} compact={compact} />
      </div>
    </div>
  );
}