import { useMemo } from 'react';
import { useLocale } from '../../../i18n/useLocale';
import type { HeatDay } from '../types';

const DAY_MS = 86_400_000;

function toKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function levelOf(problems: number, contests: number) {
  const score = problems + contests * 3;
  if (score === 0) return 0;
  if (score <= 2) return 1;
  if (score <= 5) return 2;
  if (score <= 9) return 3;
  return 4;
}

/** شبكة أسابيع × 7 أيام بشكل سداسي، بنفس هوية PHANTOMS. */
export function ActivityHeatmap({ days, weeks = 26 }: { days: HeatDay[]; weeks?: number }) {
  const { t, date } = useLocale();

  const model = useMemo(() => {
    const byDay = new Map(days.map((entry) => [entry.day, entry]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - (weeks * 7 - 1) * DAY_MS);
    // نبدأ من أول السبت قبل بداية المدى عشان الأعمدة تبقى أسابيع كاملة.
    const offset = (start.getUTCDay() + 1) % 7;
    start.setTime(start.getTime() - offset * DAY_MS);

    const columns: Array<{ key: string; month: string; cells: Array<{ day: string; problems: number; contests: number }> }> = [];
    let cursor = new Date(start);
    let lastMonth = '';
    while (cursor <= today) {
      const cells: Array<{ day: string; problems: number; contests: number }> = [];
      for (let index = 0; index < 7; index += 1) {
        const key = toKey(cursor);
        const entry = byDay.get(key);
        cells.push({ day: key, problems: entry?.problems ?? 0, contests: entry?.contests ?? 0 });
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
      const first = cells[0].day;
      const month = date(first, { month: 'short' });
      columns.push({ key: first, month: month === lastMonth ? '' : month, cells });
      lastMonth = month;
    }
    return columns;
  }, [days, weeks, date]);

  return (
    <div>
      <div className="icpc-heat" role="img" aria-label={t('خريطة نشاط التدريب اليومي', 'Daily training activity map')}>
        <div className="icpc-heat-weeks">
          {model.map((column) => (
            <div key={column.key} className="icpc-heat-week">
              <span className="icpc-heat-legend" style={{ height: 14, margin: 0 }}>{column.month}</span>
              {column.cells.map((cell) => {
                const level = levelOf(cell.problems, cell.contests);
                const label = t(
                  `${date(cell.day)} — ${cell.problems} مسألة، ${cell.contests} مسابقة`,
                  `${date(cell.day)} — ${cell.problems} solved, ${cell.contests} contests`,
                );
                return <span key={cell.day} className="icpc-hex" data-level={level} title={label} aria-label={label} />;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="icpc-heat-legend">
        <span>{t('أقل', 'Less')}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className="icpc-hex" data-level={level} aria-hidden="true" />
        ))}
        <span>{t('أكثر', 'More')}</span>
      </div>
    </div>
  );
}
