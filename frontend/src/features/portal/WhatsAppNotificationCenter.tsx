import { useEffect, useRef } from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  CheckSquare,
  ClipboardCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { MemberEvaluation } from '../evaluations/api';
import type { MemberAnnouncement, Task } from '../../types/db';
import AnnouncementsAPI from '../../lib/api/announcements';
import {
  unlockNotificationAudio,
  useNotificationStore,
  type NotificationCategory,
  type NotificationTargetTab,
  type PhantomsNotificationItem,
} from '../../lib/notifications';
import { useLocale, type Locale } from '../../i18n/useLocale';

interface KnownPortalSnapshot {
  initialized: boolean;
  taskStates: Record<string, string>;
  evaluationIds: number[];
  announcementIds: number[];
}

function snapshotStorageKey(memberId: number): string {
  return `phantoms_notif_snapshot_v2_${memberId}`;
}

function loadSnapshot(memberId: number): KnownPortalSnapshot {
  try {
    const primaryKey = snapshotStorageKey(memberId);
    const raw = localStorage.getItem(primaryKey);
    if (!raw) {
      return { initialized: false, taskStates: {}, evaluationIds: [], announcementIds: [] };
    }
    const parsed = JSON.parse(raw) as Partial<KnownPortalSnapshot>;
    return {
      initialized: Boolean(parsed.initialized),
      taskStates: parsed.taskStates && typeof parsed.taskStates === 'object' ? parsed.taskStates : {},
      evaluationIds: Array.isArray(parsed.evaluationIds) ? parsed.evaluationIds : [],
      announcementIds: Array.isArray(parsed.announcementIds) ? parsed.announcementIds : [],
    };
  } catch {
    return { initialized: false, taskStates: {}, evaluationIds: [], announcementIds: [] };
  }
}

function saveSnapshot(memberId: number, snapshot: KnownPortalSnapshot): void {
  try {
    localStorage.setItem(snapshotStorageKey(memberId), JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

function localizedCopy(locale: Locale, arabic: string, english: string): string {
  return locale === 'ar' ? arabic : english;
}

function categoryLabel(category: NotificationCategory, locale: Locale): string {
  switch (category) {
    case 'task':
      return localizedCopy(locale, 'مهمة جديدة', 'New task');
    case 'review':
      return localizedCopy(locale, 'تحديث مهمة', 'Task update');
    case 'evaluation':
      return localizedCopy(locale, 'تقييم أداء', 'Performance evaluation');
    case 'announcement':
      return localizedCopy(locale, 'إعلان إداري', 'Announcement');
    default:
      return localizedCopy(locale, 'إشعار النظام', 'System notification');
  }
}

function CategoryIcon({ category }: { category: NotificationCategory }) {
  switch (category) {
    case 'task':
    case 'review':
      return <CheckSquare size={18} aria-hidden="true" />;
    case 'evaluation':
      return <ClipboardCheck size={18} aria-hidden="true" />;
    default:
      return <Bell size={18} aria-hidden="true" />;
  }
}

function formatNotificationTime(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return localizedCopy(locale, 'الآن', 'Now');
  }
}

export function WhatsAppNotificationCenter({
  memberId,
  tasks,
  evaluations,
  onSelectTab,
  onTestNotification,
}: {
  memberId: number;
  tasks: Task[];
  evaluations: MemberEvaluation[];
  onSelectTab: (tab: NotificationTargetTab) => void;
  onTestNotification: () => void;
}) {
  const { t, dir, locale, number } = useLocale();
  const items = useNotificationStore((s) => s.items);
  const activeBanner = useNotificationStore((s) => s.activeBanner);
  const soundEnabled = useNotificationStore((s) => s.soundEnabled);
  const drawerOpen = useNotificationStore((s) => s.drawerOpen);
  const hydrateForMember = useNotificationStore((s) => s.hydrateForMember);
  const pushNotification = useNotificationStore((s) => s.pushNotification);
  const dismissBanner = useNotificationStore((s) => s.dismissBanner);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const setSoundEnabled = useNotificationStore((s) => s.setSoundEnabled);
  const setDrawerOpen = useNotificationStore((s) => s.setDrawerOpen);

  const pollingAnnouncementsRef = useRef(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const unreadCount = items.filter((item) => !item.read).length;

  useEffect(() => {
    if (!drawerOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [drawerOpen]);

  const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawerOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      event.preventDefault();
      drawerRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // تهيئة الصوت وقراءة سجل الإشعارات المحفوظ للعضو
  useEffect(() => {
    unlockNotificationAudio();
    hydrateForMember(memberId);
  }, [memberId, hydrateForMember]);

  // الاستماع لرسائل الـ Service Worker في وضع PWA وعند الضغط على إشعار الأندرويد في وضع APK
  useEffect(() => {
    const onServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            payload?: {
              id?: string;
              title?: string;
              body?: string;
              category?: NotificationCategory;
              targetTab?: NotificationTargetTab;
            };
          }
        | undefined;

      if (!data?.type) return;

      if (data.type === 'PHANTOMS_PUSH_RECEIVED' && data.payload) {
        pushNotification(
          memberId,
          {
            id: data.payload.id || `push_${Date.now()}`,
            title: data.payload.title || localizedCopy(locale, 'PHANTOMS — إشعار جديد', 'PHANTOMS — New notification'),
            body: data.payload.body || localizedCopy(locale, 'وصلك تحديث جديد على البوابة', 'You have a new update in the portal.'),
            category: data.payload.category || 'announcement',
            targetTab: data.payload.targetTab || 'ANNOUNCEMENTS',
          },
          { triggerSystem: false, playSound: true, showBanner: true },
        );
      } else if (data.type === 'PHANTOMS_NOTIFICATION_CLICKED' && data.payload?.targetTab) {
        onSelectTab(data.payload.targetTab);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    }

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const tab = action.notification?.extra?.targetTab as NotificationTargetTab | undefined;
        if (tab) onSelectTab(tab);
      }).then((handle) => {
        listenerHandle = handle;
      });
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
      }
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [memberId, onSelectTab, pushNotification, locale]);

  // مراقبة التغييرات في المهام والتقييمات وإطلاق إشعارات فورية بصوت وتنبيه الهاتف
  useEffect(() => {
    if (!memberId) return;
    const snap = loadSnapshot(memberId);
    const memberKey = String(memberId);

    const nextTaskStates: Record<string, string> = { ...snap.taskStates };
    const nextEvalIds = new Set<number>(snap.evaluationIds);
    let hasChanges = false;

    for (const task of tasks) {
      const taskIdKey = String(task.id);
      const currentStatus = task.tracking?.[memberKey]?.status || 'pending';
      const prevStatus = snap.taskStates[taskIdKey];

      if (!snap.initialized) {
        nextTaskStates[taskIdKey] = currentStatus;
        hasChanges = true;
        continue;
      }

      if (prevStatus === undefined) {
        nextTaskStates[taskIdKey] = currentStatus;
        hasChanges = true;
        pushNotification(memberId, {
          id: `task_new_${task.id}`,
          title: localizedCopy(locale, `مهمة جديدة: ${task.title}`, `New task: ${task.title}`),
          body: task.description || localizedCopy(locale, 'تم إسناد مهمة جديدة ليك على بوابة PHANTOMS.', 'A new task was assigned to you in the PHANTOMS portal.'),
          category: 'task',
          targetTab: 'TASKS',
        });
      } else if (prevStatus !== currentStatus) {
        nextTaskStates[taskIdKey] = currentStatus;
        hasChanges = true;
        if (currentStatus === 'approved') {
          pushNotification(memberId, {
            id: `task_approved_${task.id}_${task.tracking?.[memberKey]?.updated_at || Date.now()}`,
            title: localizedCopy(locale, `تم اعتماد مهمتك: ${task.title}`, `Task approved: ${task.title}`),
            body: task.tracking?.[memberKey]?.note || localizedCopy(locale, 'اعتمدت الإدارة تسليم المهمة وأضافت نقاط البونص لرصيدك.', 'The administration approved your task and added its bonus points to your balance.'),
            category: 'review',
            targetTab: 'TASKS',
          });
        } else if (currentStatus === 'revision_requested') {
          pushNotification(memberId, {
            id: `task_rev_${task.id}_${task.tracking?.[memberKey]?.updated_at || Date.now()}`,
            title: localizedCopy(locale, `مطلوب تعديل على مهمة: ${task.title}`, `Revision requested: ${task.title}`),
            body: task.tracking?.[memberKey]?.note || localizedCopy(locale, 'راجعت الإدارة المهمة وطلبت تعديل بسيط قبل الاعتماد.', 'The administration reviewed this task and requested a revision before approval.'),
            category: 'review',
            targetTab: 'TASKS',
          });
        }
      }
    }

    for (const ev of evaluations) {
      if (!snap.initialized) {
        nextEvalIds.add(ev.id);
        hasChanges = true;
        continue;
      }
      if (!nextEvalIds.has(ev.id)) {
        nextEvalIds.add(ev.id);
        hasChanges = true;
        pushNotification(memberId, {
          id: `eval_new_${ev.id}`,
          title: localizedCopy(locale, `تقييم جديد: ${ev.title}`, `New evaluation: ${ev.title}`),
          body: ev.feedback || localizedCopy(locale, 'سجّلت الإدارة تقييماً جديداً لأدائك على بوابة الفريق.', 'The administration added a new performance evaluation to your portal.'),
          category: 'evaluation',
          targetTab: 'EVALUATIONS',
        });
      }
    }

    if (!snap.initialized || hasChanges) {
      saveSnapshot(memberId, {
        initialized: true,
        taskStates: nextTaskStates,
        evaluationIds: Array.from(nextEvalIds),
        announcementIds: snap.announcementIds,
      });
    }
  }, [memberId, tasks, evaluations, pushNotification, locale]);

  // فحص الإعلانات الجديدة دورياً وعند عودة التطبيق للواجهة (يعمل في APK و PWA)
  useEffect(() => {
    if (!memberId) return;

    const checkAnnouncements = async () => {
      if (pollingAnnouncementsRef.current) return;
      pollingAnnouncementsRef.current = true;
      try {
        const list: MemberAnnouncement[] = await AnnouncementsAPI.getMemberAnnouncements(memberId);
        const snap = loadSnapshot(memberId);
        const knownAnnIds = new Set<number>(snap.announcementIds);
        let updated = false;

        if (snap.announcementIds.length === 0 && list.length > 0) {
          for (const ann of list) {
            knownAnnIds.add(ann.id);
          }
          // لو هناك إعلان غير مقروء وصل حديثاً ولم يظهر في مركز الإشعارات بعد، نبه العضو به
          const newestUnread = list.find((a) => !a.is_read);
          if (newestUnread) {
            pushNotification(memberId, {
              id: `ann_init_${newestUnread.id}`,
              title: localizedCopy(locale, `إعلان هام: ${newestUnread.title}`, `Important announcement: ${newestUnread.title}`),
              body: newestUnread.content,
              category: 'announcement',
              targetTab: 'ANNOUNCEMENTS',
              createdAt: newestUnread.created_at,
            });
          }
          updated = true;
        } else {
          for (const ann of list) {
            if (!knownAnnIds.has(ann.id)) {
              knownAnnIds.add(ann.id);
              updated = true;
              pushNotification(memberId, {
                id: `ann_new_${ann.id}`,
                title: localizedCopy(locale, `إعلان جديد: ${ann.title}`, `New announcement: ${ann.title}`),
                body: ann.content,
                category: 'announcement',
                targetTab: 'ANNOUNCEMENTS',
                createdAt: ann.created_at,
              });
            }
          }
        }

        if (updated) {
          saveSnapshot(memberId, {
            ...loadSnapshot(memberId),
            initialized: true,
            announcementIds: Array.from(knownAnnIds),
          });
        }
      } catch {
        // ignore background poll errors
      } finally {
        pollingAnnouncementsRef.current = false;
      }
    };

    void checkAnnouncements();
    const intervalId = window.setInterval(() => {
      void checkAnnouncements();
    }, 12_000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkAnnouncements();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [memberId, pushNotification, locale]);

  const handleOpenItem = (item: PhantomsNotificationItem) => {
    markAsRead(memberId, item.id);
    dismissBanner();
    setDrawerOpen(false);
    onSelectTab(item.targetTab);
  };

  return (
    <>
      {/* شريط الإشعار العائم بأسلوب واتساب في أعلى شاشة الهاتف أو المتصفح */}
      {activeBanner && (
        <div
          role="alert"
          aria-live="assertive"
          dir={dir}
          className="fixed inset-x-0 top-0 z-[130] mx-auto w-full max-w-xl px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4"
        >
          <div className="overflow-hidden rounded-2xl border border-[var(--success-border)] border-s-4 border-s-[var(--success)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-lg)]">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--success)] text-[var(--on-success)]">
                <BellRing size={20} aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span dir="auto" className="text-xs font-black text-[var(--success-text)] dark:text-[var(--success-text)]">
                      {activeBanner.senderName || t('PHANTOMS — الإدارة', 'PHANTOMS — Administration')}
                    </span>
                    <span className="rounded-md bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--success-text)] dark:text-[var(--success-text)]">
                      {categoryLabel(activeBanner.category, locale)}
                    </span>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-[var(--text-muted)]">{t('الآن', 'Now')}</span>
                </div>

                <p dir="auto" className="mt-1 truncate text-sm font-black text-[var(--text)]">
                  {activeBanner.title}
                </p>
                <p dir="auto" className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--text-2)]">
                  {activeBanner.body}
                </p>

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                  <button
                    type="button"
                    onClick={() => handleOpenItem(activeBanner)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--success)] px-3 text-xs font-black text-[var(--on-success)] transition-colors hover:bg-[var(--success)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  >
                    <CheckCheck size={14} aria-hidden="true" />
                    <span>{t('عرض التفاصيل الآن', 'View details now')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={dismissBanner}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    <span>{t('إخفاء', 'Dismiss')}</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={dismissBanner}
                aria-label={t('إغلاق الإشعار', 'Close notification')}
                className="grid size-11 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة مركز الإشعارات بأسلوب محادثات واتساب */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[120] flex justify-end bg-black/45"
          dir={dir}
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            ref={drawerRef}
            id="notification-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-drawer-title"
            tabIndex={-1}
            onKeyDown={handleDrawerKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-s border-[var(--border)] bg-[var(--surface)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)]"
          >
            {/* رأس نافذة الإشعارات */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]">
                  <BellRing size={20} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="notification-drawer-title" className="text-base font-black text-[var(--text)]">{t('إشعارات PHANTOMS الفورية', 'PHANTOMS notifications')}</h2>
                  <p className="text-xs text-[var(--text-muted)]">{t('تنبيهات المهام والتقييمات والإعلانات', 'Task, evaluation, and announcement alerts')}</p>
                  <p className="sr-only" aria-live="polite">{unreadCount > 0 ? t(`${number(unreadCount)} إشعارات غير مقروءة`, `${number(unreadCount)} unread notifications`) : t('لا توجد إشعارات غير مقروءة', 'No unread notifications')}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t('إغلاق مركز الإشعارات', 'Close notification center')}
                className="grid size-11 place-items-center rounded-xl border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {/* شريط التحكم في الصوت والتجربة */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  aria-pressed={soundEnabled}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                    soundEnabled
                      ? 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]`}
                >
                  {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  <span>{soundEnabled ? t('نغمة الإشعار: شغالة', 'Notification sound: on') : t('نغمة الإشعار: مكتومة', 'Notification sound: muted')}</span>
                </button>

                <button
                  type="button"
                  onClick={onTestNotification}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-bold text-[var(--link)] hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  <Bell size={14} />
                  <span>{t('تجربة إشعار بصوت', 'Test sound notification')}</span>
                </button>
              </div>

              {unreadCount > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => markAllAsRead(memberId)}
                    className="min-h-11 rounded-lg px-2 text-xs font-bold text-[var(--link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    {t('قراءة الكل', 'Mark all as read')}
                  </button>
                </div>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearAll(memberId)}
                  className="min-h-11 rounded-lg px-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--danger-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  {t('مسح السجل', 'Clear history')}
                </button>
              )}
            </div>

            {/* قائمة الإشعارات بأسلوب رسائل واتساب */}
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
              {items.length === 0 ? (
                <div className="grid place-items-center gap-3 px-6 py-16 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-muted)]">
                    <Bell size={26} aria-hidden="true" />
                  </span>
                  <p className="text-base font-black text-[var(--text)]">{t('مفيش إشعارات في السجل حاليًا', 'No notifications in your history yet')}</p>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    {t('أول ما تنزل مهمة جديدة أو تقييم أو إعلان من الإدارة، هيظهرلك إشعار فوري بصوت في أعلى الشاشة وهيتسجل هنا.', 'When a new task, evaluation, or announcement arrives, you will receive an audible notification and it will be saved here.')}
                  </p>
                  <button
                    type="button"
                    onClick={onTestNotification}
                    className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--success)] px-4 text-xs font-black text-[var(--on-success)] hover:bg-[var(--success)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  >
                    <BellRing size={15} />
                    <span>{t('جرّب إشعار وصوت دلوقتي', 'Test a notification and sound')}</span>
                  </button>
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleOpenItem(item)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-start transition-colors hover:bg-[var(--surface-2)] ${
                      !item.read ? 'bg-[var(--success-soft)]' : ''
                    }`}
                  >
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-full ${
                        !item.read
                          ? 'bg-[var(--success)] text-[var(--on-success)]'
                          : 'bg-[var(--surface-2)] text-[var(--text-2)]'
                      }`}
                    >
                      <CategoryIcon category={item.category} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-[var(--success-text)] dark:text-[var(--success-text)]">
                          {categoryLabel(item.category, locale)}
                        </span>
                        <time className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
                          {formatNotificationTime(item.createdAt, locale)}
                        </time>
                      </div>

                      <p dir="auto" className="mt-0.5 truncate text-sm font-black text-[var(--text)]">
                        {item.title}
                      </p>
                      <p dir="auto" className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--text-2)]">
                        {item.body}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)]">
                          <CheckCheck
                            size={14}
                            className={item.read ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]'}
                          />
                          <span>{item.read ? t('تمت المشاهدة', 'Read') : t('جديد — اضغط للفتح', 'New — select to open')}</span>
                        </span>
                        {!item.read && (
                          <span className="size-2.5 rounded-full bg-[var(--success)]" aria-label={t('غير مقروء', 'Unread')} />
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
