import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Mail } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { useAuthStore, setDeviceToken, getMemberRemember, setMemberRemember } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { fetchMemberByEmail } from '../members/api';
import { isValidEmail } from '../../lib/validators';

export default function LoginPage() {
  const currentMember = useAuthStore((state) => state.currentMember);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState<boolean>(() => getMemberRemember());
  const setMember = useAuthStore((state) => state.setMember);
  const navigate = useNavigate();

  // جلسة عضو محفوظة (تذكرني) — لا تعرض نموذج الدخول أصلاً
  if (currentMember) {
    return <Navigate to="/portal" replace />;
  }

  const handleMemberLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanEmail === 'admin') {
      navigate('/admin/login');
      return;
    }

    if (!cleanEmail) {
      setError('اكتب بريدك الإلكتروني.');
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      setError('صيغة البريد الإلكتروني مش صحيحة. مثال: name@wasla.com');
      return;
    }

    setLoading(true);
    setError('');
    // رمز جهاز غير متوقع (CSPRNG) — إثبات ملكية سجل العضو في RPCs اللاحقة
    const deviceBytes = new Uint8Array(16);
    crypto.getRandomValues(deviceBytes);
    const deviceToken = Array.from(deviceBytes, (b) => b.toString(36)).join('').replace(/[^a-z0-9]/gi, '').slice(0, 20) + Date.now().toString(36);

    // افصل جلسة الإدارة (إن وجدت) عن بوابة الأعضاء لمنع تسريب صلاحيات
    try {
      await supabase.auth.signOut();
    } catch {
      // تجاهل الفشل: تسجيل الدخول بوابة الأعضاء يعمل حتى بدون signOut
    }

    try {
      const member = await fetchMemberByEmail(cleanEmail, deviceToken);
      if (!member) {
        setError('البريد ده مش مسجل في فريق وصلة. راجع الإدارة.');
      } else {
        // لا نخزّن session_token في الواجهة لتقليل أثر سرقة الجلسة (يظل محفوظاً في قاعدة البيانات فقط).
        setMemberRemember(remember);
        setDeviceToken(deviceToken, remember);
        setMember(member, remember);
        navigate('/portal');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'حصلت مشكلة وإحنا بنتصل. جرّب تاني.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      audience="member"
      badge="مساحة العمل والتكليفات"
      title="دخول أعضاء وصلة"
      description="اكتب بريدك الإلكتروني المسجل في الفريق عشان تكمّل."
      footer={<span className="text-sm text-[var(--text-2)]">في مشكلة في الدخول؟ كلم مسؤول فريقك.</span>}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleMemberLogin} method="post" className="auth-form" noValidate>
        <label className="auth-field" htmlFor="member-email">البريد الإلكتروني للعضو
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="member-email" type="email" dir="ltr" autoComplete="email" required placeholder="name@wasla.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'member-email-error' : undefined} /></span>
        </label>
        {email.trim() && !isValidEmail(email.trim().toLowerCase()) && <p className="text-xs font-bold text-amber-700 dark:text-amber-300" role="note">اتأكد من الصيغة: لازم يبقى فيه @ ونطاق صحيح.</p>}
        <label className="auth-remember" htmlFor="member-remember">
          <input
            id="member-remember"
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span className="auth-remember-box" aria-hidden="true" />
          <span>احفظ تسجيل الدخول على الجهاز ده</span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? 'بنتأكد...' : 'ادخل مساحة العمل'}
          {!loading && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
    </AuthShell>
  );
}
