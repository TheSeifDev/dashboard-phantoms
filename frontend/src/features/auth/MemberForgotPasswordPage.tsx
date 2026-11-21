import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { useLocale } from '../../i18n/useLocale';
import { requestMemberRecovery, MemberRecoveryError } from './member-recovery-api';
import { normalizeAuthEmail } from './member-password';
import { isValidEmail } from '../../lib/validators';

export default function MemberForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const live = useRef(true);
  const latch = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (latch.current || cooldown > 0) return;
    setError('');
    const address = normalizeAuthEmail(email);
    if (!isValidEmail(address) || address.length > 254) { setError(t('اكتب بريد تسجيل الدخول بصيغة صحيحة.', 'Enter a valid sign-in email address.')); return; }
    latch.current = true; setPending(true);
    try {
      await requestMemberRecovery(address);
      if (live.current) { setSent(true); setCooldown(60); }
    } catch (cause) {
      if (!live.current) return;
      const rateLimited = cause instanceof MemberRecoveryError && cause.code === 'RATE_LIMITED';
      setError(rateLimited ? t('طلبات كثيرة. انتظر قليلاً قبل المحاولة مرة أخرى.', 'Too many requests. Wait before trying again.') : t('تعذّر الاتصال بخدمة الاستعادة. حاول لاحقاً أو اطلب رابطاً آمناً من الإدارة.', 'The recovery service could not be reached. Try later or request a secure administrator link.'));
      if (rateLimited) setCooldown(60);
    } finally { latch.current = false; if (live.current) setPending(false); }
  };
  return <AuthShell audience="member" badge={t('استعادة آمنة', 'SECURE RECOVERY')} title={t('نسيت كلمة المرور؟', 'Forgot your password?')} description={t('استخدم بريدك المسجل. بيانات الدراسة والبريد الجامعي لا تغيّر بريد تسجيل الدخول.', 'Use your registered email. Academic information and university email do not change your sign-in address.')} footer={<Link to="/login" className="auth-inline-link justify-center">{t('العودة لتسجيل الدخول', 'Back to sign in')}<ArrowLeft size={16} aria-hidden="true" /></Link>}>
    {sent && <div className="mb-5 flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--success-soft)] p-4 text-[var(--success-text)]" role="status" aria-live="polite"><CheckCircle2 size={21} className="shrink-0" aria-hidden="true" /><p className="text-sm leading-7">{t('إذا كان البريد مرتبطاً بعضوية مؤهلة، ستصلك رسالة استعادة عند توفر خدمة البريد. راجع البريد غير المرغوب فيه. لا تؤكد هذه الرسالة وجود الحساب.', 'If this address belongs to an eligible member, a recovery email will arrive when the mail service is available. Check your spam folder. This message does not confirm whether an account exists.')}</p></div>}
    {error && <div className="auth-error" id="member-forgot-error" role="alert">{error}</div>}
    <form onSubmit={(event) => { void submit(event); }} className="auth-form" noValidate aria-busy={pending || undefined}>
      <label className="auth-field" htmlFor="member-forgot-email">{t('البريد الإلكتروني المسجل', 'Registered email address')}<span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="member-forgot-email" type="email" dir="ltr" required autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} disabled={pending} placeholder="name@example.com" onChange={(event) => { setEmail(event.target.value); setError(''); setSent(false); }} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'member-forgot-error' : 'member-forgot-help'} /></span></label>
      <button type="submit" className="auth-submit" disabled={pending || cooldown > 0}>{pending ? t('جارٍ إرسال الطلب...', 'Requesting recovery...') : cooldown > 0 ? t(`أعد المحاولة بعد ${cooldown} ثانية`, `Try again in ${cooldown}s`) : t('طلب رابط استعادة', 'Request recovery link')}{!pending && <ArrowLeft size={17} aria-hidden="true" />}</button>
    </form>
    <p className="mt-4 text-xs leading-7 text-[var(--text-muted)]">{t('افتح رابط البريد خلال 30 دقيقة في نفس المتصفح الذي طلبت منه الاستعادة، مع السماح بالتخزين المحلي. أي طلب جديد يستبدل الرابط السابق في هذا المتصفح.', 'Open the email link within 30 minutes in the same browser used to request recovery, with local storage enabled. A new request replaces the previous link in this browser.')}</p>
    <div id="member-forgot-help" className="mt-5 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-xs leading-7 text-[var(--text-muted)]"><ShieldCheck size={17} className="mt-1 shrink-0" aria-hidden="true" /><p>{t('لا تستطيع استقبال البريد أو لديك حساب قديم؟ اطلب من مسؤول PHANTOMS رابط إعادة تعيين شخصياً لمرة واحدة. لا نغيّر بريد الحساب أو نفعّل عضوية غير معتمدة من خلال الاستعادة.', 'Cannot receive email or have a legacy account? Ask a PHANTOMS administrator for a personal one-time reset link. Recovery does not change your email or activate an unapproved membership.')}</p></div>
  </AuthShell>;
}
