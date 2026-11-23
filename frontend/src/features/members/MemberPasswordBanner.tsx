import { Link } from 'react-router-dom';
import { ArrowUpRight, KeyRound } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { useMemberPasswordAccess } from '../auth/member-password-access';

/**
 * Shown on the member workspace while the account still signs in with a
 * temporary password set by an administrator.
 */
export function MemberPasswordBanner() {
  const { t } = useLocale();
  const access = useMemberPasswordAccess();
  if (access.data?.must_change_password !== true) return null;
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
      role="status"
      aria-labelledby="member-password-banner-title"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <KeyRound size={19} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p id="member-password-banner-title" className="text-sm font-black">{t('كلمة المرور دي مؤقتة', 'This password is temporary')}</p>
          <p className="mt-0.5 text-xs leading-5">{t('اختار كلمة مرور خاصة بك وأكّدها من الإعدادات عشان حسابك يبقى آمن.', 'Choose and confirm your own password in Settings to keep your account safe.')}</p>
        </div>
      </div>
      <Link to="/portal/settings#password" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white hover:opacity-95">
        {t('تغيير كلمة المرور', 'Change password')}
        <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}
