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
  type WaslaNotificationItem,
} from '../../lib/notifications';

interface KnownPortalSnapshot {
  initialized: boolean;
  taskStates: Record<string, string>;
  evaluationIds: number[];
  announcementIds: number[];
}

function snapshotStorageKey(memberId: number): string {
  return `phantoms_notif_snapshot_v2_${memberId}`;
}

function legacySnapshotStorageKey(memberId: number): string {
  return `wasla_notif_snapshot_v2_${memberId}`;
}

function loadSnapshot(memberId: number): KnownPortalSnapshot {
  try {
    const primaryKey = snapshotStorageKey(memberId);
    let raw = localStorage.getItem(primaryKey);
    if (!raw) {
      const legacyKey = legacySnapshotStorageKey(memberId);
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) {
        raw = legacyRaw;
        try {
          localStorage.setItem(primaryKey, legacyRaw);
          if (localStorage.getItem(primaryKey) === legacyRaw) {
            localStorage.removeItem(legacyKey);
          }
        } catch {
          // ignore quota
        }
      }
    }
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
    try {
      localStorage.removeItem(legacySnapshotStorageKey(memberId));
    } catch {}
  } catch {
    // ignore
  }
}

function categoryLabel(category: NotificationCategory): string {
  switch (category) {
    case 'task':
      return 'مهمة جديدة';
    case 'review':
      return 'تحديث مهمة';
    case 'evaluation':
      return 'تقييم أداء';
    case 'announcement':
      return 'إعلان إداري';
    default:
      return 'إشعار النظام';
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

function formatNotificationTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return 'الآن';
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

      if ((data.type === 'PHANTOMS_PUSH_RECEIVED' || data.type === 'WASLA_PUSH_RECEIVED') && data.payload) {
        pushNotification(
          memberId,
          {
            id: data.payload.id || `push_${Date.now()}`,
            title: data.payload.title || 'PHANTOMS — إشعار جديد',
            body: data.payload.body || 'وصلك تحديث جديد على البوابة',
            category: data.payload.category || 'announcement',
            targetTab: data.payload.targetTab || 'ANNOUNCEMENTS',
          },
          { triggerSystem: false, playSound: true, showBanner: true },
        );
      } else if ((data.type === 'PHANTOMS_NOTIFICATION_CLICKED' || data.type === 'WASLA_NOTIFICATION_CLICKED') && data.payload?.targetTab) {
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
  }, [memberId, onSelectTab, pushNotification]);

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
          title: `مهمة جديدة: ${task.title}`,
          body: task.description || 'تم إسناد مهمة جديدة ليك على بوابة PHANTOMS.',
          category: 'task',
          targetTab: 'TASKS',
        });
      } else if (prevStatus !== currentStatus) {
        nextTaskStates[taskIdKey] = currentStatus;
        hasChanges = true;
        if (currentStatus === 'approved') {
          pushNotification(memberId, {
            id: `task_approved_${task.id}_${task.tracking?.[memberKey]?.updated_at || Date.now()}`,
            title: `تم اعتماد مهمتك: ${task.title}`,
            body: task.tracking?.[memberKey]?.note || 'اعتمدت الإدارة تسليم المهمة وأضافت نقاط البونص لرصيدك.',
            category: 'review',
            targetTab: 'TASKS',
          });
        } else if (currentStatus === 'revision_requested') {
          pushNotification(memberId, {
            id: `task_rev_${task.id}_${task.tracking?.[memberKey]?.updated_at || Date.now()}`,
            title: `مطلوب تعديل على مهمة: ${task.title}`,
            body: task.tracking?.[memberKey]?.note || 'راجعت الإدارة المهمة وطلبت تعديل بسيط قبل الاعتماد.',
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
          title: `تقييم جديد: ${ev.title}`,
          body: ev.feedback || 'سجّلت الإدارة تقييماً جديداً لأدائك على بوابة الفريق.',
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
  }, [memberId, tasks, evaluations, pushNotification]);

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
              title: `إعلان هام: ${newestUnread.title}`,
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
                title: `إعلان جديد: ${ann.title}`,
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
  }, [memberId, pushNotification]);

  const handleOpenItem = (item: WaslaNotificationItem) => {
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
          dir="rtl"
          className="fixed inset-x-0 top-0 z-[130] mx-auto w-full max-w-xl px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4"
        >
          <div className="overflow-hidden rounded-2xl border border-emerald-700/30 border-s-4 border-s-emerald-600 bg-[var(--surface)] p-3.5 shadow-[var(--shadow-lg)]">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                <BellRing size={20} aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                      {activeBanner.senderName || 'PHANTOMS — الإدارة'}
                    </span>
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                      {categoryLabel(activeBanner.category)}
                    </span>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-[var(--text-muted)]">الآن</span>
                </div>

                <p className="mt-1 truncate text-sm font-black text-[var(--text)]">
                  {activeBanner.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--text-2)]">
                  {activeBanner.body}
                </p>

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                  <button
                    type="button"
                    onClick={() => handleOpenItem(activeBanner)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white transition-colors hover:bg-emerald-700"
                  >
                    <CheckCheck size={14} aria-hidden="true" />
                    <span>عرض التفاصيل الآن</span>
                  </button>

                  <button
                    type="button"
                    onClick={dismissBanner}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  >
                    <span>إخفاء</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={dismissBanner}
                aria-label="إغلاق الإشعار"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
          dir="rtl"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            aria-label="مركز الإشعارات الفورية"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-s border-[var(--border)] bg-[var(--surface)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)]"
          >
            {/* رأس نافذة الإشعارات */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <BellRing size={20} aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-base font-black text-[var(--text)]">إشعارات PHANTOMS الفورية</h2>
                  <p className="text-xs text-[var(--text-muted)]">تنبيهات المهام والتقييمات والإعلانات</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="إغلاق مركز الإشعارات"
                className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
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
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                    soundEnabled
                      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                  }`}
                >
                  {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  <span>{soundEnabled ? 'نغمة الإشعار: شغالة' : 'نغمة الإشعار: مكتومة'}</span>
                </button>

                <button
                  type="button"
                  onClick={onTestNotification}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-bold text-[var(--link)] hover:bg-[var(--primary-soft)]"
                >
                  <Bell size={14} />
                  <span>تجربة إشعار بصوت</span>
                </button>
              </div>

              {items.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => markAllAsRead(memberId)}
                    className="text-xs font-bold text-[var(--link)] hover:underline"
                  >
                    قراءة الكل
                  </button>
                  <span className="text-[var(--text-muted)]">•</span>
                  <button
                    type="button"
                    onClick={() => clearAll(memberId)}
                    className="text-xs font-bold text-[var(--text-muted)] hover:text-red-600"
                  >
                    مسح السجل
                  </button>
                </div>
              )}
            </div>

            {/* قائمة الإشعارات بأسلوب رسائل واتساب */}
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
              {items.length === 0 ? (
                <div className="grid place-items-center gap-3 px-6 py-16 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-muted)]">
                    <Bell size={26} aria-hidden="true" />
                  </span>
                  <p className="text-base font-black text-[var(--text)]">مفيش إشعارات جديدة لحد دلوقتي</p>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    أول ما تنزل مهمة جديدة أو تقييم أو إعلان من الإدارة، هيظهرلك إشعار فوري بصوت في أعلى الشاشة وهيتسجل هنا.
                  </p>
                  <button
                    type="button"
                    onClick={onTestNotification}
                    className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700"
                  >
                    <BellRing size={15} />
                    <span>جرّب إشعار وصوت دلوقتي</span>
                  </button>
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleOpenItem(item)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-start transition-colors hover:bg-[var(--surface-2)] ${
                      !item.read ? 'bg-emerald-500/5' : ''
                    }`}
                  >
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-full ${
                        !item.read
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[var(--surface-2)] text-[var(--text-2)]'
                      }`}
                    >
                      <CategoryIcon category={item.category} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                          {categoryLabel(item.category)}
                        </span>
                        <time className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
                          {formatNotificationTime(item.createdAt)}
                        </time>
                      </div>

                      <p className="mt-0.5 truncate text-sm font-black text-[var(--text)]">
                        {item.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--text-2)]">
                        {item.body}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--text-muted)]">
                          <CheckCheck
                            size={14}
                            className={item.read ? 'text-emerald-600' : 'text-[var(--text-muted)]'}
                          />
                          <span>{item.read ? 'تمت المشاهدة' : 'جديد — اضغط للفتح'}</span>
                        </span>
                        {!item.read && (
                          <span className="size-2.5 rounded-full bg-emerald-600" aria-label="غير مقروء" />
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
