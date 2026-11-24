import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../i18n/useLocale';
import { PLATFORM_LABELS, type RatingSeries } from '../types';

const SERIES_COLORS = ['var(--primary)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--accent)'];

/** كل منصة بخطها الخاص — ممنوع دمج تقييمات منصات مختلفة في رقم واحد. */
export function RatingChart({ series }: { series: RatingSeries[] }) {
  const { t, date } = useLocale();

  const { rows, platforms } = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const entry of series) {
      for (const point of entry.points) {
        const row = byDate.get(point.date) ?? { date: point.date };
        row[entry.platform] = point.rating;
        byDate.set(point.date, row);
      }
    }
    return {
      rows: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
      platforms: series.map((entry) => entry.platform),
    };
  }, [series]);

  if (rows.length === 0) {
    return (
      <p className="icpc-empty-inline">
        {t('مفيش تاريخ تقييم مسجّل لسه — اربط حساب المنصة وسجّل أول مسابقة.', 'No rating history yet — link a platform account and log your first contest.')}
      </p>
    );
  }

  return (
    <div style={{ width: '100%', height: 240 }} dir="ltr">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickFormatter={(value: string) => date(value, { month: 'short', day: 'numeric' })}
            stroke="var(--border)"
            minTickGap={28}
          />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} stroke="var(--border)" domain={['auto', 'auto']} width={46} />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              fontSize: 12,
              color: 'var(--text)',
            }}
            labelFormatter={(value) => date(String(value))}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
          {platforms.map((platform, index) => (
            <Line
              key={platform}
              type="monotone"
              dataKey={platform}
              name={PLATFORM_LABELS[platform] ?? platform}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
