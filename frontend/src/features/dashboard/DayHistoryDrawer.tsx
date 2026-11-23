import { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CircleCheck,
  CircleDot,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  ListPlus,
  MessageSquare,
  RotateCcw,
  Send,
  StickyNote,
  Tag,
  UserRoundPlus,
  Eye,
} from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer';
import { AnimatedNumber } from '../../components/motion/AnimatedNumber';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import { useLocale } from '../../i18n/useLocale';
import { BONUS_MARKER_GLOBAL, readBonusPoints } from '../notes/noteBonus';
import { addIsoDays } from './taskContributions';
import { cairoDayOf, type DayRecords, type TeamDay } from './teamActivity';
import type { GithubEvent } from './github';
import type { PersonInfo } from './TaskStreakHeatmap';
import { useGithubDayEvents } from './useGithubTeam';
import { GithubMark } from './GithubMark';
import { PersonAvatar } from './PersonAvatar';

interface DayHistoryDrawerProps {
  date: string | null;
  onClose: () => void;
  day: TeamDay | undefined;
  records: DayRecords;
  people: ReadonlyMap<number, PersonInfo>;
  githubEnabled: boolean;
  isUntracked: boolean;
  today: string;
}

type TimelineItem =
  | { kind: 'delivery'; id: string; at: string; memberId: number; title: string; status: string; url: string | null; note: string | null }
  | { kind: 'github'; id: string; at: string; event: GithubEvent; memberId: number | null }
  | { kind: 'note'; id: string; at: string; author: string; target: string; text: string; points: number | null }
  | { kind: 'task'; id: string; at: string; title: string }
  | { kind: 'member'; id: string; at: string; memberId: number; name: string };

const GITHUB_ICONS = {
  push: GitCommitHorizontal,
  pull_request: GitPullRequest,
  review: Eye,
  issue: CircleDot,
  comment: MessageSquare,
  create: GitBranch,
  release: Tag,
  other: GitBranch,
} as const;

function pointsOf(text: string): number | null {
  return readBonusPoints(text);
}

export function DayHistoryDrawer({ date, onClose, day, records, people, githubEnabled, isUntracked, today }: DayHistoryDrawerProps) {
  const { t, number, date: formatDate, locale, dir } = useLocale();
  const body = useRef<HTMLDivElement>(null);
  const handles = useMemo(() => (day?.githubBy ?? []).map((share) => share.handle), [day]);
  const handleToMember = useMemo(() => new Map((day?.githubBy ?? []).map((share) => [share.handle.toLowerCase(), share.memberId])), [day]);
  const eventsWindowStart = addIsoDays(today, -89);
  const withinEventsWindow = Boolean(date && eventsWindowStart && date >= eventsWindowStart);
  const eventsQuery = useGithubDayEvents(handles, date, githubEnabled && withinEventsWindow);
  const time = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }), [locale]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!date) return [];
    const items: TimelineItem[] = [];
    for (const delivery of day?.deliveries ?? []) {
      items.push({ kind: 'delivery', id: `d-${delivery.taskId}-${delivery.memberId}`, at: delivery.at, memberId: delivery.memberId, title: delivery.taskTitle, status: delivery.status, url: delivery.url, note: delivery.note });
    }
    for (const event of eventsQuery.data?.events ?? []) {
      if (cairoDayOf(event.createdAt) !== date) continue;
      items.push({ kind: 'github', id: `g-${event.id}`, at: event.createdAt, event, memberId: handleToMember.get(event.handle.toLowerCase()) ?? null });
    }
    for (const note of records.notes) {
      const text = (note.text || '').replace(BONUS_MARKER_GLOBAL, '').trim();
      items.push({ kind: 'note', id: `n-${note.id}`, at: note.created_at, author: note.author || t('الإدارة', 'Admin'), target: note.target_name || t('عضو', 'a member'), text, points: pointsOf(note.text || '') });
    }
    for (const task of records.tasksCreated) items.push({ kind: 'task', id: `t-${task.id}`, at: task.created_at, title: task.title });
    for (const member of records.membersJoined) items.push({ kind: 'member', id: `m-${member.id}`, at: member.created_at, memberId: member.id, name: member.full_name });
    const seen = new Set<string>();
    return items
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }, [date, day, eventsQuery.data, records, handleToMember, t]);

  const contributors = useMemo(() => {
    const map = new Map<number, { deliveries: number; github: number }>();
    for (const delivery of day?.deliveries ?? []) {
      const entry = map.get(delivery.memberId) ?? { deliveries: 0, github: 0 };
      entry.deliveries += 1;
      map.set(delivery.memberId, entry);
    }
    for (const share of day?.githubBy ?? []) {
      const entry = map.get(share.memberId) ?? { deliveries: 0, github: 0 };
      entry.github += share.count;
      map.set(share.memberId, entry);
    }
    return [...map.entries()].sort((a, b) => (b[1].deliveries * 5 + b[1].github) - (a[1].deliveries * 5 + a[1].github));
  }, [day]);

  useLayoutEffect(() => {
    const root = body.current;
    if (!date || !root || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.day-hero-hex', { rotate: -40, scale: 0.4, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(1.8)' })
        .fromTo('.day-hero-copy > *', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06 }, '-=0.45')
        .fromTo('.day-heat-meter span', { scaleX: 0 }, { scaleX: 1, duration: 0.5, stagger: 0.07, transformOrigin: dir === 'rtl' ? 'right center' : 'left center' }, '-=0.3')
        .fromTo('.day-section', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08 }, '-=0.35')
        .fromTo('.day-item', { x: dir === 'rtl' ? -18 : 18, opacity: 0 }, { x: 0, opacity: 1, duration: 0.42, stagger: 0.045, clearProps: 'transform,opacity' }, '-=0.3');
    }, root);
    return () => context.revert();
  }, [date, dir]);

  useLayoutEffect(() => {
    const root = body.current;
    if (!root || !eventsQuery.data || prefersReducedMotion()) return;
    const fresh = root.querySelectorAll('.day-item[data-kind="github"]');
    if (fresh.length) gsap.fromTo(fresh, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: 'power3.out', clearProps: 'transform,opacity' });
  }, [eventsQuery.data]);

  if (!date || typeof document === 'undefined') return null;
  const title = formatDate(new Date(`${date}T12:00:00Z`), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const total = day?.total ?? 0;
  const crew = day?.crew ?? 0;
  const approvedVisible = (day?.deliveries ?? []).filter((item) => item.status === 'approved').length;
  const nameOf = (id: number | null) => (id === null ? null : people.get(id)?.name ?? `#${id}`);
  const statusCopy = (status: string) => ({
    approved: { label: t('اتعمد', 'Approved'), icon: CircleCheck },
    under_review: { label: t('اتسلّم للمراجعة', 'Submitted for review'), icon: Send },
    revision_requested: { label: t('مطلوب تعديل', 'Revision requested'), icon: RotateCcw },
  } as Record<string, { label: string; icon: typeof CircleCheck }>)[status] ?? { label: status, icon: ClipboardCheck };

  return createPortal(
    <Drawer isOpen onClose={onClose} title={title} label={t(`سجل يوم ${title}`, `History for ${title}`)} className="day-drawer sm:max-w-lg">
      <div ref={body} className="day-history" data-crew={crew || undefined}>
        <section className="day-hero">
          <span className="day-hero-hex" data-crew={crew || undefined} aria-hidden="true">
            <AnimatedNumber value={total} format={number} />
          </span>
          <div className="day-hero-copy">
            <p className="dashboard-eyebrow">{t('سجل اليوم', 'Day history')}</p>
            <p className="day-hero-title">{isUntracked && total === 0 ? t('سجل غير مكتمل لليوم ده', 'Incomplete history for this day') : t(`${number(total)} مساهمة`, `${number(total)} contributions`)}</p>
            <ul className="day-hero-chips">
              <li><ClipboardCheck size={14} aria-hidden="true" />{t(`${number(day?.approvals ?? 0)} اعتماد`, `${number(day?.approvals ?? 0)} approvals`)}</li>
              <li><GithubMark size={14} />{t(`${number(day?.github ?? 0)} على GitHub`, `${number(day?.github ?? 0)} on GitHub`)}</li>
              <li><History size={14} aria-hidden="true" />{t(`${number(timeline.length)} حدث`, `${number(timeline.length)} events`)}</li>
            </ul>
          </div>
        </section>

        <div className="day-heat" aria-label={t(`حرارة الفريق: ${number(day?.crewSize ?? 0)} أشخاص`, `Team heat: ${number(day?.crewSize ?? 0)} people`)}>
          <span className="day-heat-label">{t('حرارة الفريق', 'Team heat')}</span>
          <span className="day-heat-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((tier) => <span key={tier} data-tier={tier} data-on={crew >= tier ? 'true' : undefined} />)}
          </span>
          <strong>{crew >= 4 ? t('نار', 'On fire') : crew === 3 ? t('سخنة', 'Hot') : crew === 2 ? t('دافية', 'Warm') : crew === 1 ? t('هادية', 'Calm') : t('ساكنة', 'Quiet')}</strong>
        </div>

        {contributors.length > 0 && (
          <section className="day-section" aria-labelledby="day-people-title">
            <h3 id="day-people-title" className="day-section-title">{t('مين اشتغل', 'Who was active')}</h3>
            <ul className="day-people">
              {contributors.map(([memberId, stat]) => {
                const person = people.get(memberId);
                return (
                  <li key={memberId} className="day-item">
                    <PersonAvatar id={memberId} name={person?.name ?? `#${memberId}`} handle={person?.handle} size={36} />
                    <span className="day-person-copy">
                      <span className="dashboard-person-name">{person?.name ?? `#${memberId}`}</span>
                      {person?.handle && <small dir="ltr">@{person.handle}</small>}
                    </span>
                    <span className="day-person-stats">
                      {stat.deliveries > 0 && <span data-kind="task"><ClipboardCheck size={13} aria-hidden="true" />{number(stat.deliveries)}</span>}
                      {stat.github > 0 && <span data-kind="github"><GithubMark size={13} />{number(stat.github)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {(day?.approvals ?? 0) > 0 && (
          <section className="day-section day-ledger">
            <ClipboardCheck size={18} aria-hidden="true" />
            <div>
              <p><strong>{number(day?.approvals ?? 0)}</strong> {t('اعتماد موثّق في سجل الأحداث لليوم ده.', 'audited approvals in the event ledger for this day.')}</p>
              {(day?.approvals ?? 0) > approvedVisible && (
                <small>{t('السجل الموثّق بيحفظ العدد فقط؛ بعض التسليمات اتغيرت حالتها بعد كده فمش ظاهرة تفاصيلها هنا.', 'The ledger stores counts only; some deliveries changed state later, so their details are not listed here.')}</small>
              )}
            </div>
          </section>
        )}

        <section className="day-section" aria-labelledby="day-timeline-title">
          <h3 id="day-timeline-title" className="day-section-title">{t('اللي حصل', 'What happened')}</h3>
          {githubEnabled && handles.length > 0 && !withinEventsWindow && (
            <p className="day-note">{t('GitHub بيعرض تفاصيل الأحداث لآخر ٩٠ يوم بس؛ العدد ظاهر فوق.', 'GitHub only exposes event details for the last 90 days; counts are shown above.')}</p>
          )}
          {eventsQuery.isFetching && <p className="day-note day-note-loading"><span className="hex-loader" aria-hidden="true" />{t('بنجيب تفاصيل GitHub…', 'Loading GitHub details…')}</p>}
          {eventsQuery.data && eventsQuery.data.failed.length > 0 && (
            <p className="day-note">{t(`تعذّر تحميل أحداث: ${eventsQuery.data.failed.join('، ')}`, `Could not load events for: ${eventsQuery.data.failed.join(', ')}`)}</p>
          )}
          {timeline.length > 0 ? (
            <ol className="day-timeline">
              {timeline.map((item) => {
                const at = Number.isFinite(Date.parse(item.at)) && item.at.length > 10 ? time.format(new Date(item.at)) : null;
                if (item.kind === 'delivery') {
                  const status = statusCopy(item.status);
                  const Icon = status.icon;
                  return (
                    <li key={item.id} className="day-item" data-kind="delivery" data-status={item.status}>
                      <span className="day-node" aria-hidden="true"><Icon size={14} /></span>
                      <div className="day-item-copy">
                        <p><span className="dashboard-person-name">{nameOf(item.memberId)}</span> · {status.label}</p>
                        <strong>{item.title}</strong>
                        {item.note && <small>{item.note}</small>}
                        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="day-link">{t('افتح التسليم', 'Open submission')}<ExternalLink size={12} aria-hidden="true" /></a>}
                      </div>
                      {at && <time dateTime={item.at}>{at}</time>}
                    </li>
                  );
                }
                if (item.kind === 'github') {
                  const Icon = GITHUB_ICONS[item.event.kind];
                  return (
                    <li key={item.id} className="day-item" data-kind="github">
                      <span className="day-node" aria-hidden="true"><Icon size={14} /></span>
                      <div className="day-item-copy">
                        <p><span className="dashboard-person-name">{nameOf(item.memberId) ?? `@${item.event.handle}`}</span> · <a href={item.event.repoUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{item.event.repo}</a></p>
                        <strong dir="auto">{item.event.title}</strong>
                        {item.event.detail && <small dir="ltr">{item.event.detail}</small>}
                        <a href={item.event.url} target="_blank" rel="noopener noreferrer" className="day-link">{t('افتح على GitHub', 'Open on GitHub')}<ExternalLink size={12} aria-hidden="true" /></a>
                      </div>
                      {at && <time dateTime={item.at}>{at}</time>}
                    </li>
                  );
                }
                if (item.kind === 'note') {
                  return (
                    <li key={item.id} className="day-item" data-kind="note">
                      <span className="day-node" aria-hidden="true"><StickyNote size={14} /></span>
                      <div className="day-item-copy">
                        <p>{t(`${item.author} أضاف ملاحظة لـ ${item.target}`, `${item.author} added a note for ${item.target}`)}</p>
                        {item.text && <small>{item.text}</small>}
                        {item.points !== null && <span className="day-points" data-sign={item.points >= 0 ? 'plus' : 'minus'}>{item.points > 0 ? '+' : ''}{number(item.points)} {t('نقطة', 'pts')}</span>}
                      </div>
                      {at && <time dateTime={item.at}>{at}</time>}
                    </li>
                  );
                }
                if (item.kind === 'task') {
                  return (
                    <li key={item.id} className="day-item" data-kind="task">
                      <span className="day-node" aria-hidden="true"><ListPlus size={14} /></span>
                      <div className="day-item-copy">
                        <p>{t('تكليف جديد', 'New task')}</p>
                        <strong>{item.title}</strong>
                      </div>
                      {at && <time dateTime={item.at}>{at}</time>}
                    </li>
                  );
                }
                return (
                  <li key={item.id} className="day-item" data-kind="member">
                    <span className="day-node" aria-hidden="true"><UserRoundPlus size={14} /></span>
                    <div className="day-item-copy">
                      <p>{t('عضو جديد انضم', 'New member joined')}</p>
                      <strong className="dashboard-person-name">{item.name}</strong>
                    </div>
                    {at && <time dateTime={item.at}>{at}</time>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="day-empty">
              <Clock3 size={22} aria-hidden="true" />
              <p>{isUntracked ? t('اليوم ده قبل بداية السجل الموثّق، فممكن يكون فيه نشاط مش متسجل.', 'This day predates reliable tracking, so some activity may be missing.') : t('مفيش أحداث متسجلة في اليوم ده.', 'No recorded events on this day.')}</p>
            </div>
          )}
        </section>
      </div>
    </Drawer>,
    document.body,
  );
}
