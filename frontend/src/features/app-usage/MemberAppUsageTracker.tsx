import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { appUsagePlatform, recordMemberAppUsage } from './api';

const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const attempts = new Map<string, number>();

/** Mounted only behind the successful MemberAccessGuard; reporting is optional. */
export function MemberAppUsageTracker() {
  const memberId = useAuthStore((state) => state.currentMember?.id ?? null);
  const memberEmail = useAuthStore((state) => state.currentMember?.email ?? '');
  useEffect(() => {
    if (!memberId || !Capacitor.isNativePlatform()) return;
    const platform = appUsagePlatform(Capacitor.getPlatform());
    if (!platform) return;
    let active = true;
    let busy = false;
    let removeNativeListener: (() => void) | undefined;
    const key = `${memberId}:${memberEmail}:${platform}`;
    const sameIdentity = (device: string) => {
      const current = useAuthStore.getState().currentMember;
      return active && current?.id === memberId && current.email === memberEmail && getDeviceToken() === device;
    };
    const report = async () => {
      if (!active || busy) return;
      const last = attempts.get(key);
      if (last !== undefined && Date.now() - last < REPORT_INTERVAL_MS) return;
      const device = getDeviceToken();
      if (!device) return;
      busy = true;
      try {
        const info = await App.getInfo();
        if (!sameIdentity(device) || info.id !== 'com.phantoms.app') return;
        const latest = attempts.get(key);
        if (latest !== undefined && Date.now() - latest < REPORT_INTERVAL_MS) return;
        // Only a live effect claims the attempt, so StrictMode cleanup cannot lose first use.
        attempts.set(key, Date.now());
        await recordMemberAppUsage(device, info.version, info.build, platform);
      } catch {
        // Throttle failures too; telemetry must never disrupt sign-in or spam retries.
        if (sameIdentity(device)) attempts.set(key, Date.now());
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
  }, [memberId, memberEmail]);
  return null;
}
