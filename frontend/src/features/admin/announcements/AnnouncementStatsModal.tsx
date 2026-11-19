import { useState, useEffect } from 'react';

import AnnouncementsAPI from '../../../lib/api/announcements';
import type { Announcement, AnnouncementMemberDetail, AnnouncementStats } from '../../../types/db';
import { Modal } from '../../../components/ui/Modal';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Badge } from '../../../components/ui/Badge';

import { useLocale } from '../../../i18n/useLocale';
interface AnnouncementStatsModalProps {
  announcementId: number;
  onClose: () => void;
}

export default function AnnouncementStatsModal({
  announcementId,
  onClose,
}: AnnouncementStatsModalProps) {
  const { t, number, date, dir } = useLocale();
  const [stats, setStats] = useState<AnnouncementStats | null>(null);
  const [details, setDetails] = useState<AnnouncementMemberDetail[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsData, detailsData, announcementData] = await Promise.all([
        AnnouncementsAPI.getAnnouncementStats(announcementId),
        AnnouncementsAPI.getAnnouncementDetails(announcementId),
        AnnouncementsAPI.getAnnouncementById(announcementId),
      ]);
      setStats(statsData);
      setDetails(detailsData);
      setAnnouncement(announcementData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('حصلت مشكلة مش معروفة', 'An unknown error occurred.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcementId]);

  const getReadPercentage = () => {
    if (!stats || stats.total_recipients === 0) return 0;
    return Math.round((stats.read_count / stats.total_recipients) * 100);
  };

  const getDismissedPercentage = () => {
    if (!stats || stats.total_recipients === 0) return 0;
    return Math.round((stats.dismissed_count / stats.total_recipients) * 100);
  };

  const getViewedPercentage = () => {
    if (!stats || stats.total_recipients === 0) return 0;
    return Math.round((stats.viewed_count / stats.total_recipients) * 100);
  };

  const formatDateTime = (value: string | null) => {
    if (!value) return '—';
    return date(value, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const memberStatus = (row: AnnouncementMemberDetail): { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' } => {
    if (row.dismissed_at) return { label: t('خبّاه', 'Dismissed'), variant: 'neutral' };
    if (row.read_at) return { label: t('قرا الإعلان', 'Read'), variant: 'success' };
    if (row.viewed_at) return { label: t('فتح ومقراش', 'Opened, not read'), variant: 'warning' };
    return { label: t('لسه ما فتحش', 'Not opened yet'), variant: 'info' };
  };

  return (
    <Modal isOpen onClose={onClose} title={t("إحصائيات الإعلان", "Announcement statistics")} maxWidth="3xl">
      <div className="grid gap-8 pb-4" dir={dir}>
        {loading ? (
          <div className="grid gap-4" role="status" aria-label={t("بنحمّل الإحصائيات", "Loading statistics")}>
            <Skeleton className="h-12 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => { void loadStats(); }} />
        ) : !stats ? (
          <div className="py-12 text-center text-[var(--text-muted)]">
            {t("مفيش إحصائيات متاحة للإعلان ده", "No statistics are available for this announcement")}
          </div>
        ) : (
          <div className="grid gap-12">
            {/* Editorial Header Stats */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4 border-b border-[var(--border)] pb-8">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">{t("اللي استلموا", "Recipients")}</p>
                <p className="font-[Instrument_Serif] text-4xl text-[var(--text)]">{number(stats.total_recipients)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">{t("اتفتح", "Opened")}</p>
                <p className="font-[Instrument_Serif] text-4xl text-[var(--text)]">{number(stats.viewed_count)}</p>
                <p className="text-xs mt-1 text-[var(--text-2)]">{number(getViewedPercentage())}% {t('من الإجمالي', 'of total')}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">{t("اتقرا", "Read")}</p>
                <p className="font-[Instrument_Serif] text-4xl text-[var(--text)]">{number(stats.read_count)}</p>
                <p className="text-xs mt-1 text-[var(--text-2)]">{number(getReadPercentage())}% {t('من الإجمالي', 'of total')}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">{t("اتمسح", "Dismissed")}</p>
                <p className="font-[Instrument_Serif] text-4xl text-[var(--text)]">{number(stats.dismissed_count)}</p>
                <p className="text-xs mt-1 text-[var(--text-2)]">{number(getDismissedPercentage())}% {t('من الإجمالي', 'of total')}</p>
              </div>
            </div>

            {/* حالة إرسال الواتساب */}
            {announcement?.send_whatsapp ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-sm leading-7 text-[var(--text-2)]">
                <h4 className="mb-1 font-bold text-[var(--text)]">{t("إرسال الواتساب", "WhatsApp delivery")}</h4>
                {announcement.whatsapp_sent_at ? (
                  <>
                    <p>
                      {t("وصل لـ", "Sent to")} <strong>{number(announcement.whatsapp_sent_count)}</strong> {t("عضو", "members")}
                      {' — '}{formatDateTime(announcement.whatsapp_sent_at)}
                    </p>
                    {Array.isArray(announcement.whatsapp_errors) && announcement.whatsapp_errors.length > 0 ? (
                      <ul className="mt-2 grid gap-1 text-[var(--danger)]">
                        {announcement.whatsapp_errors.slice(0, 10).map((err, idx) => (
                          <li key={idx}>• {String(err)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[var(--success-text)] dark:text-[var(--success-text)]">{t("مفيش أخطاء متسجلة.", "No errors recorded.")}</p>
                    )}
                  </>
                ) : (
                  <p>{t("لسه مفيش إرسال واتساب متسجل للإعلان ده (ممكن الطلب يكون فشل قبل ما يوصل للجسر).", "No WhatsApp send is recorded for this announcement yet; the request may have failed before reaching the bridge.")}</p>
                )}
              </div>
            ) : null}

            {/* تفاصيل كل عضو */}
            <div>
              <div className="mb-4 flex items-baseline justify-between">
                <h4 className="font-bold text-[var(--text)]">{t("تفاصيل اللي استلموا", "Recipient details")} ({number(details.length)})</h4>
              </div>
              {details.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t("مفيش حد استلم الإعلان ده.", "No one received this announcement.")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-start">
                    <thead className="border-b border-[var(--border)]">
                      <tr className="text-xs text-[var(--text-muted)]">
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("العضو", "Member")}</th>
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("الحالة", "Status")}</th>
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("أول فتح", "First opened")}</th>
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("آخر فتح (مرات)", "Last opened (count)")}</th>
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("اتقرا", "Read")}</th>
                        <th className="pb-3 text-start font-bold whitespace-nowrap px-2">{t("اتمسح", "Dismissed")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {details.map((row) => {
                        const status = memberStatus(row);
                        return (
                          <tr key={row.member_id} className="hover:bg-[var(--surface-2)]/50 transition-colors">
                            <td className="py-3 px-2 whitespace-nowrap">
                              <p className="font-bold text-[var(--text)]">{row.full_name}</p>
                              <p className="text-xs text-[var(--text-muted)] font-[Geist]">{row.email}</p>
                            </td>
                            <td className="py-3 px-2 whitespace-nowrap">
                              <Badge variant={status.variant === 'success' ? 'success' : status.variant === 'warning' ? 'warning' : status.variant === 'info' ? 'info' : 'neutral'}>
                                {status.label}
                              </Badge>
                            </td>
                            <td className="py-3 px-2 whitespace-nowrap text-[var(--text-2)] font-[Geist]">{formatDateTime(row.viewed_at)}</td>
                            <td className="py-3 px-2 whitespace-nowrap text-[var(--text-2)] font-[Geist]">
                              {row.view_count > 0 ? `${formatDateTime(row.last_viewed_at)} (${row.view_count})` : '—'}
                            </td>
                            <td className="py-3 px-2 whitespace-nowrap text-[var(--text-2)] font-[Geist]">{formatDateTime(row.read_at)}</td>
                            <td className="py-3 px-2 whitespace-nowrap text-[var(--text-2)] font-[Geist]">{formatDateTime(row.dismissed_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* معلومات إضافية */}
            {stats.total_recipients > 0 && (
              <div className="border-t border-[var(--border)] pt-6 text-sm text-[var(--text-2)] max-w-prose leading-relaxed">
                <p>
                  <strong>{t('ملحوظة:', 'Note:')}</strong> {t('لو نسبة القراءة قليلة، جرّب تغيّر وقت الإرسال أو تستخدم عناوين تشد أكتر. ولو نسبة المسح عالية، راجع محتوى الإعلانات وخليه أفيد.', 'If the read rate is low, try changing the send time or using more engaging titles. If the dismissal rate is high, review the announcement content and make it more useful.')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
