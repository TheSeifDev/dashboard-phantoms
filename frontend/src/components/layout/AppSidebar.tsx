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
  const canSee = (item: SidebarLink) =>
    (!item.ownerOnly || isOwner) &&
    (!item.permission || isOwner || permissions[item.permission] === true);
  return (
    <>
      {GROUPS.filter((group) => group.items.some(canSee)).map((group) => (
        <div key={group.title}>
          <p className="app-sidebar-group-title" aria-hidden="true">
            {group.title}
          </p>
          <ul className="app-sidebar-group">
            {group.items.filter(canSee).map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={label}
                  aria-label={label}
                  data-tip={railTips ? label : undefined}
                  className={({ isActive }) =>
                    `app-sidebar-item${isActive ? ' is-active' : ''}${
                      railTips ? ' app-sidebar-tip' : ''
                    }`
                  }
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="app-sidebar-item-label">{label}</span>
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
    onCloseDrawer();
    navigate('/admin/login');
  };

  return (
    <>
      <aside className="app-sidebar" aria-label="الشريط الجانبي">
        <NavLink to="/admin" className="app-sidebar-brand" aria-label="PHANTOMS — الرئيسية">
          <PhantomsLogo size="md" className="app-sidebar-logo" />
        </NavLink>
        <nav aria-label="التنقل الرئيسي" className="app-sidebar-nav">
          <SidebarLinks railTips isOwner={isOwner} permissions={permissions} />
        </nav>
        <div className="app-sidebar-footer">
          <button
            type="button"
            onClick={() => void logout()}
            title="سجّل الخروج"
            aria-label="سجّل الخروج"
            data-tip="سجّل الخروج"
            className="app-sidebar-item app-sidebar-tip app-sidebar-logout"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="app-sidebar-item-label">سجّل الخروج</span>
          </button>
        </div>
      </aside>

      <Drawer isOpen={drawerOpen} onClose={onCloseDrawer} title="القائمة الرئيسية">
        <div className="app-drawer-user" aria-label="المستخدم الحالي">
          <span className="app-drawer-user-avatar" aria-hidden="true">
            {userName.trim().charAt(0) || 'م'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-[var(--text)]">{userName}</p>
            <p className="text-xs font-bold text-[var(--text-muted)]">مدير النظام</p>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي" className="app-drawer-nav flex flex-col gap-4 py-4">
          <SidebarLinks onNavigate={onCloseDrawer} isOwner={isOwner} permissions={permissions} />
          <button
            type="button"
            onClick={() => void logout()}
            className="app-sidebar-item app-sidebar-logout app-drawer-nav"
          >
            <LogOut size={20} aria-hidden="true" />
            <span className="app-sidebar-item-label">سجّل الخروج</span>
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
