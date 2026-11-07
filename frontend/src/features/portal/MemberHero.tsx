import { Laptop, MapPin, Bell, BellRing, Download, CheckCircle2, Gift } from 'lucide-react';
import type { Member } from '../../types/db';
import { usePWA } from '../../hooks/usePWA';
import { formatSigned } from '../../lib/arabic';

export function MemberHero({
  member,
  onToggleField,
  isUpdating,
  totalBonus,
  bonusInfinite = false,
  bonusLoading = false,
  bonusStateLoading = false,
  bonusStateError = false,
}: {
  member: Member;
  onToggleField: () => void;
  isUpdating: boolean;
  totalBonus?: number | null;
  bonusInfinite?: boolean;
  bonusLoading?: boolean;
  bonusStateLoading?: boolean;
  bonusStateError?: boolean;
}) {
  const { isInstallable, installPWA, isSubscribed, subscribeToPush, sendTestNotification } = usePWA({
    memberId: member.id,
    memberEmail: member.email,
  });

  return (
    <section
      className="grid gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6"
      aria-labelledby="member-name"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-xl font-black text-white">
            {member.full_name.charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="member-name" className="text-xl font-black sm:text-2xl">
                {member.full_name}
              </h1>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--text-2)]">
              {member.bio || 'عضو شاطر ومبدع في الفريق'}
            </p>
            <p className="mt-1 break-all text-sm text-[var(--text-muted)]" dir="ltr">
              {member.email}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isInstallable && (
            <button
              type="button"
              onClick={installPWA}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--primary-soft)] px-3 text-xs font-bold text-[var(--link)] transition-colors hover:bg-[var(--primary)] hover:text-white"
            >
              <Download size={14} aria-hidden="true" /> تثبيت التطبيق
            </button>
          )}

          <button
            type="button"
            onClick={subscribeToPush}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors ${
              isSubscribed
                ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
                : 'bg-[var(--primary-soft)] text-[var(--link)] hover:bg-[var(--primary)] hover:text-white'
            }`}
          >
            {isSubscribed ? <CheckCircle2 size={14} /> : <Bell size={14} />}
            {isSubscribed ? 'الإشعارات شغالة' : 'شغّل الإشعارات'}
          </button>

          <button
            type="button"
            onClick={() => {
              void sendTestNotification();
            }}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <BellRing size={14} aria-hidden="true" />
            <span>جرّب الإشعار</span>
          </button>
        </div>
      </div>
      <div className="grid gap-2 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <span className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
            <Gift size={18} aria-hidden="true" />
            رصيد البونص
          </span>
          {bonusLoading || bonusStateLoading ? (
            <span
              className="h-5 w-10 animate-pulse rounded bg-amber-200/60 dark:bg-amber-900/60"
              aria-label="بنحمّل الرصيد"
            />
          ) : (
            <strong className="text-base font-black tabular-nums text-amber-900 dark:text-amber-100">
              {bonusStateError ? '—' : bonusInfinite ? '∞' : typeof totalBonus === 'number' ? formatSigned(totalBonus) : '—'}
            </strong>
          )}
        </div>
        <ReadinessInfo icon={<Laptop size={18} />} label="الجهاز المتاح" value={member.device || 'مش متحدد'} />
        <button
          type="button"
          onClick={onToggleField}
          disabled={isUpdating}
          aria-pressed={member.can_go_alexandria}
          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-start text-sm font-bold disabled:opacity-60"
        >
          <span className="flex items-center gap-2">
            <MapPin size={18} aria-hidden="true" />
            جاهزية النزول
          </span>
          <span>{member.can_go_alexandria ? 'جاهز' : 'مش جاهز'}</span>
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
      <strong>{value}</strong>
    </div>
  );
}
