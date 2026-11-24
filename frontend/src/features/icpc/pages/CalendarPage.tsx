import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Modal } from '../../../components/ui/Modal';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Segmented } from '../../dashboard/Segmented';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useDeleteSession, useIcpcCalendar, useSaveSession } from '../api';
import { Chip, InlineEmpty, Panel } from '../components/IcpcPanels';
import type { IcpcMode, IcpcSession } from '../types';

const KINDS: Array<{ value: IcpcSession['kind']; ar: string; en: string }> = [
  { value: 'training', ar: 'تدريب', en: 'Training' },
  { value: 'mock', ar: 'محاكاة مسابقة', en: 'Mock contest' },
  { value: 'upsolving', ar: 'Upsolving', en: 'Upsolving' },
  { value: 'sharing', ar: 'مشاركة معرفة', en: 'Knowledge sharing' },
  { value: 'deadline', ar: 'موعد تسليم', en: 'Deadline' },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const gridStart = new Date(start);
  gridStart.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 1) % 7));
  const gridEnd = new Date(end);
  gridEnd.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 1) % 7)));
  return { start: isoDate(gridStart), end: isoDate(gridEnd), gridStart, gridEnd };
}

interface SessionDraft {
  title: string;
  kind: IcpcSession['kind'];
  starts_at: string;
  duration_minutes: string;
  location: string;
  url: string;
  topic: string;
}

export function CalendarPage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const bounds = useMemo(() => monthBounds(cursor.year, cursor.month), [cursor]);
  const calendar = useIcpcCalendar(mode, bounds.start, bounds.end);
  const saveSession = useSaveSession(mode);
  const deleteSession = useDeleteSession(mode);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SessionDraft>({
    title: '',
    kind: 'training',
    starts_at: `${isoDate(today)}T18:00`,
    duration_minutes: '90',
    location: '',
    url: '',
    topic: '',
  });

  const canManage = calendar.data?.can_manage ?? false;

  const cells = useMemo(() => {
    const list: Array<{ key: string; day: number; events: Array<{ label: string; kind: string }> }> = [];
    const cursorDate = new Date(bounds.gridStart);
    const sessions = calendar.data?.sessions ?? [];
    const contests = calendar.data?.contests ?? [];
    const deadlines = calendar.data?.deadlines ?? [];
    while (cursorDate <= bounds.gridEnd) {
      const key = isoDate(cursorDate);
      const events = [
        ...sessions.filter((session) => session.starts_at.slice(0, 10) === key).map((session) => ({ label: session.title, kind: 'session' })),
        ...contests.filter((contest) => contest.starts_at.slice(0, 10) === key).map((contest) => ({ label: contest.name, kind: 'contest' })),
        ...deadlines.filter((deadline) => deadline.due_date === key).map((deadline) => ({ label: deadline.title, kind: 'deadline' })),
      ];
      list.push({ key, day: cursorDate.getUTCDate(), events });
      cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
    }
    return list;
  }, [bounds, calendar.data]);

  const submit = async () => {
    try {
      await saveSession.mutateAsync({
        title: draft.title,
        kind: draft.kind,
        starts_at: new Date(draft.starts_at).toISOString(),
        duration_minutes: Number(draft.duration_minutes),
        location: draft.location,
        url: draft.url,
        topic: draft.topic,
      });
      toast.success(t('اتحفظت الجلسة.', 'Session saved.'));
      setOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحفظ الجلسة.', 'Could not save the session.'));
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteSession.mutateAsync(id);
      toast.success(t('اتحذفت الجلسة.', 'Session deleted.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف الجلسة.', 'Could not delete the session.'));
    }
  };

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  if (calendar.isLoading) return <CardSkeletons count={2} />;
  if (calendar.isError) {
    return <ErrorState message={(calendar.error as Error | null)?.message ?? t('معرفناش نحمّل التقويم.', 'Could not load the calendar.')} onRetry={() => void calendar.refetch()} />;
  }

  const monthLabel = date(new Date(Date.UTC(cursor.year, cursor.month, 1)), { month: 'long', year: 'numeric' });
  const weekdayLabels = locale === 'ar'
    ? ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
    : ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<ChevronRight size={16} aria-hidden="true" />} onClick={() => shift(-1)} aria-label={t('الشهر السابق', 'Previous month')} />
          <strong className="text-sm">{monthLabel}</strong>
          <Button variant="ghost" icon={<ChevronLeft size={16} aria-hidden="true" />} onClick={() => shift(1)} aria-label={t('الشهر التالي', 'Next month')} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={view}
            options={[{ value: 'month', label: t('شهري', 'Month') }, { value: 'agenda', label: t('أجندة', 'Agenda') }]}
            onChange={(value) => setView(value as 'month' | 'agenda')}
            label={t('طريقة العرض', 'View')}
          />
          {canManage && <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>{t('جلسة جديدة', 'New session')}</Button>}
        </div>
      </div>

      <Panel
        title={t('تقويم التدريب', 'Training calendar')}
        icon={<CalendarDays size={15} aria-hidden="true" />}
        hint={t(`${number(calendar.data?.sessions.length ?? 0)} جلسة`, `${number(calendar.data?.sessions.length ?? 0)} sessions`)}
        flush
      >
        {view === 'month' ? (
          <div className="p-3">
            <div className="icpc-calendar" style={{ marginBlockEnd: 4, background: 'transparent' }}>
              {weekdayLabels.map((label) => (
                <div key={label} className="text-center text-[10px] font-extrabold text-[var(--text-muted)]">{label}</div>
              ))}
            </div>
            <div className="icpc-calendar">
              {cells.map((cell) => (
                <div key={cell.key} className="icpc-cal-cell" data-today={cell.key === isoDate(today)}>
                  <span className="icpc-cal-day">{number(cell.day)}</span>
                  {cell.events.slice(0, 3).map((event, index) => (
                    <span key={`${cell.key}-${index}`} className="icpc-cal-event" data-kind={event.kind} title={event.label}>{event.label}</span>
                  ))}
                  {cell.events.length > 3 && <span className="text-[10px] text-[var(--text-muted)]">+{number(cell.events.length - 3)}</span>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="icpc-list">
            {(calendar.data?.sessions.length ?? 0) === 0 && (calendar.data?.contests.length ?? 0) === 0 ? (
              <InlineEmpty>{t('مفيش أنشطة في الشهر ده.', 'Nothing scheduled this month.')}</InlineEmpty>
            ) : (
              <>
                {(calendar.data?.sessions ?? []).map((session) => (
                  <div key={session.id} className="icpc-row">
                    <div className="icpc-row-main">
                      <span className="icpc-row-title">{session.title}</span>
                      <span className="icpc-row-sub">
                        <Chip tone="primary">{KINDS.find((entry) => entry.value === session.kind)?.[locale] ?? session.kind}</Chip>
                        <span>{date(session.starts_at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{number(session.duration_minutes)} {t('دقيقة', 'min')}</span>
                        {session.location && <span>{session.location}</span>}
                        {session.url && <a href={session.url} target="_blank" rel="noreferrer noopener">{t('لينك', 'Link')}</a>}
                      </span>
                    </div>
                    {canManage && (
                      <Button variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void remove(session.id)} aria-label={t('حذف', 'Delete')} />
                    )}
                  </div>
                ))}
                {(calendar.data?.contests ?? []).map((contest) => (
                  <div key={`contest-${contest.id}`} className="icpc-row">
                    <div className="icpc-row-main">
                      <span className="icpc-row-title">{contest.name}</span>
                      <span className="icpc-row-sub">
                        <Chip tone="warning">{t('مسابقة', 'Contest')}</Chip>
                        <span>{date(contest.starts_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </Panel>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('جلسة تدريب جديدة', 'New training session')}
        maxWidth="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={() => void submit()} isLoading={saveSession.isPending} disabled={!draft.title.trim()}>{t('حفظ', 'Save')}</Button>
          </>
        )}
      >
        <div className="icpc-form-grid">
          <label className="icpc-field icpc-span-2">
            <span>{t('العنوان', 'Title')}</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('النوع', 'Kind')}</span>
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as IcpcSession['kind'] })}>
              {KINDS.map((entry) => <option key={entry.value} value={entry.value}>{entry[locale]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('الموعد', 'When')}</span>
            <input type="datetime-local" value={draft.starts_at} onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('المدة (دقيقة)', 'Duration (min)')}</span>
            <input type="number" min={15} max={600} value={draft.duration_minutes} onChange={(event) => setDraft({ ...draft, duration_minutes: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('الموضوع', 'Topic')}</span>
            <input value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('المكان', 'Location')}</span>
            <input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('لينك أونلاين', 'Online link')}</span>
            <input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
          </label>
        </div>
      </Modal>
    </div>
  );
}
