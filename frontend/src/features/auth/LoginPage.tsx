import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, CheckCircle2 } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
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

function loginErrorMessage(code: string): string {
  if (code === 'MEMBER_PENDING_REVIEW') return memberAuthErrorMessage(code);
  if (code === 'MEMBER_DISABLED') return memberAuthErrorMessage(code);
  if (code === 'IDENTITY_CONFLICT' || code === 'MEMBER_NOT_FOUND') return 'الحساب غير مرتبط بعضوية PHANTOMS مفعّلة.';
  if (code === 'DEVICE_CONFLICT') return 'الحساب ده مفتوح من متصفح أو جهاز تاني. اخرج من الجهاز الأول وجرّب تاني.';
  if (code === 'SERVER_UNAVAILABLE') return 'تعذر الوصول للخدمة حالياً. حاول مرة أخرى لاحقاً.';
  return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
}

async function localMemberAuthCleanup(logoutMember: () => void): Promise<void> {
  await memberSupabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  clearDeviceToken();
  logoutMember();
}

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
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
    if (state?.registrationPending) return 'تم استلام بياناتك وكلمة مرورك. عضويتك الآن بانتظار مراجعة الإدارة وتفعيلها؛ لن تتمكن من الدخول قبل ذلك.';
    return state?.enrollmentComplete ? 'تم إعداد الحساب بنجاح. يمكنك تسجيل الدخول الآن بكلمة المرور الجديدة.' : '';
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
        if (liveRef.current) setError('اكتب بريدك الإلكتروني بصيغة صحيحة.');
        return;
      }
      if (!submittedPassword) {
        if (liveRef.current) setError('اكتب كلمة المرور.');
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
          setError(loginErrorMessage(code));
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
      badge="مساحة العمل والتكليفات"
      title="دخول أعضاء PHANTOMS"
      description="استخدم البريد المسجل وكلمة المرور التي أعددتها عبر دعوة الفريق."
      footer={(
        <div className="grid gap-2 text-center text-sm text-[var(--text-2)]">
          <p>نسيت كلمة المرور؟ تواصل مع مسؤول الفريق لإصدار دعوة إعادة ضبط يدوية لمرة واحدة. لا نرسل رسائل استعادة تلقائية.</p>
          <Link className="auth-inline-link justify-center" to="/join">لديك دعوة؟ إنشاء كلمة مرور</Link>
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
        <label className="auth-field" htmlFor="member-email">البريد الإلكتروني للعضو
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="member-email" type="email" dir="ltr" autoComplete="email" required placeholder="name@phantoms.com" value={email} disabled={loading} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /></span>
        </label>
        <label className="auth-field" htmlFor="member-password">كلمة المرور
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="member-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required value={password} disabled={loading} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} aria-invalid={Boolean(error) || undefined} /><button type="button" className="auth-password-toggle" disabled={loading} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <label className="auth-remember" htmlFor="member-remember">
          <input id="member-remember" type="checkbox" checked={remember} disabled={loading} onChange={(event) => setRemember(event.target.checked)} />
          <span className="auth-remember-box" aria-hidden="true" />
          <span>تذكرني على هذا الجهاز</span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? 'بنتحقق بأمان...' : 'دخول بوابة الأعضاء'}
          {!loading && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
    </AuthShell>
  );
}
