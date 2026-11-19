import { useMemo, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Flame, ShieldCheck } from 'lucide-react';
import { buildContributionCalendar, calculateContributionStreaks, contributionCoverageDate, type TaskContributions } from './taskContributions';
import { useLocale } from '../../i18n/useLocale';

gsap.registerPlugin(useGSAP);

interface TaskStreakHeatmapProps {
  contributions: TaskContributions;
  year: number;
  memberName: string | null;
  years: number[];
  memberOptions: Array<{ id: number; name: string }>;
  selectedMemberId: number | null;
  onYearChange: (year: number) => void;
  onMemberChange: (memberId: number | null) => void;
}

function dayDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function TaskStreakHeatmap({
  contributions,
  year,
  memberName,
  years,
  memberOptions,
  selectedMemberId,
  onYearChange,
  onMemberChange,
}: TaskStreakHeatmapProps) {
  const { locale, t, number, date } = useLocale();
  const root = useRef<HTMLElement>(null);
  const coverageSince = contributionCoverageDate(contributions.history_complete_since);
  const calendar = useMemo(() => buildContributionCalendar(year, contributions.days, contributions.today, coverageSince), [year, contributions.days, contributions.today, coverageSince]);
  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cells = root.current?.querySelectorAll('[data-contribution-date]');
    if (!cells?.length) return;
    gsap.from(cells, { opacity: 0.55, scale: 0.85, duration: 0.3, stagger: { amount: 0.55 }, ease: 'power2.out', clearProps: 'opacity,transform' });
  }, { scope: root, dependencies: [year, selectedMemberId], revertOnUpdate: true });
  const streaks = useMemo(
    () => calculateContributionStreaks(contributions.days, contributions.today),
    [contributions.days, contributions.today],
  );
  const isCurrentYear = year === Number(contributions.today.slice(0, 4));
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const shortMonth = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' });
  const monthName = (month: number) => shortMonth.format(new Date(Date.UTC(year, month, 1, 12)));
  const sundayFirstLabels = locale === 'ar'
    ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dayLabels = calendar
    ? Array.from({ length: 7 }, (_, index) => sundayFirstLabels[(calendar.weekStart + index) % 7])
    : sundayFirstLabels;
  const tabStopDate = focusedDate?.startsWith(`${year}-`)
    ? focusedDate
    : contributions.today.startsWith(`${year}-`) ? contributions.today : `${year}-01-01`;

  return (
    <section ref={root} className="dashboard-panel dashboard-heatmap-panel dashboard-reveal" data-testid="dashboard-contributions" aria-labelledby="dashboard-heatmap-title">
      <header className="dashboard-panel-header dashboard-heatmap-header">
        <div>
          <p className="dashboard-eyebrow">{t('سجل اعتماد المهام', 'Task approval activity')}</p>
          <h2 id="dashboard-heatmap-title" className="dashboard-panel-title">{t('مساهمات الفريق', 'Team contributions')}</h2>
          <p className="dashboard-panel-subtitle">
            {memberName
              ? t(`اعتمادات ${memberName}`, `Approvals by ${memberName}`)
              : t('كل اعتماد إداري يُحتسب كنشاط في يومه بتوقيت القاهرة.', 'Each administrative approval is recorded on its Cairo-local day.')}
          </p>
        </div>
        <div className="dashboard-heatmap-controls">
          <label className="dashboard-select-wrap">
            <span>{t('السنة', 'Year')}</span>
            <select aria-label={t('سنة سجل المساهمات', 'Contribution year')} value={year} onChange={(event) => onYearChange(Number(event.currentTarget.value))}>
              {years.map((item) => <option key={item} value={item}>{number(item)}</option>)}
            </select>
          </label>
          <label className="dashboard-select-wrap">
            <span>{t('النطاق', 'Scope')}</span>
            <select
              aria-label={t('اختيار عضو لسجل المساهمات', 'Select a member for the contribution history')}
              value={selectedMemberId ?? ''}
              onChange={(event) => onMemberChange(event.currentTarget.value ? Number(event.currentTarget.value) : null)}
            >
              <option value="">{t('الفريق كله', 'Entire team')}</option>
              {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="dashboard-contribution-summary" aria-live="polite">
        <div className="dashboard-contribution-total">
          <span className="dashboard-contribution-number">{number(contributions.total_approvals)}</span>
          <span>{t('حدث اعتماد خلال السنة المحددة', 'approval events in selected year')}</span>
        </div>
        <div className="dashboard-streaks">
          <div className="dashboard-streak">
            <span className="dashboard-streak-icon dashboard-streak-icon-current"><Flame size={16} aria-hidden="true" /></span>
            <span><strong>{isCurrentYear && streaks ? number(streaks.current) : '—'}</strong><small>{isCurrentYear ? t('الحالية داخل السنة', 'current within this year') : t('الحالية للسنة الحالية فقط', 'current year only')}</small></span>
          </div>
          <div className="dashboard-streak">
            <span className="dashboard-streak-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
            <span><strong>{streaks ? number(streaks.best) : '—'}</strong><small>{t('الأفضل المسجلة في السنة', 'best observed in year')}</small></span>
          </div>
        </div>
      </div>

      {calendar ? (
        <div className="dashboard-heatmap-scroll" dir="ltr" aria-label={t('تقويم اعتمادات السنة', 'Calendar of approvals for the year')}>
          <div className="dashboard-heatmap-inner" style={{ '--dashboard-week-count': calendar.weeks.length } as CSSProperties}>
            <div className="dashboard-heatmap-months" aria-hidden="true">
              {calendar.monthLabels.map(({ weekIndex, month }) => (
                <span key={month} style={{ gridColumnStart: weekIndex + 1 }}>{monthName(month)}</span>
              ))}
            </div>
            <div className="dashboard-heatmap-body">
              <div className="dashboard-heatmap-weekdays" aria-hidden="true">
                {dayLabels.map((label, index) => <span key={`${label}-${index}`}>{index % 2 === 0 ? label : ''}</span>)}
              </div>
              <div className="dashboard-heatmap-weeks">
                {calendar.weeks.map((week, weekIndex) => (
                  <div className="dashboard-heatmap-week" key={week[0]?.date ?? weekIndex}>
                    {week.map((day) => {
                      if (!day.inSelectedYear || day.isFuture) return <span className="dashboard-heatmap-cell dashboard-heatmap-padding" key={day.date} aria-hidden="true" />;
                      const countLabel = day.count === 1 ? t('اعتماد واحد', '1 approval') : t(`${number(day.count)} اعتمادات`, `${number(day.count)} approvals`);
                      const label = `${date(dayDate(day.date), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}: ${day.isUntracked && day.count === 0 ? t('التاريخ غير مكتمل؛ النشاط غير معروف', 'Incomplete history; activity unknown') : countLabel}${day.isUntracked && day.count > 0 ? t(' · اعتمادات مرصودة في فترة غير مكتملة', ' · observed approvals in an incomplete period') : ''}`;
                      return (
                        <button
                          className="dashboard-heatmap-cell"
                          type="button"
                          key={day.date}
                          data-level={day.level}
                          data-untracked={day.isUntracked ? 'true' : undefined}
                          data-today={day.date === contributions.today ? 'true' : undefined}
                          data-contribution-date={day.date}
                          aria-label={label}
                          title={label}
                          tabIndex={day.date === tabStopDate ? 0 : -1}
                          onFocus={() => setFocusedDate(day.date)}
                          onKeyDown={(event) => {
                            const keyOffsets: Record<string, number> = {
                              ArrowRight: 7,
                              ArrowLeft: -7,
                              ArrowDown: 1,
                              ArrowUp: -1,
                            };
                            const offset = keyOffsets[event.key];
                            if (offset === undefined) return;
                            event.preventDefault();
                            const targetDate = new Date(`${day.date}T12:00:00.000Z`);
                            targetDate.setUTCDate(targetDate.getUTCDate() + offset);
                            const nextDate = targetDate.toISOString().slice(0, 10);
                            const next = event.currentTarget.closest('.dashboard-heatmap-body')?.querySelector<HTMLButtonElement>(`[data-contribution-date="${nextDate}"]`);
                            next?.focus();
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="dashboard-inline-error" role="alert">{t('سجل المساهمات وصل بصيغة غير صالحة.', 'Contribution history has an invalid format.')}</p>
      )}

      <div className="dashboard-heatmap-footer">
        <span>{t('أقل', 'Less')}</span>
        {[0, 1, 2, 3, 4].map((level) => <span key={level} className="dashboard-heatmap-cell dashboard-heatmap-legend" data-level={level} aria-hidden="true" />)}
        <span>{t('أكثر', 'More')}</span>
        <span className="dashboard-heatmap-cell dashboard-heatmap-legend" data-untracked="true" aria-hidden="true" /><span>{t('تاريخ غير مكتمل', 'Incomplete history')}</span>
      </div>

      <aside className="dashboard-history-note">
        <strong>{t('حدود السجل التاريخي', 'About historical coverage')}</strong>
        <p>
          {contributions.tracking_started_at
            ? t(`بدأ تسجيل الأحداث في ${date(contributions.tracking_started_at, { year: 'numeric', month: 'long', day: 'numeric' })}.`, `Event tracking began on ${date(contributions.tracking_started_at, { year: 'numeric', month: 'long', day: 'numeric' })}.`)
            : t('لم يرد تاريخ بداية التسجيل من الخادم.', 'The server did not report when event tracking began.')}
          {' '}
          {contributions.history_complete_since && t(`التسجيل الموثوق يبدأ من ${date(contributions.history_complete_since, { year: 'numeric', month: 'long', day: 'numeric' })}.`, `Reliable event capture starts on ${date(contributions.history_complete_since, { year: 'numeric', month: 'long', day: 'numeric' })}.`)}
          {' '}
          {t('يُحتسب حدث الاعتماد مرة واحدة؛ الإلغاء لا يضيف اعتمادًا ولا يخصم الحدث السابق. لا يمكن استعادة الاعتمادات الملغاة قبل بدء السجل. الحالة الحالية للمهمة ليست سجل أحداث.', 'Each approval event is counted once; a revocation adds no approval and does not subtract the earlier event. Approvals revoked before event tracking began cannot be reconstructed. Current task status is not an event history.')}
          {' '}{t('السلاسل للأيام المرصودة داخل السنة المحددة فقط، ولا تمتد عبر حدود السنة.', 'Streaks use observed days within the selected year only and do not extend across year boundaries.')}
        </p>
      </aside>
    </section>
  );
}
