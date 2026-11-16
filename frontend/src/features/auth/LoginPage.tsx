import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Mail, KeyRound, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { useAuthStore, setDeviceToken, getMemberRemember, setMemberRemember } from '../../store/auth';
import { memberSupabase } from '../../lib/supabase/member-client';
import { fetchMemberByEmail, bindMemberDeviceSession } from '../members/api';
import { isValidEmail } from '../../lib/validators';
import { isValidMemberOtp, MEMBER_OTP_LENGTH, normalizeAuthEmail, safeMemberAuthError } from './auth-flow';

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

  const requestOtp = async (cleanEmail: string) => {
    setLoading(true);
    setError('');
    setInfo('');
    setMemberRemember(remember);
    try {
      // Keep first-time identity signup enabled, but never request a redirect URL.
      const { error: otpError } = await memberSupabase.auth.signInWithOtp({ email: cleanEmail });
      if (otpError) {
        setError(safeMemberAuthError('send'));
        return;
      }
      setStep('otp_required');
      setOtpCode('');
      setInfo(`أرسلنا رمزاً مكوناً من ${MEMBER_OTP_LENGTH} أرقام إلى بريدك الإلكتروني. اكتب الرمز لتأكيد هويتك وربط هذا الجهاز.`);
    } catch {
      setError(safeMemberAuthError('send'));
    } finally {
      setLoading(false);
    }
  };

  const handleMemberLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = normalizeAuthEmail(email);

    if (cleanEmail === 'admin') {
      navigate('/admin/login');
      return;
    }
    if (!cleanEmail) {
      setError('اكتب بريدك الإلكتروني.');
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      setError('صيغة البريد الإلكتروني مش صحيحة. مثال: name@phantoms.com');
      return;
    }
    await requestOtp(cleanEmail);
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = normalizeAuthEmail(email);
    const cleanOtp = otpCode.trim();

    if (!isValidMemberOtp(cleanOtp)) {
      setError(`اكتب رمز التحقق المكون من ${MEMBER_OTP_LENGTH} أرقام.`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: verifyError } = await memberSupabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: 'email',
      });

      if (verifyError || !data.user) {
        await memberSupabase.auth.signOut({ scope: 'local' });
        setError(safeMemberAuthError('verify'));
        return;
      }

      const verifiedEmail = normalizeAuthEmail(data.user.email ?? '');
      if (!verifiedEmail || verifiedEmail !== cleanEmail) {
        await memberSupabase.auth.signOut({ scope: 'local' });
        setError(safeMemberAuthError('verify'));
        return;
      }

      const newDeviceToken = generateDeviceToken();
      const bound = await bindMemberDeviceSession(verifiedEmail, newDeviceToken);
      if (!bound) {
        await memberSupabase.auth.signOut({ scope: 'local' });
        setError('تعذر ربط هذا الجهاز بعضويتك. حاول مرة أخرى.');
        return;
      }
      const member = await fetchMemberByEmail(verifiedEmail, newDeviceToken);
      if (!member || normalizeAuthEmail(member.email) !== verifiedEmail) {
        // Clean only the new member-auth session; do not delete independent device tokens.
        await memberSupabase.auth.signOut({ scope: 'local' });
        setError(safeMemberAuthError('member'));
        return;
      }

      setMemberRemember(remember);
      setDeviceToken(newDeviceToken, remember);
      setMember(member, remember);
      navigate('/portal');
    } catch {
      await memberSupabase.auth.signOut({ scope: 'local' });
      setError(safeMemberAuthError('verify'));
    } finally {
      setLoading(false);
    }
  };

  if (currentMember) {
    return <Navigate to="/portal" replace />;
  }

  return (
    <AuthShell
      audience="member"
      badge="مساحة العمل والتكليفات"
      title="دخول أعضاء PHANTOMS"
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
        <form onSubmit={(event) => void handleMemberLogin(event)} method="post" className="auth-form" noValidate>
          <label className="auth-field" htmlFor="member-email">البريد الإلكتروني للعضو
            <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="member-email" type="email" dir="ltr" autoComplete="email" required placeholder="name@phantoms.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'member-email-error' : undefined} /></span>
          </label>
          {email.trim() && !isValidEmail(normalizeAuthEmail(email)) && <p className="text-xs font-bold text-amber-700 dark:text-amber-300" role="note">اتأكد من الصيغة: لازم يبقى فيه @ ونطاق صحيح.</p>}
          <label className="auth-remember" htmlFor="member-remember">
            <input id="member-remember" type="checkbox" checked={remember} onChange={(event) => { setRemember(event.target.checked); setMemberRemember(event.target.checked); }} />
            <span className="auth-remember-box" aria-hidden="true" />
            <span>احفظ تسجيل الدخول على الجهاز ده</span>
          </label>
          <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
            {loading ? 'بنتأكد...' : 'ادخل مساحة العمل'}
            {!loading && <ArrowLeft size={18} aria-hidden="true" />}
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void handleVerifyOtp(event)} method="post" className="auth-form" noValidate>
          <label className="auth-field" htmlFor="member-otp">رمز التحقق (OTP)
            <span className="auth-input-wrap"><KeyRound size={17} aria-hidden="true" /><input id="member-otp" type="text" dir="ltr" inputMode="numeric" pattern="[0-9]{8}" minLength={MEMBER_OTP_LENGTH} maxLength={MEMBER_OTP_LENGTH} autoComplete="one-time-code" required placeholder="12345678" value={otpCode} onChange={(event) => { setOtpCode(event.target.value.replace(/\D/g, '').slice(0, MEMBER_OTP_LENGTH)); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /></span>
          </label>
          <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
            {loading ? 'جاري التحقق...' : 'تأكيد الرمز وربط الجهاز'}
            {!loading && <ArrowLeft size={18} aria-hidden="true" />}
          </button>
          <button type="button" disabled={loading} onClick={() => void requestOtp(normalizeAuthEmail(email))} className="text-xs font-bold text-[var(--link)] hover:text-[var(--text)] transition-colors py-1">
            إرسال رمز جديد
          </button>
          <button type="button" onClick={() => { setStep('email'); setOtpCode(''); setError(''); setInfo(''); }} className="text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] transition-colors py-1">
            الرجوع لتعديل البريد الإلكتروني
          </button>
        </form>
      )}
    </AuthShell>
  );
}
