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
import { AR, arCount } from '../../../lib/arabic';

interface MemberAnnouncementsProps {
  memberId: number;
}

export default function MemberAnnouncements({ memberId }: MemberAnnouncementsProps) {
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
      setError(err instanceof Error ? err.message : 'حصلت مشكلة وإحنا بنحمّل الإعلانات');
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
        toast.success('الإعلان اتعلّم كمقروء.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'معرفناش نعلّم الإعلان كمقروء.');
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
      toast.success('الإعلان اتخفى.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'معرفناش نخفي الإعلان.');
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
        return <AlertTriangle className="text-red-600 dark:text-red-400" size={18} aria-hidden="true" />;
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
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateString));
  };

  const unreadCount = announcements.filter(ann => !ann.is_read).length;

  if (loading) {
    return (
      <div dir="rtl" aria-label="بنحمّل الإعلانات">
        <CardSkeletons count={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div dir="rtl">
        <ErrorState message={error} onRetry={() => { void loadAnnouncements(); }} />
      </div>
    );
  }

  return (
    <section className="grid gap-3" dir="rtl" aria-labelledby="member-announcements-title">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
            <Bell size={20} aria-hidden="true" />
          </span>
          <h2 id="member-announcements-title" className="text-lg font-black text-[var(--text)]">الإعلانات</h2>
          {unreadCount > 0 && (
            <Badge variant="danger">
              {unreadCount === 1 ? 'جديد' : `${unreadCount} جديدة`}
            </Badge>
          )}
        </div>

        {announcements.length > 0 && (
          <p className="shrink-0 text-sm text-[var(--text-muted)]">
            {arCount(announcements.length, AR.announcement)}
          </p>
        )}
      </div>

      {announcements.length === 0 ? (
        <EmptyState title="مفيش إعلانات" description="هتظهر هنا الإعلانات الجديدة من الإدارة." />
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
                    <h3 className="font-black text-[var(--text)]">
                      {announcement.title}
                    </h3>
                    <Badge variant={getPriorityVariant(announcement.priority)}>
                      {AnnouncementsAPI.getPriorityLabel(announcement.priority)}
                    </Badge>
                    {!announcement.is_read && (
                      <Badge variant="info">
                        جديد
                      </Badge>
                    )}
                  </div>

                  <time className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDate(announcement.created_at)}
                  </time>
                </div>

                {/* Content */}
                <p className={`text-sm leading-6 ${
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
                        loadingText="بنحمّل..."
                        icon={<Check size={16} aria-hidden="true" />}
                      >
                        علّم كمقروء
                      </Button>
                    ) : (
                      <span className="flex min-h-11 items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCheck size={16} aria-hidden="true" />
                        اتقرا
                      </span>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => handleDismiss(announcement.id)}
                    isLoading={actionsLoading.has(announcement.id)}
                    loadingText="بنخفي..."
                    icon={<EyeOff size={16} aria-hidden="true" />}
                    aria-label={`خبّي إعلان ${announcement.title}`}
                  >
                    خبّي
                  </Button>
                </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
