import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import MainLayout from '../components/layout/MainLayout';
import PublicWorkspaceLayout from '../components/layout/PublicWorkspaceLayout';
import { PhantomLoader } from '../components/motion/PhantomLoader';
import { supabase } from '../lib/supabase/client';
import { useAdminAccess } from '../features/admin/access/api';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { firstAllowedAdminPath } from '../features/admin/access/permissions';
import type { AdminPermission } from '../types/db';
import { clearAdminSetupIntent, inspectAdminCallback } from '../features/auth/auth-flow';
import { MemberAccessGuard } from '../features/auth/MemberAccessGuard';
import { useLocale } from '../i18n/useLocale';
import { managerDestination } from '../features/teams/access';
import { MemberProfileCompletionGuard } from '../features/members/MemberProfileCompletionGuard';
import { AppDownloadBanner } from '../features/app-download/AppDownloadBanner';

const AppDownloadPage = lazy(() => import('../features/app-download/AppDownloadPage'));
const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const AdminLoginPage = lazy(() => import('../features/auth/AdminLoginPage'));
const AdminSetPasswordPage = lazy(() => import('../features/auth/AdminSetPasswordPage'));
const AdminRecoveryCallbackPage = lazy(() => import('../features/auth/AdminSetPasswordPage').then((module) => ({ default: module.AdminRecoveryCallbackPage })));
const AdminForgotPasswordPage = lazy(() => import('../features/auth/AdminForgotPasswordPage'));
const MemberPortalPage = lazy(() => import('../features/portal/MemberPortalPage'));
const MemberPortalLayout = lazy(() => import('../features/portal/MemberPortalLayout'));
const MemberTeamPage = lazy(() => import('../features/portal/MemberTeamPage'));
const MemberWebProjectsPage = lazy(() => import('../features/web-projects/MemberWebProjectsPage'));
const MemberMeetingsPage = lazy(() => import('../features/meetings/MemberMeetingsPage'));
const MemberReferencesPage = lazy(() => import('../features/references/MemberReferencesPage'));
const MemberLedgerPage = lazy(() => import('../features/ledger/MemberLedgerPage'));
const MemberRankingPage = lazy(() => import('../features/portal/MemberRankingPage'));
const ProjectWorkspacePage = lazy(() => import('../features/web-projects/ProjectWorkspacePage'));
const MemberSelfRegisterPage = lazy(() => import('../features/members/MemberSelfRegisterPage'));
const MemberSettingsPage = lazy(() => import('../features/members/MemberSettingsPage'));
const MemberForgotPasswordPage = lazy(() => import('../features/auth/MemberForgotPasswordPage'));
const MemberExperiencePreviewPage = lazy(() => import('../features/members/MemberExperiencePreviewPage'));
const MemberRecoveryPage = lazy(() => import('../features/auth/MemberRecoveryPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const MembersPage = lazy(() => import('../features/members/MembersPage'));
const TasksPage = lazy(() => import('../features/tasks/TasksPage'));
const EvaluationsPage = lazy(() => import('../features/evaluations/EvaluationsPage'));
const NotesPage = lazy(() => import('../features/notes/NotesPage'));
const MeetingsPage = lazy(() => import('../features/meetings/MeetingsPage'));
const ReferencesPage = lazy(() => import('../features/references/ReferencesPage'));
const LedgerPage = lazy(() => import('../features/ledger/LedgerPage'));
const RankingPage = lazy(() => import('../features/ranking/RankingPage'));
const AiAssistantPage = lazy(() => import('../features/ai-assistant/AiAssistantPage'));
const WhatsAppTasksPage = lazy(() => import('../features/whatsapp/WhatsAppTasksPage'));
const AnnouncementsPage = lazy(() => import('../features/admin/announcements/AnnouncementsPage'));
const AdminAccountsPage = lazy(() => import('../features/admin/access/AdminAccountsPage'));
const TeamsManagementPage = lazy(() => import('../features/teams/TeamsManagementPage'));
const TeamWorkspacePage = lazy(() => import('../features/teams/workspace/TeamWorkspacePage'));
const WebProjectsPage = lazy(() => import('../features/web-projects/WebProjectsPage'));

function PageFallback() {
  return <PhantomLoader className="page-fallback" />;
}

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function hasAdminCallbackMaterial(): boolean {
  return inspectAdminCallback('/', window.location.search, window.location.hash).kind !== 'none';
}

/** حارس لوحة الإدارة — ينتظر فحص الجلسة الأولي قبل الحسم */
function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { t, dir } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const clear = useAuthStore((s) => s.clear);
  const access = useAdminAccess(user?.id ?? null);
  const handleLogout = async () => {
    await supabase.auth.signOut();
    clear();
    clearAdminSetupIntent();
  };
  // لا تحسم قبل اكتمال فحص supabase.auth.getSession — وإلا وَمَضت
  // إعادة التوجيه إلى تسجيل الدخول مع كل تحديث للصفحة
  if (!ready) return <PhantomLoader message={t('بنتأكد من الجلسة...', 'Checking your session...')} />;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (access.isPending) return <PhantomLoader message={t('بنتأكد من صلاحيات الإدارة...', 'Checking administrator access...')} />;
  if (access.isError) {
    return <div className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-5" dir={dir}><ErrorState message={t('معرفناش نتحقق من صلاحيات الإدارة. مفيش صفحات هتفتح قبل نجاح التحقق.', 'Could not verify administrator access. No pages will open until verification succeeds.')} onRetry={() => { void access.refetch(); }} /><Button variant="secondary" onClick={() => void handleLogout()}>{t('تسجيل الخروج', 'Sign out')}</Button></div>;
  }
  if (managerDestination(access.data) === '/team') return <Navigate to="/team" replace />;
  if (!access.data?.is_admin) {
    return <div className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-5" dir={dir}><ErrorState message={t('الحساب ده مش مضاف كحساب إداري. تواصل مع مالك النظام لو محتاج صلاحية.', 'This account is not registered as an administrator. Contact the system owner if you need access.')} /><Button variant="secondary" onClick={() => void handleLogout()}>{t('تسجيل الخروج', 'Sign out')}</Button></div>;
  }
  return <>{children}</>;
}

/** Team-only sessions never mount MainLayout or a global administrative page. */
function ProtectedTeamRoute({ children }: { children: React.ReactNode }) {
  const { t, dir } = useLocale();
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const access = useAdminAccess(user?.id ?? null);
  if (!ready) return <PhantomLoader message={t('بنتأكد من الجلسة...', 'Checking your session...')} />;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (access.isPending) return <PhantomLoader message={t('بنتأكد من تعيين الفريق...', 'Checking team assignment...')} />;
  if (access.isError) return <div className="mx-auto min-h-screen max-w-xl p-5" dir={dir}><ErrorState message={t('معرفناش نتحقق من تعيين الفريق؛ مفيش بيانات هتظهر.', 'Could not verify team assignment; no data will be displayed.')} onRetry={() => { void access.refetch(); }} /></div>;
  const destination = managerDestination(access.data);
  if (destination === '/admin') return <>{children}</>;
  if (destination !== '/team') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

function ProtectedOwnerRoute({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  if (access.isPending) return <PhantomLoader message={t('بنتأكد من صلاحية المالك...', 'Checking owner access...')} />;
  if (access.isError) return <ErrorState message={t('معرفناش نتحقق من صلاحية المالك.', 'Could not verify owner access.')} onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.is_owner) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function NoAdminSections() {
  const { t } = useLocale();
  const clear = useAuthStore((s) => s.clear);
  const logout = async () => {
    await supabase.auth.signOut();
    clear();
    clearAdminSetupIntent();
  };
  return (
    <div className="grid min-h-64 place-items-center">
      <div className="grid max-w-lg gap-3">
        <EmptyState title={t('مفيش أقسام متاحة للحساب ده', 'No sections are available for this account')} description={t('اطلب من مالك النظام يفتح لك قسم واحد على الأقل من شاشة إدارة المشرفين.', 'Ask the system owner to enable at least one section from administrator management.')} />
        <Button variant="secondary" onClick={() => void logout()}>{t('تسجيل الخروج', 'Sign out')}</Button>
      </div>
    </div>
  );
}

function AdminStartRedirect() {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  // Keyed by history entry: a repeated navigation to /admin (same route, already mounted)
  // must redirect again instead of leaving an empty outlet behind.
  const { key } = useLocation();
  if (access.isPending) return <PhantomLoader message={t('بنتأكد من صلاحياتك...', 'Checking your access...')} />;
  if (access.isError) return <ErrorState message={t('معرفناش نتحقق من صلاحياتك.', 'Could not verify your access.')} onRetry={() => { void access.refetch(); }} />;
  const path = firstAllowedAdminPath(access.data?.permissions);
  return path ? <Navigate key={key} to={path} replace /> : <NoAdminSections />;
}

function RequireAdminPermission({ permission, children }: { permission: AdminPermission; children: React.ReactNode }) {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  if (access.isPending) return <PhantomLoader message={t('بنتأكد من صلاحيات القسم...', 'Checking section access...')} />;
  if (access.isError) return <ErrorState message={t('معرفناش نتحقق من صلاحية القسم.', 'Could not verify access to this section.')} onRetry={() => { void access.refetch(); }} />;
  if (access.data?.is_owner || access.data?.permissions?.[permission] === true) return <>{children}</>;
  const path = firstAllowedAdminPath(access.data?.permissions);
  return path ? <Navigate to={path} replace /> : <NoAdminSections />;
}

function AdminSection({ permission, children }: { permission: AdminPermission; children: React.ReactNode }) {
  return <RequireAdminPermission permission={permission}>{children}</RequireAdminPermission>;
}

/** حارس بوابة الأعضاء */
function ProtectedMemberRoute({ children, allowIncompleteProfile = false }: { children: React.ReactNode; allowIncompleteProfile?: boolean }) {
  const member = useAuthStore((s) => s.currentMember);
  if (!member) return <Navigate to="/login" replace />;
  return <MemberAccessGuard>{allowIncompleteProfile ? children : <MemberProfileCompletionGuard>{children}</MemberProfileCompletionGuard>}</MemberAccessGuard>;
}

/** الجذر: وجّه الجلسات المحفوظة (تذكرني) مباشرة بدل رمي الجميع على الدخول */
function RootRedirect() {
  const { t } = useLocale();
  const member = useAuthStore((s) => s.currentMember);
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  if (hasAdminCallbackMaterial()) return <Page><AdminRecoveryCallbackPage /></Page>;
  if (member) return <Navigate to="/portal" replace />;
  if (!ready) return <PhantomLoader message={t('بنتأكد من الجلسة...', 'Checking your session...')} />;
  if (user) return <Navigate to="/admin" replace />;
  return <Navigate to="/login" replace />;
}

function AppDownloadShell() {
  return <><AppDownloadBanner /><Outlet /></>;
}

export const router = createBrowserRouter([{ element: <AppDownloadShell />, children: [
  {
    path: '/download',
    element: <PublicWorkspaceLayout />,
    children: [{ index: true, element: <Page><AppDownloadPage /></Page> }],
  },
  // Member Portal Routes
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '/login',
    element: <Page><LoginPage /></Page>,
  },
  { path: '/forgot-password', element: <Page><MemberForgotPasswordPage /></Page> },
  { path: '/member/recovery', element: <Page><MemberRecoveryPage /></Page> },
  { path: '/portal/settings', element: <ProtectedMemberRoute allowIncompleteProfile><Page><MemberSettingsPage /></Page></ProtectedMemberRoute> },
  {
    path: '/join',
    element: <Page><MemberSelfRegisterPage /></Page>,
  },
  {
    path: '/join/:token',
    element: <Page><MemberSelfRegisterPage /></Page>,
  },
  {
    path: '/reset',
    element: <Page><MemberSelfRegisterPage /></Page>,
  },
  {
    path: '/reset/:token',
    element: <Page><MemberSelfRegisterPage /></Page>,
  },
  {
    path: '/portal',
    element: <ProtectedMemberRoute><Page><MemberPortalLayout /></Page></ProtectedMemberRoute>,
    children: [
      { index: true, element: <Page><MemberPortalPage /></Page> },
      { path: 'team', element: <Page><MemberTeamPage /></Page> },
      { path: 'meetings', element: <Page><MemberMeetingsPage /></Page> },
      { path: 'references', element: <Page><MemberReferencesPage /></Page> },
      { path: 'ledger', element: <Page><MemberLedgerPage /></Page> },
      { path: 'ranking', element: <Page><MemberRankingPage /></Page> },
      { path: 'projects', element: <Page><MemberWebProjectsPage /></Page> },
    ],
  },
  {
    path: '/portal/projects/:projectId',
    element: <ProtectedMemberRoute><Page><ProjectWorkspacePage /></Page></ProtectedMemberRoute>,
  },

  // Admin Portal Routes
  {
    path: '/admin/login',
    element: <Page><AdminLoginPage /></Page>,
  },
  {
    path: '/admin/forgot-password',
    element: <Page><AdminForgotPasswordPage /></Page>,
  },
  {
    path: '/admin/recovery/callback',
    element: <Page><AdminRecoveryCallbackPage /></Page>,
  },
  {
    path: '/admin/set-password',
    element: <Page><AdminSetPasswordPage /></Page>,
  },
  {
    path: '/admin',
    element: (
      <ProtectedAdminRoute>
        <MainLayout />
      </ProtectedAdminRoute>
    ),
    children: [
      { index: true, element: <AdminStartRedirect /> },
      { path: 'dashboard', element: <AdminSection permission="dashboard"><Page><DashboardPage /></Page></AdminSection> },
      { path: 'members', element: <AdminSection permission="members"><Page><MembersPage /></Page></AdminSection> },
      { path: 'meetings', element: <AdminSection permission="members"><Page><MeetingsPage /></Page></AdminSection> },
      { path: 'references', element: <AdminSection permission="members"><Page><ReferencesPage /></Page></AdminSection> },
      { path: 'ledger', element: <AdminSection permission="members"><Page><LedgerPage /></Page></AdminSection> },
      { path: 'members/experience', element: <AdminSection permission="members"><Page><MemberExperiencePreviewPage /></Page></AdminSection> },
      { path: 'tasks', element: <AdminSection permission="tasks"><Page><TasksPage /></Page></AdminSection> },
      { path: 'evaluations', element: <AdminSection permission="ranking"><Page><EvaluationsPage /></Page></AdminSection> },
      { path: 'ranking', element: <AdminSection permission="ranking"><Page><RankingPage /></Page></AdminSection> },
      { path: 'notes', element: <AdminSection permission="notes"><Page><NotesPage /></Page></AdminSection> },
      { path: 'announcements', element: <AdminSection permission="announcements"><Page><AnnouncementsPage /></Page></AdminSection> },
      { path: 'ai-assistant', element: <AdminSection permission="ai_assistant"><Page><AiAssistantPage /></Page></AdminSection> },
      { path: 'whatsapp', element: <AdminSection permission="whatsapp"><Page><WhatsAppTasksPage /></Page></AdminSection> },
      { path: 'admins', element: <ProtectedOwnerRoute><Page><AdminAccountsPage /></Page></ProtectedOwnerRoute> },
      { path: 'teams', element: <ProtectedOwnerRoute><Page><TeamsManagementPage /></Page></ProtectedOwnerRoute> },
      { path: 'web-projects', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/ideas', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/projects', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/projects/:projectId', element: <AdminSection permission="web_projects"><Page><ProjectWorkspacePage /></Page></AdminSection> },
      { path: 'web-projects/timeline', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/agile', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/tasks', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/reports', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
      { path: 'web-projects/resources', element: <AdminSection permission="web_projects"><Page><WebProjectsPage /></Page></AdminSection> },
    ],
  },

  { path: '/team', element: <ProtectedTeamRoute><Page><TeamWorkspacePage /></Page></ProtectedTeamRoute> },
  { path: '/team/:teamId', element: <ProtectedTeamRoute><Page><TeamWorkspacePage /></Page></ProtectedTeamRoute> },

  // Fallback
  { path: '*', element: <Navigate to="/login" replace /> },
] }]);
