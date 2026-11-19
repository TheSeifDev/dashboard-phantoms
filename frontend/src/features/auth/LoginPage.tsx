import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { useLocale } from '../../i18n/useLocale';
import {
  clearDeviceToken,
  getMemberRemember,
  setDeviceToken,
  setMemberRemember,
  useAuthStore,
} from '../../store/auth';
import { memberSupabase } from '../../lib/supabase/member-client';
import { fetchMemberByEmail, bindMemberDeviceSession } from '../members/api';
import { isValidEmail } from '../../lib/validators';
import { generateMemberDeviceToken, memberAuthErrorMessage, normalizeAuthEmail } from './member-password';
import { getMemberPasswordAccess, isMemberPendingReview } from './member-password-access';

class MemberLoginError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'MemberLoginError';
    this.code = code;
  }
}

function loginErrorMessage(code: string, t: (arabic: string, english: string) => string): string {
  if (code === 'MEMBER_PENDING_REVIEW') return t(memberAuthErrorMessage(code), 'Your details were received. Your account is awaiting admin review and activation; you cannot sign in before then.');
  if (code === 'MEMBER_DISABLED') return t(memberAuthErrorMessage(code), 'This membership is not active right now. Contact the team administrator.');
  if (code === 'IDENTITY_CONFLICT' || code === 'MEMBER_NOT_FOUND') return t('الحساب غير مرتبط بعضوية PHANTOMS مفعّلة.', 'This account is not linked to an active PHANTOMS membership.');
  if (code === 'DEVICE_CONFLICT') return t('الحساب ده مفتوح من متصفح أو جهاز تاني. اخرج من الجهاز الأول وجرّب تاني.', 'This account is open in another browser or device. Sign out there, then try again.');
  if (code === 'SERVER_UNAVAILABLE') return t('تعذر الوصول للخدمة حالياً. حاول مرة أخرى لاحقاً.', 'The service is unavailable right now. Please try again later.');
  return t('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'The email or password is incorrect.');
}

async function localMemberAuthCleanup(logoutMember: () => void): Promise<void> {
  await memberSupabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  clearDeviceToken();
  logoutMember();
}

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLocale();
  const logoutMember = useAuthStore((state) => state.logoutMember);
  const setMember = useAuthStore((state) => state.setMember);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => getMemberRemember());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(() => {
    const state = location.state as { enrollmentComplete?: boolean; registrationPending?: boolean } | null;
    if (state?.registrationPending) return t('تم استلام بياناتك وكلمة مرورك. عضويتك الآن بانتظار مراجعة الإدارة وتفعيلها؛ لن تتمكن من الدخول قبل ذلك.', 'Your details and password were received. Your membership is awaiting admin review and activation; you cannot sign in before then.');
    return state?.enrollmentComplete ? t('تم إعداد الحساب بنجاح. يمكنك تسجيل الدخول الآن بكلمة المرور الجديدة.', 'Your account is ready. You can now sign in with your new password.') : '';
  });
  const liveRef = useRef(true);
  const submitLatchRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  const handleMemberLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLatchRef.current) return;

    // Capture the complete attempt once; retries require a new enabled screen.
    const cleanEmail = normalizeAuthEmail(email);
    const submittedPassword = password;
    const rememberInput = event.currentTarget.elements.namedItem('member-remember');
    const submittedRemember = rememberInput instanceof HTMLInputElement ? rememberInput.checked : remember;
    const attempt = (async () => {
      setError('');
      setInfo('');
      if (cleanEmail === 'admin') {
        navigate('/admin/login');
        return;
      }
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        if (liveRef.current) setError(t('اكتب بريدك الإلكتروني بصيغة صحيحة.', 'Enter a valid email address.'));
        return;
      }
      if (!submittedPassword) {
        if (liveRef.current) setError(t('اكتب كلمة المرور.', 'Enter your password.'));
        return;
      }

      setLoading(true);
      try {
        const rememberPreflight = setMemberRemember(submittedRemember);
        if (!rememberPreflight.ok) throw new MemberLoginError('SERVER_UNAVAILABLE');
        const { data, error: signInError } = await memberSupabase.auth.signInWithPassword({
          email: cleanEmail,
          password: submittedPassword,
        });
        if (signInError || !data.user) throw new MemberLoginError('INVALID_CREDENTIALS');

        const authEmail = normalizeAuthEmail(data.user.email ?? '');
        if (!data.user.id || !authEmail || authEmail !== cleanEmail) {
          throw new MemberLoginError('IDENTITY_CONFLICT');
        }

        const access = await getMemberPasswordAccess();
        if (!access) {
          if (await isMemberPendingReview()) throw new MemberLoginError('MEMBER_PENDING_REVIEW');
          throw new MemberLoginError('MEMBER_NOT_FOUND');
        }
        if (!access.active) throw new MemberLoginError('MEMBER_DISABLED');
        if (!access.password_ready || access.auth_user_id !== data.user.id || access.email !== authEmail) {
          throw new MemberLoginError('IDENTITY_CONFLICT');
        }

        const deviceToken = generateMemberDeviceToken();
        const bound = await bindMemberDeviceSession(authEmail, deviceToken);
        if (!bound) throw new MemberLoginError('DEVICE_CONFLICT');

        const member = await fetchMemberByEmail(authEmail, deviceToken);
        if (
          !member
          || member.id !== access.member_id
          || normalizeAuthEmail(member.email) !== authEmail
          || member.work_status !== 'active'
          || ('auth_user_id' in member && (member as unknown as { auth_user_id?: unknown }).auth_user_id !== undefined && (member as unknown as { auth_user_id?: unknown }).auth_user_id !== data.user.id)
        ) throw new MemberLoginError('IDENTITY_CONFLICT');

        const remembered = setMemberRemember(submittedRemember);
        if (!remembered.ok) throw new MemberLoginError('SERVER_UNAVAILABLE');
        if (!liveRef.current) {
          await localMemberAuthCleanup(logoutMember);
          return;
        }
        setDeviceToken(deviceToken, submittedRemember);
        setMember(member, submittedRemember);
        navigate('/portal', { replace: true });
      } catch (cause) {
        await localMemberAuthCleanup(logoutMember);
        if (liveRef.current) {
          const code = cause instanceof MemberLoginError ? cause.code : 'SERVER_UNAVAILABLE';
          setError(loginErrorMessage(code, t));
        }
      } finally {
        if (liveRef.current) setLoading(false);
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
      badge={t('مساحة العمل والتكليفات', 'Workspace and tasks')}
      title={t('دخول أعضاء PHANTOMS', 'PHANTOMS member sign-in')}
      description={t('استخدم البريد المسجل وكلمة المرور التي أعددتها عبر دعوة الفريق.', 'Use your registered email and the password you set through your team invitation.')}
      footer={(
        <div className="grid gap-2 text-center text-sm text-[var(--text-2)]">
          <p>{t('نسيت كلمة المرور؟ تواصل مع مسؤول الفريق لإصدار دعوة إعادة ضبط يدوية لمرة واحدة. لا نرسل رسائل استعادة تلقائية.', 'Forgot your password? Contact the team administrator for a one-time reset invitation. Automatic recovery emails are not sent.')}</p>
          <Link className="auth-inline-link justify-center" to="/join">{t('لديك دعوة؟ إنشاء كلمة مرور', 'Have an invitation? Set a password')}</Link>
        </div>
      )}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      {info && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-3.5 text-xs font-semibold leading-5 text-[var(--text)]" role="status">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span>{info}</span>
        </div>
      )}
      <form onSubmit={handleMemberLogin} method="post" className="auth-form" noValidate>
        <label className="auth-field" htmlFor="member-email">{t('البريد الإلكتروني للعضو', 'Member email')}
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="member-email" type="email" dir="ltr" autoComplete="email" required placeholder="name@phantoms.com" value={email} disabled={loading} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /></span>
        </label>
        <label className="auth-field" htmlFor="member-password">{t('كلمة المرور', 'Password')}
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="member-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required value={password} disabled={loading} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /><button type="button" className="auth-password-toggle" disabled={loading} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <label className="auth-remember" htmlFor="member-remember">
          <input id="member-remember" type="checkbox" checked={remember} disabled={loading} onChange={(event) => setRemember(event.target.checked)} />
          <span className="auth-remember-box" aria-hidden="true" />
          <span>{t('تذكرني على هذا الجهاز', 'Remember me on this device')}</span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? t('بنتحقق بأمان...', 'Verifying securely...') : t('دخول بوابة الأعضاء', 'Sign in to the member portal')}
          {!loading && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
    </AuthShell>
  );
}
