import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Link2, MapPin, Save, Search, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useMemberTeamDirectory, useMembers } from '../members/api';
import { useTaskAudienceGroups } from '../tasks/api';
import { useSaveMeeting } from './api';
import type { Meeting, MeetingAudience, MeetingAudienceType, MeetingDraft, MeetingMode } from './types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  onSaved?: (id: number) => void;
}

const AUDIENCE_TYPES: Array<{ value: MeetingAudienceType; ar: string; en: string }> = [
  { value: 'all', ar: 'كل الفريق', en: 'Whole team' },
  { value: 'teams', ar: 'تيمات داخلية', en: 'Internal teams' },
  { value: 'leaders', ar: 'Heads وMonitors', en: 'Heads & monitors' },
  { value: 'members', ar: 'أعضاء محددين', en: 'Specific members' },
];

/** تحويل ISO إلى قيمة datetime-local بتوقيت مصر لعرضها في الحقل. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** فرق توقيت القاهرة لحظة معيّنة بالملي ثانية (موجب شرق جرينتش). */
function cairoOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/** القيمة المدخلة بتوقيت مصر → ISO UTC (بتحسب التوقيت الصيفي من المتصفح). */
export function fromLocalInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return '';
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // تمريرتان: الأولى تختار الإزاحة الغالبة، والتانية تثبتها لو الميعاد قريب من تغيير التوقيت.
  const firstPass = naive - cairoOffsetMs(new Date(naive));
  const stable = naive - cairoOffsetMs(new Date(firstPass));
  return new Date(stable).toISOString();
}

export function MeetingEditorModal({ isOpen, onClose, meeting, onSaved }: Props) {
  const { t, number } = useLocale();
  const formId = useId();
  const save = useSaveMeeting();
  const teams = useMemberTeamDirectory(isOpen);
  const members = useMembers();
  const audienceGroups = useTaskAudienceGroups(isOpen);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<MeetingMode>('offline');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');
  const [onlineUrl, setOnlineUrl] = useState('');
  const [audienceType, setAudienceType] = useState<MeetingAudienceType>('all');
  const [teamSlugs, setTeamSlugs] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'scheduled' | 'cancelled'>('scheduled');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setQuery('');
    if (meeting) {
      setTitle(meeting.title);
      setDescription(meeting.description ?? '');
      setMode(meeting.mode);
      setStartsAt(toLocalInput(meeting.starts_at));
      setDuration(meeting.duration_minutes);
      setLocation(meeting.location ?? '');
      setOnlineUrl(meeting.online_url ?? '');
      setAudienceType(meeting.audience.type);
      setTeamSlugs(meeting.audience.teams ?? []);
      setMemberIds((meeting.audience.member_ids ?? []).map(String));
      setStatus(meeting.status);
    } else {
      const next = new Date(Date.now() + 60 * 60 * 1000);
      next.setMinutes(0, 0, 0);
      setTitle('');
      setDescription('');
      setMode('offline');
      setStartsAt(toLocalInput(next.toISOString()));
      setDuration(60);
      setLocation('');
      setOnlineUrl('');
      setAudienceType('all');
      setTeamSlugs([]);
      setMemberIds([]);
      setStatus('scheduled');
    }
  }, [isOpen, meeting]);

  const leaderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of audienceGroups.data?.leads ?? []) ids.add(String(id));
    for (const id of audienceGroups.data?.heads ?? []) ids.add(String(id));
    return ids;
  }, [audienceGroups.data]);

  const sortedMembers = useMemo(() => {
    const list = (members.data ?? []).filter((member) => member.work_status !== 'inactive' && member.work_status !== 'archived');
    const needle = query.trim().toLocaleLowerCase();
    return list
      .filter((member) => !needle || `${member.full_name} ${member.academic_number ?? ''}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  }, [members.data, query]);

  const toggleTeam = (slug: string) => {
    setTeamSlugs((current) => (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]));
  };

  const toggleMember = (id: number) => {
    const key = String(id);
    setMemberIds((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const audience: MeetingAudience = useMemo(() => {
    if (audienceType === 'teams') return { type: 'teams', teams: teamSlugs };
    if (audienceType === 'members') return { type: 'members', member_ids: memberIds };
    return { type: audienceType };
  }, [audienceType, teamSlugs, memberIds]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (title.trim().length < 2) {
      setError(t('عنوان الاجتماع لازم يكون حرفين على الأقل.', 'Meeting title needs at least two characters.'));
      return;
    }
    if (!startsAt) {
      setError(t('حدد ميعاد الاجتماع.', 'Pick a meeting time.'));
      return;
    }
    if (mode === 'online' && !/^https?:\/\//i.test(onlineUrl.trim())) {
      setError(t('رابط الاجتماع لازم يبدأ بـ http أو https.', 'The meeting link must start with http or https.'));
      return;
    }
    if (mode === 'offline' && !location.trim()) {
      setError(t('حدد مكان الاجتماع الأوفلاين.', 'Add the offline meeting location.'));
      return;
    }
    if (audienceType === 'teams' && teamSlugs.length === 0) {
      setError(t('اختار تيم داخلي واحد على الأقل.', 'Choose at least one internal team.'));
      return;
    }
    if (audienceType === 'members' && memberIds.length === 0) {
      setError(t('اختار عضو واحد على الأقل.', 'Choose at least one member.'));
      return;
    }
    const draft: MeetingDraft = {
      id: meeting?.id,
      title: title.trim(),
      description: description.trim(),
      mode,
      starts_at: fromLocalInput(startsAt),
      duration_minutes: duration,
      location: mode === 'offline' ? location.trim() : '',
      online_url: mode === 'online' ? onlineUrl.trim() : '',
      audience,
      status,
    };
    try {
      const result = await save.mutateAsync(draft);
      toast.success(meeting ? t('اتعدّل الاجتماع.', 'Meeting updated.') : t('اتعمل الاجتماع وجمهوره جاهز للحضور.', 'Meeting created with its audience.'));
      onSaved?.(result.id);
      onClose();
    } catch (cause) {
      setError(toAppError(cause, t('معرفناش نحفظ الاجتماع.', 'Could not save the meeting.')).message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={meeting ? t('تعديل الاجتماع', 'Edit meeting') : t('اجتماع جديد', 'New meeting')}
      subtitle={t('حدد الميعاد والجمهور — والحضور هيتسجل بالـQR أو يدوي.', 'Set the time and audience — attendance is captured by QR or manually.')}
      icon={<CalendarClock size={18} aria-hidden="true" />}
      maxWidth="2xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" form={formId} icon={<Save size={16} aria-hidden="true" />} isLoading={save.isPending}>
            {meeting ? t('حفظ التعديل', 'Save changes') : t('إنشاء الاجتماع', 'Create meeting')}
          </Button>
        </div>
      }
    >
      <form id={formId} className="mtg-form" onSubmit={(event) => void submit(event)}>
        {error && <p className="mtg-scan-feedback mtg-scan-feedback--bad" role="alert">{error}</p>}

        <label className="mtg-field">
          {t('عنوان الاجتماع', 'Meeting title')}
          <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={160} placeholder={t('مثال: مراجعة أسبوعية لتيم Software', 'e.g. Software weekly review')} />
        </label>

        <label className="mtg-field">
          {t('وصف مختصر (اختياري)', 'Short description (optional)')}
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={800} placeholder={t('أجندة الاجتماع أو أي ملاحظات للأعضاء.', 'Agenda or notes for attendees.')} />
        </label>

        <div className="mtg-choices" role="group" aria-label={t('نوع الاجتماع', 'Meeting mode')}>
          <button type="button" className="mtg-choice" aria-pressed={mode === 'offline'} onClick={() => setMode('offline')}>
            <MapPin size={14} aria-hidden="true" />{t('أوفلاين', 'Onsite')}
          </button>
          <button type="button" className="mtg-choice" aria-pressed={mode === 'online'} onClick={() => setMode('online')}>
            <Link2 size={14} aria-hidden="true" />{t('أونلاين', 'Online')}
          </button>
          <button type="button" className="mtg-choice" aria-pressed={status === 'scheduled'} onClick={() => setStatus('scheduled')}>
            {t('مجدول', 'Scheduled')}
          </button>
          <button type="button" className="mtg-choice" aria-pressed={status === 'cancelled'} onClick={() => setStatus('cancelled')}>
            {t('ملغي', 'Cancelled')}
          </button>
        </div>

        <div className="mtg-form-grid">
          <label className="mtg-field">
            {t('ميعاد البداية (توقيت مصر)', 'Start time (Cairo)')}
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
          </label>
          <label className="mtg-field">
            {t('المدة بالدقائق', 'Duration (minutes)')}
            <input type="number" min={15} max={480} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value) || 60)} required />
          </label>
        </div>

        {mode === 'online' ? (
          <label className="mtg-field">
            {t('رابط الاجتماع', 'Meeting link')}
            <input type="url" dir="ltr" value={onlineUrl} onChange={(event) => setOnlineUrl(event.target.value)} placeholder="https://meet.google.com/…" required />
          </label>
        ) : (
          <label className="mtg-field">
            {t('مكان الاجتماع', 'Location')}
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={t('مثال: قاعة الكلية — الدور الثاني', 'e.g. Faculty hall — second floor')} required />
          </label>
        )}

        <div className="mtg-field">
          {t('مين يحضر؟', 'Who attends?')}
          <div className="mtg-choices" role="group" aria-label={t('نوع الجمهور', 'Audience type')}>
            {AUDIENCE_TYPES.map((option) => (
              <button key={option.value} type="button" className="mtg-choice" aria-pressed={audienceType === option.value} onClick={() => setAudienceType(option.value)}>
                {t(option.ar, option.en)}
              </button>
            ))}
          </div>
        </div>

        {audienceType === 'teams' && (
          <div className="grid gap-2">
            {teams.isPending && <p className="mtg-help">{t('بنحمّل التيمات…', 'Loading teams…')}</p>}
            {teams.data && teams.data.teams.length === 0 && <p className="mtg-help">{t('مفيش تيمات داخلية متاحة.', 'No internal teams available.')}</p>}
            <div className="mtg-choices">
              {(teams.data?.teams ?? []).map((team) => (
                <button key={team.slug} type="button" className="mtg-choice" aria-pressed={teamSlugs.includes(team.slug)} onClick={() => toggleTeam(team.slug)}>
                  {team.name}
                </button>
              ))}
            </div>
            <p className="mtg-help">{t('الجمهور بيتحسب من عضويات التيمات النشطة وقت الحفظ.', 'Audience resolves from active team memberships when saved.')}</p>
          </div>
        )}

        {audienceType === 'leaders' && (
          <p className="mtg-help">
            {t(`هيتضمن ${number(leaderIds.size)} من Heads وMonitors المسندين حاليًا في الفرق.`, `Includes ${number(leaderIds.size)} currently assigned heads and monitors.`)}
          </p>
        )}

        {audienceType === 'members' && (
          <div className="grid gap-2">
            <div className="mtg-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث بالاسم أو الرقم الأكاديمي', 'Search by name or academic number')} aria-label={t('بحث الأعضاء', 'Search members')} />
            </div>
            {members.isPending && <p className="mtg-help">{t('بنحمّل الأعضاء…', 'Loading members…')}</p>}
            <div className="mtg-audience-grid">
              {sortedMembers.map((member) => (
                <label key={member.id} className="mtg-audience-option">
                  <input type="checkbox" checked={memberIds.includes(String(member.id))} onChange={() => toggleMember(member.id)} />
                  <span>{member.full_name}</span>
                  <small dir="ltr">{member.academic_number ?? '—'}</small>
                </label>
              ))}
            </div>
            <p className="mtg-help">{t(`مختار ${number(memberIds.length)} عضو.`, `${number(memberIds.length)} members selected.`)}</p>
          </div>
        )}

        <p className="mtg-note">
          <Users size={15} aria-hidden="true" />
          {t('الحضور هيتسجل من كود الـQR اللي جوه بوابة العضو (مبني على الرقم الأكاديمي)، أو يدويًا من كشف الحضور.', 'Attendance is captured from the member’s portal QR code (built from the academic number) or manually from the roster.')}
        </p>
      </form>
    </Modal>
  );
}
