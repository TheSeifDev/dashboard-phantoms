import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';
import { useMemberTeamDirectory } from '../members/api';
import {
  fetchMeetingRoster,
  useDeleteMeeting,
  useMarkAttendance,
  useMeetingRoster,
  useMeetings,
  useSetAttendance,
} from './api';
import { MeetingEditorModal } from './MeetingEditorModal';
import { MeetingScanPanel } from './MeetingScanPanel';
import { exportAllMeetings, exportMeetingRoster } from './exportMeetings';
import { describeAudience, type Meeting, type MeetingRoster } from './types';
import './meetings.css';

type Filter = 'all' | 'upcoming' | 'past' | 'cancelled';

const AR_DATE = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const AR_TIME = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });

function meetingEnd(meeting: Pick<Meeting, 'starts_at' | 'duration_minutes'>): number {
  return new Date(meeting.starts_at).getTime() + meeting.duration_minutes * 60_000;
}

function isPast(meeting: Pick<Meeting, 'starts_at' | 'duration_minutes'>): boolean {
  return meetingEnd(meeting) < Date.now();
}

function ratio(present: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((present / expected) * 100));
}

export default function MeetingsPage() {
  const { t, number, dir } = useLocale();
  const meetings = useMeetings();
  const teams = useMemberTeamDirectory();
  const deleteMeeting = useDeleteMeeting();
  const markAttendance = useMarkAttendance();
  const setAttendance = useSetAttendance();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [presentOnly, setPresentOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingOne, setExportingOne] = useState(false);

  const allMeetings = useMemo(() => meetings.data?.meetings ?? [], [meetings.data]);
  const teamNames = useMemo(() => new Map((teams.data?.teams ?? []).map((team) => [team.slug, team.name])), [teams.data]);

  useEffect(() => {
    if (selectedId !== null && allMeetings.some((meeting) => meeting.id === selectedId)) return;
    setSelectedId(allMeetings[0]?.id ?? null);
  }, [allMeetings, selectedId]);

  const selected = allMeetings.find((meeting) => meeting.id === selectedId) ?? null;
  const roster = useMeetingRoster(selectedId);

  const metrics = useMemo(() => {
    const online = allMeetings.filter((meeting) => meeting.mode === 'online').length;
    const offline = allMeetings.length - online;
    const expected = allMeetings.reduce((sum, meeting) => sum + meeting.expected, 0);
    const present = allMeetings.reduce((sum, meeting) => sum + meeting.present, 0);
    return { online, offline, expected, present, rate: ratio(present, expected) };
  }, [allMeetings]);

  const visibleMeetings = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return allMeetings.filter((meeting) => {
      if (filter === 'upcoming' && (isPast(meeting) || meeting.status === 'cancelled')) return false;
      if (filter === 'past' && !isPast(meeting)) return false;
      if (filter === 'cancelled' && meeting.status !== 'cancelled') return false;
      if (!needle) return true;
      const haystack = `${meeting.title} ${meeting.description ?? ''} ${meeting.location ?? ''} ${meeting.online_url ?? ''}`;
      return haystack.toLocaleLowerCase().includes(needle);
    });
  }, [allMeetings, filter, query]);

  const rosterRows = useMemo(() => {
    const rows = roster.data?.members ?? [];
    const needle = rosterQuery.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (presentOnly && !row.present) return false;
      if (!needle) return true;
      return `${row.full_name} ${row.academic_number ?? ''}`.toLocaleLowerCase().includes(needle);
    });
  }, [roster.data, rosterQuery, presentOnly]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (meeting: Meeting) => {
    setEditing(meeting);
    setEditorOpen(true);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMeeting.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذف الاجتماع وسجل حضوره.', 'Meeting and its attendance log were deleted.'));
      setPendingDelete(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف الاجتماع.', 'Could not delete the meeting.'));
    }
  };

  const toggleAttendance = async (memberId: number, present: boolean) => {
    if (!selected) return;
    try {
      await setAttendance.mutateAsync({ meetingId: selected.id, memberId, present });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نعدّل الحضور.', 'Could not update attendance.'));
    }
  };

  const exportOne = async () => {
    if (!roster.data) return;
    setExportingOne(true);
    try {
      await exportMeetingRoster(roster.data);
      toast.success(t('نزل ملف الحضور.', 'Attendance file downloaded.'));
    } catch {
      toast.error(t('معرفناش نصدّر الملف.', 'Could not export the file.'));
    } finally {
      setExportingOne(false);
    }
  };

  const exportEverything = async () => {
    if (allMeetings.length === 0) {
      toast.error(t('مفيش اجتماعات للتصدير.', 'There are no meetings to export.'));
      return;
    }
    setExporting(true);
    try {
      const rosters: MeetingRoster[] = [];
      for (const meeting of allMeetings) rosters.push(await fetchMeetingRoster(meeting.id));
      await exportAllMeetings(allMeetings, rosters);
      toast.success(t('نزل ملف الحضور المجمع (ملخص + اجتماعات + أعضاء).', 'Aggregate attendance file downloaded (summary, meetings, members).'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نصدّر الملف المجمع.', 'Could not export the aggregate file.'));
    } finally {
      setExporting(false);
    }
  };

  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: 'all', label: t('الكل', 'All'), count: allMeetings.length },
    { value: 'upcoming', label: t('قادم', 'Upcoming'), count: allMeetings.filter((meeting) => !isPast(meeting) && meeting.status !== 'cancelled').length },
    { value: 'past', label: t('خلص', 'Past'), count: allMeetings.filter(isPast).length },
    { value: 'cancelled', label: t('ملغي', 'Cancelled'), count: allMeetings.filter((meeting) => meeting.status === 'cancelled').length },
  ];

  return (
    <div className="mtg-page" dir={dir}>
      <PageHeader
        icon={<CalendarCheck2 size={22} aria-hidden="true" />}
        title={t('الاجتماعات والحضور', 'Meetings & attendance')}
        description={t('أنشئ اجتماع أونلاين أو أوفلاين، حدد جمهوره، وسجّل الحضور بالـQR أو يدويًا — والتصدير لـExcel جاهز لكل اجتماع وللمجموع.', 'Create online or onsite meetings, target an audience, capture attendance by QR or manually, and export per meeting or in aggregate.')}
        actions={
          <>
            <Button variant="secondary" icon={<Download size={16} aria-hidden="true" />} onClick={() => void exportEverything()} isLoading={exporting} loadingText={t('بيتصدّر...', 'Exporting…')}>
              {t('تصدير كل الحضور', 'Export all attendance')}
            </Button>
            <Button icon={<Plus size={17} aria-hidden="true" />} onClick={openCreate}>{t('اجتماع جديد', 'New meeting')}</Button>
          </>
        }
      />

      <section className="mtg-metrics" aria-label={t('ملخص الاجتماعات', 'Meetings summary')}>
        <div className="mtg-metric">
          <span>{t('إجمالي الاجتماعات', 'Total meetings')}<CalendarDays size={15} aria-hidden="true" /></span>
          <strong>{number(allMeetings.length)}</strong>
          <small>{t('أونلاين وأوفلاين', 'Online and onsite')}</small>
        </div>
        <div className="mtg-metric">
          <span>{t('أونلاين', 'Online')}<Video size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.online)}</strong>
          <small>{t('برابط اجتماع', 'With a meeting link')}</small>
        </div>
        <div className="mtg-metric">
          <span>{t('أوفلاين', 'Onsite')}<MapPin size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.offline)}</strong>
          <small>{t('بمكان محدد', 'With a location')}</small>
        </div>
        <div className="mtg-metric">
          <span>{t('نسبة الحضور', 'Attendance rate')}<CheckCircle2 size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.rate)}%</strong>
          <small>{t(`${number(metrics.present)} من ${number(metrics.expected)} متوقع`, `${number(metrics.present)} of ${number(metrics.expected)} expected`)}</small>
        </div>
      </section>

      <div className="mtg-layout">
        <section className="mtg-panel" aria-label={t('سجل الاجتماعات', 'Meetings register')}>
          <div className="mtg-panel-head">
            <h2><CalendarClock size={16} aria-hidden="true" />{t('سجل الاجتماعات', 'Meetings register')}</h2>
            <p>{meetings.data ? t(`عرض ${number(visibleMeetings.length)} من ${number(allMeetings.length)}`, `Showing ${number(visibleMeetings.length)} of ${number(allMeetings.length)}`) : t('بيتحمّل…', 'Loading…')}</p>
          </div>
          <div className="mtg-toolbar">
            <div className="mtg-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث بالعنوان أو المكان…', 'Search title or place…')} aria-label={t('بحث الاجتماعات', 'Search meetings')} />
            </div>
            <div className="mtg-filters" role="group" aria-label={t('تصفية الاجتماعات', 'Filter meetings')}>
              {filters.map((option) => (
                <button key={option.value} type="button" className="mtg-filter" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label} · {number(option.count)}
                </button>
              ))}
            </div>
          </div>
          {meetings.isPending && <CardSkeletons count={3} />}
          {meetings.isError && <ErrorState message={t('معرفناش نحمّل الاجتماعات.', 'Could not load meetings.')} onRetry={() => { void meetings.refetch(); }} />}
          {meetings.data && visibleMeetings.length === 0 && (
            <div className="mtg-empty">
              <CalendarDays size={28} strokeWidth={1.5} aria-hidden="true" />
              <p>{allMeetings.length === 0 ? t('لسه مفيش اجتماعات. ابدأ بأول اجتماع وحدد جمهوره.', 'No meetings yet. Create the first one and pick its audience.') : t('مفيش اجتماعات مطابقة للبحث أو التصفية.', 'No meetings match this search or filter.')}</p>
              {allMeetings.length === 0 && <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('اجتماع جديد', 'New meeting')}</Button>}
            </div>
          )}
          {visibleMeetings.length > 0 && (
            <div className="mtg-list" role="list">
              {visibleMeetings.map((meeting) => {
                const percent = ratio(meeting.present, meeting.expected);
                return (
                  <button
                    key={meeting.id}
                    type="button"
                    role="listitem"
                    className="mtg-row"
                    aria-current={meeting.id === selectedId}
                    onClick={() => setSelectedId(meeting.id)}
                  >
                    <div className="mtg-row-top">
                      <span className="mtg-row-title">{meeting.title}</span>
                      <span className={`mtg-chip ${meeting.status === 'cancelled' ? 'mtg-chip--cancelled' : meeting.mode === 'online' ? 'mtg-chip--online' : 'mtg-chip--offline'}`}>
                        {meeting.status === 'cancelled' ? t('ملغي', 'Cancelled') : meeting.mode === 'online' ? t('أونلاين', 'Online') : t('أوفلاين', 'Onsite')}
                      </span>
                    </div>
                    <div className="mtg-row-meta">
                      <span><Clock3 size={13} aria-hidden="true" />{AR_DATE.format(new Date(meeting.starts_at))}</span>
                      <span><Users size={13} aria-hidden="true" />{describeAudience(meeting.audience, teamNames, t)}</span>
                    </div>
                    <div className="mtg-progress">
                      <span>{number(meeting.present)}/{number(meeting.expected)}</span>
                      <span className="mtg-progress-track"><span className="mtg-progress-fill" style={{ width: `${percent}%` }} /></span>
                      <span>{number(percent)}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="mtg-detail" aria-label={t('تفاصيل الاجتماع', 'Meeting detail')}>
          {!selected && meetings.data && (
            <EmptyState title={t('اختار اجتماع من السجل', 'Pick a meeting from the register')} description={t('هتلاقي هنا السكان وكشف الحضور والتصدير.', 'The scanner, roster, and exports appear here.')} />
          )}
          {selected && (
            <>
              <div className="mtg-detail-head">
                <div className="mtg-detail-title">
                  <h2>{selected.title}</h2>
                  <p>{AR_DATE.format(new Date(selected.starts_at))} · {number(selected.duration_minutes)} {t('دقيقة', 'minutes')}</p>
                  <div className="mtg-row-meta">
                    <span className={`mtg-chip ${selected.status === 'cancelled' ? 'mtg-chip--cancelled' : selected.mode === 'online' ? 'mtg-chip--online' : 'mtg-chip--offline'}`}>
                      {selected.status === 'cancelled' ? t('ملغي', 'Cancelled') : selected.mode === 'online' ? t('أونلاين', 'Online') : t('أوفلاين', 'Onsite')}
                    </span>
                    <span><Users size={13} aria-hidden="true" />{describeAudience(selected.audience, teamNames, t)}</span>
                    {selected.mode === 'online' && selected.online_url && (
                      <a className="mtg-link" href={selected.online_url} target="_blank" rel="noreferrer"><Link2 size={13} aria-hidden="true" />{t('رابط الاجتماع', 'Meeting link')}</a>
                    )}
                    {selected.mode === 'offline' && selected.location && (
                      <span><MapPin size={13} aria-hidden="true" />{selected.location}</span>
                    )}
                  </div>
                </div>
                <div className="mtg-detail-actions">
                  <Button variant="secondary" icon={<Pencil size={15} aria-hidden="true" />} onClick={() => openEdit(selected)}>{t('تعديل', 'Edit')}</Button>
                  <Button variant="ghost" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setPendingDelete(selected)}>{t('حذف', 'Delete')}</Button>
                </div>
              </div>

              <MeetingScanPanel
                key={selected.id}
                meetingTitle={selected.title}
                disabled={selected.status === 'cancelled'}
                onMark={(code) => markAttendance.mutateAsync({ meetingId: selected.id, code })}
              />

              <div className="mtg-panel">
                <div className="mtg-roster-head">
                  <h3><Users size={16} aria-hidden="true" />{t('كشف الحضور', 'Attendance roster')}</h3>
                  <div className="mtg-row-meta">
                    <span>{t('متوقع', 'Expected')}: <strong>{number(roster.data?.expected ?? selected.expected)}</strong></span>
                    <span>{t('حاضر', 'Present')}: <strong>{number(roster.data?.present ?? selected.present)}</strong></span>
                    <span>{t('النسبة', 'Rate')}: <strong>{number(ratio(roster.data?.present ?? selected.present, roster.data?.expected ?? selected.expected))}%</strong></span>
                  </div>
                </div>
                <div className="mtg-toolbar">
                  <div className="mtg-search">
                    <Search size={16} aria-hidden="true" />
                    <input type="search" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder={t('ابحث بالاسم أو الرقم الأكاديمي…', 'Search name or academic number…')} aria-label={t('بحث في كشف الحضور', 'Search attendance roster')} />
                  </div>
                  <div className="mtg-row-meta" style={{ justifyContent: 'space-between' }}>
                    <button type="button" className="mtg-filter" aria-pressed={presentOnly} onClick={() => setPresentOnly((value) => !value)}>{t('الحاضرين بس', 'Present only')}</button>
                    <Button variant="secondary" icon={<Download size={15} aria-hidden="true" />} onClick={() => void exportOne()} isLoading={exportingOne} disabled={!roster.data}>
                      {t('تصدير الاجتماع', 'Export meeting')}
                    </Button>
                  </div>
                </div>
                {roster.isPending && <CardSkeletons count={2} />}
                {roster.isError && <ErrorState message={t('معرفناش نحمّل كشف الحضور.', 'Could not load the roster.')} onRetry={() => { void roster.refetch(); }} />}
                {roster.data && rosterRows.length === 0 && (
                  <div className="mtg-empty">
                    <Users size={26} strokeWidth={1.5} aria-hidden="true" />
                    <p>{presentOnly ? t('مفيش حد مسجل حضور لسه.', 'Nobody has checked in yet.') : t('مفيش أعضاء مطابقين للبحث.', 'No members match this search.')}</p>
                  </div>
                )}
                {rosterRows.length > 0 && (
                  <div className="mtg-roster-list">
                    {rosterRows.map((row) => (
                      <div key={row.member_id} className="mtg-person">
                        <span className="mtg-person-avatar" aria-hidden="true">{row.full_name.trim().slice(0, 1)}</span>
                        <div className="mtg-person-body">
                          <span className="mtg-person-name">{row.full_name}</span>
                          <span className="mtg-person-meta">
                            <span dir="ltr">{row.academic_number ?? '—'}</span>
                            {row.expected ? <span>{t('من الجمهور', 'In audience')}</span> : <span>{t('بره الجمهور', 'Outside audience')}</span>}
                            {row.present && row.marked_at && <span>{t('سُجل', 'Marked')} {AR_TIME.format(new Date(row.marked_at))}</span>}
                            {row.method && <span>{row.method === 'scan' ? 'QR' : t('يدوي', 'Manual')}</span>}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mtg-person-toggle"
                          data-present={row.present}
                          disabled={setAttendance.isPending || selected.status === 'cancelled'}
                          onClick={() => void toggleAttendance(row.member_id, !row.present)}
                        >
                          {row.present ? t('حاضر ✓', 'Present ✓') : t('تسجيل حضور', 'Check in')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="mtg-note">
                <CalendarClock size={15} aria-hidden="true" />
                {t('كل تسجيل حضور بيتخزن بوقت وطريقة، فالتقرير المجمع بيطلع عدد الاجتماعات وأونلاين/أوفلاين وحضور كل شخص. الاجتماعات جاهزة تربط إشعاراتها داخل المنصة بدل واتساب/تليجرام لاحقًا.', 'Every check-in stores its time and method, so the aggregate report gives meeting counts, online/onsite split, and per-person attendance. Meetings are ready to feed in-platform notifications instead of WhatsApp/Telegram later.')}
              </p>
            </>
          )}
        </section>
      </div>

      <MeetingEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        meeting={editing}
        onSaved={(id) => setSelectedId(id)}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
        title={t('حذف الاجتماع؟', 'Delete this meeting?')}
        description={t('هيتحذف الاجتماع وكل سجل حضوره نهائيًا. لو محتاج تحتفظ بالسجل، الغِ الاجتماع بدل الحذف.', 'The meeting and its whole attendance log are removed permanently. To keep the log, cancel the meeting instead.')}
        confirmLabel={t('حذف نهائي', 'Delete permanently')}
        isPending={deleteMeeting.isPending}
        pendingLabel={t('بيتحذف…', 'Deleting…')}
      />
    </div>
  );
}