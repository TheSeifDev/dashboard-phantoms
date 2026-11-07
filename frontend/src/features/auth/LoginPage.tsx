import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Mail, KeyRound, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { useAuthStore, getDeviceToken, setDeviceToken, getMemberRemember, setMemberRemember } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { fetchMemberByEmail, bindMemberDeviceSession } from '../members/api';
import { isValidEmail } from '../../lib/validators';

function generateDeviceToken(): string {
  const deviceBytes = new Uint8Array(16);
  crypto.getRandomValues(deviceBytes);
  return Array.from(deviceBytes, (b) => b.toString(36)).join('').replace(/[^a-z0-9]/gi, '').slice(0, 20) + Date.now().toString(36);
}

export default function LoginPage() {
  const currentMember = useAuthStore((state) => state.currentMember);
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp_required'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [remember, setRemember] = useState<boolean>(() => getMemberRemember());
  const setMember = useAuthStore((state) => state.setMember);
  const navigate = useNavigate();

  // If already logged in as member, redirect to portal
  if (currentMember) {
    return <Navigate to="/portal" replace />;
  }

  // Handle incoming Magic Link authentication redirect
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!active || !user?.email) return;
      const verifiedEmail = user.email.toLowerCase();
      try {
        const deviceToken = generateDeviceToken();
        await bindMemberDeviceSession(verifiedEmail, deviceToken);
        const member = await fetchMemberByEmail(verifiedEmail, deviceToken);
        if (member && active) {
          setMemberRemember(remember);
          setDeviceToken(deviceToken, remember);
          setMember(member, remember);
          navigate('/portal');
        }
      } catch {
        // Not a member or session error
      }
    });
    return () => { active = false; };
  }, [navigate, remember, setMember]);

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
    setInfo('');

    try {
      // 1. Check if device is already recognized & bound
      const existingToken = getDeviceToken();
      if (existingToken) {
        const existingMember = await fetchMemberByEmail(cleanEmail, existingToken);
        if (existingMember) {
          setMemberRemember(remember);
          setDeviceToken(existingToken, remember);
          setMember(existingMember, remember);
          navigate('/portal');
          return;
        }
      }

      // 2. New or unrecognized device: require email OTP verification
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: window.location.origin + '/login',
        },
      });

      if (otpError) {
        // Reject insecure anonymous fallback: email verification is strictly required
        setError(
          otpError.message
            ? `تعذر إرسال رمز التحقق: ${otpError.message}. التحقق من البريد إلزامي لربط هذا الجهاز والتأكد من هويتك.`
            : 'تعذر إرسال رمز التحقق إلى بريدك الإلكتروني. التحقق من البريد إلزامي لربط هذا الجهاز والتأكد من هويتك. تأكد من الاتصال أو راجع الإدارة وأعد المحاولة.'
        );
      } else {
        setStep('otp_required');
        setInfo('أرسلنا رمز التحقق إلى بريدك الإلكتروني. اكتب الرمز لتأكيد هويتك وربط هذا الجهاز.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'حصلت مشكلة وإحنا بنتصل. جرّب تاني.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otpCode.trim();

    if (!cleanOtp) {
      setError('اكتب رمز التحقق المكون من 6 أرقام.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: 'email',
      });

      if (verifyError || !data.user) {
        setError('رمز التحقق غير صحيح أو انتهت صلاحيته. أعد المحاولة.');
        return;
      }

      const newDeviceToken = generateDeviceToken();
      await bindMemberDeviceSession(cleanEmail, newDeviceToken);
      const member = await fetchMemberByEmail(cleanEmail, newDeviceToken);

      if (!member) {
        setError('تم التحقق من البريد لكن الحساب غير مسجل كعضو في الفريق.');
        return;
      }

      setMemberRemember(remember);
      setDeviceToken(newDeviceToken, remember);
      setMember(member, remember);
      navigate('/portal');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'حصلت مشكلة أثناء التحقق. جرّب تاني.');
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
      {info && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-3.5 text-xs font-semibold leading-5 text-[var(--text)]" role="status">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span>{info}</span>
        </div>
      )}

      {step === 'email' ? (
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
      ) : (
        <form onSubmit={handleVerifyOtp} method="post" className="auth-form" noValidate>
          <label className="auth-field" htmlFor="member-otp">رمز التحقق (OTP)
            <span className="auth-input-wrap"><KeyRound size={17} aria-hidden="true" /><input id="member-otp" type="text" dir="ltr" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="one-time-code" required placeholder="123456" value={otpCode} onChange={(event) => { setOtpCode(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /></span>
          </label>
          <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
            {loading ? 'جاري التحقق...' : 'تأكيد الرمز وربط الجهاز'}
            {!loading && <ArrowLeft size={18} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => { setStep('email'); setOtpCode(''); setError(''); setInfo(''); }}
            className="text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] transition-colors py-1"
          >
            الرجوع لتعديل البريد الإلكتروني
          </button>
        </form>
      )}
    </AuthShell>
  );
}
