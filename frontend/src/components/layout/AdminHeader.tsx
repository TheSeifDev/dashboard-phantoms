import { Menu, Moon, Sun } from 'lucide-react';

const pageTitles: Record<string, string> = {
  '/admin': 'لوحة التحكم',
  '/admin/dashboard': 'لوحة التحكم',
  '/admin/members': 'دليل الأعضاء',
  '/admin/tasks': 'المهام والتكليفات',
  '/admin/evaluations': 'تقييمات الأعضاء',
  '/admin/ranking': 'ترتيب الفريق',
  '/admin/notes': 'الملاحظات والتوجيهات',
  '/admin/announcements': 'الإعلانات والتنبيهات',
  '/admin/ai-assistant': 'مساعد وصلة الذكي',
  '/admin/whatsapp': 'إرسال المهام عبر واتساب',
  '/admin/admins': 'إدارة المشرفين',
};

const pageParents: Record<string, string> = {
  '/admin/members': 'لوحة التحكم',
  '/admin/tasks': 'لوحة التحكم',
  '/admin/evaluations': 'لوحة التحكم',
  '/admin/ranking': 'لوحة التحكم',
  '/admin/notes': 'لوحة التحكم',
  '/admin/announcements': 'لوحة التحكم',
  '/admin/ai-assistant': 'لوحة التحكم',
  '/admin/whatsapp': 'لوحة التحكم',
  '/admin/admins': 'لوحة التحكم',
};

interface AdminHeaderProps {
  path: string;
  userName: string;
  isDark: boolean;
  drawerOpen?: boolean;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
}

export function AdminHeader({
  path,
  userName,
  isDark,
  drawerOpen = false,
  onToggleTheme,
  onOpenMenu,
}: AdminHeaderProps) {
  const title = pageTitles[path] ?? pageTitles['/admin'];
  const parent = pageParents[path];
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex h-[calc(var(--header-h)+env(safe-area-inset-top))] items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-[env(safe-area-inset-top)] md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-expanded={drawerOpen}
          className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] lg:hidden"
          aria-label="افتح القائمة الرئيسية"
          aria-haspopup="dialog"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0 text-start">
          <p className="truncate text-xs font-semibold text-[var(--text-muted)] md:text-sm">
            أهلاً، <span dir="ltr" className="inline-block">{userName}</span>
          </p>
          <nav
            aria-label="مسار الصفحة"
            className="flex min-w-0 items-center gap-1.5 text-base font-black md:text-lg"
          >
            {parent && (
              <span className="hidden shrink-0 text-xs font-bold text-[var(--text-muted)] md:inline">
                {parent} /
              </span>
            )}
            <h1 className="truncate">{title}</h1>
          </nav>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleTheme}
        className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--link)] transition-colors hover:bg-[var(--surface-2)]"
        aria-label={isDark ? 'شغّل الوضع الفاتح' : 'شغّل الوضع الداكن'}
      >
        {isDark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
      </button>
    </header>
  );
}
