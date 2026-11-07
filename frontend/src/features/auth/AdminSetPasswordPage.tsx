import { useState } from 'react';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { useAdminAccess } from '../admin/access/api';

export default function AdminSetPasswordPage() {
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const access = useAdminAccess(user?.id ?? null);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!ready || (user && access.isPending)) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من رابط الدعوة...</span></div>;
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  if (access.isError || !access.data?.is_admin) {
    return (
      <AuthShell audience="admin" badge="رابط دعوة الإدارة" title="الرابط غير صالح" description="لا توجد جلسة دعوة إدارية صالحة على الجهاز ده. اطلب من مالك النظام إرسال دعوة جديدة." footer={<Link to="/admin/login" className="auth-inline-link"><span>دخول الإدارة</span><ArrowLeft size={16} /></Link>}>
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6" role="alert"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" /><p>صلاحية الإدارة لم تُثبت لهذا الرابط، لذلك لم نفتح لوحة التحكم.</p></div>
      </AuthShell>
    );
  }

  const savePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('كلمة المرور لازم تكون 8 أحرف على الأقل.');
      return;
    }
    if (password !== confirmPassword) {
      setError('تأكيد كلمة المرور مش مطابق.');
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate('/admin/dashboard', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'معرفناش نحفظ كلمة المرور. جرّب تاني.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell audience="admin" badge="دعوة إدارة وصلة" title="أنشئ كلمة المرور" description={`اختار كلمة مرور لحساب الإدارة ${user.email ?? ''}.`} footer={<Link to="/login" className="auth-inline-link"><span>بوابة الأعضاء</span><ArrowLeft size={16} /></Link>}>
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={(event) => void savePassword(event)} className="auth-form" noValidate>
        <label className="auth-field" htmlFor="invite-password">كلمة المرور الجديدة
          <span className="auth-input-wrap"><input id="invite-password" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span>
        </label>
        <label className="auth-field" htmlFor="invite-password-confirm">تأكيد كلمة المرور
          <span className="auth-input-wrap"><input id="invite-password-confirm" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></span>
        </label>
        <Button type="submit" icon={<KeyRound size={17} />} isLoading={saving} loadingText="بنحفظ..." fullOnMobile>حفظ وفتح لوحة الإدارة</Button>
      </form>
    </AuthShell>
  );
}
