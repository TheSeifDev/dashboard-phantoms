import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldAlert, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { enrollMemberPassword, MemberPasswordApiError } from '../auth/member-password-api';
import type { MemberSelfServiceProfile } from '../auth/member-password-api';
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

const EMPTY_PROFILE: MemberSelfServiceProfile = {
  fullName: '', phone: '', residence: '', workConditions: '', bio: '', device: '', gender: '',
};
const DEVICE_OPTIONS = [
  'لابتوب', 'كمبيوتر مكتبي (PC)', 'بدون جهاز', 'هاتف محمول',
  'لابتوب، هاتف محمول', 'لابتوب، جهاز لوحي، هاتف محمول',
] as const;

export default function MemberSelfRegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token: legacyRouteToken = '' } = useParams<{ token: string }>();
  const isPasswordReset = location.pathname.startsWith('/reset');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<MemberSelfServiceProfile>(EMPTY_PROFILE);
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
      setError('هذا الرابط غير مدعوم. اطلب رابط دعوة جديداً من مسؤول الفريق.');
    }
    // Only accepted fragment tokens enter memory; path/query credentials are rejected.
    if (location.hash || legacyRouteToken || location.search) {
      navigate(isPasswordReset ? '/reset' : '/join', { replace: true });
    }
  }, [isPasswordReset, legacyRouteToken, location.hash, location.pathname, location.search, navigate]);

  const updateProfile = (key: keyof MemberSelfServiceProfile, value: string) => {
    setProfile((current) => ({ ...current, [key]: value }));
    if (error) setError('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLatchRef.current) return;
    const cleanEmail = normalizeAuthEmail(email);
    const submittedToken = token;
    const submittedPassword = password;
    const submittedConfirmPassword = confirmPassword;
    const submittedProfile = { ...profile };
    const attempt = (async () => {
      setError('');
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        setError('اكتب بريدك الإلكتروني بصيغة صحيحة.');
        return;
      }
      if (isLegacyMemberInviteToken(submittedToken)) {
        setError('هذا رابط دعوة قديم وغير مدعوم. اطلب رابطاً جديداً من مسؤول الفريق.');
        return;
      }
      if (!isMemberInviteToken(submittedToken)) {
        setError(isPasswordReset ? 'افتح رابط إعادة التعيين المخصص لك أو اطلب رابطاً جديداً من الإدارة.' : 'افتح رابط الدعوة المخصص لك أو اطلب رابطاً جديداً من الإدارة.');
        return;
      }
      if (!isPasswordReset && !submittedProfile.fullName.trim()) {
        setError('اكتب اسمك الكامل.');
        return;
      }
      if (!isPasswordReset && submittedProfile.phone.trim() && !/^\+?[0-9 ()-]{7,32}$/.test(submittedProfile.phone.trim())) {
        setError('اكتب رقم هاتف صحيحاً أو اترك الحقل فارغاً.');
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
        const membership = await enrollMemberPassword({
          email: cleanEmail,
          token: submittedToken,
          password: submittedPassword,
          confirmPassword: submittedConfirmPassword,
          ...(!isPasswordReset ? { profile: submittedProfile } : {}),
        });
        // Clear all sensitive enrollment material before leaving this screen.
        setPassword('');
        setConfirmPassword('');
        setToken('');
        setProfile(EMPTY_PROFILE);
        if (liveRef.current) {
          navigate('/login', {
            replace: true,
            state: membership === 'pending_review'
              ? { registrationPending: true }
              : { enrollmentComplete: true },
          });
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
      badge={isPasswordReset ? 'رابط إعادة تعيين آمن' : 'رابط آمن من إدارة PHANTOMS'}
      title={isPasswordReset ? 'إعادة تعيين كلمة المرور' : 'بياناتك وكلمة مرورك'}
      description={isPasswordReset ? 'تحقق من بريدك وأدخل كلمة مرور جديدة. لن تتغير بيانات ملفك الشخصي.' : 'اكتب بريدك وبياناتك بنفسك. إذا كانت الإدارة قد قيّدت الرابط ببريد محدد، استخدمه. الرابط صالح مرة واحدة فقط.'}
      footer={(
        <div className="grid gap-2 text-center text-sm text-[var(--text-2)]">
          <p>إذا واجهت مشكلة أو نسيت كلمة المرور، تواصل مع مسؤول الفريق ليصدر لك رابطاً جديداً.</p>
          <Link className="auth-inline-link justify-center" to="/login">العودة إلى تسجيل الدخول</Link>
        </div>
      )}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field" htmlFor="join-email">بريدك الإلكتروني للتسجيل
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="join-email" type="email" dir="ltr" autoComplete="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} /></span>
        </label>
        {!isPasswordReset && <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5" aria-labelledby="join-profile-heading">
          <div><h2 id="join-profile-heading" className="flex items-center gap-2 text-sm font-black text-[var(--text)]"><UserRound size={16} aria-hidden="true" /> بياناتك الشخصية</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">املأ معلوماتك بنفسك؛ الإدارة تراجع العضوية الجديدة قبل تفعيلها.</p></div>
          <label className="auth-field" htmlFor="join-full-name">الاسم الكامل *
            <input id="join-full-name" type="text" autoComplete="name" required maxLength={160} value={profile.fullName} onChange={(event) => updateProfile('fullName', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-phone">رقم الهاتف (اختياري)
            <input id="join-phone" type="tel" dir="ltr" autoComplete="tel" maxLength={32} placeholder="+20 ..." value={profile.phone} onChange={(event) => updateProfile('phone', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-residence">محل الإقامة (اختياري)
            <input id="join-residence" type="text" autoComplete="address-level2" maxLength={160} value={profile.residence} onChange={(event) => updateProfile('residence', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-work-conditions">ظروف العمل (اختياري)
            <input id="join-work-conditions" type="text" maxLength={2000} value={profile.workConditions} onChange={(event) => updateProfile('workConditions', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-bio">نبذة أو الدور (اختياري)
            <input id="join-bio" type="text" maxLength={4000} value={profile.bio} onChange={(event) => updateProfile('bio', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-device">الجهاز المتوفر (اختياري)
            <select id="join-device" value={profile.device} onChange={(event) => updateProfile('device', event.target.value)}>
              <option value="">— غير محدد —</option>
              {DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{device}</option>)}
            </select>
          </label>
          <label className="auth-field" htmlFor="join-gender">الجنس (اختياري)
            <select id="join-gender" value={profile.gender} onChange={(event) => updateProfile('gender', event.target.value)}>
              <option value="">— غير محدد —</option><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option>
            </select>
          </label>
        </section>}

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
          {submitting ? 'بنحفظ بياناتك بأمان...' : isPasswordReset ? 'تحديث كلمة المرور' : 'حفظ البيانات وكلمة المرور'}
          {!submitting && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3 text-xs leading-6 text-[var(--text-2)]" role="note">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span>{isPasswordReset ? 'سيتم تحديث كلمة المرور فقط، ولن نُسجّل دخولك تلقائياً.' : 'لن نُسجّل دخولك تلقائياً. إذا كنت عضواً جديداً، ستبقى عضويتك غير مفعّلة حتى تراجعها الإدارة.'}</span>
      </div>
    </AuthShell>
  );
}
