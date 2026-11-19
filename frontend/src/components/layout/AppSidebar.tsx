import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CheckSquare,
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
                  onClick={onNavigate}
                  title={t(label, EN[label] ?? label)}
                  aria-label={t(label, EN[label] ?? label)}
                  data-tip={railTips ? t(label, EN[label] ?? label) : undefined}
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
  const { t } = useLocale();
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const closeRef = useRef(onCloseDrawer);
  closeRef.current = onCloseDrawer;

  // إغلاق الدرج عند التنقل
  useEffect(() => {
    closeRef.current();
  }, [pathname]);

  const logout = async () => {
    await supabase.auth.signOut();
    clear();
    clearAdminSetupIntent();
    onCloseDrawer();
    navigate('/admin/login');
  };

  return (
    <>
      <aside className="app-sidebar" aria-label={t('الشريط الجانبي', 'Sidebar')}>
        <NavLink to="/admin" className="app-sidebar-brand" aria-label={t('PHANTOMS — الرئيسية', 'PHANTOMS — Home')}>
          <PhantomsLogo size="md" className="app-sidebar-logo" />
          <span className="sr-only"><span>PHANTOMS</span></span>
        </NavLink>
        <nav aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-sidebar-nav">
          <SidebarLinks railTips isOwner={isOwner} permissions={permissions} />
        </nav>
        <div className="app-sidebar-footer">
          <button
            type="button"
            onClick={() => void logout()}
            title={t('سجّل الخروج', 'Sign out')}
            aria-label={t('سجّل الخروج', 'Sign out')}
            data-tip={t('سجّل الخروج', 'Sign out')}
            className="app-sidebar-item app-sidebar-tip app-sidebar-logout"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="app-sidebar-item-label">{t('سجّل الخروج', 'Sign out')}</span>
          </button>
        </div>
      </aside>

      <Drawer isOpen={drawerOpen} onClose={onCloseDrawer} title={t('القائمة الرئيسية', 'Main menu')}>
        <div className="app-drawer-user" aria-label={t('المستخدم الحالي', 'Current user')}>
          <span className="app-drawer-user-avatar" aria-hidden="true">
            {userName.trim().charAt(0) || 'م'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-[var(--text)]">{userName}</p>
            <p className="text-xs font-bold text-[var(--text-muted)]">{t('مدير النظام', 'Administrator')}</p>
          </div>
        </div>
        <nav aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-drawer-nav flex flex-col gap-4 py-4">
          <SidebarLinks onNavigate={onCloseDrawer} isOwner={isOwner} permissions={permissions} />
          <button
            type="button"
            onClick={() => void logout()}
            className="app-sidebar-item app-sidebar-logout app-drawer-nav"
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
