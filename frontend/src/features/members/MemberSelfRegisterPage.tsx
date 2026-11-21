import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Info, LockKeyhole, Mail, ShieldAlert } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { useLocale } from '../../i18n/useLocale';
import { getMemberProfileFieldId, MemberProfileFields } from './MemberProfileFields';
import { EMPTY_MEMBER_PROFILE, validateMemberProfile } from './profile-fields';
import type { MemberProfileField, MemberProfileInput } from './profile-fields';
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

const PROFILE_ERROR_ENGLISH: Record<string, string> = {
  REQUIRED: 'Complete this required field.',
  TOO_LONG: 'This field is longer than allowed.',
  CONTROL_CHARACTERS: 'Control characters are not allowed.',
  INVALID_FORMAT: 'Use the required format for this field.',
  INVALID_OPTION: 'Choose one of the available options.',
  INVALID_URL: 'Use a valid HTTPS link for this field.',
  INVALID_KEYS: 'The profile fields are incomplete. Refresh and try again.',
  INVALID_TYPE: 'Profile fields must be text values.',
};

function memberProfileUiError(code: string, field: MemberProfileField, t: (arabic: string, english: string) => string): string {
  const arabic = code === 'REQUIRED' ? 'أكمل هذا الحقل المطلوب.'
    : field === 'phone' ? 'اكتب رقم هاتف صحيحاً من 7 إلى 15 رقماً.'
      : field === 'academicNumber' ? 'اكتب الرقم الأكاديمي من 1 إلى 32 رقماً.'
        : field === 'linkedinUrl' || field === 'portfolioUrl' ? 'استخدم رابط HTTPS صحيحاً وآمناً.'
          : 'راجع قيمة هذا الحقل.';
  return t(arabic, PROFILE_ERROR_ENGLISH[code] ?? 'Check this profile field.');
}

export default function MemberSelfRegisterPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: legacyRouteToken = '' } = useParams<{ token: string }>();
  const isPasswordReset = location.pathname.startsWith('/reset');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<MemberProfileInput>(EMPTY_MEMBER_PROFILE);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<'email' | 'password' | 'confirm' | 'invitation' | MemberProfileField | null>(null);
  const [completion, setCompletion] = useState<'pending_review' | 'password_updated' | 'enrollment_ready' | null>(null);
  const capturedRef = useRef(false);
  const liveRef = useRef(true);
  const submitLatchRef = useRef<Promise<void> | null>(null);
  const passwordBytes = new TextEncoder().encode(password).byteLength;
  const passwordRuleStates = [
    password.length >= 12 && passwordBytes <= 72,
    /[A-Za-z]/.test(password),
    /[0-9]/.test(password),
  ];

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

  const updateProfile = (key: MemberProfileField, value: string) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setFieldError(null);
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
      setFieldError(null);
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        setFieldError('email');
        setError(t('اكتب بريدك الإلكتروني بصيغة صحيحة.', 'Enter a valid email address.'));
        return;
      }
      if (isLegacyMemberInviteToken(submittedToken)) {
        setFieldError('invitation');
        setError(t('هذا رابط دعوة قديم وغير مدعوم. اطلب رابطاً جديداً من مسؤول الفريق.', 'This is an old, unsupported invitation link. Ask the team administrator for a new one.'));
        return;
      }
      if (!isMemberInviteToken(submittedToken)) {
        setFieldError('invitation');
        setError(isPasswordReset ? t('افتح رابط إعادة التعيين المخصص لك أو اطلب رابطاً جديداً من الإدارة.', 'Open your personal password reset link or request a new one from the administrators.') : t('افتح رابط الدعوة المخصص لك أو اطلب رابطاً جديداً من الإدارة.', 'Open your personal invitation link or request a new one from the administrators.'));
        return;
      }
      let normalizedProfile: MemberProfileInput | null = null;
      if (!isPasswordReset) {
        const profileResult = validateMemberProfile(submittedProfile);
        if (!profileResult.ok) {
          setFieldError(profileResult.field);
          setError(memberProfileUiError(profileResult.code, profileResult.field, t));
          window.requestAnimationFrame(() => document.getElementById(getMemberProfileFieldId(profileResult.field, 'join'))?.focus());
          return;
        }
        normalizedProfile = profileResult.profile;
      }
      const passwordResult = validateMemberPassword(submittedPassword, submittedConfirmPassword);
      if (!passwordResult.ok) {
        setFieldError(submittedPassword === submittedConfirmPassword ? 'password' : 'confirm');
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
          ...(!isPasswordReset && normalizedProfile ? { profile: normalizedProfile } : {}),
        });
        // Clear all sensitive enrollment material before leaving this screen.
        setPassword('');
        setConfirmPassword('');
        setToken('');
        setProfile(EMPTY_MEMBER_PROFILE);
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
        badge={completion === 'pending_review' ? t('الطلب قيد المراجعة', 'Request under review') : t('تم الحفظ بنجاح', 'Saved successfully')}
        title={completionTitle}
        description={completion === 'pending_review' ? t('حالة الطلب: بانتظار مراجعة الإدارة.', 'Request status: awaiting administrator review.') : completion === 'password_updated' ? t('تم تأكيد حفظ كلمة المرور الجديدة.', 'Your new password save was confirmed.') : t('تم تأكيد إعداد كلمة المرور.', 'Password setup was confirmed.')}
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
      {error && <div id="join-form-error" className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="auth-form" noValidate aria-busy={submitting || undefined}>
        <label className="auth-field" htmlFor="join-email">{t('بريدك الإلكتروني للتسجيل', 'Email address for registration')}
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="join-email" type="email" dir="ltr" autoCapitalize="none" spellCheck={false} autoComplete="email" required maxLength={254} placeholder="name@example.com" value={email} disabled={submitting} onChange={(event) => { setEmail(event.target.value); setFieldError(null); if (error) setError(''); }} aria-invalid={fieldError === 'email' || undefined} aria-describedby={fieldError === 'email' ? 'join-form-error' : undefined} /></span>
        </label>
        {!isPasswordReset && <MemberProfileFields profile={profile} onChange={updateProfile} disabled={submitting} invalidField={fieldError && fieldError !== 'email' && fieldError !== 'password' && fieldError !== 'confirm' && fieldError !== 'invitation' ? fieldError : null} errorId="join-form-error" idPrefix="join" />}

        <label className="auth-field" htmlFor="join-password">{t('كلمة المرور الجديدة', 'New password')}
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={password} disabled={submitting} onChange={(event) => { setPassword(event.target.value); setFieldError(null); if (error) setError(''); }} aria-invalid={fieldError === 'password' || undefined} aria-describedby={fieldError === 'password' ? 'join-form-error' : 'join-password-requirements'} /><button type="button" className="auth-password-toggle" disabled={submitting} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></span>
        </label>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-6 text-[var(--text-muted)]">
          <p id="join-password-requirements" className="flex items-center gap-1.5 font-black text-[var(--text)]"><ShieldAlert size={15} aria-hidden="true" /> {t('متطلبات كلمة المرور', 'Password requirements')}</p>
          <ul className="mt-1 grid gap-1.5" aria-label={t('قائمة متطلبات كلمة المرور', 'Password requirements checklist')}>{memberPasswordRequirements().map((item, index) => <li key={item} className={`flex items-start gap-2 ${passwordRuleStates[index] ? 'font-bold text-[var(--success-text)]' : ''}`}><CheckCircle2 size={15} className={`mt-1 shrink-0 ${passwordRuleStates[index] ? 'opacity-100' : 'opacity-30'}`} aria-hidden="true" /><span>{index === 0 ? t(item, 'At least 12 characters and no more than 72 UTF-8 bytes') : index === 1 ? t(item, 'At least one English letter') : t(item, 'At least one number')}</span></li>)}</ul>
        </div>
        <label className="auth-field" htmlFor="join-confirm-password">{t('تأكيد كلمة المرور', 'Confirm password')}
          <span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="join-confirm-password" type={showConfirmPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={confirmPassword} disabled={submitting} onChange={(event) => { setConfirmPassword(event.target.value); setFieldError(null); if (error) setError(''); }} aria-invalid={Boolean(confirmPassword && confirmPassword !== password) || undefined} aria-describedby={confirmPassword && confirmPassword !== password ? 'join-password-mismatch' : undefined} /><button type="button" className="auth-password-toggle" disabled={submitting} onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? t('إخفاء تأكيد كلمة المرور', 'Hide password confirmation') : t('إظهار تأكيد كلمة المرور', 'Show password confirmation')} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></span>
        </label>
        {confirmPassword && confirmPassword !== password && <p id="join-password-mismatch" className="-mt-3 text-xs font-bold text-amber-700 dark:text-amber-300" role="status" aria-live="polite">{t('كلمتا المرور غير متطابقتين بعد.', 'The passwords do not match yet.')}</p>}
        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? t('بنحفظ بياناتك بأمان...', 'Saving your details securely...') : isPasswordReset ? t('تحديث كلمة المرور', 'Update password') : t('حفظ البيانات وكلمة المرور', 'Save details and password')}
          {!submitting && <ArrowLeft size={18} aria-hidden="true" />}
        </button>
        {submitting && <p className="-mt-3 text-center text-xs leading-5 text-[var(--text-muted)]" role="status" aria-live="polite">{isPasswordReset ? t('جارٍ التحقق من الرابط وتحديث كلمة المرور. لا تغلق الصفحة حتى تنتهي العملية.', 'Verifying the link and updating your password. Keep this page open until the operation finishes.') : t('جارٍ التحقق من الدعوة وحفظ البيانات. لن تظهر رسالة النجاح إلا بعد تأكيد الخادم.', 'Verifying the invitation and saving your details. Success appears only after the server confirms the operation.')}</p>}
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
