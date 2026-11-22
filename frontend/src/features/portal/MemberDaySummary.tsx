import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { PersonAvatar } from '../dashboard/PersonAvatar';
import { GithubMark } from '../dashboard/GithubMark';
import type { PersonInfo } from '../dashboard/TaskStreakHeatmap';

/**
 * ملخص اليوم للعضو: اعتمادات اليوم + مساهمات GitHub بالأسماء والأفاتار.
 * بيستخدمه الهيرو (هيكس «النهارده») وخريطة المساهمات بدل درج الأدمن اللي
 * فيه ملاحظات وتسليمات إدارية.
 */
export function MemberDaySummary({ date, approvals, shares, people, onClose }: {
  date: string;
  approvals: number;
  shares: Array<{ memberId: number; handle: string; count: number }>;
  people: ReadonlyMap<number, PersonInfo>;
  onClose: () => void;
}) {
  const { t, number, date: formatDate } = useLocale();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const githubTotal = shares.reduce((total, share) => total + share.count, 0);
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--graphite-900)_55%,transparent)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t(`تفاصيل ${date}`, `Details for ${date}`)}
      onClick={onClose}
    >
      <div className="glass-card w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h3 className="text-base font-black">{formatDate(new Date(`${date}T12:00:00.000Z`), { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {t(`${number(approvals)} اعتماد · ${number(githubTotal)} مساهمة GitHub`, `${number(approvals)} approvals · ${number(githubTotal)} GitHub contributions`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--glass-hairline)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--glass-bg-soft)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={t('إغلاق', 'Close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {shares.length > 0 ? (
          <ul className="mt-4 grid gap-2">
            {shares.map((share) => {
              const person = people.get(share.memberId);
              return (
                <li key={`${share.memberId}-${share.handle}`} className="flex items-center gap-3 rounded-xl border border-[var(--glass-hairline)] px-3 py-2">
                  <PersonAvatar id={share.memberId} name={person?.name ?? share.handle} handle={share.handle} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{person?.name ?? share.handle}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-black text-[var(--text-secondary)]">
                    <GithubMark size={13} />{number(share.count)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {t('مفيش مساهمات GitHub مسجّلة في اليوم ده.', 'No GitHub contributions recorded on this day.')}
          </p>
        )}
      </div>
    </div>
  );
}