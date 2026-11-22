import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar, useSidebarDrawer } from './AppSidebar';
import { MEMBER_WORKSPACE_GROUPS } from './workspace-groups';
import { PublicHeader } from './PublicHeader';
import { useLocale } from '../../i18n/useLocale';

const TITLES: Record<string, { ar: string; en: string; shortAr: string; shortEn: string }> = {
  '/download': { ar: 'تطبيقات PHANTOMS', en: 'PHANTOMS apps', shortAr: 'التطبيقات', shortEn: 'Apps' },
};

export default function PublicWorkspaceLayout() {
  const { pathname } = useLocation();
  const { t, dir } = useLocale();
  const { drawerOpen, openDrawer, closeDrawer } = useSidebarDrawer();
  const normalized = pathname.replace(/\/+$/, '') || '/download';
  const page = TITLES[normalized] ?? TITLES['/download'];

  useEffect(() => {
    const handler = () => openDrawer();
    window.addEventListener('phantoms:open-drawer', handler);
    return () => window.removeEventListener('phantoms:open-drawer', handler);
  }, [openDrawer]);

  return (
    <div className="app-workspace app-workspace--operations flex min-h-[100dvh] text-[var(--text)]" dir={dir}>
      <AppSidebar
        userName={t('زائر', 'Guest')}
        isOwner={false}
        permissions={{}}
        groups={MEMBER_WORKSPACE_GROUPS}
        guest
        brandTo="/portal"
        brandSubtitle={t('بوابة العضو', 'Member portal')}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
      />
      <div className="app-workspace-column flex min-h-[100dvh] min-w-0 flex-1 flex-col">
        <PublicHeader title={t(page.ar, page.en)} crumb={t(page.ar, page.en)} shortTitle={t(page.shortAr, page.shortEn)} />
        <main id="workspace-content" className="workspace-content workspace-content--operations mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 md:px-7 md:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}