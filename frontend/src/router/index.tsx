import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import MainLayout from '../components/layout/MainLayout';
import { supabase } from '../lib/supabase/client';
import { useAdminAccess } from '../features/admin/access/api';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { firstAllowedAdminPath } from '../features/admin/access/permissions';
import type { AdminPermission } from '../types/db';

const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const AdminLoginPage = lazy(() => import('../features/auth/AdminLoginPage'));
const AdminSetPasswordPage = lazy(() => import('../features/auth/AdminSetPasswordPage'));
const MemberPortalPage = lazy(() => import('../features/portal/MemberPortalPage'));
const MemberSelfRegisterPage = lazy(() => import('../features/members/MemberSelfRegisterPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const MembersPage = lazy(() => import('../features/members/MembersPage'));
const TasksPage = lazy(() => import('../features/tasks/TasksPage'));
const EvaluationsPage = lazy(() => import('../features/evaluations/EvaluationsPage'));
const NotesPage = lazy(() => import('../features/notes/NotesPage'));
const RankingPage = lazy(() => import('../features/ranking/RankingPage'));
const AiAssistantPage = lazy(() => import('../features/ai-assistant/AiAssistantPage'));
const WhatsAppTasksPage = lazy(() => import('../features/whatsapp/WhatsAppTasksPage'));
const AnnouncementsPage = lazy(() => import('../features/admin/announcements/AnnouncementsPage'));
const AdminAccountsPage = lazy(() => import('../features/admin/access/AdminAccountsPage'));

function PageFallback() {
  return <div className="grid min-h-40 place-items-center text-sm font-bold text-[var(--text-muted)]" role="status">بنحمّل الصفحة...</div>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

/** حارس لوحة الإدارة — ينتظر فحص الجلسة الأولي قبل الحسم */
function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const clear = useAuthStore((s) => s.clear);
  const access = useAdminAccess(user?.id ?? null);
  const handleLogout = async () => {
    await supabase.auth.signOut();
    clear();
  };
  // لا تحسم قبل اكتمال فحص supabase.auth.getSession — وإلا وَمَضت
  // إعادة التوجيه إلى تسجيل الدخول مع كل تحديث للصفحة
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl">
        <span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">
          بنتأكد من الجلسة...
        </span>
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  if (access.isPending) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من صلاحيات الإدارة...</span></div>;
  }
  if (access.isError) {
    return <div className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-5" dir="rtl"><ErrorState message="معرفناش نتحقق من صلاحيات الإدارة. مفيش صفحات هتفتح قبل نجاح التحقق." onRetry={() => { void access.refetch(); }} /><Button variant="secondary" onClick={() => void handleLogout()}>تسجيل الخروج</Button></div>;
  }
  if (!access.data?.is_admin) {
    return <div className="mx-auto grid min-h-screen max-w-xl content-center gap-3 p-5" dir="rtl"><ErrorState message="الحساب ده مش مضاف كحساب إداري. تواصل مع مالك النظام AHMEDROMU4 لو محتاج صلاحية." /><Button variant="secondary" onClick={() => void handleLogout()}>تسجيل الخروج</Button></div>;
  }
  return <>{children}</>;
}

function ProtectedOwnerRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  if (access.isPending) return <PageFallback />;
  if (access.isError) return <ErrorState message="معرفناش نتحقق من صلاحية المالك." onRetry={() => { void access.refetch(); }} />;
  if (!access.data?.is_owner) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function NoAdminSections() {
  const clear = useAuthStore((s) => s.clear);
  const logout = async () => {
    await supabase.auth.signOut();
    clear();
  };
  return (
    <div className="grid min-h-64 place-items-center">
      <div className="grid max-w-lg gap-3">
        <EmptyState title="مفيش أقسام متاحة للحساب ده" description="اطلب من مالك النظام يفتح لك قسم واحد على الأقل من شاشة إدارة المشرفين." />
        <Button variant="secondary" onClick={() => void logout()}>تسجيل الخروج</Button>
      </div>
    </div>
  );
}

function AdminStartRedirect() {
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  if (access.isPending) return <PageFallback />;
  if (access.isError) return <ErrorState message="معرفناش نتحقق من صلاحياتك." onRetry={() => { void access.refetch(); }} />;
  const path = firstAllowedAdminPath(access.data?.permissions);
  return path ? <Navigate to={path} replace /> : <NoAdminSections />;
}

function RequireAdminPermission({ permission, children }: { permission: AdminPermission; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const access = useAdminAccess(user?.id ?? null);
  if (access.isPending) return <PageFallback />;
  if (access.isError) return <ErrorState message="معرفناش نتحقق من صلاحيات القسم." onRetry={() => { void access.refetch(); }} />;
  if (access.data?.is_owner || access.data?.permissions?.[permission] === true) return <>{children}</>;
  const path = firstAllowedAdminPath(access.data?.permissions);
  return path ? <Navigate to={path} replace /> : <NoAdminSections />;
}

function AdminSection({ permission, children }: { permission: AdminPermission; children: React.ReactNode }) {
  return <RequireAdminPermission permission={permission}>{children}</RequireAdminPermission>;
}

/** حارس بوابة الأعضاء */
function ProtectedMemberRoute({ children }: { children: React.ReactNode }) {
  const member = useAuthStore((s) => s.currentMember);
  if (!member) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** الجذر: وجّه الجلسات المحفوظة (تذكرني) مباشرة بدل رمي الجميع على الدخول */
function RootRedirect() {
  const member = useAuthStore((s) => s.currentMember);
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  if (member) return <Navigate to="/portal" replace />;
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl">
        <span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">
          بنتأكد من الجلسة...
        </span>
      </div>
    );
  }
  if (user) return <Navigate to="/admin" replace />;
  return <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
  // Member Portal Routes
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '/login',
    element: <Page><LoginPage /></Page>,
  },
  {
    path: '/join/:token',
    element: <Page><MemberSelfRegisterPage /></Page>,
  },
  {
    path: '/portal',
    element: (
      <ProtectedMemberRoute>
      <Page><MemberPortalPage /></Page>
      </ProtectedMemberRoute>
    ),
  },

  // Admin Portal Routes
  {
    path: '/admin/login',
    element: <Page><AdminLoginPage /></Page>,
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
      { path: 'tasks', element: <AdminSection permission="tasks"><Page><TasksPage /></Page></AdminSection> },
      { path: 'evaluations', element: <AdminSection permission="ranking"><Page><EvaluationsPage /></Page></AdminSection> },
      { path: 'ranking', element: <AdminSection permission="ranking"><Page><RankingPage /></Page></AdminSection> },
      { path: 'notes', element: <AdminSection permission="notes"><Page><NotesPage /></Page></AdminSection> },
      { path: 'announcements', element: <AdminSection permission="announcements"><Page><AnnouncementsPage /></Page></AdminSection> },
      { path: 'ai-assistant', element: <AdminSection permission="ai_assistant"><Page><AiAssistantPage /></Page></AdminSection> },
      { path: 'whatsapp', element: <AdminSection permission="whatsapp"><Page><WhatsAppTasksPage /></Page></AdminSection> },
      { path: 'admins', element: <ProtectedOwnerRoute><Page><AdminAccountsPage /></Page></ProtectedOwnerRoute> },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/login" replace /> },
]);
