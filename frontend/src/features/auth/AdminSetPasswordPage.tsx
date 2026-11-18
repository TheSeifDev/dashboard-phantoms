import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase/client';
import { useAdminAccess } from '../admin/access/api';
import {
  clearAdminSetupIntent,
  createSingleFlight,
  inspectAdminCallback,
  readAdminSetupIntent,
  writeAdminSetupIntent,
  type AdminCallbackInput,
} from './auth-flow';
import type { Session } from '@supabase/supabase-js';

const callbackError = 'رابط الدعوة أو الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً وحاول مرة أخرى.';
const callbackRequests = createSingleFlight<string, Session>();
let activeCallbackKey: string | null = null;

async function completeAdminCallbackOnce(callback: Extract<AdminCallbackInput, { kind: 'callback' }>): Promise<Session> {
  const assertCurrentCallback = () => {
    if (activeCallbackKey !== callback.key) throw new Error(callbackError);
  };
  assertCurrentCallback();
  // Never let a failed or repeated callback inherit a stale setup marker.
  clearAdminSetupIntent();

  try {
    let session: Session | null = null;
    if (callback.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code);
      if (error || !data.session) throw new Error(callbackError);
      session = data.session;
    } else if (callback.accessToken && callback.refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      });
      if (error || !data.session) throw new Error(callbackError);
      session = data.session;
    }

    if (!session) throw new Error(callbackError);
    assertCurrentCallback();
    const { data: access, error: accessError } = await supabase.rpc('get_admin_access');
    assertCurrentCallback();
    if (accessError || !access?.is_admin) {
      await supabase.auth.signOut({ scope: 'local' });
      assertCurrentCallback();
      useAuthStore.getState().clear();
      throw new Error('الحساب الموجود في الرابط ليس حساب إدارة معتمداً. اطلب من مالك النظام دعوة صحيحة.');
    }

    // Only a verified admin callback may create the marker used after a reload.
    writeAdminSetupIntent(callback.intent, session.user.id);
    useAuthStore.getState().setSession(session);
    window.history.replaceState({}, document.title, window.location.pathname);
    return session;
  } catch (cause) {
    // A cancelled earlier exchange must not clear a newer callback's marker.
    if (activeCallbackKey === callback.key) clearAdminSetupIntent();
    throw cause;
  }
}

function completeAdminCallback(callback: Extract<AdminCallbackInput, { kind: 'callback' }>): Promise<Session> {
  return callbackRequests.run(callback.key, () => completeAdminCallbackOnce(callback));
}

function CallbackStatus({ message }: { message: string }) {
  return (
    <AuthShell audience="admin" badge="رابط الإدارة" title="الرابط غير صالح" description="لم نفتح أي جلسة إدارة من هذا الرابط." footer={<Link to="/admin/login" className="auth-inline-link justify-center"><span>العودة لدخول الإدارة</span><ArrowLeft size={16} /></Link>}>
      <div className="grid gap-4" role="alert">
        <div className="auth-error"><AlertCircle size={18} aria-hidden="true" /><span>{message}</span></div>
        <Link to="/admin/forgot-password" className="auth-submit text-center">طلب رابط استعادة جديد</Link>
        <Link to="/admin/login" className="auth-inline-link justify-center"><span>العودة لدخول الإدارة</span><ArrowLeft size={16} /></Link>
      </div>
    </AuthShell>
  );
}

export default function AdminSetPasswordPage() {
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const access = useAdminAccess(user?.id ?? null);
  const navigate = useNavigate();
  const location = useLocation();
  const callback = useMemo(
    () => inspectAdminCallback(location.pathname, location.search, location.hash),
    [location.hash, location.pathname, location.search],
  );
  const [callbackState, setCallbackState] = useState<'idle' | 'pending' | 'complete' | 'error'>(
    callback.kind === 'callback' ? 'pending' : callback.kind === 'invalid' ? 'error' : 'idle',
  );
  const [callbackMessage, setCallbackMessage] = useState(callback.kind === 'invalid' ? callback.message : '');
  const [callbackStateKey, setCallbackStateKey] = useState(callback.key);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    activeCallbackKey = callback.kind === 'callback' ? callback.key : null;
    setCallbackStateKey(callback.key);
    setCallbackState(callback.kind === 'callback' ? 'pending' : callback.kind === 'invalid' ? 'error' : 'idle');
    setCallbackMessage(callback.kind === 'invalid' ? callback.message : '');
    setError('');
    if (callback.kind === 'invalid') {
      clearAdminSetupIntent();
      return;
    }
    if (callback.kind !== 'callback') return;
    let active = true;
    void completeAdminCallback(callback)
      .then(() => {
        if (active) setCallbackState('complete');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setCallbackMessage(cause instanceof Error ? cause.message : callbackError);
        setCallbackState('error');
      });
    return () => {
      active = false;
      if (activeCallbackKey === callback.key) activeCallbackKey = null;
    };
  }, [callback]);

  const setupIntent = ready ? readAdminSetupIntent(user?.id ?? null) : null;
  const isCurrentCallbackState = callbackStateKey === callback.key;
  const isProcessingCallback = callback.kind === 'callback'
    && (!isCurrentCallbackState || callbackState === 'pending' || (callbackState === 'complete' && !ready));
  if (callback.kind === 'invalid') return <CallbackStatus message={callback.message} />;
  if (isProcessingCallback) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من رابط الإدارة...</span></div>;
  }
  if (callback.kind === 'callback' && callbackState === 'error') return <CallbackStatus message={callbackMessage || callbackError} />;
  if (callback.kind === 'none' && !setupIntent) return <CallbackStatus message="افتح رابط دعوة أو استعادة كلمة مرور صالحاً قبل إعداد كلمة المرور." />;
  if (!ready || (user && access.isPending)) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتأكد من جلسة الإدارة...</span></div>;
  }
  if (!user) return <CallbackStatus message="لم نجد جلسة الإدارة الخاصة بهذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى." />;
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
      clearAdminSetupIntent();
      navigate('/admin/dashboard', { replace: true });
    } catch {
      setError('معرفناش نحفظ كلمة المرور. جرّب تاني.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell audience="admin" badge="دعوة إدارة PHANTOMS" title="أنشئ كلمة المرور" description={`اختار كلمة مرور لحساب الإدارة ${user.email ?? ''}.`} footer={<Link to="/login" className="auth-inline-link"><span>بوابة الأعضاء</span><ArrowLeft size={16} /></Link>}>
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

export function AdminRecoveryCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const callback = useMemo(
    () => inspectAdminCallback(location.pathname, location.search, location.hash),
    [location.hash, location.pathname, location.search],
  );
  const [error, setError] = useState(callback.kind === 'invalid' ? callback.message : '');
  const [callbackStateKey, setCallbackStateKey] = useState(callback.key);

  useEffect(() => {
    activeCallbackKey = callback.kind === 'callback' ? callback.key : null;
    setCallbackStateKey(callback.key);
    setError(
      callback.kind === 'invalid'
        ? callback.message
        : callback.kind === 'none'
          ? 'لم نجد بيانات استعادة في هذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى.'
          : '',
    );
    if (callback.kind !== 'callback') {
      clearAdminSetupIntent();
      return;
    }
    let active = true;
    void completeAdminCallback(callback)
      .then(() => {
        if (active) navigate('/admin/set-password', { replace: true });
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : callbackError);
      });
    return () => {
      active = false;
      if (activeCallbackKey === callback.key) activeCallbackKey = null;
    };
  }, [callback, navigate]);

  if (callback.kind === 'invalid') return <CallbackStatus message={callback.message} />;
  if (callback.kind === 'none') return <CallbackStatus message="لم نجد بيانات استعادة في هذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى." />;
  if (callbackStateKey !== callback.key) return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتجهز لتغيير كلمة المرور...</span></div>;
  if (error) return <CallbackStatus message={error} />;
  return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]" dir="rtl"><span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">بنتجهز لتغيير كلمة المرور...</span></div>;
}
