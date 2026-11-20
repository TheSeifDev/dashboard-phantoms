import { useState } from 'react';
import { AlertCircle, ArrowLeft, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { useLocale } from '../../i18n/useLocale';
import { supabase } from '../../lib/supabase/client';
import { isValidEmail } from '../../lib/validators';

export default function AdminForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const requestRecovery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError(t('صيغة البريد الإلكتروني مش صحيحة.', 'Enter a valid email address.'));
      return;
    }
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/admin/recovery/callback`,
      });
      if (requestError) {
        setError(t('تعذر إرسال رابط الاستعادة. تأكد من البريد وحاول مرة أخرى.', 'Could not send the recovery link. Check the email address and try again.'));
      } else {
        setInfo(t('لو البريد مسجل كحساب إدارة، هيوصلك رابط استعادة. افتح الرابط على نفس الجهاز لإعداد كلمة المرور.', 'If this email belongs to an administrator account, a recovery link will arrive. Open it on the same device to set a password.'));
      }
    } catch {
      setError(t('تعذر إرسال رابط الاستعادة. حاول مرة أخرى.', 'Could not send the recovery link. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      audience="admin"
      badge={t('استعادة كلمة مرور الإدارة', 'Administrator password recovery')}
      title={t('نسيت كلمة المرور؟', 'Forgot your password?')}
      description={t('اكتب بريد حساب الإدارة لإرسال رابط استعادة آمن.', 'Enter your administrator email to request a secure recovery link.')}
      footer={<Link to="/admin/login" className="auth-inline-link"><span>{t('العودة لدخول الإدارة', 'Back to administrator sign-in')}</span><ArrowLeft size={16} /></Link>}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      {info && <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-3.5 text-xs font-semibold leading-5 text-[var(--text)]" role="status"><Mail size={17} className="mt-0.5 shrink-0 text-[var(--primary-ink)]" aria-hidden="true" /><span>{info}</span></div>}
      <form onSubmit={(event) => void requestRecovery(event)} method="post" className="auth-form" noValidate aria-busy={loading || undefined}>
        <label className="auth-field" htmlFor="admin-recovery-email">{t('البريد الإلكتروني', 'Email address')}
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="admin-recovery-email" type="email" dir="ltr" autoCapitalize="none" spellCheck={false} autoComplete="email" required maxLength={254} placeholder="admin@phantoms.com" value={email} disabled={loading} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); if (info) setInfo(''); }} aria-invalid={Boolean(email.trim() && !isValidEmail(email.trim().toLowerCase())) || undefined} aria-describedby={email.trim() && !isValidEmail(email.trim().toLowerCase()) ? 'admin-recovery-email-hint' : undefined} /></span>
        </label>
        {email.trim() && !isValidEmail(email.trim().toLowerCase()) && <p id="admin-recovery-email-hint" className="-mt-3 text-xs font-bold text-amber-700 dark:text-amber-300" role="note">{t('استخدم بريداً إلكترونياً بصيغة صحيحة، مثل admin@phantoms.com.', 'Enter a valid email address, such as admin@phantoms.com.')}</p>}
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>{loading ? t('بنرسل الرابط...', 'Sending link...') : t('إرسال رابط الاستعادة', 'Send recovery link')} {!loading && <ArrowLeft size={18} aria-hidden="true" />}</button>
        {loading && <p className="-mt-3 text-center text-xs leading-5 text-[var(--text-muted)]" role="status" aria-live="polite">{t('جارٍ إرسال الطلب. لن نكشف ما إذا كان البريد مرتبطاً بحساب إدارة.', 'Sending your request. We will not reveal whether this email is linked to an administrator account.')}</p>}
      </form>
    </AuthShell>
  );
}
