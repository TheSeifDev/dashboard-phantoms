import { Laptop, MapPin, Bell, BellRing, Download, CheckCircle2, Gift } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Member } from '../../types/db';
import { usePWA } from '../../hooks/usePWA';
import { formatSigned } from '../../lib/arabic';
import { useLocale } from '../../i18n/useLocale';
import { isRunningInNativeApk } from '../../lib/capacitor';
import { MemberAvatar } from '../../components/ui/MemberAvatar';

export function MemberHero({
  member,
  onToggleField,
  isUpdating,
  totalBonus,
  bonusInfinite = false,
  bonusLoading = false,
  bonusError = false,
  bonusStateLoading = false,
  bonusStateError = false,
}: {
  member: Member;
  onToggleField: () => void;
  isUpdating: boolean;
  totalBonus?: number | null;
  bonusInfinite?: boolean;
  bonusLoading?: boolean;
  bonusError?: boolean;
  bonusStateLoading?: boolean;
  bonusStateError?: boolean;
}) {
  const { isSubscribed, subscribeToPush, sendTestNotification } = usePWA({
    memberId: member.id,
    memberEmail: member.email,
  });
  const { t, dir } = useLocale();

  return (
    <section
      dir={dir}
      className="grid gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6"
      aria-labelledby="member-name"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <MemberAvatar
            member={member}
            name={member.full_name}
            size={112}
            className="grid size-14 shrink-0 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] text-xl font-black text-[var(--text)]"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="member-name" dir="auto" className="text-xl font-black sm:text-2xl">
                {member.full_name}
              </h1>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--text-2)]">
              <span dir="auto">{member.bio || t('عضو شاطر ومبدع في الفريق', 'A valued and creative team member')}</span>
            </p>
            <p className="mt-1 break-all text-sm text-[var(--text-muted)]" dir="ltr">
              {member.email}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isRunningInNativeApk() && (
            <Link
              to="/download"
              className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              <Download size={14} aria-hidden="true" /> {t('تنزيل APK لأندرويد', 'Download Android APK')}
            </Link>
          )}

          <button
            type="button"
            onClick={subscribeToPush}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors ${
              isSubscribed
                ? 'bg-[var(--success-soft)] text-[var(--success-text)] hover:bg-[var(--success-soft)] dark:text-[var(--success-text)]'
                : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2`}
            aria-pressed={isSubscribed}
          >
            {isSubscribed ? <CheckCircle2 size={14} /> : <Bell size={14} />}
            {isSubscribed ? t('الإشعارات شغالة', 'Notifications enabled') : t('شغّل الإشعارات', 'Enable notifications')}
          </button>

          <button
            type="button"
            onClick={() => {
              void sendTestNotification();
            }}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            <BellRing size={14} aria-hidden="true" />
            <span>{t('جرّب الإشعار', 'Test notification')}</span>
          </button>
        </div>
      </div>
      <div className="grid gap-2 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <span className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
            <Gift size={18} aria-hidden="true" />
            {t('رصيد البونص', 'Bonus balance')}
          </span>
          {bonusLoading || bonusStateLoading ? (
            <span
              className="h-5 w-10 animate-pulse rounded bg-amber-200/60 dark:bg-amber-900/60"
              aria-label={t('بنحمّل الرصيد', 'Loading balance')}
              role="status"
            />
          ) : (
            <strong aria-label={bonusError || bonusStateError ? t('تعذّر تحميل بيانات البونص', 'Bonus balance unavailable') : undefined} className="text-base font-black tabular-nums text-amber-900 dark:text-amber-100">
              {bonusError || bonusStateError ? t('غير متاح', 'Unavailable') : bonusInfinite ? '∞' : typeof totalBonus === 'number' ? formatSigned(totalBonus) : '—'}
            </strong>
          )}
        </div>
        <ReadinessInfo icon={<Laptop size={18} />} label={t('الجهاز المتاح', 'Available device')} value={member.device || t('مش متحدد', 'Not specified')} />
        <button
          type="button"
          onClick={onToggleField}
          disabled={isUpdating}
          aria-pressed={member.can_go_alexandria}
          aria-busy={isUpdating}
          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-start text-sm font-bold transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="flex items-center gap-2">
            <MapPin size={18} aria-hidden="true" />
            {t('جاهزية النزول', 'Field availability')}
          </span>
          <span aria-live="polite">{isUpdating ? t('جارٍ التحديث…', 'Updating…') : member.can_go_alexandria ? t('جاهز', 'Available') : t('مش جاهز', 'Unavailable')}</span>
        </button>
      </div>
    </section>
  );
}

function ReadinessInfo({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm">
      <span className="flex items-center gap-2 text-[var(--text-muted)]">
        {icon}
        {label}
      </span>
      <strong dir="auto">{value}</strong>
    </div>
  );
}
