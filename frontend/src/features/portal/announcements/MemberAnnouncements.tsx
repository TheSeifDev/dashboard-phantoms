import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, EyeOff, Clock, AlertTriangle, Info } from 'lucide-react';
import AnnouncementsAPI from '../../../lib/api/announcements';
import type { MemberAnnouncement } from '../../../types/db';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ErrorState } from '../../../components/ui/ErrorState';
import { EmptyState } from '../../../components/ui/EmptyState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { toast } from '../../../store/toast';
import { useLocale } from '../../../i18n/useLocale';

interface MemberAnnouncementsProps {
  memberId: number;
}

export default function MemberAnnouncements({ memberId }: MemberAnnouncementsProps) {
  const { t, dir, number, date } = useLocale();
  const [announcements, setAnnouncements] = useState<MemberAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionsLoading, setActionsLoading] = useState<Set<number>>(new Set());

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AnnouncementsAPI.getMemberAnnouncements(memberId);
      setAnnouncements(data);
      // تسجيل المشاهدة لكل إعلان ظهر في البوابة — حدث منفصل عن "تمت القراءة".
      // fire-and-forget: فشل التسجيل لا يعطل العرض.
      for (const ann of data) {
        void AnnouncementsAPI.markAnnouncementViewed(ann.id, memberId).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('حصلت مشكلة وإحنا بنحمّل الإعلانات', 'Something went wrong while loading announcements.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (memberId) {
      void loadAnnouncements();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const handleMarkAsRead = async (announcementId: number) => {
    if (actionsLoading.has(announcementId)) return;

    try {
      setActionsLoading(prev => new Set([...prev, announcementId]));

      const success = await AnnouncementsAPI.markAnnouncementRead(announcementId, memberId);
      if (success) {
        setAnnouncements(prev =>
          prev.map(ann =>
            ann.id === announcementId
              ? { ...ann, is_read: true }
              : ann
          )
        );
        toast.success(t('الإعلان اتعلّم كمقروء.', 'Announcement marked as read.'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('معرفناش نعلّم الإعلان كمقروء.', 'We could not mark the announcement as read.'));
    } finally {
      setActionsLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(announcementId);
        return newSet;
      });
    }
  };

  const handleDismiss = async (announcementId: number) => {
    if (actionsLoading.has(announcementId)) return;

    try {
      setActionsLoading(prev => new Set([...prev, announcementId]));

      const success = await AnnouncementsAPI.dismissAnnouncement(announcementId, memberId);
      if (success) {
        setAnnouncements(prev =>
          prev.filter(ann => ann.id !== announcementId)
        );
      toast.success(t('الإعلان اتخفى.', 'Announcement hidden.'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('معرفناش نخفي الإعلان.', 'We could not hide the announcement.'));
    } finally {
      setActionsLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(announcementId);
        return newSet;
      });
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <AlertTriangle className="text-[var(--danger-text)] dark:text-[var(--danger-text)]" size={18} aria-hidden="true" />;
      case 'high':
        return <AlertTriangle className="text-amber-600 dark:text-amber-400" size={18} aria-hidden="true" />;
      case 'normal':
        return <Info className="text-[var(--link)]" size={18} aria-hidden="true" />;
      case 'low':
        return <Clock className="text-[var(--text-muted)]" size={18} aria-hidden="true" />;
      default:
        return <Bell className="text-[var(--link)]" size={18} aria-hidden="true" />;
    }
  };

  const getPriorityVariant = (priority: string): 'neutral' | 'info' | 'warning' | 'danger' => {
    if (priority === 'urgent') return 'danger';
    if (priority === 'high') return 'warning';
    if (priority === 'normal') return 'info';
    return 'neutral';
  };

  const formatDate = (dateString: string) => {
    try {
      return date(dateString, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const unreadCount = announcements.filter(ann => !ann.is_read).length;

  if (loading) {
    return (
      <div dir={dir} role="status" aria-label={t('بنحمّل الإعلانات', 'Loading announcements')}>
        <CardSkeletons count={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div dir={dir} role="alert">
        <ErrorState message={error} onRetry={() => { void loadAnnouncements(); }} />
      </div>
    );
  }

  return (
    <section className="grid gap-3" dir={dir} aria-labelledby="member-announcements-title">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
            <Bell size={20} aria-hidden="true" />
          </span>
          <h2 id="member-announcements-title" className="text-lg font-black text-[var(--text)]">{t('الإعلانات', 'Announcements')}</h2>
          {unreadCount > 0 && (
            <Badge variant="danger">
              {unreadCount === 1 ? t('جديد', 'New') : t(`${number(unreadCount)} جديدة`, `${number(unreadCount)} new`)}
            </Badge>
          )}
        </div>

        {announcements.length > 0 && (
          <p className="shrink-0 text-sm text-[var(--text-muted)]">
            {t(`${number(announcements.length)} إعلان`, `${number(announcements.length)} announcements`)}
          </p>
        )}
      </div>

      {announcements.length === 0 ? (
        <EmptyState title={t('مفيش إعلانات', 'No announcements')} description={t('هتظهر هنا الإعلانات الجديدة من الإدارة.', 'New announcements from the administration will appear here.')} />
      ) : (
        <div className="grid gap-3">
          {announcements.map((announcement) => (
            <Card
              key={announcement.id}
              className={`grid gap-3 p-4 transition-colors sm:p-5 ${
                !announcement.is_read
                  ? 'border-s-4 border-s-[var(--primary)] bg-[var(--primary-soft)]'
                  : ''
              }`}
            >
                {/* Header with title and priority */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {getPriorityIcon(announcement.priority)}
                    <h3 dir="auto" className="font-black text-[var(--text)]">
                      {announcement.title}
                    </h3>
                    <Badge variant={getPriorityVariant(announcement.priority)}>
                      {t(AnnouncementsAPI.getPriorityLabel(announcement.priority), announcement.priority === 'urgent' ? 'Urgent' : announcement.priority === 'high' ? 'High' : announcement.priority === 'normal' ? 'Normal' : announcement.priority === 'low' ? 'Low' : announcement.priority)}
                    </Badge>
                    {!announcement.is_read && (
                      <Badge variant="info">
                        {t('جديد', 'New')}
                      </Badge>
                    )}
                  </div>

                  <time dateTime={announcement.created_at} className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDate(announcement.created_at)}
                  </time>
                </div>

                {/* Content */}
                <p dir="auto" className={`whitespace-pre-line text-sm leading-6 ${
                  !announcement.is_read ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'
                }`}>
                  {announcement.content}
                </p>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <div>
                    {!announcement.is_read ? (
                      <Button
                        variant="secondary"
                        onClick={() => handleMarkAsRead(announcement.id)}
                        isLoading={actionsLoading.has(announcement.id)}
                        loadingText={t('جارٍ الحفظ…', 'Saving…')}
                        icon={<Check size={16} aria-hidden="true" />}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                      >
                        {t('علّم كمقروء', 'Mark as read')}
                      </Button>
                    ) : (
                      <span className="flex min-h-11 items-center gap-1.5 text-sm font-bold text-[var(--success-text)] dark:text-[var(--success-text)]">
                        <CheckCheck size={16} aria-hidden="true" />
                        {t('اتقرا', 'Read')}
                      </span>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => handleDismiss(announcement.id)}
                    isLoading={actionsLoading.has(announcement.id)}
                    loadingText={t('جارٍ الإخفاء…', 'Hiding…')}
                    icon={<EyeOff size={16} aria-hidden="true" />}
                    aria-label={t(`خبّي إعلان ${announcement.title}`, `Hide announcement ${announcement.title}`)}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  >
                    {t('خبّي', 'Hide')}
                  </Button>
                </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
