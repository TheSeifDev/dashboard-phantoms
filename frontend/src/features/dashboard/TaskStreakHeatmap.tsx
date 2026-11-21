import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Box, ClipboardCheck, Flame, Hexagon, Info, MousePointerClick, Trophy, Users } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import { useLocale } from '../../i18n/useLocale';
import { useThemeStore } from '../../store/theme';
import {
  buildContributionCalendar,
  calculateContributionStreaks,
  contributionCoverageDate,
  type ContributionCalendarDay,
  type TaskContributions,
} from './taskContributions';
import type { TeamActivity, TeamDay } from './teamActivity';
import type { SkylineCell } from './HexSkyline3D';
import { GithubMark } from './GithubMark';
import { PersonAvatar } from './PersonAvatar';
import { Segmented } from './Segmented';

const HexSkyline3D = lazy(() => import('./HexSkyline3D'));
const VIEW_PREFERENCE = 'phantoms_contrib_view';
type HeatmapView = 'hex' | '3d';

export interface PersonInfo {
  name: string;
  handle: string | null;
}

export interface GithubControl {
  linked: number;
  connected: number;
  failed: number;
  loading: number;
  enabled: boolean;
  onToggle: () => void;
}

interface TaskStreakHeatmapProps {
  contributions: TaskContributions;
  activity: TeamActivity;
  year: number;
  memberName: string | null;
  years: number[];
  memberOptions: Array<{ id: number; name: string }>;
  selectedMemberId: number | null;
  onYearChange: (year: number) => void;
  onMemberChange: (memberId: number | null) => void;
  people: ReadonlyMap<number, PersonInfo>;
  github: GithubControl;
  onOpenDay: (date: string) => void;
  isRefreshing?: boolean;
}

interface CellModel {
  day: ContributionCalendarDay;
  team: TeamDay | undefined;
  col: number;
  row: number;
}

interface TipState {
  date: string;
  left: number;
  top: number;
  below: boolean;
}

function dayDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function readView(): HeatmapView {
  try { return window.localStorage.getItem(VIEW_PREFERENCE) === '3d' ? '3d' : 'hex'; } catch { return 'hex'; }
}

export function TaskStreakHeatmap({
  contributions,
  activity,
  year,
  memberName,
  years,
  memberOptions,
  selectedMemberId,
  onYearChange,
  onMemberChange,
  people,
  github,
  onOpenDay,
  isRefreshing = false,
}: TaskStreakHeatmapProps) {
  const { locale, t, number, date } = useLocale();
  const theme = useThemeStore((state) => state.theme);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState<HeatmapView>(readView);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const dataYear = contributions.year;
  const coverageSince = contributionCoverageDate(contributions.history_complete_since);
  const calendar = useMemo(
    () => buildContributionCalendar(dataYear, activity.mergedDays, contributions.today, coverageSince),
    [dataYear, activity.mergedDays, contributions.today, coverageSince],
  );
  const streaks = useMemo(
    () => calculateContributionStreaks(activity.mergedDays, contributions.today),
    [activity.mergedDays, contributions.today],
  );
  const isCurrentYear = dataYear === Number(contributions.today.slice(0, 4));
  const cells = useMemo<CellModel[]>(() => {
    if (!calendar) return [];
    const list: CellModel[] = [];
    calendar.weeks.forEach((week, col) => week.forEach((day, row) => {
      if (day.inSelectedYear) list.push({ day, team: activity.byDate.get(day.date), col, row });
    }));
    return list;
  }, [calendar, activity.byDate]);
  const calendarKey = `${dataYear}:${selectedMemberId ?? 'team'}:${github.enabled ? 'gh' : 'ledger'}`;
  const tabStopDate = focusedDate?.startsWith(`${dataYear}-`)
    ? focusedDate
    : contributions.today.startsWith(`${dataYear}-`) ? contributions.today : `${dataYear}-01-01`;

  const shortMonth = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' });
  const monthName = (month: number) => shortMonth.format(new Date(Date.UTC(dataYear, month, 1, 12)));
  const sundayFirstLabels = locale === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayLabels = calendar
    ? Array.from({ length: 7 }, (_, index) => sundayFirstLabels[(calendar.weekStart + index) % 7])
    : sundayFirstLabels;

  const describe = (cell: CellModel) => {
    const { day, team } = cell;
    const total = day.count;
    const approvals = team?.approvals ?? 0;
    const gh = team?.github ?? 0;
    const parts: string[] = [];
    if (day.isUntracked && total === 0) parts.push(t('التاريخ غير مكتمل؛ النشاط غير معروف', 'Incomplete history; activity unknown'));
    else if (total === 0) parts.push(t('لا مساهمات', 'No contributions'));
    else if (gh === 0) parts.push(approvals === 1 ? t('اعتماد واحد', '1 approval') : t(`${number(approvals)} اعتمادات`, `${number(approvals)} approvals`));
    else parts.push(t(`${number(total)} مساهمة (${number(approvals)} اعتماد · ${number(gh)} GitHub)`, `${number(total)} contributions (${number(approvals)} approvals · ${number(gh)} GitHub)`));
    if (team && team.crewSize > 1) parts.push(t(`${number(team.crewSize)} أشخاص شاركوا`, `${number(team.crewSize)} people active`));
    if (team && team.deliveries.length > 0 && total === 0) parts.push(t(`${number(team.deliveries.length)} تسليم بانتظار المراجعة`, `${number(team.deliveries.length)} submissions awaiting review`));
    if (day.isUntracked && total > 0) parts.push(t('اعتمادات مرصودة في فترة غير مكتملة', 'observed approvals in an incomplete period'));
    return `${date(dayDate(day.date), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}: ${parts.join(' · ')}`;
  };

  const grid = useMemo(() => {
    if (!calendar) return null;
    return (
      <div ref={gridRef} className="hex-grid" style={{ '--weeks': calendar.weeks.length } as CSSProperties}>
        {cells.map((cell) => {
          const { day, team, col, row } = cell;
          const position = { '--c': col, '--r': row, '--o': row % 2 } as CSSProperties;
          if (day.isFuture) return <span key={day.date} className="hex-future" style={position} data-c={col} data-r={row} aria-hidden="true" />;
          const crew = day.count > 0 ? team?.crew ?? 1 : 0;
          const pending = day.count === 0 && (team?.deliveries.length ?? 0) > 0;
          return (
            <button
              key={day.date}
              type="button"
              className="dashboard-heatmap-cell"
              style={position}
              data-c={col}
              data-r={row}
              data-level={day.level}
              data-crew={crew || undefined}
              data-pending={pending ? 'true' : undefined}
              data-untracked={day.isUntracked ? 'true' : undefined}
              data-today={day.date === contributions.today ? 'true' : undefined}
              data-contribution-date={day.date}
              aria-label={describe(cell)}
              tabIndex={day.date === tabStopDate ? 0 : -1}
            >
              {crew >= 3 && <span className="hex-cell-glow" aria-hidden="true" />}
              <span className="hex-cell-fill" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    );
    // Labels depend on locale; handlers are delegated so the grid only re-renders on data/focus/locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, calendar, tabStopDate, locale, contributions.today]);

  const showTip = (target: HTMLElement) => {
    const stage = stageRef.current;
    const dateValue = target.dataset.contributionDate;
    if (!stage || !dateValue) return;
    const stageRect = stage.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const row = Number(target.dataset.r ?? 0);
    setTip({
      date: dateValue,
      left: rect.left + rect.width / 2 - stageRect.left,
      top: row < 3 ? rect.bottom - stageRect.top : rect.top - stageRect.top,
      below: row < 3,
    });
  };

  const ripple = (origin: HTMLElement) => {
    if (prefersReducedMotion() || !gridRef.current) return;
    const c0 = Number(origin.dataset.c);
    const r0 = Number(origin.dataset.r);
    gridRef.current.querySelectorAll<HTMLElement>('button.dashboard-heatmap-cell').forEach((button) => {
      const distance = Math.hypot(Number(button.dataset.c) - c0, (Number(button.dataset.r) - r0) * 0.9);
      if (distance > 5) return;
      const fill = button.querySelector('.hex-cell-fill');
      if (!fill) return;
      gsap.fromTo(fill, { scale: 1 }, {
        scale: distance === 0 ? 0.72 : 1.26,
        duration: 0.16,
        delay: distance * 0.045,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'transform',
      });
    });
  };

  const onGridClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-contribution-date]');
    const value = button?.dataset.contributionDate;
    if (!button || !value) return;
    ripple(button);
    onOpenDay(value);
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-contribution-date]');
    const current = button?.dataset.contributionDate;
    if (!current) return;
    const keyOffsets: Record<string, number> = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 };
    const offset = keyOffsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const target = dayDate(current);
    target.setUTCDate(target.getUTCDate() + offset);
    const nextDate = target.toISOString().slice(0, 10);
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-contribution-date="${nextDate}"]`)?.focus();
  };

  // Entrance: cells bloom outward from the middle of the year (the fill animates, never the hit area).
  useLayoutEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement || view !== 'hex' || prefersReducedMotion()) return;
    const fills = Array.from(gridElement.querySelectorAll<HTMLElement>('.hex-cell-fill, .hex-future'));
    if (!fills.length) return;
    const weeks = calendar?.weeks.length ?? 53;
    const tween = gsap.fromTo(fills, { scale: 0.15, opacity: 0 }, {
      scale: 1,
      opacity: 1,
      duration: 0.55,
      ease: 'back.out(2.2)',
      clearProps: 'transform,opacity',
      stagger: (_index: number, target: Element) => {
        const host = target.closest<HTMLElement>('[data-c]');
        if (!host) return 0;
        const c = Number(host.dataset.c ?? 0);
        const r = Number(host.dataset.r ?? 0);
        return Math.hypot(c - weeks / 2, (r - 3) * 2.2) * 0.022;
      },
    });
    return () => { tween.kill(); gsap.set(fills, { clearProps: 'transform,opacity' }); };
  }, [calendarKey, view, calendar]);

  // Multi-person days breathe so "hot" team days read at a glance.
  useEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement || view !== 'hex' || prefersReducedMotion()) return;
    const glows = gridElement.querySelectorAll<HTMLElement>('.hex-cell-glow');
    if (!glows.length) return;
    const tween = gsap.to(glows, {
      opacity: 0.72,
      scale: 1.28,
      duration: 1.6,
      ease: 'sine.inOut',
      stagger: { each: 0.14, from: 'random', repeat: -1, yoyo: true },
    });
    return () => { tween.kill(); gsap.set(glows, { clearProps: 'transform,opacity' }); };
  }, [calendarKey, view, cells]);

  // The current week is the interesting edge: start scrolled to today on narrow screens.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || view !== 'hex' || !isCurrentYear) return;
    if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
    const todayCell = scroller.querySelector<HTMLElement>('[data-today="true"]');
    if (!todayCell) { scroller.scrollLeft = scroller.scrollWidth; return; }
    // Keep today near the trailing edge with a couple of upcoming weeks visible for context.
    const delta = todayCell.getBoundingClientRect().right - scroller.getBoundingClientRect().right;
    scroller.scrollLeft += delta + todayCell.offsetWidth * 2.5;
  }, [calendarKey, view, isCurrentYear]);

  useEffect(() => {
    if (!totalRef.current || prefersReducedMotion()) return;
    const tween = gsap.fromTo(totalRef.current, { scale: 0.82, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)', clearProps: 'transform,opacity' });
    return () => { tween.kill(); };
  }, [activity.totals.total, calendarKey]);

  const changeView = (next: HeatmapView) => {
    setView(next);
    setTip(null);
    try { window.localStorage.setItem(VIEW_PREFERENCE, next); } catch { /* preference only */ }
  };

  const skyCells = useMemo<SkylineCell[]>(() => cells.map(({ day, team, col, row }) => ({
    date: day.date,
    col,
    row,
    total: day.count,
    level: day.level,
    crew: day.count > 0 ? team?.crew ?? 1 : 0,
    future: day.isFuture,
    untracked: day.isUntracked,
  })), [cells]);

  const githubStatus = github.linked === 0
    ? t('لا توجد حسابات GitHub مربوطة', 'No linked GitHub accounts')
    : !github.enabled
      ? t('الدمج متوقف', 'Merge paused')
      : github.loading > 0
        ? t('جارٍ المزامنة…', 'Syncing…')
        : github.failed > 0
          ? t(`${number(github.connected)} متصل · ${number(github.failed)} تعذّر`, `${number(github.connected)} synced · ${number(github.failed)} unavailable`)
          : t(`${number(github.connected)} حساب متصل`, `${number(github.connected)} accounts synced`);
  const githubState = github.linked === 0 || !github.enabled ? 'idle' : github.loading > 0 ? 'loading' : github.failed > 0 ? 'partial' : 'ok';
  const tipDay = tip ? activity.byDate.get(tip.date) : undefined;
  const tipCell = tip ? cells.find((cell) => cell.day.date === tip.date) : undefined;
  const totals = activity.totals;
  const hot = activity.crewScale.hot;
  const crewLegendLabel = (crew: number) => {
    if (crew === 4) return `${number(hot)}+`;
    if (crew === 3) return hot > 4 ? `${number(3)}–${number(hot - 1)}` : number(3);
    return number(crew);
  };

  return (
    <section
      className="dashboard-panel dashboard-heatmap-panel glass-card"
      data-testid="dashboard-contributions"
      data-reveal
      data-refreshing={isRefreshing ? 'true' : undefined}
      aria-labelledby="dashboard-heatmap-title"
    >
      <header className="dashboard-heatmap-header">
        <div className="dashboard-heatmap-heading">
          <span className="dashboard-hex-orb" aria-hidden="true"><Hexagon size={20} /></span>
          <div className="min-w-0">
            <p className="dashboard-eyebrow">{t('خلية نشاط الفريق', 'Team activity hive')}</p>
            <h2 id="dashboard-heatmap-title" className="dashboard-panel-title">{t('مساهمات الفريق', 'Team contributions')}</h2>
            <p className="dashboard-panel-subtitle">
              {memberName
                ? t(`مساهمات ${memberName}: اعتماد المهام + GitHub`, `${memberName}'s contributions: task approvals + GitHub`)
                : t('كل تسليم معتمد مساهمة، ومساهمات GitHub للأعضاء بتتجمع هنا. كل ما زاد عدد اللي اشتغلوا في نفس اليوم، الخلية بتسخن.', 'Every approved delivery counts, and members’ GitHub activity merges in. The more people active on a day, the hotter its cell.')}
            </p>
          </div>
        </div>
        <div className="dashboard-heatmap-controls">
          <label className="dashboard-select-wrap">
            <span>{t('السنة', 'Year')}</span>
            <select aria-label={t('سنة سجل المساهمات', 'Contribution year')} value={year} onChange={(event) => onYearChange(Number(event.currentTarget.value))}>
              {years.map((item) => <option key={item} value={item}>{new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { useGrouping: false }).format(item)}</option>)}
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
          <Segmented<HeatmapView>
            label={t('طريقة عرض المساهمات', 'Contribution view')}
            value={view}
            onChange={changeView}
            options={[
              { value: 'hex', label: t('خلية', 'Hive'), icon: <Hexagon aria-hidden="true" /> },
              { value: '3d', label: '3D', icon: <Box aria-hidden="true" /> },
            ]}
          />
        </div>
      </header>

      <div className="dashboard-contribution-summary">
        <div className="dashboard-contribution-total" aria-live="polite">
          <span ref={totalRef} className="dashboard-contribution-number">{number(totals.total)}</span>
          <span className="dashboard-contribution-caption">{t('مساهمة خلال السنة المحددة', 'contributions in the selected year')}</span>
        </div>
        <ul className="dashboard-contribution-breakdown" aria-label={t('مصادر المساهمات', 'Contribution sources')}>
          <li data-source="tasks"><ClipboardCheck size={15} aria-hidden="true" /><strong>{number(totals.approvals)}</strong><span>{t('اعتماد مهام', 'task approvals')}</span></li>
          <li data-source="github"><GithubMark size={15} /><strong>{number(totals.github)}</strong><span>{t('على GitHub', 'on GitHub')}</span></li>
          <li data-source="crew"><Users size={15} aria-hidden="true" /><strong>{number(totals.crewDays)}</strong><span>{t('يوم جماعي', 'team days')}</span></li>
        </ul>
        <div className="dashboard-streaks">
          <div className="dashboard-streak" data-kind="current">
            <span className="dashboard-streak-icon dashboard-streak-icon-current"><Flame size={16} aria-hidden="true" /></span>
            <span><strong>{isCurrentYear && streaks ? number(streaks.current) : '—'}</strong><small>{isCurrentYear ? t('السلسلة الحالية', 'current streak') : t('الحالية للسنة الحالية فقط', 'current year only')}</small></span>
          </div>
          <div className="dashboard-streak" data-kind="best">
            <span className="dashboard-streak-icon"><Trophy size={16} aria-hidden="true" /></span>
            <span><strong>{streaks ? number(streaks.best) : '—'}</strong><small>{t('أطول سلسلة', 'best streak')}</small></span>
          </div>
        </div>
      </div>

      <div className="dashboard-github-bar">
        <button
          type="button"
          className="gh-sync"
          aria-pressed={github.enabled && github.linked > 0}
          disabled={github.linked === 0}
          onClick={github.onToggle}
        >
          <GithubMark size={15} />
          <span>{t('دمج GitHub', 'Merge GitHub')}</span>
          <span className="gh-sync-switch" aria-hidden="true" />
        </button>
        <span className="gh-status" data-state={githubState}>
          <span className="gh-status-dot" aria-hidden="true" />
          {githubStatus}
        </span>
        <span className="dashboard-heatmap-hint"><MousePointerClick size={14} aria-hidden="true" />{t('اضغط على أي خلية لعرض كل اللي حصل في اليوم', 'Click any cell for that day’s full history')}</span>
      </div>

      <div ref={stageRef} className="hex-stage" data-view={view} onPointerLeave={() => setTip(null)}>
        {calendar ? (
          <>
            <div
              ref={scrollRef}
              className="dashboard-heatmap-scroll"
              dir="ltr"
              hidden={view !== 'hex'}
              aria-label={t('تقويم مساهمات السنة', 'Calendar of contributions for the year')}
              onScroll={() => setTip(null)}
            >
              <div className="hex-canvas" style={{ '--weeks': calendar.weeks.length } as CSSProperties}>
                <div className="hex-months" aria-hidden="true">
                  {calendar.monthLabels.map(({ weekIndex, month }) => (
                    <span key={month} style={{ '--c': weekIndex } as CSSProperties}>{monthName(month)}</span>
                  ))}
                </div>
                <div className="hex-body">
                  <div className="hex-weekdays" aria-hidden="true">
                    {dayLabels.map((label, index) => <span key={`${label}-${index}`} style={{ '--r': index } as CSSProperties}>{index % 2 === 1 ? label : ''}</span>)}
                  </div>
                  <div
                    className="hex-grid-host"
                    onClick={onGridClick}
                    onKeyDown={onGridKeyDown}
                    onPointerOver={(event: ReactPointerEvent<HTMLDivElement>) => {
                      if (event.pointerType === 'touch') return;
                      const button = (event.target as Element).closest<HTMLElement>('button[data-contribution-date]');
                      if (button) showTip(button);
                    }}
                    onFocus={(event) => {
                      const button = (event.target as Element).closest<HTMLElement>('button[data-contribution-date]');
                      if (!button?.dataset.contributionDate) return;
                      setFocusedDate(button.dataset.contributionDate);
                      if (button.matches(':focus-visible')) showTip(button);
                    }}
                    onBlur={() => setTip(null)}
                  >
                    {grid}
                  </div>
                </div>
              </div>
            </div>
            {view === '3d' && (
              <Suspense fallback={<div className="hex-3d-loading"><span className="hex-loader" aria-hidden="true" />{t('بنجهز المشهد ثلاثي الأبعاد…', 'Preparing the 3D scene…')}</div>}>
                <HexSkyline3D
                  cells={skyCells}
                  weeks={calendar.weeks.length}
                  theme={theme}
                  label={t('مجسم ثلاثي الأبعاد لمساهمات السنة. استخدم عرض الخلية للتنقل بلوحة المفاتيح.', '3D skyline of the year’s contributions. Use the hive view for keyboard navigation.')}
                  hint={t('اسحب للتدوير · مرّر للتقريب · اضغط على عمود لعرض اليوم', 'Drag to orbit · scroll to zoom · click a column to open the day')}
                  unavailable={t('المتصفح ده مش بيدعم WebGL. استخدم عرض الخلية.', 'WebGL is unavailable in this browser. Use the hive view.')}
                  onSelect={onOpenDay}
                  onHover={(hovered, clientX, clientY) => {
                    const stage = stageRef.current;
                    if (!stage || !hovered) { setTip(null); return; }
                    const rect = stage.getBoundingClientRect();
                    setTip({ date: hovered, left: clientX - rect.left, top: clientY - rect.top - 14, below: false });
                  }}
                />
              </Suspense>
            )}
          </>
        ) : (
          <p className="dashboard-inline-error" role="alert">{t('سجل المساهمات وصل بصيغة غير صالحة.', 'Contribution history has an invalid format.')}</p>
        )}
        {tip && tipCell && (
          <HexTooltip
            tip={tip}
            stageWidth={stageRef.current?.clientWidth ?? 0}
            title={date(dayDate(tip.date), { weekday: 'long', day: 'numeric', month: 'long' })}
            total={tipCell.day.count}
            untracked={tipCell.day.isUntracked}
            day={tipDay}
            people={people}
          />
        )}
      </div>

      <footer className="dashboard-heatmap-footer">
        <div className="hex-legend" aria-hidden="true">
          <span>{t('أقل', 'Less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <span key={level} className="hex-legend-cell" data-level={level} data-crew={level ? 1 : undefined} />)}
          <span>{t('أكثر', 'More')}</span>
        </div>
        <div className="hex-legend hex-legend-crew" aria-hidden="true">
          <span>{t('حرارة الفريق', 'Team heat')}</span>
          {[1, 2, 3, 4].map((crew) => (
            <span key={crew} className="hex-legend-crew-item">
              <span className="hex-legend-cell" data-level={4} data-crew={crew} />
              <small>{crewLegendLabel(crew)}</small>
            </span>
          ))}
        </div>
        <div className="hex-legend" aria-hidden="true">
          <span className="hex-legend-cell" data-untracked="true" />
          <span>{t('تاريخ غير مكتمل', 'Incomplete history')}</span>
          <span className="hex-legend-cell" data-pending="true" />
          <span>{t('تسليم بانتظار المراجعة', 'Awaiting review')}</span>
        </div>
      </footer>

      <details className="dashboard-history-note">
        <summary><Info size={15} aria-hidden="true" /><strong>{t('إزاي بنحسب المساهمات؟', 'How contributions are counted')}</strong></summary>
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
        <p>
          {t('مساهمات GitHub بتيجي من التقويم العام لكل عضو مربوط حسابه (حقل مخصص اسمه GitHub أو رابط github.com في ملفه). لون الخلية بيتحول من الأزرق للبنفسجي للوردي للأحمر كل ما زاد عدد الأشخاص النشطين في اليوم.', 'GitHub contributions come from each linked member’s public calendar (a custom field named GitHub or a github.com profile link). A cell shifts from blue to violet to magenta to red as more people are active that day.')}
        </p>
      </details>
    </section>
  );
}

function HexTooltip({
  tip,
  stageWidth,
  title,
  total,
  untracked,
  day,
  people,
}: {
  tip: TipState;
  stageWidth: number;
  title: string;
  total: number;
  untracked: boolean;
  day: TeamDay | undefined;
  people: ReadonlyMap<number, PersonInfo>;
}) {
  const { t, number } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const half = 124;
  const left = stageWidth > half * 2 ? Math.min(Math.max(tip.left, half), stageWidth - half) : stageWidth / 2;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !inner.current) return;
    if (prefersReducedMotion()) { gsap.set(element, { left, top: tip.top }); return; }
    if (!shown.current) {
      gsap.set(element, { left, top: tip.top });
      gsap.fromTo(inner.current, { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1, duration: 0.24, ease: 'back.out(2)' });
      shown.current = true;
    } else {
      gsap.to(element, { left, top: tip.top, duration: 0.18, ease: 'power3.out', overwrite: 'auto' });
    }
  }, [left, tip.top]);
  const contributorIds = day?.contributorIds ?? [];
  return (
    <div ref={ref} className="hex-tip" data-below={tip.below ? 'true' : undefined} data-crew={day?.crew || undefined} aria-hidden="true">
      <div ref={inner} className="hex-tip-inner">
      <p className="hex-tip-date">{title}</p>
      <p className="hex-tip-total">
        <strong>{untracked && total === 0 ? '—' : number(total)}</strong>
        <span>{untracked && total === 0 ? t('سجل غير مكتمل', 'incomplete history') : t('مساهمة', 'contributions')}</span>
      </p>
      {day && (day.approvals > 0 || day.github > 0 || day.deliveries.length > 0) && (
        <p className="hex-tip-split">
          {day.approvals > 0 && <span><ClipboardCheck size={12} aria-hidden="true" />{number(day.approvals)}</span>}
          {day.github > 0 && <span><GithubMark size={12} />{number(day.github)}</span>}
          {day.crewSize > 0 && <span><Users size={12} aria-hidden="true" />{number(day.crewSize)}</span>}
        </p>
      )}
      {contributorIds.length > 0 && (
        <span className="hex-tip-people">
          {contributorIds.slice(0, 5).map((id) => {
            const person = people.get(id);
            return <PersonAvatar key={id} id={id} name={person?.name ?? `#${id}`} handle={person?.handle} size={22} />;
          })}
          {contributorIds.length > 5 && <small>+{number(contributorIds.length - 5)}</small>}
        </span>
      )}
      <p className="hex-tip-cta">{t('اضغط لعرض السجل', 'Click for history')}</p>
      </div>
    </div>
  );
}
