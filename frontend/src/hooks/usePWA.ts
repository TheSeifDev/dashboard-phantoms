import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase/client';
import { getDeviceToken } from '../store/auth';
import { toast } from '../store/toast';
import {
  checkUnifiedNotificationPermission,
  ensureAndroidNotificationChannel,
  playWhatsAppNotificationSound,
  requestUnifiedNotificationPermission,
  urlBase64ToUint8Array,
  useNotificationStore,
} from '../lib/notifications';

/** بصمة المفتاح العام الحالي — لكشف الاشتراكات المبنية على مفتاح قديم بعد تدوير VAPID */
const PUSH_KEY_FP_STORE = 'phantoms_push_key_fp';
const LEGACY_PUSH_KEY_FP_STORE = 'wasla_push_key_fp';
const APK_SUB_PREFIX = 'phantoms_apk_notif_enabled_';
const LEGACY_APK_SUB_PREFIX = 'wasla_apk_notif_enabled_';

const currentKeyFingerprint = (): string | null => {
  const key = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';
  return key.length >= 12 ? key.slice(0, 12) : null;
};

const storedKeyFingerprint = (): string | null => {
  try {
    return localStorage.getItem(PUSH_KEY_FP_STORE) ?? localStorage.getItem(LEGACY_PUSH_KEY_FP_STORE);
  } catch {
    return null;
  }
};

const storeKeyFingerprint = (fp: string): void => {
  try {
    localStorage.setItem(PUSH_KEY_FP_STORE, fp);
    try { localStorage.removeItem(LEGACY_PUSH_KEY_FP_STORE); } catch {}
  } catch {
    // ignore
  }
};

export function usePWA({ memberId, memberEmail }: { memberId?: number; memberEmail?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const autoResubscribed = useRef(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    let mounted = true;

    const checkCurrentStatus = async () => {
      if (Capacitor.isNativePlatform()) {
        const granted = await checkUnifiedNotificationPermission();
        if (granted) {
          await ensureAndroidNotificationChannel();
          if (mounted) setIsSubscribed(true);
        } else if (memberId) {
          // لو لم يمنح الإذن بعد في أندرويد 13+ نطلبه تلقائياً عند فتح البوابة لأول مرة
          const autoRequestedKey = `phantoms_apk_perm_prompted_${memberId}`;
          const legacyAutoRequestedKey = `wasla_apk_perm_prompted_${memberId}`;
          if (!localStorage.getItem(autoRequestedKey) && !localStorage.getItem(legacyAutoRequestedKey)) {
            localStorage.setItem(autoRequestedKey, '1');
            const nowGranted = await requestUnifiedNotificationPermission();
            if (nowGranted && mounted) {
              localStorage.setItem(`${APK_SUB_PREFIX}${memberId}`, '1');
              try { localStorage.removeItem(`${LEGACY_APK_SUB_PREFIX}${memberId}`); } catch {}
              setIsSubscribed(true);
            }
          }
        }
        return;
      }

      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub && mounted) {
              setIsSubscribed(true);
              return;
            }
          }
        } catch {
          // ignore
        }
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        if (mounted) setIsSubscribed(true);
      }
    };

    void checkCurrentStatus();
    return () => {
      mounted = false;
    };
  }, [memberId]);

  const saveSubscription = async (subscription: PushSubscription) => {
    if (!memberId || !memberEmail) return;
    const { error } = await supabase.rpc('save_push_subscription', {
      p_member_id: memberId,
      p_email: memberEmail,
      p_subscription: JSON.parse(JSON.stringify(subscription)),
      p_device_token: getDeviceToken(),
    });
    if (error) throw error;
  };

  /**
   * اشتراك سليم دائماً مع تحويل مفتاح VAPID إلى Uint8Array ليعمل على متصفحات الموبايل
   */
  const ensureFreshSubscription = async (): Promise<PushSubscription> => {
    const reg = await navigator.serviceWorker.ready;
    const fp = currentKeyFingerprint();
    const rawKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';
    if (!fp || !rawKey) throw new Error('مفتاح الإشعارات مش متظبط في النظام.');
    const existing = await reg.pushManager.getSubscription().catch(() => null);
    if (existing && storedKeyFingerprint() === fp) return existing;
    if (existing) {
      await existing.unsubscribe().catch(() => undefined);
    }
    const applicationServerKey = urlBase64ToUint8Array(rawKey) as unknown as BufferSource;
    const fresh = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    return fresh;
  };

  const markSubscribed = async (subscription: PushSubscription) => {
    await saveSubscription(subscription);
    const fp = currentKeyFingerprint();
    if (fp) storeKeyFingerprint(fp);
    setIsSubscribed(true);
  };

  // إعادة اشتراك صامتة على الويب/PWA
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (autoResubscribed.current || isSubscribed || !memberId || !memberEmail) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    autoResubscribed.current = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        const fp = currentKeyFingerprint();
        if (sub && fp && storedKeyFingerprint() === fp) {
          try {
            await saveSubscription(sub);
          } catch {
            // ignore
          }
          setIsSubscribed(true);
          return;
        }
        const fresh = await ensureFreshSubscription();
        await markSubscribed(fresh);
      })
      .catch(() => {
        setIsSubscribed(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubscribed, memberId, memberEmail]);

  const installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  const subscribeToPush = async () => {
    if (!memberId || !memberEmail) return;
    try {
      // تشغيل الصوت فور ضغطة المستخدم لفتح قناة الصوت على الهاتف
      playWhatsAppNotificationSound(true);

      const granted = await requestUnifiedNotificationPermission();
      if (!granted) {
        toast.warning('اسمح بالإشعارات من إعدادات الهاتف أو المتصفح عشان توصلك التنبيهات.');
        return;
      }

      if (Capacitor.isNativePlatform()) {
        localStorage.setItem(`${APK_SUB_PREFIX}${memberId}`, '1');
        try { localStorage.removeItem(`${LEGACY_APK_SUB_PREFIX}${memberId}`); } catch {}
        setIsSubscribed(true);
        useNotificationStore.getState().pushNotification(
          memberId,
          {
            title: 'تم تفعيل إشعارات PHANTOMS',
            body: 'هتوصلك تنبيهات المهام والتقييمات والإعلانات بصوت وتنبيه فوري.',
            category: 'system',
            targetTab: 'ALL',
          },
          { triggerSystem: true, playSound: false, showBanner: true },
        );
        toast.success('الإشعارات والصوت اتفعلوا بنجاح على تليفونك!');
        return;
      }

      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const subscription = await ensureFreshSubscription();
          await markSubscribed(subscription);
        } catch {
          // في حال كان المتصفح لا يدعم Web Push الخلفي، نفعل إشعارات النظام اللحظية
          setIsSubscribed(true);
        }
      } else {
        setIsSubscribed(true);
      }

      useNotificationStore.getState().pushNotification(
        memberId,
        {
          title: 'تم تفعيل إشعارات PHANTOMS',
          body: 'هتوصلك تنبيهات المهام والتقييمات والإعلانات بصوت وتنبيه فوري.',
          category: 'system',
          targetTab: 'ALL',
        },
        { triggerSystem: true, playSound: false, showBanner: true },
      );
      toast.success('الإشعارات اتفعلت بنجاح!');
    } catch (err: any) {
      console.error(err);
      toast.error('معرفناش نفعل الإشعارات: ' + (err?.message || 'جرّب تاني'));
    }
  };

  const sendTestNotification = async () => {
    if (!memberId) return;
    const granted = await requestUnifiedNotificationPermission();
    if (!granted) {
      toast.warning('اسمح بالإشعارات الأول عشان تشوف الإشعار التجريبي.');
      return;
    }
    setIsSubscribed(true);
    useNotificationStore.getState().pushNotification(
      memberId,
      {
        title: 'رسالة إشعار تجريبية — PHANTOMS',
        body: 'الإشعارات والصوت شغالين ممتاز على جهازك دلوقتي وتنبيهات الفريق هتوصلك فوراً.',
        category: 'announcement',
        targetTab: 'ALL',
      },
      { triggerSystem: true, playSound: true, showBanner: true },
    );
  };

  return { isInstallable, installPWA, isSubscribed, subscribeToPush, sendTestNotification };
}
