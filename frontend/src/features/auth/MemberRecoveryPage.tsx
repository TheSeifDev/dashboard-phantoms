import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { AuthShell } from '../../components/layout/AuthShell';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { useLocale } from '../../i18n/useLocale';
import { parseMemberRecoveryLocation, type MemberRecoveryCallback } from './member-recovery';
import { completeMemberRecovery, createMemberRecoveryClient, MemberRecoveryError, verifyMemberRecovery } from './member-recovery-api';
import { validateMemberPassword } from './member-password';

export default function MemberRecoveryPage() {
  const { t } = useLocale();
  const location = useLocation();
  const [client] = useState(createMemberRecoveryClient);
  const callback = useRef<MemberRecoveryCallback>(parseMemberRecoveryLocation(location));
  const verification = useRef<Promise<string> | null>(null);
  const cleanupStarted = useRef(false);
  const live = useRef(true);
  const latch = useRef(false);
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const cleanupRecovery = useCallback(async () => {
    if (cleanupStarted.current) return;
    cleanupStarted.current = true;
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }, [client]);
  useEffect(() => {
    live.current = true;
    if (!verification.current) {
      const captured = callback.current;
      callback.current = { kind: 'none' };
      // Scrub even malformed callbacks before a request or error screen is rendered.
      window.history.replaceState({}, document.title, '/member/recovery');
      verification.current = verifyMemberRecovery(client, captured);
    }
    void verification.current.then((address) => { if (live.current) { setEmail(address); setState('ready'); } }, () => {
      if (live.current) setState('invalid');
      void cleanupRecovery();
    });
    return () => {
      live.current = false;
      const cleanup = async () => {
        if (live.current) return;
        await cleanupRecovery();
      };
      // StrictMode effect replay reuses the same promise and must not redeem twice.
      void verification.current?.then(cleanup, cleanup);
    };
  }, [client, cleanupRecovery]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (latch.current || state !== 'ready') return;
    setError('');
    if (!validateMemberPassword(password, confirm).ok) {
      setError(password !== confirm ? t('كلمتا المرور غير متطابقتين.', 'The passwords do not match.') : t('استخدم 12 حرفاً على الأقل، وحرفاً إنجليزياً ورقماً، وبحد أقصى 72 بايت UTF-8.', 'Use at least 12 characters, an English letter and a number, with no more than 72 UTF-8 bytes.'));
      return;
    }
    latch.current = true; setPending(true);
    try {
      await completeMemberRecovery(client, password, confirm);
      if (!live.current) return;
      setPassword(''); setConfirm(''); setState('done');
      // Only this ephemeral recovery session is ended; ordinary/admin stores are untouched.
      await cleanupRecovery();
    } catch (cause) {
      if (!live.current) return;
      const code = cause instanceof MemberRecoveryError ? cause.code : 'SERVER_UNAVAILABLE';
      if (code === 'REVIEW_REQUIRED') {
        void cleanupRecovery();
        setState('invalid'); setPassword(''); setConfirm('');
        setError(t('العملية تحتاج مراجعة الإدارة. لا تُكرر الحفظ بهذا الرابط؛ اطلب رابطاً جديداً من المسؤول.', 'This operation needs administrator review. Do not repeat the save with this link; ask an administrator for a new one.'));
      } else if (code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN' || code === 'MEMBER_SESSION_REQUIRED') {
        void cleanupRecovery();
        setState('invalid'); setPassword(''); setConfirm('');
      } else {
        setError(code === 'RATE_LIMITED' ? t('طلبات كثيرة. انتظر ثم حاول لاحقاً.', 'Too many attempts. Wait before trying later.') : t('تعذّر تأكيد تغيير كلمة المرور. اطلب المساعدة من الإدارة إذا تكرر الخطأ.', 'The password change could not be confirmed. Ask the administrators for help if the error continues.'));
      }
    } finally { latch.current = false; if (live.current) setPending(false); }
  };

  if (state === 'checking') return <PhantomLoader message={t('بنتأكد من رابط الاستعادة...', 'Verifying your recovery link...')} />;
  const invalid = state === 'invalid';
  const done = state === 'done';
  return <AuthShell audience="member" badge={t('أمان حساب PHANTOMS', 'PHANTOMS ACCOUNT SECURITY')} title={done ? t('كلمة المرور اتحدّثت', 'Password updated') : invalid ? t('الرابط غير متاح', 'Link unavailable') : t('كلمة مرور جديدة', 'A new password')} description={done ? t('أكّد الخادم حفظ كلمة المرور. سجل الدخول بها من بوابة الأعضاء.', 'The server confirmed the password save. Sign in with it through the member portal.') : invalid ? t('الرابط انتهى أو استُخدم أو فُتح بمتصفح مختلف عن الذي طلب الاستعادة أو لم يثبت عضوية مؤهلة. اطلب رابطاً جديداً وافتحه في نفس المتصفح. لم نغيّر جلسة الإدارة أو بياناتك.', 'The link expired, was used, was opened in a different browser from the recovery request, or did not prove an eligible membership. Request a new link and open it in the same browser. Your administrator session and profile were not changed.') : t(`الاستعادة للبريد ${email}. معلوماتك وعضويات التيم لا تتغير.`, `Recovering ${email}. Your information and team memberships stay unchanged.`)} footer={<Link to="/login" className="auth-inline-link justify-center">{t('العودة لتسجيل الدخول', 'Back to sign in')}<ArrowLeft size={16} aria-hidden="true" /></Link>}>
    {error && <div id="member-recovery-error" className="auth-error" role="alert">{error}</div>}
    {done ? <div className="grid justify-items-center gap-4 text-center" role="status"><CheckCircle2 size={34} className="text-[var(--success-text)]" aria-hidden="true" /><Link to="/login" className="auth-submit">{t('دخول بوابة الأعضاء', 'Member sign-in')}<ArrowLeft size={17} aria-hidden="true" /></Link></div> : invalid ? <Link to="/forgot-password" className="auth-submit">{t('طلب رابط استعادة جديد', 'Request a new recovery link')}</Link> : <form onSubmit={(event) => { void submit(event); }} className="auth-form" noValidate aria-busy={pending || undefined}>
      <label className="auth-field" htmlFor="member-recovery-password">{t('كلمة المرور الجديدة', 'New password')}<span className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="member-recovery-password" type={show ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={password} disabled={pending} onChange={(event) => { setPassword(event.target.value); setError(''); }} aria-describedby="member-recovery-policy" /><button className="auth-password-toggle" type="button" disabled={pending} onClick={() => setShow((value) => !value)} aria-label={show ? t('إخفاء كلمات المرور', 'Hide passwords') : t('إظهار كلمات المرور', 'Show passwords')} aria-pressed={show}>{show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></span></label>
      <p id="member-recovery-policy" className="-mt-3 text-xs leading-6 text-[var(--text-muted)]">{t('12 حرفاً على الأقل، حرف إنجليزي ورقم، وبحد أقصى 72 بايت UTF-8.', 'At least 12 characters, an English letter and a number; at most 72 UTF-8 bytes.')}</p>
      <label className="auth-field" htmlFor="member-recovery-confirm">{t('تأكيد كلمة المرور', 'Confirm password')}<input id="member-recovery-confirm" type={show ? 'text' : 'password'} dir="ltr" autoComplete="new-password" required value={confirm} disabled={pending} onChange={(event) => { setConfirm(event.target.value); setError(''); }} aria-invalid={Boolean(confirm && confirm !== password) || undefined} aria-describedby={error ? 'member-recovery-error' : undefined} /></label>
      <button type="submit" className="auth-submit" disabled={pending}>{pending ? t('جارٍ التحقق والحفظ...', 'Verifying and saving...') : t('حفظ كلمة المرور', 'Save password')}<ArrowLeft size={17} aria-hidden="true" /></button>
    </form>}
  </AuthShell>;
}
