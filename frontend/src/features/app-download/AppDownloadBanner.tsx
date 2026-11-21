import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowDownToLine, X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import {
  dismissAppDownloadBanner,
  isAppDownloadBannerEligible,
  readAppDownloadBannerDismissal,
} from './AppDownloadPage';

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function AppDownloadBanner() {
  const { dir, t } = useLocale();
  const { pathname, search, hash } = useLocation();
  const [visible, setVisible] = useState(false);
  const dismissedThisSession = useRef(false);

  useEffect(() => {
    const eligible = isAppDownloadBannerEligible(pathname, { search, hash });
    setVisible(!dismissedThisSession.current && eligible && !readAppDownloadBannerDismissal(getStorage()));
  }, [hash, pathname, search]);

  if (!visible) return null;

  const dismiss = () => {
    dismissedThisSession.current = true;
    dismissAppDownloadBanner(getStorage());
    setVisible(false);
  };

  return (
    <aside
      dir={dir}
      role="status"
      aria-label={t('تنبيه تطبيق PHANTOMS', 'PHANTOMS app notice')}
      className="relative mx-3 mb-3 mt-[max(12px,env(safe-area-inset-top))] flex max-w-lg items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)] sm:mx-auto"
    >
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary-ink)]" aria-hidden="true">
        <ArrowDownToLine size={18} />
      </div>
      <p className="min-w-0 flex-1 text-xs font-bold leading-5 text-[var(--text-2)]">
        {t('ملف APK الرسمي لتطبيق PHANTOMS متاح لأندرويد.', 'The official PHANTOMS Android APK is available.')}
      </p>
      <Link to="/download" className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl bg-[var(--crimson)] px-3 text-xs font-black text-white hover:bg-[var(--primary-hover)]">
        {t('تنزيل APK', 'Download APK')}
      </Link>
      <button type="button" onClick={dismiss} className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label={t('لاحقاً', 'Later')}>
        <X size={17} aria-hidden="true" />
      </button>
    </aside>
  );
}

export default AppDownloadBanner;
