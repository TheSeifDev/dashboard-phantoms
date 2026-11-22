import { useMemo, useState } from 'react';
import { BellRing } from 'lucide-react';
import type { Member } from '../../types/db';
import { useLocale } from '../../i18n/useLocale';
import { sendPushNotification } from '../../lib/api/push';
import { toast } from '../../store/toast';
import { hasRequiredMemberInformation } from './member-profile-display';

const COOLDOWN_KEY = 'phantoms_profile_reminder_admin_v1';
const COOLDOWN_MS = 12 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

function lastSentAt(): number {
  try {
    const value = Number(window.localStorage.getItem(COOLDOWN_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function markSent(at: number): void {
  try {
    window.localStorage.setItem(COOLDOWN_KEY, String(at));
  } catch {
    /* Cooldown is best-effort only. */
  }
}

/**
 * Sends the completion reminder push to every member whose profile is still
 * incomplete. Batched to the edge-function limit and throttled to one broadcast
 * every 12 hours so the team is never spammed from the admin side.
 */
export function MemberProfileReminderAction({ members }: { members: Member[] }) {
  const { t, number } = useLocale();
  const [sending, setSending] = useState(false);
  const incomplete = useMemo(() => members.filter((member) => !hasRequiredMemberInformation(member)), [members]);

  const remind = async () => {
    if (sending) return;
    if (incomplete.length === 0) {
      toast.info(t('كل الأعضاء بياناتهم مكتملة — مفيش حد محتاج تذكير.', 'Every member profile is complete — nobody needs a reminder.'));
      return;
    }
    const elapsed = Date.now() - lastSentAt();
    if (elapsed < COOLDOWN_MS) {
      const hours = Math.max(1, Math.ceil((COOLDOWN_MS - elapsed) / 3_600_000));
      toast.info(t(
        `آخر تذكير اتبعت قريب. جرّب تاني بعد ${number(hours)} ساعة عشان منزعجش الأعضاء.`,
        `A reminder was sent recently. Try again in ${number(hours)} hour(s) to avoid spamming members.`,
      ));
      return;
    }
    setSending(true);
    try {
      const title = t('بيانات حسابك ناقصة', 'Your profile is incomplete');
      const body = t(
        'كمّل بياناتك من إعدادات الحساب عشان ترجع لمساحة العمل. هنفضل نذكّرك لحد ما تكمّلها.',
        'Complete your profile in account settings to return to your workspace. We keep reminding you until it is done.',
      );
      let sent = 0;
      for (let index = 0; index < incomplete.length; index += BATCH_SIZE) {
        const batch = incomplete.slice(index, index + BATCH_SIZE).map((member) => member.id);
        await sendPushNotification(title, body, batch, '/portal/settings');
        sent += batch.length;
      }
      markSent(Date.now());
      toast.success(t(
        `اتبعت تذكير لـ ${number(sent)} عضو بياناتهم ناقصة.`,
        `Reminder sent to ${number(sent)} members with an incomplete profile.`,
      ));
    } catch {
      toast.error(t(
        'معرفناش نبعت التذكير. راجع صلاحية الإشعارات وحاول تاني.',
        'The reminder could not be sent. Check notification permissions and try again.',
      ));
    } finally {
      setSending(false);
    }
  };

  return (
    <button type="button" className="member-dir-menu-item" onClick={() => { void remind(); }} disabled={sending}>
      <BellRing size={16} aria-hidden="true" />
      <span>{t('تذكير الناقصين', 'Remind incomplete profiles')}</span>
      <em>{number(incomplete.length)}</em>
    </button>
  );
}
