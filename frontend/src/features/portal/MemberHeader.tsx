import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Command as CommandIcon, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { CommandPalette } from '../../components/layout/CommandPalette';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import { useQuery } from '@tanstack/react-query';
import AnnouncementsAPI from '../../lib/api/announcements';
import { useMemberEvaluations } from '../evaluations/api';
import type { Member } from '../../types/db';

export interface ThemeOrigin { x: number; y: number }

/** Portal sections, shared by the header palette, the page title and the sidebar. */
export const MEMBER_PAGES: Array<{ path: string; ar: string; en: string }> = [
  { path: '/portal', ar: 'الرئيسية', en: 'Home' },
  { path: '/portal?tab=TASKS', ar: 'مهامي', en: 'My tasks' },
  { path: '/portal?tab=EVALUATIONS', ar: 'تقييماتي وملاحظات الأداء', en: 'My evaluations' },
  { path: '/portal?tab=ANNOUNCEMENTS', ar: 'الإعلانات', en: 'Announcements' },
  { path: '/portal/team', ar: 'الفريق الداخلي', en: 'Internal team' },
  { path: '/portal/projects', ar: 'مشروعات الويب', en: 'Web projects' },
  { path: '/portal/settings', ar: 'الحساب والإعدادات', en: 'Account & settings' },
];

interface MemberHeaderProps {
  path: string;
  search: string;
  isDark: boolean;
  drawerOpen?: boolean;
  member: Member | null;
  onToggleTheme: (origin?: ThemeOrigin) => void;
  onOpenMenu: () => void;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** نفس هيدر الإدارة لكن بأقسام بوابة العضو وإشعارات العضو. */
export function MemberHeader({ path, search, isDark, drawerOpen = false, member, onToggleTheme, onOpenMenu }: MemberHeaderProps) {
  const { t, number } = useLocale();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);

  const evaluations = useMemberEvaluations(member?.id ?? null);
  const announcements = useQuery({
    queryKey: ['member-announcements-header', member?.id],
    enabled: typeof member?.id === 'number',
    staleTime: 60_000,
    queryFn: () => AnnouncementsAPI.getMemberAnnouncements(member!.id),
  });

  const unreadEvaluations = (evaluations.data ?? []).filter((row) => !row.read_at).length;
  const unreadAnnouncements = (announcements.data ?? []).filter((row) => !row.is_read && !row.is_dismissed).length;
  const unreadTotal = unreadEvaluations + unreadAnnouncements;

  const currentTab = new URLSearchParams(search).get('tab');
  const section = path === '/portal'
    ? (currentTab ? MEMBER_PAGES.find((page) => page.path.endsWith(`tab=${currentTab}`)) : MEMBER_PAGES[0])
    : MEMBER_PAGES.find((page) => page.path !== '/portal' && path.startsWith(page.path));
  const current = section ?? MEMBER_PAGES[0];
  const isHome = path === '/portal' && !currentTab;
  const mac = isMac();

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setNotificationsOpen(false); };
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') setNotificationsOpen(false); };
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

  useEffect(() => { setPaletteOpen(false); setNotificationsOpen(false); }, [path, search]);

  useEffect(() => {
    if (prefersReducedMotion() || !ref.current) return;
    const tween = gsap.fromTo(ref.current.querySelectorAll('.workspace-tools > *'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { tween.kill(); };
  }, []);
  useEffect(() => {
    if (prefersReducedMotion() || !ref.current) return;
    const tween = gsap.fromTo(ref.current.querySelectorAll('.workspace-heading-copy > *'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { tween.kill(); };
  }, [path, search]);
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
    <header ref={ref} data-scrolled={scrolled} className={`workspace-header ${isHome ? 'workspace-header--dashboard' : 'workspace-header--operations'}`}>
      <div className="workspace-heading">
        <button type="button" onClick={onOpenMenu} aria-expanded={drawerOpen} className="header-icon lg:hidden" aria-label={t('افتح القائمة الرئيسية', 'Open main menu')} aria-haspopup="dialog"><Menu size={20} aria-hidden="true" /></button>
        <div className="workspace-heading-copy min-w-0">
          {isHome ? <>
            <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb"><span>PHANTOMS</span><span aria-hidden="true">/</span><span>{t('بوابة العضو', 'Member portal')}</span></nav>
            <h1 className="workspace-page-title">{t(current.ar, current.en)}</h1>
          </> : <>
            <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb"><span>PHANTOMS</span><span aria-hidden="true">/</span><span>{t('بوابة العضو', 'Member portal')}</span><span aria-hidden="true">/</span><span aria-current="page">{t(current.ar, current.en)}</span></nav>
            <p className="workspace-page-title" aria-hidden="true">{t(current.ar, current.en)}</p>
          </>}
        </div>
      </div>

      <div className="workspace-search-slot">
        <button type="button" className="workspace-search-trigger" onClick={() => setPaletteOpen(true)} aria-label={t('ابحث عن قسم', 'Search sections')} aria-haspopup="dialog" aria-expanded={paletteOpen} aria-keyshortcuts="Control+K Meta+K" data-magnetic="0.15">
          <Search size={17} aria-hidden="true" />
          <span className="workspace-search-placeholder">{t('ابحث أو انتقل إلى...', 'Search or jump to…')}</span>
          <kbd className="kbd workspace-search-kbd" dir="ltr">{mac ? <><CommandIcon size={11} aria-hidden="true" />K</> : 'Ctrl K'}</kbd>
        </button>
      </div>

      <div className="workspace-tools">
        <LanguageToggle iconOnly />
        <button ref={themeButton} type="button" onClick={toggleTheme} className="header-icon header-theme" data-magnetic="0.3" aria-label={isDark ? t('شغّل الوضع الفاتح', 'Use light theme') : t('شغّل الوضع الداكن', 'Use dark theme')}>{isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
        <div className="notification-anchor">
          <button type="button" className="header-icon" data-magnetic="0.3" aria-label={t('إشعاراتي', 'My notifications')} aria-expanded={notificationsOpen} aria-controls="member-notifications" onClick={() => setNotificationsOpen((value) => !value)}>
            <Bell size={18} aria-hidden="true" />
            {unreadTotal > 0 && <span className="notification-dot" />}
          </button>
          {notificationsOpen && (
            <section id="member-notifications" className="header-popover notification-popover" aria-label={t('إشعاراتي', 'My notifications')}>
              <div className="flex items-center justify-between gap-2">
                <h2>{t('إشعاراتي', 'My notifications')}</h2>
                <button type="button" className="header-icon" onClick={() => setNotificationsOpen(false)} aria-label={t('اقفل', 'Close')}><X size={16} /></button>
              </div>
              <p role="status">
                {evaluations.isPending && announcements.isPending
                  ? t('بنحمّل الإشعارات...', 'Loading notifications…')
                  : `${number(unreadTotal)} ${t('جديد في انتظارك', 'new waiting for you')}`}
              </p>
              <Link to="/portal?tab=EVALUATIONS" onClick={() => setNotificationsOpen(false)}>
                {t('تقييماتي', 'My evaluations')} · {number(unreadEvaluations)}
              </Link>
              <Link to="/portal?tab=ANNOUNCEMENTS" onClick={() => setNotificationsOpen(false)}>
                {t('الإعلانات', 'Announcements')} · {number(unreadAnnouncements)}
              </Link>
            </section>
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={MEMBER_PAGES} isDark={isDark} onToggleTheme={() => { onToggleTheme(); }} />
    </header>
  );
}