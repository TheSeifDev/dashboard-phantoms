import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerKind, LedgerStatus } from './types';
import { motionAllowed, tweenNumber, useLedgerEnter } from './animations';
import './ledger.css';

type RangeKey = 'month' | 'quarter' | 'year';
interface InsightEntry {
  amount: number;
  kind: LedgerKind;
  status: LedgerStatus;
  occurred_on: string;
}
interface Bucket {
  key: string;
  label: string;
  collected: number;
  expenses: number;
}
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RANGES: Array<{ key: RangeKey; ar: string; en: string }> = [
  { key: 'month', ar: 'شهري', en: 'Monthly' },
  { key: 'quarter', ar: 'ربع سنوي', en: 'Quarterly' },
  { key: 'year', ar: 'سنوي', en: 'Yearly' },
];

function bucketStarts(range: RangeKey, now: Date): Date[] {
  if (range === 'month') {
    return Array.from({ length: 12 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - (11 - index), 1));
  }
  if (range === 'quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    return Array.from({ length: 8 }, (_, index) => {
      const offset = 7 - index;
      const quarter = currentQuarter - offset;
      const year = now.getFullYear() + Math.floor(quarter / 4);
      const normalized = ((quarter % 4) + 4) % 4;
      return new Date(year, normalized * 3, 1);
    });
  }
  return Array.from({ length: 5 }, (_, index) => new Date(now.getFullYear() - (4 - index), 0, 1));
}

function buildBuckets(entries: InsightEntry[], range: RangeKey, locale: 'ar' | 'en'): Bucket[] {
  const now = new Date();
  const starts = bucketStarts(range, now);
  const buckets: Bucket[] = starts.map((start) => {
    const label = range === 'month'
      ? (locale === 'ar' ? MONTHS_AR[start.getMonth()] : MONTHS_EN[start.getMonth()])
      : range === 'quarter'
        ? `Q${Math.floor(start.getMonth() / 3) + 1} ${String(start.getFullYear()).slice(2)}`
        : String(start.getFullYear());
    return { key: `${start.getFullYear()}-${start.getMonth()}`, label, collected: 0, expenses: 0 };
  });
  const endOf = (start: Date, index: number) => {
    const next = starts[index + 1];
    if (next) return next.getTime();
    if (range === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
    if (range === 'quarter') return new Date(start.getFullYear(), start.getMonth() + 3, 1).getTime();
    return new Date(start.getFullYear() + 1, 0, 1).getTime();
  };
  entries.forEach((entry) => {
    if (entry.status !== 'approved') return;
    const at = new Date(`${entry.occurred_on}T00:00:00`).getTime();
    if (!Number.isFinite(at)) return;
    for (let index = 0; index < starts.length; index += 1) {
      const from = starts[index].getTime();
      if (at >= from && at < endOf(starts[index], index)) {
        if (entry.kind === 'payment') buckets[index].collected += Number(entry.amount) || 0;
        else if (entry.kind === 'expense') buckets[index].expenses += Number(entry.amount) || 0;
        return;
      }
    }
  });
  return buckets;
}

function plainNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
}

/**
 * Charts للخزنة: أعمدة الحركة الشهرية (زي المرجع الأخضر) + حلقة توزيع التحصيل
 * اللي في نصها «الباقي» وتحتيه «المدفوع» رمادي مشطوب.
 */
export function LedgerInsights({
  entries,
  paidTotal,
  remainingTotal,
  expectedTotal,
  variant,
}: {
  entries: InsightEntry[];
  paidTotal: number;
  remainingTotal: number;
  expectedTotal: number;
  variant: 'admin' | 'member';
}) {
  const { t, locale, dir } = useLocale();
  const [range, setRange] = useState<RangeKey>('month');
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const remainingRef = useRef<HTMLElement>(null);
  const paidRef = useRef<HTMLElement>(null);
  const buckets = useMemo(() => buildBuckets(entries, range, locale === 'ar' ? 'ar' : 'en'), [entries, range, locale]);
  const max = Math.max(...buckets.map((bucket) => bucket.collected), 1);
  const activeIndex = buckets.reduce((best, bucket, index) => (bucket.collected > buckets[best].collected ? index : best), 0);
  const active = buckets[activeIndex];
  const previous = buckets[activeIndex - 1];
  const delta = previous && previous.collected > 0
    ? Math.round(((active.collected - previous.collected) / previous.collected) * 100)
    : null;
  const totalCollected = buckets.reduce((sum, bucket) => sum + bucket.collected, 0);
  const average = buckets.length > 0 ? totalCollected / buckets.length : 0;
  const expected = Math.max(expectedTotal, 0);
  const paid = Math.max(paidTotal, 0);
  const remaining = Math.max(remainingTotal, 0);
  const ratio = expected > 0 ? Math.min(paid / expected, 1) : 0;
  const paidPercent = expected > 0 ? Math.round(ratio * 100) : 0;
  const leftPercent = expected > 0 ? 100 - paidPercent : 0;

  useLedgerEnter(rootRef, [range]);

  // Bars grow from the baseline, then the highlighted value chip settles in.
  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = chart.querySelectorAll<HTMLElement>('.ldg-chart-bar');
    const chips = chart.querySelectorAll<HTMLElement>('.ldg-chart-chip');
    if (!motionAllowed() || bars.length === 0) return;
    const timeline = gsap.timeline();
    timeline.fromTo(
      bars,
      { scaleY: 0.02, opacity: 0.4 },
      { scaleY: 1, opacity: 1, duration: 0.72, stagger: 0.035, ease: 'power3.out', transformOrigin: 'bottom center' },
    );
    if (chips.length > 0) {
      timeline.fromTo(chips, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, '-=0.25');
    }
    return () => { timeline.kill(); };
  }, [range, buckets.length, activeIndex]);

  // Ring draws itself and the two numbers count up.
  useLayoutEffect(() => {
    const circle = ringRef.current;
    if (!circle) return;
    const circumference = Number(circle.getAttribute('r')) * 2 * Math.PI;
    const target = circumference * (1 - ratio);
    const cleanupNumbers = [
      tweenNumber(remaining, (value) => { if (remainingRef.current) remainingRef.current.textContent = plainNumber(value); }),
      tweenNumber(paid, (value) => { if (paidRef.current) paidRef.current.textContent = plainNumber(value); }, 1.05),
    ];
    if (!motionAllowed()) {
      circle.style.strokeDashoffset = String(target);
      return () => cleanupNumbers.forEach((stop) => stop());
    }
    gsap.fromTo(
      circle,
      { strokeDashoffset: circumference },
      { strokeDashoffset: target, duration: 1.15, ease: 'power2.out' },
    );
    return () => cleanupNumbers.forEach((stop) => stop());
  }, [ratio, paid, remaining]);

  return (
    <section className="ldg-insights" aria-label={t('رسوم الخزنة', 'Ledger charts')} dir={dir} ref={rootRef}>
      <article className="ldg-card ldg-chart-card" data-ldg-enter>
        <header className="ldg-card-head">
          <div>
            <span className="ldg-card-kicker"><Sparkles size={14} aria-hidden="true" /> {t('حركة الخزنة', 'Ledger movement')}</span>
            <h3>{t(variant === 'admin' ? 'التحصيل على مدار الفترة' : 'مدفوعاتك على مدار الفترة', variant === 'admin' ? 'Collections over time' : 'Your payments over time')}</h3>
          </div>
          <div className="ldg-range" role="group" aria-label={t('مدى الرسم', 'Chart range')}>
            {RANGES.map((item) => (
              <button key={item.key} type="button" aria-pressed={range === item.key} onClick={() => setRange(item.key)}>
                {t(item.ar, item.en)}
              </button>
            ))}
          </div>
        </header>
        <div className="ldg-chart" ref={chartRef} style={{ '--ldg-cols': String(buckets.length) } as CSSProperties}>
          {buckets.map((bucket, index) => {
            const height = Math.max(bucket.collected > 0 ? 6 : 2, Math.round((bucket.collected / max) * 100));
            const isActive = index === activeIndex && bucket.collected > 0;
            return (
              <div key={bucket.key} className={`ldg-chart-col${isActive ? ' is-active' : ''}`}>
                <div className="ldg-chart-track" style={{ '--ldg-h': `${height}` } as CSSProperties}>
                  <span className="ldg-chart-bar" />
                  {isActive && <span className="ldg-chart-chip">{plainNumber(bucket.collected)}</span>}
                </div>
                <span className="ldg-chart-x">{bucket.label}</span>
              </div>
            );
          })}
        </div>
        <footer className="ldg-chart-foot">
          <span className="ldg-chart-badge" data-tone={delta === null ? 'flat' : delta >= 0 ? 'up' : 'down'}>
            {delta === null || delta === 0
              ? <ArrowUpRight size={13} aria-hidden="true" />
              : delta > 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
            {delta === null
              ? t('أول فترة', 'First period')
              : <span dir="ltr">{`${delta > 0 ? '+' : ''}${delta}%`}</span>}
          </span>
          <span className="ldg-chart-foot-label">
            {t(`أعلى ${range === 'year' ? 'سنة' : range === 'quarter' ? 'ربع' : 'شهر'}: ${active.label}`, `Top ${range === 'year' ? 'year' : range === 'quarter' ? 'quarter' : 'month'}: ${active.label}`)}
          </span>
          <span className="ldg-chart-foot-total">
            {t('إجمالي الفترة', 'Period total')} <strong>{plainNumber(totalCollected)}</strong>
          </span>
        </footer>
      </article>

      <article className="ldg-card ldg-ring-card" data-ldg-enter>
        <header className="ldg-card-head">
          <div>
            <span className="ldg-card-kicker">{t('توزيع التحصيل', 'Collection split')}</span>
            <h3>{t('الباقي مقابل المدفوع', 'Remaining vs paid')}</h3>
          </div>
          <span className="ldg-pill">{plainNumber(expected)} {t('إجمالي', 'total')}</span>
        </header>
        {expected <= 0 ? (
          <p className="ldg-ring-empty">
            {t('لسه مفيش التزامات محددة على الأعضاء — أول ما تضيف التزامات هتشوف هنا نسبة التحصيل.', 'No dues are set for members yet — the collection ring appears once you add dues.')}
          </p>
        ) : (
          <>
            <div className="ldg-ring-wrap">
              <svg className="ldg-ring" viewBox="0 0 160 160" role="img" aria-label={t(`اتحصل ${paidPercent}% من إجمالي ${plainNumber(expected)}`, `${paidPercent}% of ${plainNumber(expected)} collected`)}>
                <circle className="ldg-ring-track" cx="80" cy="80" r="62" />
                <circle
                  ref={ringRef}
                  className="ldg-ring-value"
                  cx="80"
                  cy="80"
                  r="62"
                  strokeDasharray={String(2 * Math.PI * 62)}
                  strokeDashoffset={String(2 * Math.PI * 62)}
                />
              </svg>
              <div className="ldg-ring-center">
                <small>{t('الباقي', 'Remaining')}</small>
                <strong ref={remainingRef}>{plainNumber(remaining)}</strong>
                <span className="ldg-ring-currency">{t('ج.م', 'EGP')}</span>
                <span className="ldg-ring-paid">
                  <span>{t('مدفوع', 'paid')}</span> <s ref={paidRef}>{plainNumber(paid)}</s>
                </span>
              </div>
            </div>
            <ul className="ldg-legend">
              <li><i className="is-paid" aria-hidden="true" /> {t('مدفوع', 'Paid')} <strong>{paidPercent}%</strong></li>
              <li><i className="is-left" aria-hidden="true" /> {t('باقي', 'Remaining')} <strong>{leftPercent}%</strong></li>
              <li><i className="is-avg" aria-hidden="true" /> {t('متوسط الفترة', 'Period average')} <strong>{plainNumber(average)}</strong></li>
            </ul>
          </>
        )}
      </article>
    </section>
  );
}
