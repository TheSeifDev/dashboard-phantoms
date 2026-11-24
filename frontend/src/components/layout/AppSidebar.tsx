import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import gsap from 'gsap';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Lock,
  BookMarked,
  CalendarCheck2,
  ChartGantt,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  FileChartColumn,
  FolderGit2,
  FolderKanban,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListChecks,
  ListTodo,
  LogOut,
  Megaphone,
  Network,
  PanelLeft,
  PanelRight,
  Send,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  StickyNote,
  Trophy,
  Wallet,
  Users,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { Drawer } from '../ui/Drawer';
import { PhantomsLogo } from '../brand/PhantomsLogo';
import type { AdminPermission, AdminPermissions, Member } from '../../types/db';
import { clearAdminSetupIntent } from '../../features/auth/auth-flow';
import { useAccountMember } from '../../features/auth/useAccountMember';
import { MemberAvatar } from '../ui/MemberAvatar';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';

const EN: Record<string, string> = {
  'نظرة عامة': 'Overview', 'العمليات': 'Operations', 'التواصل': 'Communication', 'الحساب': 'Account', 'إدارة النظام': 'Administration',
  'الحساب والإدارة': 'Account & administration',
  'الرئيسية': 'Dashboard', 'المهام': 'Tasks', 'الأعضاء': 'Members', 'التقييمات': 'Evaluations', 'ترتيب الفريق': 'Leaderboard',
  'الملاحظات': 'Notes', 'الإعلانات': 'Announcements', 'بوت تلجرام': 'Telegram bot', 'المساعد الذكي': 'AI assistant',
  'بوابة الأعضاء': 'Member portal', 'إدارة المشرفين': 'Administrators', 'الفرق الداخلية': 'Internal teams',
  'مشروعات الويب': 'Web Projects', 'ملخص المشروعات': 'Overview', 'الأفكار': 'Ideas', 'المشروعات': 'Projects',
  'المخطط الزمني': 'Timeline', 'لوحات أجايل': 'Agile boards', 'مهام المشروعات': 'Project tasks',
  'تقارير المشروعات': 'Reports', 'الموارد': 'Resources',
  'شغلي': 'My work', 'مهامي': 'My tasks', 'تقييماتي': 'My evaluations',
  'الفريق الداخلي': 'Internal team', 'مساحات المشروعات': 'Project workspaces',
  'الحساب والإعدادات': 'Account & settings', 'بوابة العضو': 'Member portal',
};

export interface SidebarLink {
  to: string;
  label: string;
  icon: typeof Users;
  end?: boolean;
  ownerOnly?: boolean;
  permission?: AdminPermission;
  /** Match the query string too (sections that live on `?tab=` of one route). */
  matchSearch?: boolean;
}

export interface SidebarGroup {
  title: string;
  items: SidebarLink[];
}

export const GROUPS: SidebarGroup[] = [
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
      { to: '/admin/tasks', label: 'المهام', icon: ListChecks, permission: 'tasks' },
      { to: '/admin/members', label: 'الأعضاء', icon: Users, permission: 'members' },
      { to: '/admin/meetings', label: 'الاجتماعات والحضور', icon: CalendarCheck2, permission: 'members' },
      { to: '/admin/references', label: 'المصادر', icon: BookMarked, permission: 'members' },
      { to: '/admin/ledger', label: 'الخزنة', icon: Wallet, permission: 'members' },
      {
        to: '/admin/teams',
        label: 'الفرق الداخلية',
        icon: Network,
        ownerOnly: true,
      },
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
    title: 'مشروعات الويب',
    items: [
      { to: '/admin/web-projects', label: 'ملخص المشروعات', icon: FolderKanban, end: true, permission: 'web_projects' },
      { to: '/admin/web-projects/ideas', label: 'الأفكار', icon: Lightbulb, permission: 'web_projects' },
      { to: '/admin/web-projects/projects', label: 'المشروعات', icon: FolderGit2, permission: 'web_projects' },
      { to: '/admin/web-projects/timeline', label: 'المخطط الزمني', icon: ChartGantt, permission: 'web_projects' },
      { to: '/admin/web-projects/agile', label: 'لوحات أجايل', icon: SquareKanban, permission: 'web_projects' },
      { to: '/admin/web-projects/tasks', label: 'مهام المشروعات', icon: ListTodo, permission: 'web_projects' },
      { to: '/admin/web-projects/reports', label: 'تقارير المشروعات', icon: FileChartColumn, permission: 'web_projects' },
      { to: '/admin/web-projects/resources', label: 'الموارد', icon: Library, permission: 'web_projects' },
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
        to: '/admin/telegram',
        label: 'بوت تلجرام',
        icon: Send,
        permission: 'whatsapp',
      },
      {
        to: '/admin/ai-assistant',
        label: 'المساعد الذكي',
        icon: Sparkles,
        permission: 'ai_assistant',
      },
    ],
  },
  {
    // الحساب وإدارة المشرفين في قائمة واحدة بدل قائمتين.
    title: 'الحساب والإدارة',
    items: [
      { to: '/portal', label: 'بوابة الأعضاء', icon: CircleUserRound },
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
  collapsed = false,
  isOwner,
  isAdmin = false,
  permissions,
  groups = GROUPS,
}: {
  onNavigate?: () => void;
  railTips?: boolean;
  collapsed?: boolean;
  isOwner: boolean;
  isAdmin?: boolean;
  permissions: Partial<AdminPermissions>;
  groups?: SidebarGroup[];
}) {
  const { t } = useLocale();
  const rail = useRailTooltip();
  const id = useId();
  const { pathname, search } = useLocation();
  // One group open at a time: opening another closes the previous one instead of
  // growing the rail past the viewport and forcing a scroll.
  // Admin starts on "العمليات"; other shells (member portal) start on their first group.
  const [openGroup, setOpenGroup] = useState<string | null>(() => (
    groups.some((group) => group.title === 'العمليات')
      ? 'العمليات'
      : groups.find((group) => group.title !== 'نظرة عامة')?.title ?? null
  ));
  // المشرفين بيشوفوا كل صفحات المالك كمان — بس الصفحات الحساسة بتظهر بقفل
  // لحد ما المالك يوافق على صلاحية مؤقتة.
  const canSee = (item: SidebarLink) =>
    (!item.ownerOnly || isOwner || isAdmin) &&
    (!item.permission || isOwner || permissions[item.permission] === true);
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter(canSee) }))
    .filter((group) => group.items.length > 0);
  /** Search-aware match so `?tab=` sections keep their own active pill. */
  const isItemActive = (item: SidebarLink) => {
    const [itemPath, itemSearch = ''] = item.to.split('?');
    if (item.matchSearch) {
      return pathname === itemPath && search.replace(/^\?/, '') === itemSearch;
    }
    return pathname === item.to || (!item.end && pathname.startsWith(`${item.to}/`));
  };
  const activeGroup = visibleGroups.find((group) =>
    group.title !== 'نظرة عامة' && group.items.some(isItemActive),
  )?.title;

  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroup(activeGroup);
  }, [activeGroup]);

  const label = (value: string) => t(value, EN[value] ?? value);
  return (
    <>
      {visibleGroups.map((group, index) => {
        const homeGroup = group.title === 'نظرة عامة';
        const expanded = homeGroup || collapsed || openGroup === group.title;
        const groupId = `${id}-section-${index}`;
        const links = group.items.map((item) => {
          const { to, label: itemLabel, icon: Icon, end } = item;
          const locked = item.ownerOnly === true && !isOwner;
          return (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={() => { rail.hide(); onNavigate?.(); }}
              title={label(itemLabel)}
              aria-label={label(itemLabel)}
              data-tip={railTips ? label(itemLabel) : undefined}
              {...(railTips ? rail.events(label(itemLabel)) : {})}
              className={({ isActive }) =>
                `app-sidebar-item${(item.matchSearch ? isItemActive(item) : isActive) ? ' is-active' : ''}${railTips ? ' app-sidebar-tip' : ''
                }`
              }
            >
              <Icon size={20} aria-hidden="true" />
              <span className="app-sidebar-item-label">{label(itemLabel)}</span>
              {locked && (
                <span className="app-sidebar-item-lock" aria-label={t('محتاجة موافقة المالك', 'Needs owner approval')}>
                  <Lock size={13} aria-hidden="true" />
                </span>
              )}
            </NavLink>
          </li>
          );
        });
        return (
          <section className={`app-sidebar-section${homeGroup ? ' is-home' : ''}`} key={group.title}>
            {!homeGroup && (
              <button
                type="button"
                className="app-sidebar-section-toggle"
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => setOpenGroup((current) => (current === group.title ? null : group.title))}
              >
                <span className="app-sidebar-group-title">{label(group.title)}</span>
                <ChevronDown className="app-sidebar-section-chevron" size={17} aria-hidden="true" />
              </button>
            )}
            <SidebarGroupList id={groupId} open={expanded}>
              {links}
            </SidebarGroupList>
          </section>
        );
      })}
      {rail.tooltip}
    </>
  );
}

/** GSAP needs a real rendering environment; DOM-less runtimes fall back to plain style writes. */
function canAnimate() {
  return typeof window !== 'undefined'
    && typeof globalThis.getComputedStyle === 'function'
    && typeof globalThis.requestAnimationFrame === 'function'
    && typeof window.matchMedia === 'function';
}

/**
 * Group list that grows and shrinks instead of snapping open/closed.
 * `hidden` is written imperatively so the closing tween can play out before the
 * list leaves the accessibility tree.
 */
const GROUP_ANIM_EVENT = 'phantoms:sidebar-group-anim';

function SidebarGroupList({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const reduced = !canAnimate() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reset = () => {
      list.style.removeProperty('height');
      list.style.removeProperty('overflow');
      list.style.removeProperty('opacity');
      list.style.removeProperty('will-change');
    };

    if (!mounted.current) {
      mounted.current = true;
      list.hidden = !open;
      return;
    }

    gsap.killTweensOf(list);
    if (reduced) {
      list.hidden = !open;
      reset();
      return;
    }

    list.style.overflow = 'hidden';
    list.style.willChange = 'height, opacity';
    const tick = () => { list.dispatchEvent(new CustomEvent(GROUP_ANIM_EVENT, { bubbles: true })); };
    if (open) {
      list.hidden = false;
      gsap.fromTo(
        list,
        { height: 0, opacity: 0 },
        {
          height: list.scrollHeight,
          opacity: 1,
          duration: 0.34,
          ease: 'power3.out',
          onUpdate: tick,
          onComplete: reset,
        },
      );
      return;
    }
    gsap.to(list, {
      height: 0,
      opacity: 0,
      duration: 0.24,
      ease: 'power2.inOut',
      onUpdate: tick,
      onComplete: () => {
        list.hidden = true;
        reset();
      },
    });
  }, [open]);

  return <ul ref={ref} id={id} className="app-sidebar-group">{children}</ul>;
}

export function AppSidebar({
  userName,
  isOwner,
  isAdmin = false,
  permissions,
  drawerOpen,
  onCloseDrawer,
  groups = GROUPS,
  guest = false,
  brandTo = '/admin',
  roleLabel,
  onSignOut,
  signOutTo = '/admin/login',
  avatarMember,
  brandSubtitle,
}: {
  userName: string;
  isOwner: boolean;
  isAdmin?: boolean;
  permissions: Partial<AdminPermissions>;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  groups?: SidebarGroup[];
  guest?: boolean;
  brandTo?: string;
  /** Overrides the footer role line (member portal shows the member's own role). */
  roleLabel?: string;
  /** Member sessions sign out of their own client instead of the admin one. */
  onSignOut?: () => Promise<void>;
  signOutTo?: string;
  avatarMember?: Member | null;
  brandSubtitle?: string;
}) {
  const { t, dir } = useLocale();
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [signingOut, setSigningOut] = useState(false);
  const logoutRail = useRailTooltip();
  const clear = useAuthStore((state) => state.clear);
  const accountMember = useAccountMember();
  const memberAvatar = avatarMember === undefined ? accountMember : avatarMember;
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const closeRef = useRef(onCloseDrawer);
  closeRef.current = onCloseDrawer;
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  // إغلاق الدرج عند التنقل
  useEffect(() => {
    closeRef.current();
  }, [pathname]);

  // Sliding active pill: GSAP glides one indicator to the active route instead of swapping fills.
  useEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator || typeof window === 'undefined') return;
    const animated = canAnimate();
    const reduced = !animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let first = true;
    let frame = 0;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('.app-sidebar-item.is-active');
      const rect = active?.getBoundingClientRect();
      if (!active || !rect || rect.width === 0 || active.closest('[hidden]')) {
        nav.dataset.indicator = 'off';
        indicator.style.opacity = '0';
        return;
      }
      const navRect = nav.getBoundingClientRect();
      const box = { x: rect.left - navRect.left + nav.scrollLeft, y: rect.top - navRect.top + nav.scrollTop, width: rect.width, height: rect.height };
      nav.dataset.indicator = 'on';
      if (animated) {
        gsap.to(indicator, { ...box, opacity: 1, duration: first || reduced ? 0 : 0.55, ease: 'power3.out', overwrite: 'auto' });
      } else {
        Object.assign(indicator.style, { transform: `translate(${box.x}px, ${box.y}px)`, width: `${box.width}px`, height: `${box.height}px`, opacity: '1' });
      }
      first = false;
    };
    const schedule = () => {
      if (typeof window.requestAnimationFrame !== 'function') { place(); return; }
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    place();
    schedule();
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutation?.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(nav);
    // Group open/close tweens change link positions without resizing the nav, so follow them too.
    nav.addEventListener(GROUP_ANIM_EVENT, schedule);
    return () => {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
      nav.removeEventListener(GROUP_ANIM_EVENT, schedule);
      mutation?.disconnect();
      resize?.disconnect();
      if (animated) gsap.killTweensOf(indicator);
    };
  }, [pathname, search, collapsed]);

  // Entrance: the rail fades in and links cascade once per mount.
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside || !canAnimate() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = aside.querySelectorAll('.app-sidebar-brand, .app-sidebar-section, .app-sidebar-footer');
    const tween = gsap.fromTo(items, { opacity: 0, x: dir === 'rtl' ? 14 : -14 }, { opacity: 1, x: 0, duration: 0.6, stagger: 0.05, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE, String(next)); } catch { /* UI preference only. */ }
  };
  const CollapseIcon = dir === 'rtl' ? PanelRight : PanelLeft;

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    logoutRail.hide();
    const failure = t('تعذّر تسجيل الخروج. جرّب تاني.', 'Could not sign out. Please try again.');
    try {
      if (onSignOut) {
        await onSignOut();
        onCloseDrawer();
        return;
      }
      const { error } = await supabase.auth.signOut();
      if (error) { toast.error(failure); return; }
      clear();
      clearAdminSetupIntent();
      onCloseDrawer();
      navigate(signOutTo);
    } catch { toast.error(failure); }
    finally { setSigningOut(false); }
  };

  return (
    <>
      <aside ref={asideRef} className="app-sidebar" data-collapsed={collapsed} aria-label={t('الشريط الجانبي', 'Sidebar')}>
        <div className="app-sidebar-header">
          <NavLink to={brandTo} className="app-sidebar-brand" aria-label={t('PHANTOMS — الرئيسية', 'PHANTOMS — Home')}>
            <span className="app-sidebar-logo-orb"><PhantomsLogo size="md" symbolOnly themeMode="dark" className="app-sidebar-logo" /></span>
            <span className="app-sidebar-brand-copy" aria-hidden="true"><strong>PHANTOMS</strong><small>{brandSubtitle ?? t('مساحة الفريق', 'Team workspace')}</small></span>
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
            <CollapseIcon size={20} aria-hidden="true" />
          </button>
        </div>
        <nav ref={navRef} id="desktop-sidebar-navigation" aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-sidebar-nav">
          <span ref={indicatorRef} className="app-sidebar-indicator" aria-hidden="true" />
          <SidebarLinks railTips collapsed={collapsed} isOwner={isOwner} isAdmin={isAdmin} permissions={permissions} groups={groups} />
        </nav>
        <div className="app-sidebar-footer">
          {guest ? (
            <div className="app-sidebar-guest-actions">
              <NavLink to="/login" className="app-sidebar-item app-sidebar-guest-cta" onClick={() => onCloseDrawer()}>
                <CircleUserRound size={20} aria-hidden="true" />
                <span className="app-sidebar-item-label">{t('دخول بوابة الأعضاء', 'Member sign in')}</span>
              </NavLink>
              <NavLink to="/admin/login" className="app-sidebar-item" onClick={() => onCloseDrawer()}>
                <ShieldCheck size={20} aria-hidden="true" />
                <span className="app-sidebar-item-label">{t('دخول الإدارة', 'Admin sign in')}</span>
              </NavLink>
            </div>
          ) : (
            <>
              <div className="app-sidebar-user" aria-hidden="true">
                <span className="app-sidebar-user-avatar-wrap">
                  <MemberAvatar member={memberAvatar} name={userName} size={76} className="app-sidebar-user-avatar" />
                  <i className="app-sidebar-user-status" />
                </span>
                <span className="app-sidebar-user-copy"><strong dir="auto">{userName}</strong><small>{roleLabel ?? (isOwner ? t('مالك الفريق', 'Team owner') : t('مدير النظام', 'Administrator'))}</small></span>
              </div>
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
            </>
          )}
        </div>
      </aside>
      {logoutRail.tooltip}

      <Drawer isOpen={drawerOpen} onClose={onCloseDrawer} title={t('القائمة الرئيسية', 'Main menu')} className="app-sidebar-drawer">
        <div className="app-drawer-user" aria-label={t('المستخدم الحالي', 'Current user')}>
          <MemberAvatar member={memberAvatar} name={userName} size={88} className="app-drawer-user-avatar" />
          <div className="min-w-0">
            <p className="truncate text-sm font-black app-drawer-user-name">{userName}</p>
            <p className="text-xs font-bold app-drawer-user-role">{roleLabel ?? t('مدير النظام', 'Administrator')}</p>
          </div>
        </div>
        <nav aria-label={t('التنقل الرئيسي', 'Main navigation')} className="app-drawer-nav flex flex-col gap-4 py-4">
          <SidebarLinks onNavigate={onCloseDrawer} isOwner={isOwner} isAdmin={isAdmin} permissions={permissions} groups={groups} />
          {guest ? (
            <>
              <NavLink to="/login" className="app-sidebar-item app-sidebar-guest-cta" onClick={onCloseDrawer}>
                <CircleUserRound size={20} aria-hidden="true" />
                <span className="app-sidebar-item-label">{t('دخول بوابة الأعضاء', 'Member sign in')}</span>
              </NavLink>
              <NavLink to="/admin/login" className="app-sidebar-item" onClick={onCloseDrawer}>
                <ShieldCheck size={20} aria-hidden="true" />
                <span className="app-sidebar-item-label">{t('دخول الإدارة', 'Admin sign in')}</span>
              </NavLink>
            </>
          ) : (
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
          )}
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
