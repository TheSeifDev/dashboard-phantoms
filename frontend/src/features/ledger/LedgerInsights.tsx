import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import type { LedgerSeriesPoint } from './types';
import { motionAllowed, tweenNumber, useLedgerEnter } from './animations';
import { plainNumber } from './types';
import './ledger.css';

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(month: string, locale: 'ar' | 'en'): string {
  const [, raw] = month.split('-');
  const index = Number(raw) - 1;
  if (!Number.isFinite(index) || index < 0 || index > 11) return month;
  return locale === 'ar' ? MONTHS_AR[index] : MONTHS_EN[index];
}

/**
 * Charts الخزنة: أعمدة التحصيل لآخر 6 شهور (من غير أي تابات مدى زمني)
 * + حلقة توزيع التحصيل اللي في نصها «الباقي» وتحتيه «المدفوع» رمادي مشطوب.
 */
export function LedgerInsights({
  series,
  paidTotal,
  remainingTotal,
  expectedTotal,
  variant,
}: {
  series: LedgerSeriesPoint[];
  paidTotal: number;
  remainingTotal: number;
  expectedTotal: number;
  variant: 'admin' | 'member';
}) {
  const { t, locale, dir } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const remainingRef = useRef<HTMLElement>(null);
  const paidRef = useRef<HTMLElement>(null);

  const buckets = useMemo(
    () => series.map((point) => ({
      key: point.month,
      label: monthLabel(point.month, locale === 'ar' ? 'ar' : 'en'),
      collected: Number(point.collected) || 0,
      expenses: Number(point.expenses) || 0,
    })),
    [series, locale],
  );
  const max = Math.max(...buckets.map((bucket) => Math.max(bucket.collected, bucket.expenses)), 1);
  const activeIndex = buckets.reduce((best, bucket, index) => (bucket.collected > buckets[best].collected ? index : best), 0);
  const active = buckets[activeIndex] ?? { key: '', label: '—', collected: 0, expenses: 0 };
  const previous = buckets[activeIndex - 1];
  const delta = previous && previous.collected > 0
    ? Math.round(((active.collected - previous.collected) / previous.collected) * 100)
    : null;
  const totalCollected = buckets.reduce((sum, bucket) => sum + bucket.collected, 0);
  const totalExpenses = buckets.reduce((sum, bucket) => sum + bucket.expenses, 0);
  const average = buckets.length > 0 ? totalCollected / buckets.length : 0;
  const expected = Math.max(expectedTotal, 0);
  const paid = Math.max(paidTotal, 0);
  const remaining = Math.max(remainingTotal, 0);
  const ratio = expected > 0 ? Math.min(paid / expected, 1) : 0;
  const paidPercent = expected > 0 ? Math.round(ratio * 100) : 0;
  const leftPercent = expected > 0 ? 100 - paidPercent : 0;

  useLedgerEnter(rootRef, [buckets.length]);

  // الأعمدة تطلع من الخط الأرضي، وبعدها الشيب بيتثبت.
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
      { scaleY: 1, opacity: 1, duration: 0.72, stagger: 0.045, ease: 'power3.out', transformOrigin: 'bottom center' },
    );
    if (chips.length > 0) {
      timeline.fromTo(chips, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, '-=0.25');
    }
    return () => { timeline.kill(); };
  }, [buckets.length, activeIndex]);

  // الحلقة بترسم نفسها والأرقام بتعد لحد قيمتها.
  useLayoutEffect(() => {
    const circle = ringRef.current;
    if (!circle) return;
    const circumference = Number(circle.getAttribute('r')) * 2 * Math.PI;
    const target = circumference * (1 - ratio);
    const cleanupNumbers = [
      tweenNumber(remaining, (value) => { if (remainingRef.current) remainingRef.current.textContent = plainNumber(Math.round(value)); }),
      tweenNumber(paid, (value) => { if (paidRef.current) paidRef.current.textContent = plainNumber(Math.round(value)); }, 1.05),
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
            <h3>{t(variant === 'admin' ? 'التحصيل في آخر 6 شهور' : 'مدفوعاتك في آخر 6 شهور', variant === 'admin' ? 'Collections over the last 6 months' : 'Your payments over the last 6 months')}</h3>
          </div>
        </header>
        <div className="ldg-chart" ref={chartRef} style={{ '--ldg-cols': String(Math.max(buckets.length, 1)) } as CSSProperties}>
          {buckets.map((bucket, index) => {
            const height = Math.max(bucket.collected > 0 ? 6 : 2, Math.round((bucket.collected / max) * 100));
            const expenseHeight = Math.max(bucket.expenses > 0 ? 4 : 1, Math.round((bucket.expenses / max) * 100));
            const isActive = index === activeIndex && bucket.collected > 0;
            return (
              <div key={bucket.key} className={`ldg-chart-col${isActive ? ' is-active' : ''}`}>
                <div className="ldg-chart-track" style={{ '--ldg-h': `${height}`, '--ldg-h2': `${expenseHeight}` } as CSSProperties}>
                  <span className="ldg-chart-bar" />
                  <span className="ldg-chart-bar ldg-chart-bar--expense" aria-hidden="true" />
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
              ? t('أول شهر', 'First month')
              : <span dir="ltr">{`${delta > 0 ? '+' : ''}${delta}%`}</span>}
          </span>
          <span className="ldg-chart-foot-label">
            {t(`أعلى شهر: ${active.label}`, `Top month: ${active.label}`)}
          </span>
          <span className="ldg-chart-foot-total">
            {t('إجمالي الفترة', 'Period total')} <strong>{plainNumber(totalCollected)}</strong>
          </span>
          <span className="ldg-chart-foot-label">
            {t('مصروفات الفترة', 'Period expenses')} <strong className="ldg-chart-foot-strong">{plainNumber(totalExpenses)}</strong>
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
            {t('لسه مفيش التزامات محددة — أول ما تتضاف هتشوف هنا نسبة التحصيل.', 'No dues are set yet — the collection ring appears once dues are added.')}
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
              <li><i className="is-avg" aria-hidden="true" /> {t('متوسط الشهر', 'Monthly average')} <strong>{plainNumber(average)}</strong></li>
            </ul>
          </>
        )}
      </article>
    </section>
  );
}
