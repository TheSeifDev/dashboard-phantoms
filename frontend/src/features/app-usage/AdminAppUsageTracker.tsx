import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '../../store/auth';
import { appUsagePlatform, recordAdminAppUsage } from './api';

const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const attempts = new Map<string, number>();

/**
 * جوه بوابة الإدارة (MainLayout) — الأدمن/المالك مش بيمر على MemberAccessGuard،
 * فمكانش بيتسجل إنه نزّل التطبيق. ده بيسجل استخدام الحساب لنفسه من غير أي
 * معرّف عضو جاي من العميل: الخادم بيربط الحساب بعضويته.
 */
export function AdminAppUsageTracker({ enabled }: { enabled: boolean }) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    if (!enabled || !userId) return;
    if (!Capacitor.isNativePlatform()) return;
    const platform = appUsagePlatform(Capacitor.getPlatform());
    if (!platform) return;
    let active = true;
    let busy = false;
    let removeNativeListener: (() => void) | undefined;
    const key = `${userId}:${platform}`;
    const sameIdentity = () => active && useAuthStore.getState().user?.id === userId;
    const report = async () => {
      if (!active || busy) return;
      const last = attempts.get(key);
      if (last !== undefined && Date.now() - last < REPORT_INTERVAL_MS) return;
      busy = true;
      try {
        const info = await App.getInfo();
        if (!sameIdentity() || info.id !== 'com.phantoms.app') return;
        const latest = attempts.get(key);
        if (latest !== undefined && Date.now() - latest < REPORT_INTERVAL_MS) return;
        // Only a live effect claims the attempt, so StrictMode cleanup cannot lose first use.
        attempts.set(key, Date.now());
        await recordAdminAppUsage(info.version, info.build, platform);
      } catch {
        // Telemetry must never disrupt the admin shell or spam retries.
        if (sameIdentity()) attempts.set(key, Date.now());
      } finally { busy = false; }
    };
    void report();
    const onVisible = () => { if (document.visibilityState === 'visible') void report(); };
    document.addEventListener('visibilitychange', onVisible);
    void App.addListener('appStateChange', ({ isActive }) => { if (isActive) void report(); })
      .then((handle) => {
        if (!active) { void handle.remove(); return; }
        removeNativeListener = () => { void handle.remove(); };
      }).catch(() => undefined);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      removeNativeListener?.();
    };
  }, [enabled, userId]);
  return null;
}
