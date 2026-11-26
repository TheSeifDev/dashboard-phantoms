import { Outlet, useLocation } from 'react-router-dom';
import { useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { AdminHeader, type ThemeOrigin } from './AdminHeader';
import { AppSidebar, useSidebarDrawer } from './AppSidebar';
import { useAuthStore } from '../../store/auth';
import { useThemeStore } from '../../store/theme';
import { useAdminAccess } from '../../features/admin/access/api';
import { authorizedTeamEntries } from '../../features/teams/access';
import { AdminAppUsageTracker } from '../../features/app-usage/AdminAppUsageTracker';
import { useLocale } from '../../i18n/useLocale';
import { gsap, useGSAP, prefersReducedMotion } from '../motion/gsap';

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

export default function MainLayout() {
  const user = useAuthStore((state) => state.user);
  const { dir, t } = useLocale();
  const adminAccess = useAdminAccess(user?.id ?? null);
  const { theme, toggle } = useThemeStore();
  const { pathname } = useLocation();
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const isDashboard = normalizedPath === '/admin/dashboard' || normalizedPath === '/admin';
  const content = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);

  // Route change: a gradient progress beam sweeps the top edge while the page rises into place.
  useGSAP(() => {
    if (prefersReducedMotion() || !content.current) return;
    if (progress.current) {
      gsap.timeline()
        .set(progress.current, { scaleX: 0, opacity: 1 })
        .to(progress.current, { scaleX: 0.72, duration: 0.32, ease: 'power2.out' })
        .to(progress.current, { scaleX: 1, duration: 0.22, ease: 'power1.in' })
        .to(progress.current, { opacity: 0, duration: 0.3 }, '+=0.05');
    }
    gsap.fromTo(content.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out', clearProps: 'opacity,transform' });
  }, { dependencies: [pathname], revertOnUpdate: true });

  // Theme switch reveals the new palette as a circle growing from the toggle button.
  const toggleTheme = useCallback((origin?: ThemeOrigin) => {
    const doc = document as ViewTransitionDocument;
    if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) { toggle(); return; }
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? 0;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    try {
      const transition = doc.startViewTransition(() => { flushSync(() => toggle()); });
      transition.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 700, easing: 'cubic-bezier(.22,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => { /* Transition skipped; the theme already switched. */ });
    } catch {
      toggle();
    }
  }, [toggle]);

  // التاج في السايدبار بيعبّر عن الدور الحقيقي: مالك، أدمن، أو Head/Monitor على فريق.
  const roleLabel = useMemo(() => {
    const data = adminAccess.data;
    if (data?.owner_authority === true) return t('مالك الفريق', 'Team owner');
    if (data?.is_admin === true) return t('مدير النظام', 'Administrator');
    const entry = authorizedTeamEntries(data)[0];
    if (entry) {
      const role = entry.role === 'head' ? t('Head', 'Head') : t('Monitor', 'Monitor');
      return `${role} · ${entry.name}`;
    }
    return t('مدير النظام', 'Administrator');
  }, [adminAccess.data, t]);

  const { drawerOpen, openDrawer, closeDrawer } = useSidebarDrawer();
  const userName = (user?.user_metadata?.full_name as string | undefined)
    || user?.email?.split('@')[0]
    || t('المسؤول الإداري', 'Administrator');

  return (
    <div className={isDashboard ? 'app-workspace flex min-h-[100dvh] text-[var(--text)]' : 'app-workspace app-workspace--operations flex min-h-[100dvh] text-[var(--text)]'} dir={dir}>
      <div ref={progress} className="route-progress" aria-hidden="true" />
      <AdminAppUsageTracker enabled={adminAccess.data?.is_admin === true} />
      {!isDashboard && <a className="skip-link" href="#workspace-content">{t('انتقل إلى المحتوى الرئيسي', 'Skip to main content')}</a>}
      <AppSidebar userName={userName} isOwner={adminAccess.data?.owner_authority === true} isAdmin={adminAccess.data?.is_admin === true} permissions={adminAccess.data?.permissions ?? {}} roleLabel={roleLabel} drawerOpen={drawerOpen} onCloseDrawer={closeDrawer} />
      <div className="app-workspace-column flex min-w-0 flex-1 flex-col min-h-[100dvh]">
        <AdminHeader path={pathname} isDark={theme === 'dark'} drawerOpen={drawerOpen} onToggleTheme={toggleTheme} onOpenMenu={openDrawer} isOwner={adminAccess.data?.owner_authority === true} permissions={adminAccess.data?.permissions ?? {}} />
        <main ref={content} id="workspace-content" tabIndex={isDashboard ? undefined : -1} className={isDashboard ? 'workspace-content mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-6' : 'workspace-content workspace-content--operations mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-6'}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
