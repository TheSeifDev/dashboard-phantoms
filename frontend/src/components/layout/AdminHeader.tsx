import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Command as CommandIcon, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { usePendingMemberJoinReviews } from '../../features/members/memberInviteApi';
import type { AdminPermission, AdminPermissions } from '../../types/db';
import { CommandPalette } from './CommandPalette';
import { gsap, prefersReducedMotion } from '../motion/gsap';

const pages: Array<{ path: string; ar: string; en: string; permission?: AdminPermission; ownerOnly?: boolean }> = [
  { path: '/admin/dashboard', ar: 'لوحة التحكم', en: 'Dashboard', permission: 'dashboard' },
  { path: '/admin/members', ar: 'دليل الأعضاء', en: 'Team members', permission: 'members' },
  { path: '/admin/tasks', ar: 'المهام والتكليفات', en: 'Tasks & assignments', permission: 'tasks' },
  { path: '/admin/evaluations', ar: 'تقييمات الأعضاء', en: 'Evaluations', permission: 'ranking' },
  { path: '/admin/ranking', ar: 'ترتيب الفريق', en: 'Leaderboard', permission: 'ranking' },
  { path: '/admin/notes', ar: 'الملاحظات والتوجيهات', en: 'Notes & feedback', permission: 'notes' },
  { path: '/admin/announcements', ar: 'الإعلانات والتنبيهات', en: 'Announcements', permission: 'announcements' },
  { path: '/admin/ai-assistant', ar: 'مساعد PHANTOMS الذكي', en: 'AI assistant', permission: 'ai_assistant' },
  { path: '/admin/telegram', ar: 'بوت تلجرام', en: 'Telegram bot', permission: 'whatsapp' },
  { path: '/admin/admins', ar: 'إدارة المشرفين', en: 'Administrators', ownerOnly: true },
  { path: '/admin/teams', ar: 'إدارة الفرق الداخلية', en: 'Internal teams', ownerOnly: true },
  { path: '/admin/web-projects', ar: 'مشروعات الويب', en: 'Web Projects', permission: 'web_projects' },
  { path: '/admin/web-projects/ideas', ar: 'أفكار المنتجات', en: 'Project ideas', permission: 'web_projects' },
  { path: '/admin/web-projects/projects', ar: 'دليل المشروعات', en: 'Project directory', permission: 'web_projects' },
  { path: '/admin/web-projects/timeline', ar: 'المخطط الزمني', en: 'Project timeline', permission: 'web_projects' },
  { path: '/admin/web-projects/agile', ar: 'لوحات أجايل', en: 'Agile boards', permission: 'web_projects' },
  { path: '/admin/web-projects/tasks', ar: 'مهام المشروعات', en: 'Project tasks', permission: 'web_projects' },
  { path: '/admin/web-projects/reports', ar: 'تقارير المشروعات', en: 'Project reports', permission: 'web_projects' },
  { path: '/admin/web-projects/resources', ar: 'موارد المشروعات', en: 'Project resources', permission: 'web_projects' },
];
export interface ThemeOrigin { x: number; y: number }
interface AdminHeaderProps {
  path: string;
  isDark: boolean;
  drawerOpen?: boolean;
  onToggleTheme: (origin?: ThemeOrigin) => void;
  onOpenMenu: () => void;
  isOwner?: boolean;
  permissions?: Partial<AdminPermissions>;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function AdminHeader({ path, isDark, drawerOpen = false, onToggleTheme, onOpenMenu, isOwner = false, permissions = {} }: AdminHeaderProps) {
  const { t, number } = useLocale();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);
  const canMembers = isOwner || permissions.members === true;
  const reviews = usePendingMemberJoinReviews(canMembers && notificationsOpen);
  const visiblePages = pages.filter((item) => (!item.ownerOnly || isOwner) && (!item.permission || isOwner || permissions[item.permission] === true));
  const normalizedPath = path.replace(/\/+$/, '') || '/';
  const current = pages
    .filter((item) => normalizedPath === item.path || normalizedPath.startsWith(`${item.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0] ?? pages[0];
  const reviewCount = reviews.data?.pages.flat().length;
  const isDashboard = normalizedPath === '/admin/dashboard' || normalizedPath === '/admin';
  const mac = isMac();

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setNotificationsOpen(false); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    // Capture phase + preventDefault so Ctrl/⌘K opens the palette instead of the browser search bar.
    const paletteKeys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen((value) => !value);
    };
    const scroll = () => setScrolled(window.scrollY > 8);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keys);
    window.addEventListener('keydown', paletteKeys, true);
    window.addEventListener('scroll', scroll, { passive: true });
    scroll();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keys);
      window.removeEventListener('keydown', paletteKeys, true);
      window.removeEventListener('scroll', scroll);
    };
  }, []);

  useEffect(() => { setPaletteOpen(false); setNotificationsOpen(false); }, [path]);

  // Header tools cascade in once; the title re-types itself on every route change.
  useEffect(() => {
    if (prefersReducedMotion() || !ref.current) return;
    const tween = gsap.fromTo(ref.current.querySelectorAll('.workspace-tools > *'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { tween.kill(); };
  }, []);
  useEffect(() => {
    if (prefersReducedMotion() || !ref.current) return;
    const tween = gsap.fromTo(ref.current.querySelectorAll('.workspace-heading-copy > *'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { tween.kill(); };
  }, [path]);
  useEffect(() => {
    const icon = themeButton.current?.querySelector('svg');
    if (!icon || prefersReducedMotion()) return;
    const tween = gsap.fromTo(icon, { rotate: -120, scale: 0.4, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2)' });
    return () => { tween.kill(); };
  }, [isDark]);

  const toggleTheme = () => {
    const rect = themeButton.current?.getBoundingClientRect();
    onToggleTheme(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
  };

  return (
    <header ref={ref} data-scrolled={scrolled} className={`workspace-header ${isDashboard ? 'workspace-header--dashboard' : 'workspace-header--operations'}`}>
      <div className="workspace-heading">
        <button type="button" onClick={onOpenMenu} aria-expanded={drawerOpen} className="header-icon lg:hidden" aria-label={t('افتح القائمة الرئيسية', 'Open main menu')} aria-haspopup="dialog"><Menu size={20} aria-hidden="true" /></button>
        <div className="workspace-heading-copy min-w-0">
          {isDashboard ? <>
            <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb"><span>PHANTOMS</span><span aria-hidden="true">/</span><span>{t('مساحة العمل', 'Workspace')}</span></nav>
            <h1 className="workspace-page-title">{t(current.ar, current.en)}</h1>
          </> : <>
            <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb"><span>PHANTOMS</span><span aria-hidden="true">/</span><span>{t('مساحة العمل', 'Workspace')}</span><span aria-hidden="true">/</span><span aria-current="page">{t(current.ar, current.en)}</span></nav>
            <p className="workspace-page-title" aria-hidden="true">{t(current.ar, current.en)}</p>
          </>}
        </div>
      </div>
      <div className="workspace-search-slot">
        <button type="button" className="workspace-search-trigger" onClick={() => setPaletteOpen(true)} aria-label={t('ابحث عن صفحة', 'Search pages')} aria-haspopup="dialog" aria-expanded={paletteOpen} aria-keyshortcuts="Control+K Meta+K" data-magnetic="0.15">
          <Search size={17} aria-hidden="true" />
          <span className="workspace-search-placeholder">{t('ابحث أو انتقل إلى...', 'Search or jump to…')}</span>
          <kbd className="kbd workspace-search-kbd" dir="ltr">{mac ? <><CommandIcon size={11} aria-hidden="true" />K</> : 'Ctrl K'}</kbd>
        </button>
      </div>
      <div className="workspace-tools">
        <LanguageToggle iconOnly />
        <button ref={themeButton} type="button" onClick={toggleTheme} className="header-icon header-theme" data-magnetic="0.3" aria-label={isDark ? t('شغّل الوضع الفاتح', 'Use light theme') : t('شغّل الوضع الداكن', 'Use dark theme')}>{isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
        {canMembers && <div className="notification-anchor">
          <button type="button" className="header-icon" data-magnetic="0.3" aria-label={t('طلبات الانضمام', 'Join requests')} aria-expanded={notificationsOpen} aria-controls="join-notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={18} aria-hidden="true" />{typeof reviewCount === 'number' && reviewCount > 0 && <span className="notification-dot" />}</button>
          {notificationsOpen && <section id="join-notifications" className="header-popover notification-popover" aria-label={t('طلبات الانضمام', 'Join requests')}>
            <div className="flex items-center justify-between gap-2"><h2>{t('مراجعة الانضمام', 'Join review')}</h2><button type="button" className="header-icon" onClick={() => setNotificationsOpen(false)} aria-label={t('اقفل', 'Close')}><X size={16} /></button></div>
            <p role="status">{reviews.isPending ? t('بنحمّل الطلبات...', 'Loading requests…') : reviews.isError ? t('تعذر تحميل الطلبات. راجع صفحة الأعضاء.', 'Unable to load requests. Open team members.') : `${number(reviewCount ?? 0)} ${t('طلب في انتظار المراجعة', 'requests awaiting review')}${reviews.hasNextPage ? '+' : ''}`}</p>
            <Link to="/admin/members" onClick={() => setNotificationsOpen(false)}>{t('افتح طلبات المراجعة', 'Open review queue')}</Link>
          </section>}
        </div>}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={visiblePages} isDark={isDark} onToggleTheme={() => onToggleTheme()} />
    </header>
  );
}
