import { Outlet, useLocation } from 'react-router-dom';
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { AdminHeader } from './AdminHeader';
import { AppSidebar, useSidebarDrawer } from './AppSidebar';
import { useAuthStore } from '../../store/auth';
import { useThemeStore } from '../../store/theme';
import { useAdminAccess } from '../../features/admin/access/api';
import { useLocale } from '../../i18n/useLocale';

gsap.registerPlugin(useGSAP);

export default function MainLayout() {
  const user = useAuthStore((state) => state.user);
  const { dir, t } = useLocale();
  const adminAccess = useAdminAccess(user?.id ?? null);
  const { theme, toggle } = useThemeStore();
  const { pathname } = useLocation();
  const content = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !content.current) return;
    gsap.from(content.current, { y: 6, opacity: 0.9, duration: 0.22, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, { scope: content, dependencies: [pathname], revertOnUpdate: true });
  const { drawerOpen, openDrawer, closeDrawer } = useSidebarDrawer();
  const userName = (user?.user_metadata?.full_name as string | undefined)
    || user?.email?.split('@')[0]
    || t('المسؤول الإداري', 'Administrator');

  return (
    <div className="app-workspace flex min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]" dir={dir}>
      <AppSidebar userName={userName} isOwner={adminAccess.data?.is_owner === true} permissions={adminAccess.data?.permissions ?? {}} drawerOpen={drawerOpen} onCloseDrawer={closeDrawer} />
      <div className="flex min-w-0 flex-1 flex-col min-h-[100dvh]">
        <AdminHeader path={pathname} userName={userName} isDark={theme === 'dark'} drawerOpen={drawerOpen} onToggleTheme={toggle} onOpenMenu={openDrawer} isOwner={adminAccess.data?.is_owner === true} permissions={adminAccess.data?.permissions ?? {}} />
        <main ref={content} id="workspace-content" className="workspace-content mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
