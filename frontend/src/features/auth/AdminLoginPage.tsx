import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { useAuthStore, getAdminRemember, setAdminRemember } from '../../store/auth';
import { supabase, syncAdminSessionStorage } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { isValidEmail } from '../../lib/validators';
import { useAdminAccess } from '../admin/access/api';

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
  const navigate = useNavigate();

  // جلسة إدارة محفوظة (تذكرني) — لا تعرض نموذج الدخول أصلاً.
  // ننتظر فحص الجلسة الأولي حتى لا نومض نموذج الدخول لجزء من الثانية.
  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl">
        <span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من الجلسة...</span>
      </div>
    );
  }
  if (sessionUser) {
    if (access.isPending) {
      return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من صلاحيات الإدارة...</span></div>;
    }
    if (access.data?.is_admin) return <Navigate to="/admin/dashboard" replace />;
    const signOutAndRetry = async () => {
      await supabase.auth.signOut();
      clearSession();
    };
    return (
      <AuthShell
        audience="admin"
        badge="تأكيد الصلاحيات"
        title="الحساب مش إداري"
        description="الدخول للوحة الإدارة متاح للحسابات اللي أضافها مالك النظام."
        footer={<Link to="/login" className="auth-inline-link"><span>بوابة الأعضاء</span><ArrowLeft size={16} /></Link>}
      >
        <div className="grid gap-4" role="alert">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6">
            <ShieldAlert className="mt-0.5 shrink-0 text-amber-500" size={20} aria-hidden="true" />
            <p>{access.isError ? 'معرفناش نتحقق من صلاحية الحساب. سجّل الخروج وجرّب تاني.' : 'الحساب ده مش مضاف كحساب إداري. اطلب من مالك النظام AHMEDROMU4 إضافته.'}</p>
          </div>
          <Button variant="secondary" onClick={() => void signOutAndRetry()}>تسجيل الخروج والمحاولة بحساب آخر</Button>
        </div>
      </AuthShell>
    );
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError('صيغة البريد الإلكتروني مش صحيحة. مثال: admin@wasla.com');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور قصيرة قوي — لازم تكون 6 أحرف على الأقل.');
      return;
    }
    setLoading(true);
    setError('');
    // ثبّت اختيار الحفظ قبل تسجيل الدخول حتى يكتبه Supabase في المخزن الصحيح.
    // ملاحظة: تنظيف المخزن المقابل يتم بعد نجاح الدخول فقط — حتى لا تضيع
    // جلسة صالحة قديمة عند فشل محاولة دخول جديدة.
    setAdminRemember(remember);
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (loginError) {
        const errorCode = loginError.code?.toLowerCase();
        const errorMessage = loginError.message.toLowerCase();
        if (
          errorCode === 'invalid_credentials'
          || (loginError.status === 400 && errorMessage.includes('invalid login credentials'))
        ) {
          setError('بيانات الدخول مش صحيحة. اتأكد من البريد وكلمة المرور.');
        } else if (errorCode === 'email_not_confirmed') {
          setError('أكد البريد الإلكتروني المرتبط بالحساب الأول، وبعدها جرّب تسجيل الدخول.');
        } else if (errorCode === 'invalid_api_key' || errorMessage.includes('invalid api key')) {
          setError('إعداد اتصال Supabase غير صحيح. راجع إعدادات VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY.');
        } else {
          setError(toAppError(loginError, 'معرفناش نتصل بالخادم. حاول تاني بعد شوية.').message);
        }
      } else if (data.session) {
        const { data: accessData, error: accessError } = await supabase.rpc('get_admin_access');
        if (accessError || !accessData?.is_admin) {
          await supabase.auth.signOut();
          setError(accessError
            ? 'معرفناش نتحقق من صلاحيات الحساب. جرّب تاني بعد شوية.'
            : 'الحساب ده مش مضاف للإدارة. اطلب من المالك AHMEDROMU4 إضافته.');
          return;
        }
        syncAdminSessionStorage(remember);
        setSession(data.session);
        navigate('/admin/dashboard');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'حصلت مشكلة وإحنا بنتصل بالخادم.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      audience="admin"
      badge="مساحة المسؤولين المعتمدين"
      title="دخول الإدارة"
      description="اكتب بياناتك عشان تدخل مركز إدارة الفريق."
      footer={<Link to="/login" className="auth-inline-link"><span>بوابة الأعضاء</span><ArrowLeft size={16} /></Link>}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleLogin} method="post" className="auth-form" noValidate>
        <label className="auth-field" htmlFor="admin-email">البريد الإلكتروني
          <span className="auth-input-wrap"><input id="admin-email" type="email" dir="ltr" autoComplete="username" required placeholder="admin@wasla.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /></span>
        </label>
        {email.trim() && !isValidEmail(email.trim().toLowerCase()) && <p className="text-xs font-bold text-amber-700 dark:text-amber-300" role="note">اتأكد من الصيغة: لازم يبقى فيه @ ونطاق صحيح.</p>}
        <label className="auth-field" htmlFor="admin-password">كلمة المرور
          <span className="auth-input-wrap">
            <input id="admin-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required minLength={6} placeholder="••••••••" value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} />
            <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'خبّي كلمة المرور' : 'ورّي كلمة المرور'} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        <label className="auth-remember" htmlFor="admin-remember">
          <input
            id="admin-remember"
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              const next = event.target.checked;
              setRemember(next);
              setAdminRemember(next);
            }}
          />
          <span className="auth-remember-box" aria-hidden="true" />
          <span>احفظ تسجيل الدخول على الجهاز ده</span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? 'جارٍ تسجيل الدخول...' : 'ادخل مركز الإدارة'}
          {!loading && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
    </AuthShell>
  );
}
