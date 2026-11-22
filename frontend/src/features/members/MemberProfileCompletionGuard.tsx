import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isMemberCoreProfileComplete, useMemberProfile } from './profile-api';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { ErrorState } from '../../components/ui/ErrorState';
import { useLocale } from '../../i18n/useLocale';
import { PortalHeader } from '../portal/PortalHeader';
import { cleanupMemberState } from '../auth/MemberAccessGuard';

/** Product-completion prompt, AFTER the existing live identity/device guard.
 * SQL validates registration/profile writes; this does not grant business access.
 */
export function MemberProfileCompletionGuard({ children }: { children: ReactNode }) {
  const { t, dir } = useLocale();
  const location = useLocation();
  const profile = useMemberProfile();
  if (profile.isPending || !profile.isFetchedAfterMount) return <PhantomLoader message={t('بنتأكد من اكتمال بياناتك...', 'Checking your profile information...')} />;
  if (profile.isError || !profile.data) return (
    <div dir={dir} className="min-h-screen bg-[var(--bg)]">
      <PortalHeader onLogout={() => { void cleanupMemberState(); }} />
      <main className="mx-auto max-w-xl p-5"><ErrorState message={t('تعذّر تحميل بيانات الملف. حسابك لم يُحذف أو يُعطّل. أعد المحاولة أو تواصل مع الإدارة.', 'Your profile could not be loaded. Your account has not been deleted or disabled. Retry or contact the administrators.')} onRetry={() => { void profile.refetch(); }} /></main>
    </div>
  );
  // Every profile field is mandatory, but only the core identity fields block
  // the workspace; the rest is collected by the completion banner + reminders.
  if (!isMemberCoreProfileComplete(profile.data)) return <Navigate to="/portal/settings" replace state={{ profileCompletionRequired: true, from: location.pathname }} />;
  return <>{children}</>;
}
