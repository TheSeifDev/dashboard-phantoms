import { useMemo, useState } from 'react';
import { CalendarClock, ClipboardList, FileBarChart2, Star, Target } from 'lucide-react';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole } from '../../../types/db';
import { PanelShell, StateChip, TASK_STATE_COPY } from './shared';

type TimelineKind = 'task' | 'evaluation' | 'goal' | 'project';

interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string;
  tone: 'muted' | 'accent' | 'warning' | 'primary';
}

const FILTERS: TimelineKind[] = ['task', 'evaluation', 'goal', 'project'];

export function TimelinePanel({ data }: { data: TeamConsole }) {
  const { t, locale, number, date } = useLocale();
  const [active, setActive] = useState<'all' | TimelineKind>('all');

  const events = useMemo(() => {
    const list: TimelineEvent[] = [
      ...data.tasks.map((task) => ({
        id: `task-${task.id}`,
        kind: 'task' as const,
        at: task.created_at,
        title: task.title,
        detail: `${t('مهمة', 'Task')} · ${TASK_STATE_COPY[task.state][locale === 'ar' ? 'ar' : 'en']}`,
        tone: TASK_STATE_COPY[task.state].tone,
      })),
      ...data.evaluations.map((item) => ({
        id: `eval-${item.id}`,
        kind: 'evaluation' as const,
        at: item.created_at,
        title: `${item.member_name} — ${item.title}`,
        detail: `${item.points >= 0 ? '+' : ''}${item.points} ${t('نجمة', 'stars')}`,
        tone: item.points >= 0 ? 'primary' as const : 'warning' as const,
      })),
      ...data.goals.map((goal) => ({
        id: `goal-${goal.id}`,
        kind: 'goal' as const,
        at: goal.updated_at,
        title: goal.title,
        detail: `${number(goal.current_value)} / ${number(goal.target_value)}`,
        tone: goal.status === 'done' ? 'primary' as const : goal.status === 'paused' ? 'muted' as const : 'accent' as const,
      })),
      ...data.project_reports.map((report) => ({
        id: `report-${report.id}`,
        kind: 'project' as const,
        at: report.created_at,
        title: `${report.project_name} — ${report.member_name}`,
        detail: report.period_start ? `${date(report.period_start)} → ${report.period_end ? date(report.period_end) : '—'}` : report.status,
        tone: 'accent' as const,
      })),
    ];
    return list
      .filter((event) => event.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data, locale, number, t, date]);

  const visible = active === 'all' ? events : events.filter((event) => event.kind === active);
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of visible) {
      const key = event.at.slice(0, 10);
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }
    return [...map.entries()];
  }, [visible]);

  const labelFor = (kind: TimelineKind) => {
    switch (kind) {
      case 'task': return t('المهام', 'Tasks');
      case 'evaluation': return t('التقييمات', 'Evaluations');
      case 'goal': return t('الخطة', 'Plan');
      default: return t('المشروعات', 'Projects');
    }
  };

  return (
    <PanelShell
      id="tmc-timeline"
      kicker={<><CalendarClock size={14} aria-hidden="true" />{t('المخطط الزمني', 'Timeline')}</>}
      title={t('كل اللي حصل على الفريق', 'Everything that happened in this team')}
      hint={t('مهام وتقييمات وأهداف وتقارير مشروعات — مرتبة زمنيًا من الأحدث.', 'Tasks, evaluations, goals, and project reports in reverse chronological order.')}
      actions={(
        <div className="tmc-segmented tmc-segmented--sm" role="group" aria-label={t('تصفية المخطط الزمني', 'Filter timeline')}>
          <button type="button" className={active === 'all' ? 'is-active' : ''} onClick={() => setActive('all')}>{t('الكل', 'All')}</button>
          {FILTERS.map((kind) => (
            <button key={kind} type="button" className={active === kind ? 'is-active' : ''} onClick={() => setActive(kind)}>
              {labelFor(kind)}
            </button>
          ))}
        </div>
      )}
    >
      {grouped.length === 0
        ? <p className="tmc-note">{t('مفيش أحداث في الفترة/الفلتر ده.', 'No events for this filter yet.')}</p>
        : (
          <div className="tmc-timeline">
            {grouped.map(([day, dayEvents]) => (
              <section key={day} className="tmc-timeline-day">
                <header>
                  <span className="tmc-timeline-date" dir="ltr">{day}</span>
                  <span className="tmc-timeline-count">{number(dayEvents.length)}</span>
                </header>
                <ul>
                  {dayEvents.map((event) => (
                    <li key={event.id} className="tmc-timeline-item" data-tmc-anim>
                      <span className={`tmc-timeline-dot is-${event.tone}`} aria-hidden="true">
                        {event.kind === 'task' ? <ClipboardList size={12} aria-hidden="true" />
                          : event.kind === 'evaluation' ? <Star size={12} aria-hidden="true" />
                            : event.kind === 'goal' ? <Target size={12} aria-hidden="true" />
                              : <FileBarChart2 size={12} aria-hidden="true" />}
                      </span>
                      <div className="tmc-timeline-copy">
                        <strong>{event.title}</strong>
                        <small>{event.detail}</small>
                      </div>
                      <StateChip tone={event.tone}>{labelFor(event.kind)}</StateChip>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </PanelShell>
  );
}
