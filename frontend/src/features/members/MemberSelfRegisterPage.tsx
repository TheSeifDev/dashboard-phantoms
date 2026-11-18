import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldAlert } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { enrollMemberPassword, MemberPasswordApiError } from '../auth/member-password-api';
import {
  isLegacyMemberInviteToken,
  isMemberInviteToken,
  memberAuthErrorMessage,
  memberPasswordRequirements,
  normalizeAuthEmail,
  parseMemberInviteLocation,
  validateMemberPassword,
} from '../auth/member-password';
import { isValidEmail } from '../../lib/validators';

export default function MemberSelfRegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token: legacyRouteToken = '' } = useParams<{ token: string }>();
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const capturedRef = useRef(false);
  const liveRef = useRef(true);
  const submitLatchRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const parsed = parseMemberInviteLocation({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      legacyRouteToken,
    });
    if (parsed.kind === 'token') setToken(parsed.token);
    if (parsed.kind === 'legacy' || parsed.kind === 'invalid') {
      setError('هذا الرابط غير مدعوم. اطلب رابط دعوة جديداً أو أدخل الكود يدوياً من مسؤول الفريق.');
    }
    // Only accepted fragment tokens enter memory; path/query credentials are rejected.
    if (location.hash || legacyRouteToken || location.search) {
      navigate('/join', { replace: true });
    }
  }, [legacyRouteToken, location.hash, location.pathname, location.search, navigate]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLatchRef.current) return;
    const cleanEmail = normalizeAuthEmail(email);
    const submittedToken = token;
    const submittedPassword = password;
    const submittedConfirmPassword = confirmPassword;
    const attempt = (async () => {
      setError('');
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        setError('اكتب بريدك الإلكتروني بصيغة صحيحة.');
        return;
      }
      if (isLegacyMemberInviteToken(submittedToken)) {
        setError('هذا رابط دعوة قديم وغير مدعوم. اطلب رمز دعوة جديداً من مسؤول الفريق.');
        return;
      }
      if (!isMemberInviteToken(submittedToken)) {
        setError('أدخل رمز الدعوة من الإدارة أو افتح رابط الدعوة المخصص لك.');
        return;
      }
      const passwordResult = validateMemberPassword(submittedPassword, submittedConfirmPassword);
      if (!passwordResult.ok) {
        setError(submittedPassword === submittedConfirmPassword
          ? memberAuthErrorMessage('WEAK_PASSWORD')
          : memberAuthErrorMessage('PASSWORD_MISMATCH'));
        return;
      }

      setSubmitting(true);
      try {
        await enrollMemberPassword({
          email: cleanEmail,
          token: submittedToken,
          password: submittedPassword,
          confirmPassword: submittedConfirmPassword,
        });
        // Clear all sensitive enrollment material before leaving this screen.
        setPassword('');
        setConfirmPassword('');
        setToken('');
        if (liveRef.current) {
          navigate('/login', { replace: true, state: { enrollmentComplete: true } });
        }
      } catch (cause) {
        if (liveRef.current) {
          const code = cause instanceof MemberPasswordApiError ? cause.code : 'SERVER_UNAVAILABLE';
          setError(memberAuthErrorMessage(code));
        }
      } finally {
        if (liveRef.current) setSubmitting(false);
      }
    })();
    submitLatchRef.current = attempt;
    void attempt.finally(() => {
      if (submitLatchRef.current === attempt) submitLatchRef.current = null;
    });
  };

  return (
    <AuthShell
      audience="member"
      badge="دعوة خاصة للعضوية"
      title="إنشاء كلمة مرور للعضو"
      description="هذه الصفحة متاحة فقط برمز دعوة مرتبط بعضوية PHANTOMS موجودة مسبقاً."
      footer={(
        <div className="grid gap-2 text-center text-sm text-[var(--text-2)]">
          <p>لا توجد استعادة تلقائية بالبريد. إذا انتهت الدعوة أو احتجت إعادة ضبط، تواصل مع مسؤول الفريق.</p>
          <Link className="auth-inline-link justify-center" to="/login">العودة إلى تسجيل الدخول</Link>
        </div>
      )}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field" htmlFor="join-email">البريد الإلكتروني المرتبط بالدعوة
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="join-email" type="email" dir="ltr" autoComplete="email" required placeholder="name@phantoms.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} /></span>
        </label>
        <label className="auth-field" htmlFor="join-token">رمز الدعوة أو الكود اليدوي
          <span className="auth-input-wrap"><KeyRound size={17} aria-hidden="true" /><input id="join-token" type="text" dir="ltr" autoComplete="off" spellCheck={false} required placeholder="phpw_..." value={token} onChange={(event) => { setToken(event.target.value.trim()); if (error) setError(''); }} /></span>
        </label>
        <label className="auth-field" htmlFor="join-password">كلمة المرور الجديدة
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-6 text-[var(--text-muted)]">
          <p className="flex items-center gap-1.5 font-black text-[var(--text)]"><ShieldAlert size={15} aria-hidden="true" /> متطلبات كلمة المرور</p>
          <ul className="mt-1 list-inside list-disc">{memberPasswordRequirements().map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <label className="auth-field" htmlFor="join-confirm-password">تأكيد كلمة المرور
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-confirm-password" type={showConfirmPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); if (error) setError(''); }} /><button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'}>{showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? 'بنسجّل الحساب بأمان...' : 'إنشاء الحساب والعودة للدخول'}
          {!submitting && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3 text-xs leading-6 text-[var(--text-2)]" role="note">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
        <span>بعد النجاح لن يتم تسجيل دخولك تلقائياً. ستعود لصفحة الدخول لتستخدم البريد وكلمة المرور.</span>
      </div>
    </AuthShell>
  );
}
