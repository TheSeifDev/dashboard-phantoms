import { useState } from 'react';
import { BarChart3, ChartBar, PieChart } from 'lucide-react';
import { Bar as RechartsBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Segmented } from '../../dashboard/Segmented';
import { useLocale } from '../../../i18n/useLocale';
import { useIcpcAnalytics } from '../api';
import { Bar, Chip, InlineEmpty, Panel } from '../components/IcpcPanels';
import { DIFFICULTY_LABELS, PLATFORM_LABELS, STATUS_LABELS, type IcpcMode, type ProblemDifficulty, type ProblemStatus } from '../types';

const RANGES = [
  { value: '30', ar: '30 يوم', en: '30 days' },
  { value: '90', ar: '90 يوم', en: '90 days' },
  { value: '180', ar: '6 شهور', en: '6 months' },
] as const;

export function AnalyticsPage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const [days, setDays] = useState(90);
  const analytics = useIcpcAnalytics(mode, days);

  if (analytics.isLoading) return <CardSkeletons count={3} />;
  if (analytics.isError || !analytics.data) {
    return <ErrorState message={(analytics.error as Error | null)?.message ?? t('معرفناش نحمّل التحليلات.', 'Could not load analytics.')} onRetry={() => void analytics.refetch()} />;
  }

  const data = analytics.data;
  const totalSolved = data.by_platform.reduce((sum, entry) => sum + entry.solved, 0);
  const totalDifficulty = data.by_difficulty.reduce((sum, entry) => sum + entry.solved, 0);
  const totalStatus = data.status_breakdown.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={String(days)}
          options={RANGES.map((range) => ({ value: range.value, label: t(range.ar, range.en) }))}
          onChange={(value) => setDays(Number(value))}
          label={t('المدى', 'Range')}
        />
        <Chip tone="primary">{t(`${number(totalSolved)} مسألة محلولة`, `${number(totalSolved)} solved`)}</Chip>
      </div>

      <Panel title={t('المسائل حسب المنصة', 'Solved by platform')} icon={<ChartBar size={15} aria-hidden="true" />}>
        {data.by_platform.length === 0 ? (
          <InlineEmpty>{t('مفيش بيانات في المدى ده.', 'No data in this range.')}</InlineEmpty>
        ) : (
          data.by_platform.map((entry) => (
            <Bar key={entry.platform} label={PLATFORM_LABELS[entry.platform] ?? entry.platform} value={entry.solved} total={Math.max(1, totalSolved)} suffix={t('مسألة', 'solved')} />
          ))
        )}
      </Panel>

      <div className="icpc-grid icpc-grid--split">
        <Panel title={t('الإنتاجية الأسبوعية', 'Weekly output')} icon={<BarChart3 size={15} aria-hidden="true" />}>
          {data.weekly.length === 0 ? (
            <InlineEmpty>{t('مفيش أسابيع فيها نشاط.', 'No active weeks yet.')}</InlineEmpty>
          ) : (
            <div style={{ width: '100%', height: 220 }} dir="ltr">
              <ResponsiveContainer>
                <BarChart data={data.weekly} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    tickFormatter={(value: string) => date(value, { month: 'short', day: 'numeric' })}
                    stroke="var(--border)"
                    minTickGap={16}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} stroke="var(--border)" allowDecimals={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--text)' }}
                    labelFormatter={(value) => date(String(value))}
                  />
                  <RechartsBar dataKey="solved" name={t('محلولة', 'Solved')} fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={t('التوزيع حسب الصعوبة', 'By difficulty')} icon={<PieChart size={15} aria-hidden="true" />}>
          {data.by_difficulty.length === 0 ? (
            <InlineEmpty>{t('مفيش بيانات.', 'No data.')}</InlineEmpty>
          ) : (
            data.by_difficulty.map((entry) => (
              <Bar
                key={entry.difficulty}
                label={DIFFICULTY_LABELS[entry.difficulty as ProblemDifficulty]?.[locale] ?? entry.difficulty}
                value={entry.solved}
                total={Math.max(1, totalDifficulty)}
              />
            ))
          )}
        </Panel>
      </div>

      <Panel title={t('حالة المسائل في البنك', 'Problem status breakdown')} icon={<BarChart3 size={15} aria-hidden="true" />}>
        {data.status_breakdown.length === 0 ? (
          <InlineEmpty>{t('مفيش تكليفات لسه.', 'No assignments yet.')}</InlineEmpty>
        ) : (
          data.status_breakdown.map((entry) => (
            <Bar
              key={entry.status}
              label={STATUS_LABELS[entry.status as ProblemStatus]?.[locale] ?? entry.status}
              value={entry.total}
              total={Math.max(1, totalStatus)}
            />
          ))
        )}
      </Panel>
    </div>
  );
}
