import { useEffect, useRef } from 'react';
import { useLocale } from '../../i18n/useLocale';
import { useNotificationStore } from '../../lib/notifications';
import { toast } from '../../store/toast';
import type { MemberProfileSnapshot } from './profile-api';

/** How often an incomplete member is reminded (in-app, bell and system notification). */
export const PROFILE_REMINDER_INTERVAL_MS = 20 * 60 * 1000;
const STORAGE_PREFIX = 'phantoms_profile_reminder_v1:';

function storageKey(memberId: number): string {
  return `${STORAGE_PREFIX}${memberId}`;
}

function readLastReminder(memberId: number): number {
  try {
    const raw = window.localStorage.getItem(storageKey(memberId));
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeLastReminder(memberId: number, at: number): void {
  try {
    window.localStorage.setItem(storageKey(memberId), String(at));
  } catch {
    /* Reminders are best-effort; storage denial must never break the portal. */
  }
}

/** Called once the profile is complete so a later regression reminds immediately. */
export function clearProfileReminders(memberId: number): void {
  try {
    window.localStorage.removeItem(storageKey(memberId));
  } catch {
    /* Ignore storage denial. */
  }
}

/**
 * Repeats a completion reminder while the profile stays incomplete: a toast with
 * a direct Settings action, a notification-centre entry and a system
 * notification. The last delivery time is persisted per member so refreshing
 * the portal does not spam the member.
 */
export function useProfileReminder(profile: MemberProfileSnapshot | null | undefined, onOpenSettings?: () => void) {
  const { t } = useLocale();
  const openRef = useRef(onOpenSettings);
  openRef.current = onOpenSettings;

  const memberId = profile?.member_id ?? null;
  const incomplete = Boolean(profile && !profile.profile_complete);
  const missingCount = profile?.missing_fields.length ?? 0;

  useEffect(() => {
    if (!incomplete || !memberId) return;
    let timeoutId: number | undefined;
    let intervalId: number | undefined;
    const notify = () => {
      const message = t(
        `بيانات حسابك لسه ناقصة — فاضل ${missingCount} حقول. كمّلها عشان ترجع لمساحة العمل وتوقف التذكيرات.`,
        `Your profile is still incomplete — ${missingCount} fields left. Complete them to return to your workspace and stop the reminders.`,
      );
      const slot = Math.floor(Date.now() / PROFILE_REMINDER_INTERVAL_MS);
      useNotificationStore.getState().pushNotification(memberId, {
        id: `profile-incomplete-${memberId}-${slot}`,
        title: t('تذكير: بيانات حسابك ناقصة', 'Reminder: your profile is incomplete'),
        body: message,
        category: 'system',
        targetTab: 'ALL',
        senderName: 'PHANTOMS',
      }, { playSound: false, showBanner: true, triggerSystem: true });
      toast.warning(message, {
        title: t('استكمال البيانات مطلوب', 'Profile completion required'),
        durationMs: 12000,
        action: openRef.current ? { label: t('افتح الإعدادات', 'Open settings'), onClick: () => openRef.current?.() } : undefined,
      });
      writeLastReminder(memberId, Date.now());
    };
    const elapsed = Date.now() - readLastReminder(memberId);
    const delay = elapsed >= PROFILE_REMINDER_INTERVAL_MS ? 1500 : PROFILE_REMINDER_INTERVAL_MS - elapsed;
    timeoutId = window.setTimeout(() => {
      notify();
      intervalId = window.setInterval(notify, PROFILE_REMINDER_INTERVAL_MS);
    }, Math.max(1500, delay));
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [incomplete, memberId, missingCount, t]);

  useEffect(() => {
    if (memberId && profile?.profile_complete) clearProfileReminders(memberId);
  }, [memberId, profile?.profile_complete]);
}
