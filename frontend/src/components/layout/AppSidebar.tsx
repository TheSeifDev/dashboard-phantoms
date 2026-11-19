import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  StickyNote,
  Trophy,
  Users,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { Drawer } from '../ui/Drawer';
import { PhantomsLogo } from '../brand/PhantomsLogo';
import type { AdminPermission, AdminPermissions } from '../../types/db';
import { clearAdminSetupIntent } from '../../features/auth/auth-flow';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';

const EN: Record<string, string> = {
  'نظرة عامة': 'Overview', 'العمليات': 'Operations', 'التواصل': 'Communication', 'الحساب': 'Account', 'إدارة النظام': 'Administration',
  'الرئيسية': 'Dashboard', 'المهام': 'Tasks', 'الأعضاء': 'Members', 'التقييمات': 'Evaluations', 'ترتيب الفريق': 'Leaderboard',
  'الملاحظات': 'Notes', 'الإعلانات': 'Announcements', 'إرسال المهام عبر واتساب': 'WhatsApp assignments', 'المساعد الذكي': 'AI assistant',
  'بوابة الأعضاء': 'Member portal', 'إدارة المشرفين': 'Administrators',
};

interface SidebarLink {
  to: string;
  label: string;
  icon: typeof Users;
  end?: boolean;
  ownerOnly?: boolean;
  permission?: AdminPermission;
}

interface SidebarGroup {
  title: string;
  items: SidebarLink[];
}

const GROUPS: SidebarGroup[] = [
  {
    title: 'نظرة عامة',
    items: [
      {
        to: '/admin/dashboard',
        label: 'الرئيسية',
        icon: LayoutDashboard,
        end: true,
        permission: 'dashboard',
      },
    ],
  },
  {
    title: 'العمليات',
    items: [
      { to: '/admin/tasks', label: 'المهام', icon: CheckSquare, permission: 'tasks' },
      { to: '/admin/members', label: 'الأعضاء', icon: Users, permission: 'members' },
      {
        to: '/admin/evaluations',
        label: 'التقييمات',
        icon: ClipboardCheck,
        permission: 'ranking',
      },
      { to: '/admin/ranking', label: 'ترتيب الفريق', icon: Trophy, permission: 'ranking' },
      { to: '/admin/notes', label: 'الملاحظات', icon: StickyNote, permission: 'notes' },
    ],
  },
  {
    title: 'التواصل',
    items: [
      {
        to: '/admin/announcements',
        label: 'الإعلانات',
        icon: Megaphone,
        permission: 'announcements',
      },
      {
        to: '/admin/whatsapp',
        label: 'إرسال المهام عبر واتساب',
        icon: MessageCircle,
        permission: 'whatsapp',
      },
      {
        to: '/admin/ai-assistant',
        label: 'المساعد الذكي',
        icon: Bot,
        permission: 'ai_assistant',
      },
    ],
  },
  { title: 'الحساب', items: [{ to: '/portal', label: 'بوابة الأعضاء', icon: Users }] },
  {
    title: 'إدارة النظام',
    items: [
      {
        to: '/admin/admins',
        label: 'إدارة المشرفين',
        icon: ShieldCheck,
        ownerOnly: true,
      },
  ],
  },
];

const SIDEBAR_PREFERENCE = 'phantoms_sidebar_collapsed';

export function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const preference = window.localStorage.getItem(SIDEBAR_PREFERENCE);
    if (preference === 'true') return true;
    if (preference === 'false') return false;
  } catch { /* Blocked UI storage must not prevent navigation. */ }
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1279px)').matches;
}

function useRailTooltip() {
  const { dir } = useLocale();
  const id = useId();
  const [tip, setTip] = useState<{ label: string; top: number; left: number; right: number } | null>(null);
  useEffect(() => {
    const clearTip = () => setTip(null);
    clearTip();
    window.addEventListener('resize', clearTip);
    return () => window.removeEventListener('resize', clearTip);
  }, [dir]);
  const show = (target: HTMLElement, label: string) => {
    if (target.closest('aside')?.dataset.collapsed !== 'true') return;
    const rect = target.getBoundingClientRect();
    setTip({ label, top: Math.max(8, Math.min(window.innerHeight - 40, rect.top + rect.height / 2 - 16)), left: rect.right + 12, right: window.innerWidth - rect.left + 12 });
  };
  return {
    events: (label: string) => ({
      onFocus: (event: FocusEvent<HTMLElement>) => show(event.currentTarget, label),
      onPointerEnter: (event: PointerEvent<HTMLElement>) => show(event.currentTarget, label),
      onBlur: () => setTip(null),
      onPointerLeave: () => setTip(null),
      'aria-describedby': tip?.label === label ? id : undefined,
    }),
    hide: () => setTip(null),
    tooltip: tip ? createPortal(<span id={id} role="tooltip" className="app-sidebar-tooltip" dir={dir} style={{ top: tip.top, ...(dir === 'rtl' ? { right: tip.right } : { left: tip.left }) }}>{tip.label}</span>, document.body) : null,
  };
}

function SidebarLinks({
  onNavigate,
  railTips,
  isOwner,
  permissions,
}: {
  onNavigate?: () => void;
  railTips?: boolean;
  isOwner: boolean;
  permissions: Partial<AdminPermissions>;
}) {
  const { t } = useLocale();
  const rail = useRailTooltip();
  const canSee = (item: SidebarLink) =>
    (!item.ownerOnly || isOwner) &&
    (!item.permission || isOwner || permissions[item.permission] === true);
  return (
    <>
      {GROUPS.filter((group) => group.items.some(canSee)).map((group) => (
        <div key={group.title}>
          <p className="app-sidebar-group-title" aria-hidden="true">
            {t(group.title, EN[group.title] ?? group.title)}
          </p>
          <ul className="app-sidebar-group">
            {group.items.filter(canSee).map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => { rail.hide(); onNavigate?.(); }}
                  title={t(label, EN[label] ?? label)}
                  aria-label={t(label, EN[label] ?? label)}
                  data-tip={railTips ? t(label, EN[label] ?? label) : undefined}
                  {...(railTips ? rail.events(t(label, EN[label] ?? label)) : {})}
                  className={({ isActive }) =>
                    `app-sidebar-item${isActive ? ' is-active' : ''}${
                      railTips ? ' app-sidebar-tip' : ''
                    }`
                  }
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="app-sidebar-item-label">{t(label, EN[label] ?? label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {rail.tooltip}
    </>
  );
}

export function AppSidebar({
  userName,
  isOwner,
  permissions,
  drawerOpen,
  onCloseDrawer,
}: {
  userName: string;
  isOwner: boolean;
  permissions: Partial<AdminPermissions>;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const { t, dir } = useLocale();
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [signingOut, setSigningOut] = useState(false);
  const logoutRail = useRailTooltip();
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const closeRef = useRef(onCloseDrawer);
  closeRef.current = onCloseDrawer;

  // إغلاق الدرج عند التنقل
  useEffect(() => {
    closeRef.current();
  }, [pathname]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE, String(next)); } catch { /* UI preference only. */ }
  };
  const CollapseIcon = collapsed
    ? (dir === 'rtl' ? ChevronLeft : ChevronRight)
    : (dir === 'rtl' ? ChevronRight : ChevronLeft);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    logoutRail.hide();
    const failure = t('تعذّر تسجيل الخروج. جرّب تاني.', 'Could not sign out. Please try again.');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) { toast.error(failure); return; }
      clear();
      clearAdminSetupIntent();
      onCloseDrawer();
      navigate('/admin/login');
    } catch { toast.error(failure); }
    finally { setSigningOut(false); }
  };

  return (
    <>
      <aside className="app-sidebar" data-collapsed={collapsed} aria-label={t('الشريط الجانبي', 'Sidebar')}>
        <NavLink to="/admin" className="app-sidebar-brand" aria-label={t('PHANTOMS — الرئيسية', 'PHANTOMS — Home')}>
          <PhantomsLogo size="md" themeMode="dark" className="app-sidebar-logo" />
          <span className="sr-only"><span>PHANTOMS</span></span>
        </NavLink>
        <button
          type="button"
          className="app-sidebar-collapse"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="desktop-sidebar-navigation"
          aria-label={collapsed ? t('وسّع الشريط الجانبي', 'Expand sidebar') : t('اطوِ الشريط الجانبي', 'Collapse sidebar')}
          title={collapsed ? t('وسّع الشريط الجانبي', 'Expand sidebar') : t('اطوِ الشريط الجانبي', 'Collapse sidebar')}
        >
          <CollapseIcon size={18} aria-hidden="true" />
        </button>
        <nav id="desktop-sidebar-navigation" aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-sidebar-nav">
          <SidebarLinks railTips isOwner={isOwner} permissions={permissions} />
        </nav>
        <div className="app-sidebar-footer">
          <button
            type="button"
            onClick={() => void logout()}
            title={t('سجّل الخروج', 'Sign out')}
            aria-label={t('سجّل الخروج', 'Sign out')}
            data-tip={t('سجّل الخروج', 'Sign out')}
            {...logoutRail.events(t('سجّل الخروج', 'Sign out'))}
            disabled={signingOut}
            aria-busy={signingOut || undefined}
            className="app-sidebar-item app-sidebar-tip app-sidebar-logout"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="app-sidebar-item-label">{t('سجّل الخروج', 'Sign out')}</span>
          </button>
        </div>
      </aside>
      {logoutRail.tooltip}

      <Drawer isOpen={drawerOpen} onClose={onCloseDrawer} title={t('القائمة الرئيسية', 'Main menu')} className="app-sidebar-drawer">
        <div className="app-drawer-user" aria-label={t('المستخدم الحالي', 'Current user')}>
          <span className="app-drawer-user-avatar" aria-hidden="true">
            {userName.trim().charAt(0) || 'م'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black app-drawer-user-name">{userName}</p>
            <p className="text-xs font-bold app-drawer-user-role">{t('مدير النظام', 'Administrator')}</p>
          </div>
        </div>
        <nav aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-drawer-nav flex flex-col gap-4 py-4">
          <SidebarLinks onNavigate={onCloseDrawer} isOwner={isOwner} permissions={permissions} />
          <button
            type="button"
            onClick={() => void logout()}
            disabled={signingOut}
            aria-busy={signingOut || undefined}
            className="app-sidebar-item app-sidebar-logout"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="app-sidebar-item-label">{t('سجّل الخروج', 'Sign out')}</span>
          </button>
          <span className="sr-only">{userName}</span>
        </nav>
      </Drawer>
      <span className="sr-only">{userName}</span>
    </>
  );
}

export function useSidebarDrawer() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return {
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  };
}
