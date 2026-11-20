import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { usePendingMemberJoinReviews } from '../../features/members/memberInviteApi';
import type { AdminPermission, AdminPermissions } from '../../types/db';

const pages: Array<{path: string; ar: string; en: string; permission?: AdminPermission; ownerOnly?: boolean}> = [
  { path: '/admin/dashboard', ar: 'لوحة التحكم', en: 'Dashboard', permission: 'dashboard' },
  { path: '/admin/members', ar: 'دليل الأعضاء', en: 'Team members', permission: 'members' },
  { path: '/admin/tasks', ar: 'المهام والتكليفات', en: 'Tasks & assignments', permission: 'tasks' },
  { path: '/admin/evaluations', ar: 'تقييمات الأعضاء', en: 'Evaluations', permission: 'ranking' },
  { path: '/admin/ranking', ar: 'ترتيب الفريق', en: 'Leaderboard', permission: 'ranking' },
  { path: '/admin/notes', ar: 'الملاحظات والتوجيهات', en: 'Notes & feedback', permission: 'notes' },
  { path: '/admin/announcements', ar: 'الإعلانات والتنبيهات', en: 'Announcements', permission: 'announcements' },
  { path: '/admin/ai-assistant', ar: 'مساعد PHANTOMS الذكي', en: 'AI assistant', permission: 'ai_assistant' },
  { path: '/admin/whatsapp', ar: 'إرسال المهام عبر واتساب', en: 'WhatsApp assignments', permission: 'whatsapp' },
  { path: '/admin/admins', ar: 'إدارة المشرفين', en: 'Administrators', ownerOnly: true },
  { path: '/admin/teams', ar: 'إدارة الفرق الداخلية', en: 'Internal teams', ownerOnly: true },
];
interface AdminHeaderProps {
  path: string;
  userName: string;
  isDark: boolean;
  drawerOpen?: boolean;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  isOwner?: boolean;
  permissions?: Partial<AdminPermissions>;
}

export function AdminHeader({ path, userName, isDark, drawerOpen = false, onToggleTheme, onOpenMenu, isOwner = false, permissions = {} }: AdminHeaderProps) {
  const { t, number } = useLocale();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const canMembers = isOwner || permissions.members === true;
  const reviews = usePendingMemberJoinReviews(canMembers && notificationsOpen);
  const visiblePages = pages.filter((item) => (!item.ownerOnly || isOwner) && (!item.permission || isOwner || permissions[item.permission] === true));
  const results = visiblePages.filter((item) => `${item.ar} ${item.en}`.toLowerCase().includes(search.trim().toLowerCase()));
  const current = pages.find((item) => item.path === path) ?? pages[0];
  const reviewCount = reviews.data?.pages.flat().length;

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) { setSearchOpen(false); setNotificationsOpen(false); }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSearchOpen(false); setNotificationsOpen(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);

  return (
    <header ref={ref} className="workspace-header">
      <div className="workspace-heading">
        <button type="button" onClick={onOpenMenu} aria-expanded={drawerOpen} className="header-icon lg:hidden" aria-label={t('افتح القائمة الرئيسية', 'Open main menu')} aria-haspopup="dialog"><Menu size={20} aria-hidden="true" /></button>
        <div className="min-w-0">
          <nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="workspace-breadcrumb"><span>PHANTOMS</span><span aria-hidden="true">/</span><span>{t('مساحة العمل', 'Workspace')}</span></nav>
          <h1 className="workspace-page-title">{t(current.ar, current.en)}</h1>
        </div>
      </div>
      <div className="workspace-tools">
        <form className="workspace-search" onSubmit={(event) => { event.preventDefault(); if (results[0]) { navigate(results[0].path); setSearchOpen(false); setSearch(''); } }}>
          <Search size={17} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} aria-label={t('ابحث عن صفحة', 'Search pages')} placeholder={t('ابحث في مساحة العمل...', 'Search workspace…')} aria-expanded={searchOpen} aria-controls="workspace-search-results" />
          <span className="search-key" aria-hidden="true">↵</span>
          {searchOpen && <div id="workspace-search-results" className="header-popover search-results">
            <p>{t('انتقل إلى', 'Navigate to')}</p>
            {results.length ? results.map((item) => <Link key={item.path} to={item.path} onClick={() => { setSearchOpen(false); setSearch(''); }}>{t(item.ar, item.en)}</Link>) : <span>{t('مفيش صفحة مطابقة', 'No matching pages')}</span>}
          </div>}
        </form>
        <LanguageToggle />
        <button type="button" onClick={onToggleTheme} className="header-icon" aria-label={isDark ? t('شغّل الوضع الفاتح', 'Use light theme') : t('شغّل الوضع الداكن', 'Use dark theme')}>{isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
        {canMembers && <div className="notification-anchor">
          <button type="button" className="header-icon" aria-label={t('طلبات الانضمام', 'Join requests')} aria-expanded={notificationsOpen} aria-controls="join-notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={19} aria-hidden="true" />{typeof reviewCount === 'number' && reviewCount > 0 && <span className="notification-dot" />}</button>
          {notificationsOpen && <section id="join-notifications" className="header-popover notification-popover" aria-label={t('طلبات الانضمام', 'Join requests')}>
            <div className="flex items-center justify-between gap-2"><h2>{t('مراجعة الانضمام', 'Join review')}</h2><button type="button" className="header-icon" onClick={() => setNotificationsOpen(false)} aria-label={t('اقفل', 'Close')}><X size={16} /></button></div>
            <p role="status">{reviews.isPending ? t('بنحمّل الطلبات...', 'Loading requests…') : reviews.isError ? t('تعذر تحميل الطلبات. راجع صفحة الأعضاء.', 'Unable to load requests. Open team members.') : `${number(reviewCount ?? 0)} ${t('طلب في انتظار المراجعة', 'requests awaiting review')}${reviews.hasNextPage ? '+' : ''}`}</p>
            <Link to="/admin/members" onClick={() => setNotificationsOpen(false)}>{t('افتح طلبات المراجعة', 'Open review queue')}</Link>
          </section>}
        </div>}
        <div className="header-account" title={userName}><span className="header-avatar" aria-hidden="true">{userName.trim().charAt(0).toUpperCase() || 'P'}</span><span className="header-account-copy"><strong dir="auto">{userName}</strong><small>{isOwner ? t('مالك الفريق', 'Team owner') : t('المشرف', 'Administrator')}</small></span><ChevronDown size={13} aria-hidden="true" /></div>
      </div>
    </header>
  );
}
