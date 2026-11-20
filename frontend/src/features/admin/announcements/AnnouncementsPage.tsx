import { useState, useEffect } from 'react';
import { Plus, Eye, MessageSquare, Users, Clock, AlertTriangle, Trash2 } from 'lucide-react';
import AnnouncementsAPI from '../../../lib/api/announcements';
import type { Announcement, AnnouncementPriority } from '../../../types/db';
import CreateAnnouncementModal from './CreateAnnouncementModal';
import AnnouncementStatsModal from './AnnouncementStatsModal';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ErrorState } from '../../../components/ui/ErrorState';
import { EmptyState } from '../../../components/ui/EmptyState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../store/toast';

import { useLocale } from '../../../i18n/useLocale';

type StatusFilter = 'all' | 'active' | 'inactive';
type PriorityFilter = 'all' | AnnouncementPriority;

export default function AnnouncementsPage() {
  const { t, number, date, dir } = useLocale();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AnnouncementsAPI.getAnnouncements();
      setAnnouncements(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('حصلت مشكلة مش معروفة', 'An unknown error occurred.'));
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
      toast.success(announcement.is_active ? t('الإعلان اتوقف.', 'Announcement deactivated.') : t('الإعلان اتفعّل.', 'Announcement activated.'));
      loadAnnouncements();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('معرفناش نغيّر حالة الإعلان.', 'Could not change announcement status.'));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await AnnouncementsAPI.deleteAnnouncement(pendingDelete.id);
      toast.success(t('الإعلان اتمسح نهائيًا.', 'Announcement deleted permanently.'));
      setPendingDelete(null);
      loadAnnouncements();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('معرفناش نمسح الإعلان.', 'Could not delete announcement.'));
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
    return date(dateString, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const searchTerm = searchQuery.trim().toLocaleLowerCase();
  const filteredAnnouncements = announcements.filter((announcement) => {
    const matchesSearch = !searchTerm
      || announcement.title.toLocaleLowerCase().includes(searchTerm)
      || announcement.content.toLocaleLowerCase().includes(searchTerm);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' ? announcement.is_active : !announcement.is_active);
    const matchesPriority = priorityFilter === 'all' || announcement.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });
  const hasActiveFilters = Boolean(searchTerm) || statusFilter !== 'all' || priorityFilter !== 'all';
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  const todayKey = new Date().toDateString();
  const stats = [
    { label: t('كل الإعلانات','All announcements'), value: announcements.length, icon: MessageSquare, tone: 'bg-[var(--primary-soft)] text-[var(--link)]' },
    { label: t('نشطة دلوقتي','Active now'), value: announcements.filter((a) => a.is_active).length, icon: Users, tone: 'bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]' },
    { label: t('أولوية عالية','High priority'), value: announcements.filter((a) => a.priority === 'high' || a.priority === 'urgent').length, icon: AlertTriangle, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    { label: t('اتنشرت النهارده','Published today'), value: announcements.filter((a) => new Date(a.created_at).toDateString() === todayKey).length, icon: Clock, tone: 'bg-[var(--info-soft)] text-[var(--info-text)] dark:text-[var(--info-text)]' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4" dir={dir}>
      <section className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><MessageSquare size={23} /></span>
          <div className="min-w-0">
            <h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t('إدارة الإعلانات', 'Announcement management')}</h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('ابعت التنبيهات للأعضاء وتابع مين قراها.', 'Send updates to members and track who has read them.')}</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)} icon={<Plus size={19} aria-hidden="true" />} fullOnMobile>{t('إعلان جديد', 'New announcement')}</Button>
      </section>

      {loading ? (
        <section className="grid gap-4" dir={dir} aria-label={t('بنحمّل الإعلانات...', 'Loading announcements...')} aria-live="polite" aria-busy="true">
          <CardSkeletons count={3} />
        </section>
      ) : error ? (
        <section className="grid gap-4" aria-labelledby="announcements-load-error-title">
          <h2 id="announcements-load-error-title" className="sr-only">{t('تعذر تحميل الإعلانات', 'Could not load announcements')}</h2>
          <ErrorState message={t(`حصلت مشكلة وإحنا بنحمّل الإعلانات: ${error}`, `Could not load announcements: ${error}`)} onRetry={() => { void loadAnnouncements(); }} />
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('إحصائيات الإعلانات', 'Announcement statistics')}>
            {stats.map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] sm:p-4">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`} aria-hidden="true"><Icon size={19} /></span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text-muted)] sm:text-sm">{label}</p>
                  <p className="text-xl font-black tabular-nums text-[var(--text)]">{number(value)}</p>
                </div>
              </div>
            ))}
          </section>

          <section className="grid gap-3" aria-labelledby="announcements-list-title">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 id="announcements-list-title" className="flex items-center gap-2 text-base font-black text-[var(--text)]">
                {t('كل الإعلانات', 'All announcements')} <span className="text-sm font-bold tabular-nums text-[var(--text-muted)]">({number(announcements.length)})</span>
              </h2>
              {announcements.length > 0 && (
                <p className="text-sm font-semibold tabular-nums text-[var(--text-muted)]" aria-live="polite">
                  {t(`عرض ${number(filteredAnnouncements.length)} من ${number(announcements.length)}`, `Showing ${number(filteredAnnouncements.length)} of ${number(announcements.length)}`)}
                </p>
              )}
            </div>

            {announcements.length > 0 && (
              <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] sm:grid-cols-2 sm:p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(9rem,0.55fr)_minmax(9rem,0.55fr)_auto] lg:items-end">
                <label className="grid min-w-0 gap-1.5 text-sm font-bold text-[var(--text)]" htmlFor="announcement-search">
                  {t('بحث', 'Search')}
                  <input
                    id="announcement-search"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('ابحث في العنوان أو المحتوى', 'Search title or content')}
                    className="min-h-[var(--touch)] min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                  />
                </label>
                <label className="grid min-w-0 gap-1.5 text-sm font-bold text-[var(--text)]" htmlFor="announcement-status-filter">
                  {t('الحالة', 'Status')}
                  <select
                    id="announcement-status-filter"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="min-h-[var(--touch)] min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                  >
                    <option value="all">{t('كل الحالات', 'All statuses')}</option>
                    <option value="active">{t('نشط', 'Active')}</option>
                    <option value="inactive">{t('متوقف', 'Inactive')}</option>
                  </select>
                </label>
                <label className="grid min-w-0 gap-1.5 text-sm font-bold text-[var(--text)]" htmlFor="announcement-priority-filter">
                  {t('الأولوية', 'Priority')}
                  <select
                    id="announcement-priority-filter"
                    value={priorityFilter}
                    onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                    className="min-h-[var(--touch)] min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
                  >
                    <option value="all">{t('كل الأولويات', 'All priorities')}</option>
                    <option value="low">{t('منخفضة', 'Low')}</option>
                    <option value="normal">{t('عادية', 'Normal')}</option>
                    <option value="high">{t('عالية', 'High')}</option>
                    <option value="urgent">{t('عاجلة', 'Urgent')}</option>
                  </select>
                </label>
                <Button type="button" variant="secondary" onClick={clearFilters} disabled={!hasActiveFilters} className="w-full sm:col-span-2 lg:col-span-1 lg:w-auto">
                  {t('مسح الفلاتر', 'Clear filters')}
                </Button>
              </div>
            )}

            {announcements.length === 0 ? (
              <EmptyState title={t('مفيش إعلانات لسه', 'No announcements yet')} description={t('ابدأ واعمل أول إعلان للأعضاء.', 'Create the first announcement for your members.')} action={<Button onClick={() => setShowCreateModal(true)} icon={<Plus size={17} aria-hidden="true" />}>{t('اعمل أول إعلان', 'Create the first announcement')}</Button>} />
            ) : filteredAnnouncements.length === 0 ? (
              <EmptyState
                title={t('مفيش نتائج مطابقة', 'No matching announcements')}
                description={t('جرّب تغيّر كلمات البحث أو الفلاتر.', 'Try changing your search terms or filters.')}
                action={<Button variant="secondary" onClick={clearFilters}>{t('مسح الفلاتر', 'Clear filters')}</Button>}
              />
            ) : (
              <ul className="grid gap-3">
                {filteredAnnouncements.map((announcement) => (
                  <li
                    key={announcement.id}
                    className={`grid gap-3 rounded-[var(--radius)] border bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] transition-colors sm:p-5 lg:flex lg:items-start lg:justify-between lg:gap-6 ${announcement.is_active ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-80'}`}
                  >
                    <div className="grid min-w-0 gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words font-black text-[var(--text)]">{announcement.title}</h3>
                        <Badge variant={getPriorityVariant(announcement.priority)}>{t(AnnouncementsAPI.getPriorityLabel(announcement.priority), ({ low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } as const)[announcement.priority as 'low' | 'normal' | 'high' | 'urgent'] ?? announcement.priority)}</Badge>
                        {!announcement.is_active && <Badge variant="neutral">{t('متوقف', 'Inactive')}</Badge>}
                      </div>
                      <p className="line-clamp-2 text-sm leading-7 text-[var(--text-2)]">{announcement.content}</p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden="true" />{formatDate(announcement.created_at)}</span>
                        <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" />{t(AnnouncementsAPI.getAudienceLabel(announcement.target_audience), announcement.target_audience?.type === 'all' ? 'All members' : announcement.target_audience?.type === 'specific' ? `${number(announcement.target_audience.member_ids?.length ?? 0)} selected members` : 'Not specified')}</span>
                        {announcement.send_whatsapp && <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[var(--success-text)] dark:text-[var(--success-text)]">{t('واتساب', 'WhatsApp')}</span>}
                        {announcement.send_push && <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[var(--link)]">{t('إشعار فوري', 'Push notification')}</span>}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3 lg:shrink-0 lg:border-t-0 lg:pt-0">
                      <Button variant="secondary" onClick={() => handleViewStats(announcement.id)} icon={<Eye size={16} aria-hidden="true" />} className="flex-1 lg:flex-none">
                        {t('مين قراه؟', 'Read stats')}
                      </Button>
                      <Button variant="secondary" onClick={() => handleToggleActive(announcement)} className="flex-1 lg:flex-none">
                        {announcement.is_active ? t('وقّف','Deactivate') : t('فعّل تاني','Reactivate')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(announcement)}
                        className="grid size-11 min-h-0 min-w-0 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)] dark:hover:bg-[var(--danger-soft)]"
                        aria-label={t(`امسح إعلان ${announcement.title}`, `Delete announcement ${announcement.title}`)}
                        title={t('حذف الإعلان', 'Delete announcement')}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

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
        title={t('حذف الإعلان', 'Delete announcement')}
        subtitle={pendingDelete ? t(`الإعلان هيتحذف نهائيًا من عند كل الأعضاء: "${pendingDelete.title}".`, `This announcement will be permanently removed for all members: “${pendingDelete.title}”.`) : undefined}
        maxWidth="sm"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setPendingDelete(null)} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
          <Button variant="danger" onClick={() => void confirmDelete()} isLoading={isDeleting} loadingText={t('بنمسح...', 'Deleting...')} fullOnMobile>{t('امسح نهائي', 'Delete permanently')}</Button>
        </div>
      </Modal>
    </div>
  );
}
