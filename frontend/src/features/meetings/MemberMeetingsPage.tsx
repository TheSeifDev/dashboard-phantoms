import { useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CalendarCheck2, CalendarClock, CheckCircle2, Clock3, History, Link2, MapPin, QrCode, TriangleAlert, Video, XCircle } from 'lucide-react';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { useMemberMeetings } from './api';
import type { MemberMeetingCard } from './types';
import './meetings.css';

const AR_DATE = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const AR_DAY = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });

/** تطبيع الرقم الأكاديمي بنفس منطق الخادم: حروف وأرقام كبيرة فقط. */
export function normalizeAcademicCode(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export default function MemberMeetingsPage() {
  const { t, number, dir } = useLocale();
  const member = useAuthStore((state) => state.currentMember);
  const meetings = useMemberMeetings(Boolean(member));
  const payload = meetings.data;

  const code = useMemo(() => normalizeAcademicCode(payload?.member.academic_number ?? member?.academic_number), [payload?.member.academic_number, member?.academic_number]);

  const stats = payload?.stats;
  const rate = stats && stats.total > 0 ? Math.round((stats.attended / stats.total) * 100) : 0;

  return (
    <div className="mtg-page" dir={dir}>
      <PageHeader
        icon={<CalendarCheck2 size={22} aria-hidden="true" />}
        title={t('اجتماعاتي والحضور', 'My meetings & attendance')}
        description={t('كود الـQR بتاعك هو اللي بيتعمله سكان في الاجتماعات الأوفلاين. هنا كمان كل اجتماع جاي وحاضر وسجل حضورك.', 'Your QR is what gets scanned at onsite meetings. Upcoming meetings, links, and your attendance history live here too.')}
      />

      {meetings.isPending && <CardSkeletons count={3} />}
      {meetings.isError && <ErrorState message={t('معرفناش نحمّل اجتماعاتك.', 'Could not load your meetings.')} onRetry={() => { void meetings.refetch(); }} />}

      {payload && (
        <div className="mtg-layout">
          <aside className="grid gap-3.5">
            <section className="mtg-qr-card" aria-label={t('كود الحضور', 'Attendance code')}>
              <div className="mtg-scan-title" style={{ justifyContent: 'center' }}>
                <span><QrCode size={16} aria-hidden="true" /> {t('كود حضورك', 'Your check-in code')}</span>
              </div>
              {code ? (
                <>
                  <div className="mtg-qr-plate">
                    <QRCodeSVG value={code} size={188} level="M" bgColor="#FFFFFF" fgColor="#0B1020" marginSize={0} title={t('كود حضور العضو', 'Member check-in code')} />
                  </div>
                  <p className="mtg-qr-code" dir="ltr">{code}</p>
                  <p className="mtg-qr-hint">{t('الإدارة بتمسح الكود ده في الاجتماع الأوفلاين. لو الكاميرا مش متاحة، رقمك الأكاديمي بيكفي.', 'Admins scan this code at onsite meetings. If the camera fails, your academic number works too.')}</p>
                </>
              ) : (
                <div className="grid justify-items-center gap-2 py-4">
                  <TriangleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
                  <p className="mtg-qr-hint">{t('رقمك الأكاديمي مش مسجل لسه — كمّل بياناتك من الحساب والإعدادات عشان الكود يشتغل.', 'Your academic number is missing — complete your profile in account settings so the code can be issued.')}</p>
                </div>
              )}
            </section>

            <section className="mtg-metrics" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} aria-label={t('ملخص حضورك', 'Attendance summary')}>
              <div className="mtg-metric">
                <span>{t('حضرت', 'Attended')}<CheckCircle2 size={15} aria-hidden="true" /></span>
                <strong>{number(stats?.attended ?? 0)}</strong>
                <small>{t(`من ${number(stats?.total ?? 0)} اجتماع`, `of ${number(stats?.total ?? 0)} meetings`)}</small>
              </div>
              <div className="mtg-metric">
                <span>{t('نسبة الحضور', 'Rate')}<CalendarClock size={15} aria-hidden="true" /></span>
                <strong>{number(rate)}%</strong>
                <small>{t('على اجتماعات جمهورك', 'Across your meetings')}</small>
              </div>
              <div className="mtg-metric">
                <span>{t('أونلاين', 'Online')}<Video size={15} aria-hidden="true" /></span>
                <strong>{number(stats?.online ?? 0)}</strong>
                <small>{t('حضور أونلاين', 'Online attendance')}</small>
              </div>
              <div className="mtg-metric">
                <span>{t('أوفلاين', 'Onsite')}<MapPin size={15} aria-hidden="true" /></span>
                <strong>{number(stats?.offline ?? 0)}</strong>
                <small>{t('حضور بالـQR', 'Checked in by QR')}</small>
              </div>
            </section>
          </aside>

          <div className="grid gap-3.5">
            <section className="mtg-panel">
              <div className="mtg-panel-head">
                <h2><CalendarClock size={16} aria-hidden="true" />{t('الاجتماعات الجاية', 'Upcoming meetings')}</h2>
                <p>{t(`${number(payload.upcoming.length)} اجتماع`, `${number(payload.upcoming.length)} meetings`)}</p>
              </div>
              <div className="grid gap-3 p-4">
                {payload.upcoming.length === 0 && <p className="mtg-qr-hint" style={{ maxWidth: 'none' }}>{t('مفيش اجتماعات جاية لجمهورك دلوقتي.', 'No upcoming meetings for your audience right now.')}</p>}
                {payload.upcoming.map((meeting: MemberMeetingCard) => (
                  <article key={meeting.id} className="mtg-meeting-card">
                    <header>
                      <h3>{meeting.title}</h3>
                      <span className={`mtg-chip ${meeting.mode === 'online' ? 'mtg-chip--online' : 'mtg-chip--offline'}`}>
                        {meeting.mode === 'online' ? t('أونلاين', 'Online') : t('أوفلاين', 'Onsite')}
                      </span>
                    </header>
                    <p><Clock3 size={13} aria-hidden="true" style={{ display: 'inline', marginInlineEnd: 6 }} />{AR_DATE.format(new Date(meeting.starts_at))} · {number(meeting.duration_minutes)} {t('دقيقة', 'minutes')}</p>
                    {meeting.description && <p>{meeting.description}</p>}
                    <div className="mtg-meeting-links">
                      {meeting.mode === 'online' && meeting.online_url && (
                        <a className="mtg-link" href={meeting.online_url} target="_blank" rel="noreferrer"><Link2 size={13} aria-hidden="true" />{t('ادخل الاجتماع', 'Join meeting')}</a>
                      )}
                      {meeting.mode === 'offline' && meeting.location && (
                        <span className="mtg-link"><MapPin size={13} aria-hidden="true" />{meeting.location}</span>
                      )}
                      {meeting.present && <span className="mtg-chip mtg-chip--offline"><CheckCircle2 size={12} aria-hidden="true" />{t('حضورك مسجل', 'Checked in')}</span>}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mtg-panel">
              <div className="mtg-panel-head">
                <h2><History size={16} aria-hidden="true" />{t('سجل الحضور', 'Attendance history')}</h2>
                <p>{t('آخر 40 اجتماع', 'Latest 40 meetings')}</p>
              </div>
              {payload.history.length === 0 ? (
                <div className="mtg-empty"><History size={26} strokeWidth={1.5} aria-hidden="true" /><p>{t('لسه مفيش سجل — أول اجتماع يخلص هيظهر هنا.', 'No history yet — it appears after your first meeting ends.')}</p></div>
              ) : (
                <div className="mtg-history">
                  {payload.history.map((entry) => (
                    <div key={entry.id} className="mtg-history-row">
                      <div className="grid gap-0.5">
                        <strong>{entry.title}</strong>
                        <span className="mtg-person-meta"><span>{AR_DAY.format(new Date(entry.starts_at))}</span><span>{entry.mode === 'online' ? t('أونلاين', 'Online') : t('أوفلاين', 'Onsite')}</span></span>
                      </div>
                      {entry.present ? (
                        <span className="mtg-chip mtg-chip--offline"><CheckCircle2 size={12} aria-hidden="true" />{t('حاضر', 'Present')}</span>
                      ) : (
                        <span className="mtg-chip mtg-chip--cancelled"><XCircle size={12} aria-hidden="true" />{t('غائب', 'Absent')}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <p className="mtg-note">
              <QrCode size={15} aria-hidden="true" />
              {t('الكود مبني على رقمك الأكاديمي ومش بيتغير. لو الرقم اتعدّل من الإدارة، الكود الجديد بيظهر هنا تلقائي.', 'The code is built from your academic number and stays stable. If the number changes, the new code appears here automatically.')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}