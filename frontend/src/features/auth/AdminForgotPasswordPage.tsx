import { useState } from 'react';
import { AlertCircle, ArrowLeft, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { supabase } from '../../lib/supabase/client';
import { isValidEmail } from '../../lib/validators';

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const requestRecovery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError('صيغة البريد الإلكتروني مش صحيحة.');
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
        setError('تعذر إرسال رابط الاستعادة. تأكد من البريد وحاول مرة أخرى.');
      } else {
        setInfo('لو البريد مسجل كحساب إدارة، هيوصلك رابط استعادة. افتح الرابط على نفس الجهاز لإعداد كلمة المرور.');
      }
    } catch {
      setError('تعذر إرسال رابط الاستعادة. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      audience="admin"
      badge="استعادة كلمة مرور الإدارة"
      title="نسيت كلمة المرور؟"
      description="اكتب بريد حساب الإدارة لإرسال رابط استعادة آمن."
      footer={<Link to="/admin/login" className="auth-inline-link"><span>العودة لدخول الإدارة</span><ArrowLeft size={16} /></Link>}
    >
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      {info && <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-3.5 text-xs font-semibold leading-5 text-[var(--text)]" role="status"><Mail size={17} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" /><span>{info}</span></div>}
      <form onSubmit={(event) => void requestRecovery(event)} method="post" className="auth-form" noValidate>
        <label className="auth-field" htmlFor="admin-recovery-email">البريد الإلكتروني
          <span className="auth-input-wrap"><Mail size={17} aria-hidden="true" /><input id="admin-recovery-email" type="email" dir="ltr" autoComplete="email" required placeholder="admin@phantoms.com" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }} /></span>
        </label>
        <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading || undefined}>{loading ? 'بنرسل الرابط...' : 'إرسال رابط الاستعادة'} {!loading && <ArrowLeft size={18} aria-hidden="true" />}</button>
      </form>
    </AuthShell>
  );
}
