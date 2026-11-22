import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { useLocale } from '../../i18n/useLocale';
import { Button } from '../../components/ui/Button';
import { useAuthStore, getAdminRemember, setAdminRemember } from '../../store/auth';
import { supabase, syncAdminSessionStorage } from '../../lib/supabase/client';
import { isValidEmail } from '../../lib/validators';
import { authFailureMessage, classifyAuthFailure } from './auth-errors';
import { adminAccessKey, useAdminAccess } from '../admin/access/api';
import type { AdminAccess } from '../../types/db';
import { clearAdminSetupIntent } from './auth-flow';
import { managerDestination } from '../teams/access';

export default function AdminLoginPage() {
  const sessionUser = useAuthStore((state) => state.user);
  const sessionReady = useAuthStore((state) => state.ready);
  const access = useAdminAccess(sessionUser?.id ?? null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => getAdminRemember());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clear);
  const queryClient = useQueryClient();
  const { t } = useLocale();

  // جلسة إدارة محفوظة (تذكرني) — لا تعرض نموذج الدخول أصلاً.
  // ننتظر فحص الجلسة الأولي حتى لا نومض نموذج الدخول لجزء من الثانية.
  if (!sessionReady) {
    return <PhantomLoader message={t('بنتأكد من الجلسة...', 'Checking your session...')} />;
  }
  if (sessionUser) {
    if (access.isPending) {
      return <PhantomLoader message={t('بنتأكد من صلاحيات الإدارة...', 'Checking administrator access...')} />;
    }
    const destination = access.isError ? null : managerDestination(access.data);
    if (destination) return <Navigate to={destination} replace />;
    const signOutAndRetry = async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(t('تسجيل الخروج فشل. الجلسة لسه موجودة؛ جرّب تاني.', 'Sign out failed. Your session remains; please retry.'));
        return;
      }
      clearSession();
      clearAdminSetupIntent();
    };
    return (
      <AuthShell
        audience="admin"
        badge={t('تأكيد الصلاحيات', 'Access verification')}
        title={t('الحساب مش إداري', 'This account is not an administrator')}
        description={t('الدخول للوحة الإدارة متاح للحسابات اللي أضافها مالك النظام.', 'The admin workspace is available only to accounts added by the system owner.')}
        footer={<Link to="/login" className="auth-inline-link"><span>{t('بوابة الأعضاء', 'Member portal')}</span><ArrowLeft size={16} /></Link>}
      >
        <div className="grid gap-4" role="alert">
          <div className="auth-error">
            <ShieldAlert className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
            <p>{error || (access.isError ? t('معرفناش نتحقق من صلاحية الحساب. سجّل الخروج وجرّب تاني.', 'We could not verify this account. Sign out and try again.') : t('الحساب ده مش مضاف كمسؤول عام أو مسؤول فريق نشط. اطلب من مالك النظام إضافته.', 'This account has no global or active team assignment. Ask the system owner to add it.'))}</p>
          </div>
          <Button variant="secondary" onClick={() => void signOutAndRetry()}>{t('تسجيل الخروج والمحاولة بحساب آخر', 'Sign out and try another account')}</Button>
        </div>
      </AuthShell>
    );
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError(t('صيغة البريد الإلكتروني مش صحيحة. مثال: admin@phantoms.com', 'Enter a valid email address, e.g. admin@phantoms.com.'));
      return;
    }
    if (password.length < 6) {
      setError(t('كلمة المرور قصيرة قوي — لازم تكون 6 أحرف على الأقل.', 'Password is too short — it must be at least 6 characters.'));
      return;
    }
    setLoading(true);
    setError('');
    // ثبّت اختيار الحفظ قبل تسجيل الدخول حتى يكتبه Supabase في المخزن الصحيح.
    // ملاحظة: تنظيف المخزن المقابل يتم بعد نجاح الدخول فقط — حتى لا تضيع
    // جلسة صالحة قديمة عند فشل محاولة دخول جديدة.
    setAdminRemember(remember);
    clearAdminSetupIntent();
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (loginError) {
        const failure = classifyAuthFailure(loginError);
        const invalidCredentialsCopy = t('بيانات الدخول مش صحيحة. اتأكد من البريد وكلمة المرور.', 'The sign-in details are incorrect. Check your email and password.');
        setError(failure.kind === 'INVALID_CREDENTIALS'
          ? invalidCredentialsCopy
          : authFailureMessage(failure, t, 'معرفناش نتصل بالخادم. حاول تاني بعد شوية.'));
      } else if (data.session) {
        const { data: accessData, error: accessError } = await supabase.rpc('get_admin_access');
        const destination = accessError ? null : managerDestination(accessData);
        if (!destination) {
          await supabase.auth.signOut();
          clearAdminSetupIntent();
          setError(accessError
            ? t('معرفناش نتحقق من صلاحيات الحساب. جرّب تاني بعد شوية.', 'Could not verify administrator access. Please try again shortly.')
            : t('الحساب ده مش مضاف للإدارة. اطلب من مالك النظام إضافته.', 'This account is not registered as an administrator. Ask the system owner to add it.'));
          return;
        }
        syncAdminSessionStorage(remember);
        // Seed the verified access and let the render-time <Navigate> above route exactly once.
        // The auth listener may already have mounted that redirect; a second, late
        // navigate('/admin') would undo AdminStartRedirect's hop to the first allowed section.
        queryClient.setQueryData<AdminAccess>(adminAccessKey(data.session.user.id), accessData as AdminAccess);
        setSession(data.session);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('حصلت مشكلة وإحنا بنتصل بالخادم.', 'Something went wrong while connecting to the server.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      audience="admin"
      badge={t('مساحة المسؤولين المعتمدين', 'Authorized administrators')}
      title={t('دخول إدارة PHANTOMS', 'PHANTOMS administrator sign-in')}
      description={t('اكتب بياناتك عشان تدخل مركز إدارة العمليات.', 'Enter your credentials to open the operations workspace.')}
      footer={<Link to="/login" className="auth-inline-link"><span>{t('بوابة الأعضاء', 'Member portal')}</span><ArrowLeft size={16} /></Link>}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleLogin} method="post" className="auth-form" noValidate aria-busy={loading || undefined}>
        <label className="auth-field" htmlFor="admin-email">{t('البريد الإلكتروني', 'Email address')}
          <span className="auth-input-wrap"><input id="admin-email" type="email" dir="ltr" autoCapitalize="none" spellCheck={false} autoComplete="username" required maxLength={254} placeholder="admin@phantoms.com" value={email} disabled={loading} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(email.trim() && !isValidEmail(email.trim().toLowerCase())) || undefined} aria-describedby={email.trim() && !isValidEmail(email.trim().toLowerCase()) ? 'admin-email-hint' : undefined} /></span>
        </label>
        {email.trim() && !isValidEmail(email.trim().toLowerCase()) && <p id="admin-email-hint" className="-mt-3 text-xs font-bold text-amber-700 dark:text-amber-300" role="note">{t('اتأكد من الصيغة: لازم يبقى فيه @ ونطاق صحيح.', 'Check the format: include @ and a valid domain.')}</p>}
        <label className="auth-field" htmlFor="admin-password">{t('كلمة المرور', 'Password')}
          <span className="auth-input-wrap">
            <input id="admin-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required minLength={6} placeholder="••••••••" value={password} disabled={loading} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(password && password.length < 6) || undefined} aria-describedby={password && password.length < 6 ? 'admin-password-hint' : undefined} />
            <button type="button" className="auth-password-toggle" disabled={loading} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        {password && password.length < 6 && <p id="admin-password-hint" className="-mt-3 text-xs font-bold text-amber-700 dark:text-amber-300" role="note">{t('تتطلب كلمة مرور الإدارة 6 أحرف على الأقل.', 'Administrator passwords must contain at least 6 characters.')}</p>}
        <label className="auth-remember" htmlFor="admin-remember">
          <input
            id="admin-remember"
            type="checkbox"
            checked={remember}
            disabled={loading}
            onChange={(event) => {
              const next = event.target.checked;
              setRemember(next);
              setAdminRemember(next);
            }}
          />
          <span className="auth-remember-box" aria-hidden="true" />
          <span>{t('احفظ تسجيل الدخول على الجهاز ده', 'Remember me on this device')}</span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? t('جارٍ تسجيل الدخول...', 'Signing in...') : t('ادخل مركز الإدارة', 'Open administrator workspace')}
          {!loading && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
        <Link to="/admin/forgot-password" className="text-center text-xs font-bold text-[var(--link)] hover:text-[var(--text)] transition-colors py-1">
          {t('نسيت كلمة المرور؟', 'Forgot your password?')}
        </Link>
        {loading && <p className="-mt-3 text-center text-xs leading-5 text-[var(--text-muted)]" role="status" aria-live="polite">{t('بنتحقق من بيانات الدخول وصلاحيات الإدارة قبل فتح مساحة العمل.', 'Verifying your credentials and administrator access before opening the workspace.')}</p>}
      </form>
    </AuthShell>
  );
}
