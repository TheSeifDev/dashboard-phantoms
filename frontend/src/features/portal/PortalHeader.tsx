import { Bell, LogOut, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/theme';
import { useNotificationStore } from '../../lib/notifications';
import { PhantomsLogo } from '../../components/brand/PhantomsLogo';
import { useLocale } from '../../i18n/useLocale';

export function PortalHeader({ onLogout }: { onLogout: () => void }) {
  const { theme, toggle } = useThemeStore();
  const { locale, dir, setLocale, t, number } = useLocale();
  const items = useNotificationStore((s) => s.items);
  const drawerOpen = useNotificationStore((s) => s.drawerOpen);
  const setDrawerOpen = useNotificationStore((s) => s.setDrawerOpen);
  const unreadCount = items.filter((item) => !item.read).length;
  const controlClass = 'grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] text-[var(--link)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2';

  return (
    <header dir={dir} className="sticky top-0 z-[var(--z-sticky)] flex min-h-[calc(var(--header-h)+env(safe-area-inset-top))] items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 pt-[env(safe-area-inset-top)] sm:px-6">
      <div className="flex min-w-0 shrink items-center">
        <PhantomsLogo size="sm" subtitle={t('بوابة أعضاء الفريق', 'Team member portal')} />
        <div className="sr-only">
          <strong className="block text-sm font-black sm:text-base">PHANTOMS</strong>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
          className={controlClass}
          aria-label={t('التبديل إلى الإنجليزية', 'Switch to Arabic')}
          title={t('English', 'العربية')}
        >
          <span className="text-xs font-black" aria-hidden="true">{locale === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`relative ${controlClass}`}
          aria-label={unreadCount > 0
            ? t(`الإشعارات (${number(unreadCount)} غير مقروءة)`, `Notifications (${number(unreadCount)} unread)`)
            : t('فتح مركز الإشعارات', 'Open notifications')}
          aria-expanded={drawerOpen}
          aria-controls="notification-drawer"
        >
          <Bell size={19} aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[var(--success)] px-1 text-[10px] font-black text-[var(--on-success)] tabular-nums">
              {unreadCount > 9 ? '+9' : number(unreadCount)}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={toggle}
          className={controlClass}
          aria-label={theme === 'dark' ? t('شغّل المظهر الفاتح', 'Use light appearance') : t('شغّل المظهر الداكن', 'Use dark appearance')}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={onLogout}
          aria-label={t('تسجيل الخروج', 'Sign out')}
          className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-sm font-bold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 sm:size-auto sm:min-h-11 sm:px-3"
        >
          <LogOut size={17} aria-hidden="true" />
          <span className="hidden sm:inline">{t('خروج', 'Sign out')}</span>
        </button>
      </div>
    </header>
  );
}
