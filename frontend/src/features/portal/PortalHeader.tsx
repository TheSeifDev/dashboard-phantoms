import { Bell, LogOut, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/theme';
import { useNotificationStore } from '../../lib/notifications';

export function PortalHeader({ onLogout }: { onLogout: () => void }) {
  const { theme, toggle } = useThemeStore();
  const items = useNotificationStore((s) => s.items);
  const setDrawerOpen = useNotificationStore((s) => s.setDrawerOpen);
  const unreadCount = items.filter((item) => !item.read).length;

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex min-h-[calc(var(--header-h)+env(safe-area-inset-top))] items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-[env(safe-area-inset-top)] sm:px-6">
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <img src="/wasla-logo.png" alt="" className="size-8 object-contain sm:size-9" />
        <div>
          <strong className="block text-sm font-black sm:text-base">وصلة تك</strong>
          <span className="hidden text-xs text-[var(--text-muted)] sm:block">بوابة أعضاء الفريق</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="relative grid size-10 place-items-center rounded-xl border border-[var(--border)] text-[var(--link)] hover:bg-[var(--surface-2)] sm:size-11"
          aria-label={unreadCount > 0 ? `الإشعارات (${unreadCount} غير مقروءة)` : 'فتح مركز الإشعارات'}
        >
          <Bell size={19} />
          {unreadCount > 0 && (
            <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-emerald-600 px-1 text-[10px] font-black text-white tabular-nums">
              {unreadCount > 9 ? '+9' : unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={toggle}
          className="grid size-10 place-items-center rounded-xl border border-[var(--border)] text-[var(--link)] sm:size-11"
          aria-label={theme === 'dark' ? 'شغّل المظهر الفاتح' : 'شغّل المظهر الداكن'}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex size-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-sm font-bold text-[var(--text-2)] hover:bg-[var(--surface-2)] sm:size-auto sm:min-h-11 sm:px-3"
        >
          <LogOut size={17} aria-hidden="true" />
          <span className="hidden sm:inline">خروج</span>
        </button>
      </div>
    </header>
  );
}
