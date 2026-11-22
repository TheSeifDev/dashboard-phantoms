import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Command as CommandIcon, LogIn, Menu, Moon, Search, Sun } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { CommandPalette, type PaletteEntry } from './CommandPalette';
import { useThemeStore } from '../../store/theme';

const PAGES: PaletteEntry[] = [
  { path: '/download', ar: 'تطبيقات PHANTOMS', en: 'PHANTOMS apps' },
  { path: '/login', ar: 'بوابة الأعضاء', en: 'Member portal' },
  { path: '/admin/login', ar: 'دخول الإدارة', en: 'Admin sign in' },
  { path: '/forgot-password', ar: 'استعادة كلمة المرور', en: 'Reset password' },
  { path: '/join', ar: 'إنشاء كلمة مرور بالدعوة', en: 'Accept an invite' },
];

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function PublicHeader({ title, crumb }: { title: string; crumb: string }) {
  const { t } = useLocale();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const mac = isMac();

  useEffect(() => {
    const paletteKeys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen((value) => !value);
    };
    const scroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('keydown', paletteKeys, true);
    window.addEventListener('scroll', scroll, { passive: true });
    scroll();
    return () => {
      window.removeEventListener('keydown', paletteKeys, true);
      window.removeEventListener('scroll', scroll);
    };
  }, []);

  return (
    <>
      <header ref={ref} data-scrolled={scrolled} className="workspace-header workspace-header--operations">
        <div className="workspace-heading">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('phantoms:open-drawer'))}
            className="header-icon lg:hidden"
            aria-label={t('افتح القائمة الرئيسية', 'Open main menu')}
            aria-haspopup="dialog"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="workspace-heading-copy min-w-0">
            <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb">
              <span>PHANTOMS</span>
              <span aria-hidden="true">/</span>
              <span>{t('مساحة العمل', 'Workspace')}</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{crumb}</span>
            </nav>
            <p className="workspace-page-title" aria-hidden="true">{title}</p>
          </div>
        </div>
        <div className="workspace-search-slot">
          <button
            type="button"
            className="workspace-search-trigger"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('ابحث عن صفحة', 'Search pages')}
            aria-haspopup="dialog"
            aria-expanded={paletteOpen}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Search size={17} aria-hidden="true" />
            <span className="workspace-search-placeholder">{t('ابحث أو انتقل إلى...', 'Search or jump to…')}</span>
            <kbd className="kbd workspace-search-kbd" dir="ltr">{mac ? <><CommandIcon size={11} aria-hidden="true" />K</> : 'Ctrl K'}</kbd>
          </button>
        </div>
        <div className="workspace-tools">
          <LanguageToggle iconOnly />
          <button
            type="button"
            onClick={toggleTheme}
            className="header-icon header-theme"
            aria-label={theme === 'dark' ? t('شغّل الوضع الفاتح', 'Use light theme') : t('شغّل الوضع الداكن', 'Use dark theme')}
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          <Link to="/login" className="workspace-login-cta">
            <LogIn size={16} aria-hidden="true" />
            <span>{t('تسجيل الدخول', 'Sign in')}</span>
          </Link>
        </div>
      </header>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={PAGES}
        isDark={theme === 'dark'}
        onToggleTheme={toggleTheme}
      />
    </>
  );
}
