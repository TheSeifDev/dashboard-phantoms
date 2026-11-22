import { useCallback, useMemo, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';
import {
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Network,
  Settings,
} from 'lucide-react';
import { AppSidebar, useSidebarDrawer, type SidebarGroup } from '../../components/layout/AppSidebar';
import { MemberHeader, type ThemeOrigin } from './MemberHeader';
import { useAuthStore, getDeviceToken } from '../../store/auth';
import { useThemeStore } from '../../store/theme';
import { useLocale } from '../../i18n/useLocale';
import { gsap, useGSAP, prefersReducedMotion } from '../../components/motion/gsap';
import { memberSupabase } from '../../lib/supabase/member-client';
import { logoutMemberDevice } from '../members/api';
import { logoutMemberWithCleanup } from './member-logout';
import { useMemberProjectRoles } from './useMemberProjectRoles';
import { useMemberTeams } from './useMemberTeams';
import { toast } from '../../store/toast';

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

/**
 * بوابة العضو بنفس هيكل لوحة الإدارة: سايدبار ثابت + هيدر واحد + محتوى.
 * كل الأقسام بقت مسارات حقيقية (`?tab=` للمهام/التقييمات/الإعلانات) عشان
 * الرجوع للأمام وللخلف واللينكات المباشرة يشتغلوا زي الإدارة.
 */
export default function MemberPortalLayout() {
  const member = useAuthStore((state) => state.currentMember);
  const logoutMember = useAuthStore((state) => state.logoutMember);
  const { dir, t } = useLocale();
  const { theme, toggle } = useThemeStore();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const content = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const roles = useMemberProjectRoles(member?.id);
  const teams = useMemberTeams(member?.id);

  const teamNames = (teams.data ?? [])
    .filter((team) => team.status === 'approved' || team.status === 'active')
    .map((team) => team.name);

  const roleLabel = useMemo(() => {
    const parts: string[] = [];
    if (teamNames.length > 0) parts.push(teamNames.join(' · '));
    if (roles.isLead) parts.push(t('قائد مشروع ويب', 'Web project lead'));
    else if (roles.total > 0) parts.push(t('عضو مشروع ويب', 'Web project member'));
    return parts.length > 0 ? parts.join(' · ') : t('عضو في الفريق', 'Team member');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.isLead, roles.total, teams.data, t]);

  const groups = useMemo<SidebarGroup[]>(() => [
    {
      title: 'نظرة عامة',
      items: [{ to: '/portal', label: 'الرئيسية', icon: LayoutDashboard, end: true }],
    },
    {
      title: 'شغلي',
      items: [
        { to: '/portal?tab=TASKS', label: 'مهامي', icon: ListChecks, matchSearch: true },
        { to: '/portal?tab=EVALUATIONS', label: 'تقييماتي', icon: ClipboardCheck, matchSearch: true },
        { to: '/portal?tab=ANNOUNCEMENTS', label: 'الإعلانات', icon: Megaphone, matchSearch: true },
        { to: '/portal/team', label: 'الفريق الداخلي', icon: Network },
      ],
    },
    {
      title: 'مشروعات الويب',
      items: [{ to: '/portal/projects', label: 'مساحات المشروعات', icon: FolderKanban }],
    },
    {
      title: 'الحساب',
      items: [{ to: '/portal/settings', label: 'الحساب والإعدادات', icon: Settings }],
    },
  ], []);

  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const isHome = normalizedPath === '/portal' && !search;

  // نفس إحساس الانتقال في لوحة الإدارة: شريط تقدّم رفيع + الصفحة بتطلع لفوق.
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
  }, { dependencies: [pathname, search], revertOnUpdate: true });

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

  const signOut = useCallback(async () => {
    if (!member) { navigate('/login'); return; }
    const deviceToken = getDeviceToken();
    await logoutMemberWithCleanup({
      deviceLogout: deviceToken ? () => logoutMemberDevice(member.id, deviceToken) : undefined,
      localSignOut: async () => {
        const { error } = await memberSupabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      },
      clearMemberState: logoutMember,
      navigateToLogin: () => navigate('/login'),
      onDeviceLogoutFailure: () =>
        toast.error(t('حصلت مشكلة وإحنا بنسجّل خروج الجهاز، لكن تم تنظيف الجلسة المحلية.', 'There was a problem signing this device out, but local session data was cleared.')),
      onLocalSignOutFailure: () =>
        toast.error(t('حصلت مشكلة في إنهاء جلسة العضو، لكن تم تنظيف بيانات التطبيق.', 'There was a problem ending the member session, but local app data was cleared.')),
    });
  }, [member, logoutMember, navigate, t]);

  const { drawerOpen, openDrawer, closeDrawer } = useSidebarDrawer();
  const userName = member?.full_name || t('عضو الفريق', 'Team member');

  return (
    <div className={isHome ? 'app-workspace flex min-h-[100dvh] text-[var(--text)]' : 'app-workspace app-workspace--operations flex min-h-[100dvh] text-[var(--text)]'} dir={dir}>
      <div ref={progress} className="route-progress" aria-hidden="true" />
      <a className="skip-link" href="#portal-content">{t('انتقل إلى المحتوى الرئيسي', 'Skip to main content')}</a>
      <AppSidebar
        userName={userName}
        isOwner={false}
        permissions={{}}
        groups={groups}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
        brandTo="/portal"
        brandSubtitle={t('بوابة العضو', 'Member portal')}
        roleLabel={roleLabel}
        onSignOut={signOut}
        signOutTo="/login"
        avatarMember={member}
      />
      <div className="app-workspace-column flex min-w-0 flex-1 flex-col min-h-[100dvh]">
        <MemberHeader
          path={pathname}
          search={search}
          isDark={theme === 'dark'}
          drawerOpen={drawerOpen}
          member={member}
          onToggleTheme={toggleTheme}
          onOpenMenu={openDrawer}
        />
        <main
          ref={content}
          id="portal-content"
          tabIndex={isHome ? undefined : -1}
          className={isHome
            ? 'workspace-content mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-6'
            : 'workspace-content workspace-content--operations mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-6'}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}