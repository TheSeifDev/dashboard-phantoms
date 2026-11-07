import { useState, useEffect } from 'react';
import { Plus, Eye, MessageSquare, Users, Clock, AlertTriangle, Trash2 } from 'lucide-react';
import AnnouncementsAPI from '../../../lib/api/announcements';
import type { Announcement } from '../../../types/db';
import CreateAnnouncementModal from './CreateAnnouncementModal';
import AnnouncementStatsModal from './AnnouncementStatsModal';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ErrorState } from '../../../components/ui/ErrorState';
import { EmptyState } from '../../../components/ui/EmptyState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../store/toast';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AnnouncementsAPI.getAnnouncements();
      setAnnouncements(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حصلت مشكلة مش معروفة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const handleCreateSuccess = () => {
    setShowCreateModal(false);
    loadAnnouncements();
  };

  const handleViewStats = (announcementId: number) => {
    setSelectedAnnouncementId(announcementId);
    setShowStatsModal(true);
  };

  const handleToggleActive = async (announcement: Announcement) => {
    try {
      await AnnouncementsAPI.updateAnnouncement(announcement.id, {
        is_active: !announcement.is_active
      });
      toast.success(announcement.is_active ? 'الإعلان اتوقف.' : 'الإعلان اتفعّل.');
      loadAnnouncements();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'معرفناش نغيّر حالة الإعلان.');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await AnnouncementsAPI.deleteAnnouncement(pendingDelete.id);
      toast.success('الإعلان اتمسح نهائيًا.');
      setPendingDelete(null);
      loadAnnouncements();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'معرفناش نمسح الإعلان.');
    } finally {
      setIsDeleting(false);
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

  if (loading) {
    return (
      <div className="grid gap-4" dir="rtl" aria-label="بنحمّل الإعلانات...">
        <CardSkeletons count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-4" dir="rtl">
        <ErrorState message={`حصلت مشكلة وإحنا بنحمّل الإعلانات: ${error}`} onRetry={() => { void loadAnnouncements(); }} />
      </div>
    );
  }

  const todayKey = new Date().toDateString();
  const stats = [
    { label: 'كل الإعلانات', value: announcements.length, icon: MessageSquare, tone: 'bg-[var(--primary-soft)] text-[var(--link)]' },
    { label: 'نشطة دلوقتي', value: announcements.filter((a) => a.is_active).length, icon: Users, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
    { label: 'أولوية عالية', value: announcements.filter((a) => a.priority === 'high' || a.priority === 'urgent').length, icon: AlertTriangle, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    { label: 'اتنشرت النهارده', value: announcements.filter((a) => new Date(a.created_at).toDateString() === todayKey).length, icon: Clock, tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4" dir="rtl">
      {/* Header */}
      <section className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><MessageSquare size={23} /></span>
          <div className="min-w-0">
            <h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">إدارة الإعلانات</h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">ابعت التنبيهات للأعضاء وتابع مين قراها.</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)} icon={<Plus size={19} aria-hidden="true" />} fullOnMobile>إعلان جديد</Button>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="إحصائيات الإعلانات">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] sm:p-4">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`} aria-hidden="true"><Icon size={19} /></span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--text-muted)] sm:text-sm">{label}</p>
              <p className="text-xl font-black tabular-nums text-[var(--text)]">{value}</p>
            </div>
          </div>
        ))}
      </section>

      {/* List */}
      <section className="grid gap-3" aria-labelledby="announcements-list-title">
        <h2 id="announcements-list-title" className="flex items-center gap-2 px-1 text-base font-black text-[var(--text)]">
          كل الإعلانات <span className="text-sm font-bold tabular-nums text-[var(--text-muted)]">({announcements.length})</span>
        </h2>

        {announcements.length === 0 ? (
          <EmptyState title="مفيش إعلانات لسه" description="ابدأ واعمل أول إعلان للأعضاء." action={<Button onClick={() => setShowCreateModal(true)} icon={<Plus size={17} />}>اعمل أول إعلان</Button>} />
        ) : (
          <ul className="grid gap-3">
            {announcements.map((announcement) => (
              <li
                key={announcement.id}
                className={`grid gap-3 rounded-[var(--radius)] border bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-colors sm:p-5 lg:flex lg:items-start lg:justify-between lg:gap-6 ${announcement.is_active ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-80'}`}
              >
                <div className="grid min-w-0 gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words font-black text-[var(--text)]">{announcement.title}</h3>
                    <Badge variant={getPriorityVariant(announcement.priority)}>{AnnouncementsAPI.getPriorityLabel(announcement.priority)}</Badge>
                    {!announcement.is_active && <Badge variant="neutral">متوقف</Badge>}
                  </div>
                  <p className="line-clamp-2 text-sm leading-7 text-[var(--text-2)]">{announcement.content}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden="true" />{formatDate(announcement.created_at)}</span>
                    <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" />{AnnouncementsAPI.getAudienceLabel(announcement.target_audience)}</span>
                    {announcement.send_whatsapp && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">واتساب</span>}
                    {announcement.send_push && <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[var(--link)]">إشعار فوري</span>}
                  </p>
                </div>

                <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3 lg:shrink-0 lg:border-t-0 lg:pt-0">
                  <Button variant="secondary" onClick={() => handleViewStats(announcement.id)} icon={<Eye size={16} aria-hidden="true" />} className="flex-1 lg:flex-none">
                    مين قراه؟
                  </Button>
                  <Button variant="secondary" onClick={() => handleToggleActive(announcement)} className="flex-1 lg:flex-none">
                    {announcement.is_active ? 'وقّف' : 'فعّل تاني'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(announcement)}
                    className="grid size-10 min-h-0 min-w-0 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                    aria-label={`امسح إعلان ${announcement.title}`}
                    title="حذف الإعلان"
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modals */}
      {showCreateModal && (
        <CreateAnnouncementModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />
      )}

      {showStatsModal && selectedAnnouncementId && (
        <AnnouncementStatsModal
          announcementId={selectedAnnouncementId}
          onClose={() => {
            setShowStatsModal(false);
            setSelectedAnnouncementId(null);
          }}
        />
      )}

      <Modal
        isOpen={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title="حذف الإعلان"
        subtitle={pendingDelete ? `الإعلان هيتحذف نهائيًا من عند كل الأعضاء: "${pendingDelete.title}".` : undefined}
        maxWidth="sm"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setPendingDelete(null)} fullOnMobile>إلغاء</Button>
          <Button variant="danger" onClick={() => void confirmDelete()} isLoading={isDeleting} loadingText="بنمسح..." fullOnMobile>امسح نهائي</Button>
        </div>
      </Modal>
    </div>
  );
}
