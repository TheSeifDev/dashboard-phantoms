import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Info, LockKeyhole, Mail, ShieldAlert, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { useLocale } from '../../i18n/useLocale';
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

const MEMBER_ERROR_ENGLISH: Record<string, string> = {
  INVALID_INPUT: 'Check the email, password, and invitation code, then try again.',
  INVALID_TOKEN: 'The invitation code is invalid or no longer available.',
  WRONG_EMAIL: 'This email does not match the invitation for this member.',
  EXPIRED: 'The invitation has expired. Contact the team administrator for a new one.',
  REVOKED: 'This invitation was cancelled. Contact the team administrator.',
  ALREADY_USED: 'This invitation has already been used. Contact the team administrator if you need help.',
  MEMBER_PENDING_REVIEW: 'Your details were received and your account is awaiting admin review and activation. You cannot sign in before activation.',
  MEMBER_DISABLED: 'This membership is not active right now. Contact the team administrator.',
  MEMBER_NOT_FOUND: 'We could not find the requested membership.',
  IDENTITY_CONFLICT: 'We could not verify that this sign-in identity belongs to the membership. Contact the team administrator.',
  PASSWORD_ALREADY_SET: 'A password has already been set for this account. Contact the team administrator.',
  PASSWORD_MISMATCH: 'The passwords do not match.',
  WEAK_PASSWORD: 'Password must be at least 12 characters, no more than 72 UTF-8 bytes, and contain an English letter and a number.',
  RATE_LIMITED: 'Too many attempts. Wait a little and try again.',
  SERVER_CONFIG: 'The service is currently unavailable. Contact the system administrator.',
  SERVER_UNAVAILABLE: 'The enrollment service is unavailable. Please try again later.',
  REVIEW_REQUIRED: 'This invitation needs team administrator review before you can continue.',
  UNAUTHORIZED: 'You are not authorized to perform this action.',
};

function memberUiError(code: string, t: (arabic: string, english: string) => string): string {
  return t(memberAuthErrorMessage(code), MEMBER_ERROR_ENGLISH[code] ?? 'Could not complete the request. Try again or contact the team administrator.');
}

export default function MemberSelfRegisterPage() {
  const { t } = useLocale();
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
  const [completion, setCompletion] = useState<'pending_review' | 'password_updated' | 'enrollment_ready' | null>(null);
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
      setError(t('هذا الرابط غير مدعوم. اطلب رابط دعوة جديداً من مسؤول الفريق.', 'This link is not supported. Ask the team administrator for a new invitation link.'));
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
        setError(t('اكتب بريدك الإلكتروني بصيغة صحيحة.', 'Enter a valid email address.'));
        return;
      }
      if (isLegacyMemberInviteToken(submittedToken)) {
        setError(t('هذا رابط دعوة قديم وغير مدعوم. اطلب رابطاً جديداً من مسؤول الفريق.', 'This is an old, unsupported invitation link. Ask the team administrator for a new one.'));
        return;
      }
      if (!isMemberInviteToken(submittedToken)) {
        setError(isPasswordReset ? t('افتح رابط إعادة التعيين المخصص لك أو اطلب رابطاً جديداً من الإدارة.', 'Open your personal password reset link or request a new one from the administrators.') : t('افتح رابط الدعوة المخصص لك أو اطلب رابطاً جديداً من الإدارة.', 'Open your personal invitation link or request a new one from the administrators.'));
        return;
      }
      if (!isPasswordReset && !submittedProfile.fullName.trim()) {
        setError(t('اكتب اسمك الكامل.', 'Enter your full name.'));
        return;
      }
      if (!isPasswordReset && submittedProfile.phone.trim() && !/^\+?[0-9 ()-]{7,32}$/.test(submittedProfile.phone.trim())) {
        setError(t('اكتب رقم هاتف صحيحاً أو اترك الحقل فارغاً.', 'Enter a valid phone number or leave the field blank.'));
        return;
      }
      const passwordResult = validateMemberPassword(submittedPassword, submittedConfirmPassword);
      if (!passwordResult.ok) {
        setError(submittedPassword === submittedConfirmPassword
          ? memberUiError('WEAK_PASSWORD', t)
          : memberUiError('PASSWORD_MISMATCH', t));
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
        if (liveRef.current) setCompletion(
          membership === 'pending_review' ? 'pending_review' : isPasswordReset ? 'password_updated' : 'enrollment_ready',
        );
      } catch (cause) {
        if (liveRef.current) {
          const code = cause instanceof MemberPasswordApiError ? cause.code : 'SERVER_UNAVAILABLE';
          setError(memberUiError(code, t));
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

  if (completion) {
    const completionTitle = completion === 'pending_review' ? t('طلبك اتسجّل بنجاح', 'Your request was submitted')
      : completion === 'password_updated' ? t('كلمة المرور اتحدّثت', 'Password updated')
        : t('تم إعداد كلمة المرور', 'Password set');
    const completionMessage = completion === 'pending_review'
      ? t('وصلت بياناتك للإدارة وعضويتك غير مفعّلة الآن. تقدر تدخل للبوابة بعد موافقة الإدارة فقط.', 'Your details were sent to the administrators. Your membership is inactive until approval; you can sign in only after it is approved.')
      : completion === 'password_updated'
        ? t('تم حفظ كلمة المرور الجديدة. ارجع لبوابة الأعضاء وسجّل دخولك بها.', 'Your new password was saved. Return to the member portal and sign in with it.')
        : t('تم حفظ كلمة المرور بنجاح. ارجع لبوابة الأعضاء لتسجيل الدخول.', 'Your password was saved. Return to the member portal to sign in.');
    return (
      <AuthShell
        audience="member"
        badge={t('تم الحفظ بنجاح', 'Saved successfully')}
        title={completionTitle}
        description={completion === 'pending_review' ? t('حالة الطلب: بانتظار مراجعة الإدارة.', 'Request status: awaiting administrator review.') : t('بيانات الدخول جاهزة للاستخدام.', 'Your sign-in details are ready.')}
        footer={<Link className="auth-inline-link justify-center" to="/login">{t('العودة إلى تسجيل الدخول', 'Return to sign in')}</Link>}
      >
        <div data-testid="member-enrollment-success" className="grid justify-items-center gap-3 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-5 text-center" role="status" aria-live="polite">
          <CheckCircle2 size={28} className="text-[var(--primary-ink)]" aria-hidden="true" />
          <p className="m-0 text-sm font-bold leading-7 text-[var(--text)]">{completionMessage}</p>
        </div>
        <Link to="/login" className="auth-submit mt-4 px-4 py-3 text-center no-underline">{t('العودة إلى تسجيل الدخول', 'Return to sign in')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      audience="member"
      badge={isPasswordReset ? t('رابط إعادة تعيين آمن', 'Secure reset link') : t('رابط آمن من إدارة PHANTOMS', 'Secure PHANTOMS administrator link')}
      title={isPasswordReset ? t('إعادة تعيين كلمة المرور', 'Reset your password') : t('بياناتك وكلمة مرورك', 'Your details and password')}
      description={isPasswordReset ? t('تحقق من بريدك وأدخل كلمة مرور جديدة. لن تتغير بيانات ملفك الشخصي.', 'Confirm your email and enter a new password. Your profile details will not change.') : t('اكتب بريدك وبياناتك بنفسك. إذا كانت الإدارة قد قيّدت الرابط ببريد محدد، استخدمه. الرابط صالح مرة واحدة فقط.', 'Enter your own email and details. If the administrators restricted this link to a specific email, use that address. This link can be used once.')}
      footer={(
        <div className="grid gap-2 text-center text-sm text-[var(--text-2)]">
          <p>{t('إذا واجهت مشكلة أو نسيت كلمة المرور، تواصل مع مسؤول الفريق ليصدر لك رابطاً جديداً.', 'If you have trouble or forgot your password, contact the team administrator for a new link.')}</p>
          <Link className="auth-inline-link justify-center" to="/login">{t('العودة إلى تسجيل الدخول', 'Return to sign in')}</Link>
        </div>
      )}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label className="auth-field" htmlFor="join-email">{t('بريدك الإلكتروني للتسجيل', 'Email address for registration')}
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="join-email" type="email" dir="ltr" autoComplete="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} /></span>
        </label>
        {!isPasswordReset && <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5" aria-labelledby="join-profile-heading">
          <div><h2 id="join-profile-heading" className="flex items-center gap-2 text-sm font-black text-[var(--text)]"><UserRound size={16} aria-hidden="true" /> {t('بياناتك الشخصية', 'Your personal details')}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('املأ معلوماتك بنفسك؛ الإدارة تراجع العضوية الجديدة قبل تفعيلها.', 'Enter your own details. Administrators review new memberships before activation.')}</p></div>
          <label className="auth-field" htmlFor="join-full-name">{t('الاسم الكامل *', 'Full name *')}
            <input id="join-full-name" type="text" autoComplete="name" required maxLength={160} value={profile.fullName} onChange={(event) => updateProfile('fullName', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-phone">{t('رقم الهاتف (اختياري)', 'Phone number (optional)')}
            <input id="join-phone" type="tel" dir="ltr" autoComplete="tel" maxLength={32} placeholder="+20 ..." value={profile.phone} onChange={(event) => updateProfile('phone', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-residence">{t('محل الإقامة (اختياري)', 'Residence (optional)')}
            <input id="join-residence" type="text" autoComplete="address-level2" maxLength={160} value={profile.residence} onChange={(event) => updateProfile('residence', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-work-conditions">{t('ظروف العمل (اختياري)', 'Work conditions (optional)')}
            <input id="join-work-conditions" type="text" maxLength={2000} value={profile.workConditions} onChange={(event) => updateProfile('workConditions', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-bio">{t('نبذة أو الدور (اختياري)', 'Bio or role (optional)')}
            <input id="join-bio" type="text" maxLength={4000} value={profile.bio} onChange={(event) => updateProfile('bio', event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="join-device">{t('الجهاز المتوفر (اختياري)', 'Available device (optional)')}
            <select id="join-device" value={profile.device} onChange={(event) => updateProfile('device', event.target.value)}>
              <option value="">{t('— غير محدد —', '— Not specified —')}</option>
              {DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{t(device, ({ 'لابتوب': 'Laptop', 'كمبيوتر مكتبي (PC)': 'Desktop computer (PC)', 'بدون جهاز': 'No device', 'هاتف محمول': 'Mobile phone', 'لابتوب، هاتف محمول': 'Laptop, mobile phone', 'لابتوب، جهاز لوحي، هاتف محمول': 'Laptop, tablet, mobile phone' } as Record<string, string>)[device] ?? device)}</option>)}
            </select>
          </label>
          <label className="auth-field" htmlFor="join-gender">{t('الجنس (اختياري)', 'Gender (optional)')}
            <select id="join-gender" value={profile.gender} onChange={(event) => updateProfile('gender', event.target.value)}>
              <option value="">{t('— غير محدد —', '— Not specified —')}</option><option value="ذكر">{t('ذكر', 'Male')}</option><option value="أنثى">{t('أنثى', 'Female')}</option>
            </select>
          </label>
        </section>}

        <label className="auth-field" htmlFor="join-password">{t('كلمة المرور الجديدة', 'New password')}
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-6 text-[var(--text-muted)]">
          <p className="flex items-center gap-1.5 font-black text-[var(--text)]"><ShieldAlert size={15} aria-hidden="true" /> {t('متطلبات كلمة المرور', 'Password requirements')}</p>
          <ul className="mt-1 list-inside list-disc">{memberPasswordRequirements().map((item, index) => <li key={item}>{index === 0 ? t(item, 'At least 12 characters and no more than 72 UTF-8 bytes') : index === 1 ? t(item, 'At least one English letter') : t(item, 'At least one number')}</li>)}</ul>
        </div>
        <label className="auth-field" htmlFor="join-confirm-password">{t('تأكيد كلمة المرور', 'Confirm password')}
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-confirm-password" type={showConfirmPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); if (error) setError(''); }} /><button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? 'إخفاء تأكيد كلمة المرور' : 'إظهار تأكيد كلمة المرور'}>{showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? t('بنحفظ بياناتك بأمان...', 'Saving your details securely...') : isPasswordReset ? t('تحديث كلمة المرور', 'Update password') : t('حفظ البيانات وكلمة المرور', 'Save details and password')}
          {!submitting && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
      </form>
      <div data-testid="join-submit-notice" className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-6 text-[var(--text-2)]" role="note">
        <Info size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <span>{isPasswordReset
          ? t('تنبيه قبل الحفظ: كلمة المرور لم تتحدّث بعد. اضغط «تحديث كلمة المرور»؛ هتظهر رسالة تأكيد منفصلة بعد نجاح الحفظ.', 'Before saving: your password has not been changed yet. Press “Update password”; a separate confirmation appears only after saving succeeds.')
          : t('تنبيه قبل الإرسال: الطلب لم يُسجّل بعد. اضغط «حفظ البيانات وكلمة المرور»؛ لن يظهر للإدارة إلا بعد نجاح الحفظ. لو فشل، هتظهر رسالة الخطأ فوق النموذج.', 'Before submitting: your request has not been recorded. Press “Save details and password”; administrators see it only after the save succeeds. If it fails, an error appears above the form.')}</span>
      </div>
    </AuthShell>
  );
}
