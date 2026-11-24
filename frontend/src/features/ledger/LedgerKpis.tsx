import type { LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '../../components/motion/AnimatedNumber';
import { useLocale } from '../../i18n/useLocale';
import { Sparkline, type Tone } from '../dashboard/DashboardMetrics';
import { plainNumber } from './types';
import './ledger.css';

export interface LedgerKpiTile {
  key: string;
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
  series: number[];
}

export interface LedgerStatItem {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

/**
 * كروت الخزنة: رقم عادي كبير + sparkline زي كروت الـ home page بالظبط
 * (نفس مكوّن Sparkline ونفس التوكنز، بدون أي لون أخضر).
 */
export function LedgerKpiGrid({ tiles }: { tiles: LedgerKpiTile[] }) {
  return (
    <section className="ldg-kpis" aria-label="مؤشرات الخزنة">
      {tiles.map((tile) => (
        <article key={tile.key} className="ldg-kpi glass-card" data-tone={tile.tone} data-ldg-enter>
          <div className="ldg-kpi-head">
            <span className="ldg-kpi-icon" aria-hidden="true"><tile.icon size={18} /></span>
            <span className="ldg-kpi-title">{tile.title}</span>
          </div>
          <strong className="ldg-kpi-value">
            <AnimatedNumber value={Math.round(tile.value)} format={plainNumber} />
          </strong>
          <Sparkline values={tile.series} tone={tile.tone} />
          <span className="ldg-kpi-detail">{tile.detail}</span>
        </article>
      ))}
    </section>
  );
}

/** الأرقام المساعدة: أرقام عادية بدون chart. */
export function LedgerStatStrip({ items }: { items: LedgerStatItem[] }) {
  const { dir } = useLocale();
  return (
    <section className="ldg-strip" aria-label="أرقام الخزنة" dir={dir} data-ldg-enter>
      {items.map((item) => (
        <div key={item.key} className="ldg-strip-item">
          <span className="ldg-strip-label">{item.label}</span>
          <strong className="ldg-strip-value">{item.value}</strong>
          {item.hint && <small className="ldg-strip-hint">{item.hint}</small>}
        </div>
      ))}
    </section>
  );
}
