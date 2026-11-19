import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { useLocale } from '../../i18n/useLocale';
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

function localizedCallbackMessage(message: string, t: (arabic: string, english: string) => string): string {
  const messages: Record<string, string> = {
    [callbackError]: 'This invitation or recovery link is invalid or expired. Request a new link and try again.',
    'الحساب الموجود في الرابط ليس حساب إدارة معتمداً. اطلب من مالك النظام دعوة صحيحة.': 'The account in this link is not an authorized administrator. Ask the system owner for a valid invitation.',
    'الرابط ده مش رابط دعوة أو استعادة كلمة مرور صالح.': 'This is not a valid invitation or password recovery link.',
    'رابط الدعوة أو الاستعادة فشل. اطلب رابطاً جديداً وحاول مرة أخرى.': 'The invitation or recovery link failed. Request a new link and try again.',
    'نوع رابط الدخول غير مدعوم هنا. استخدم رابط الإدارة المخصص.': 'This sign-in link type is not supported here. Use the administrator link.',
    'رابط الدعوة لا يمكن استخدامه كاستعادة لكلمة المرور.': 'An invitation link cannot be used to recover a password.',
    'الرابط ناقص أو انتهت صلاحيته. اطلب رابطاً جديداً وحاول مرة أخرى.': 'This link is incomplete or expired. Request a new link and try again.',
    'افتح رابط دعوة أو استعادة كلمة مرور صالحاً قبل إعداد كلمة المرور.': 'Open a valid invitation or recovery link before setting a password.',
    'لم نجد بيانات استعادة في هذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى.': 'No recovery details were found in this link. Request a new link and try again.',
    'لم نجد جلسة الإدارة الخاصة بهذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى.': 'The administrator session for this link was not found. Request a new link and try again.',
  };
  const english = messages[message];
  return english ? t(message, english) : message;
}

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
  const { t } = useLocale();
  return (
    <AuthShell audience="admin" badge={t('رابط الإدارة', 'Administrator link')} title={t('الرابط غير صالح', 'Invalid link')} description={t('لم نفتح أي جلسة إدارة من هذا الرابط.', 'No administrator session was opened from this link.')} footer={<Link to="/admin/login" className="auth-inline-link justify-center"><span>{t('العودة لدخول الإدارة', 'Back to administrator sign-in')}</span><ArrowLeft size={16} /></Link>}>
      <div className="grid gap-4" role="alert">
        <div className="auth-error"><AlertCircle size={18} aria-hidden="true" /><span>{localizedCallbackMessage(message, t)}</span></div>
        <Link to="/admin/forgot-password" className="auth-submit text-center">{t('طلب رابط استعادة جديد', 'Request a new recovery link')}</Link>
        <Link to="/admin/login" className="auth-inline-link justify-center"><span>{t('العودة لدخول الإدارة', 'Back to administrator sign-in')}</span><ArrowLeft size={16} /></Link>
      </div>
    </AuthShell>
  );
}

export default function AdminSetPasswordPage() {
  const { t } = useLocale();
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
    return <PhantomLoader message={t('بنتأكد من رابط الإدارة...', 'Verifying administrator link...')} />;
  }
  if (callback.kind === 'callback' && callbackState === 'error') return <CallbackStatus message={callbackMessage || callbackError} />;
  if (callback.kind === 'none' && !setupIntent) return <CallbackStatus message="افتح رابط دعوة أو استعادة كلمة مرور صالحاً قبل إعداد كلمة المرور." />;
  if (!ready || (user && access.isPending)) {
    return <PhantomLoader message={t('بنتأكد من جلسة الإدارة...', 'Verifying administrator session...')} />;
  }
  if (!user) return <CallbackStatus message="لم نجد جلسة الإدارة الخاصة بهذا الرابط. اطلب رابطاً جديداً وحاول مرة أخرى." />;
  if (access.isError || !access.data?.is_admin) {
    return (
      <AuthShell audience="admin" badge={t('رابط دعوة الإدارة', 'Administrator invitation link')} title={t('الرابط غير صالح', 'Invalid link')} description={t('لا توجد جلسة دعوة إدارية صالحة على الجهاز ده. اطلب من مالك النظام إرسال دعوة جديدة.', 'There is no valid administrator invitation session on this device. Ask the system owner to send a new invitation.')} footer={<Link to="/admin/login" className="auth-inline-link"><span>{t('دخول الإدارة', 'Administrator sign-in')}</span><ArrowLeft size={16} /></Link>}>
        <div className="auth-error" role="alert"><ShieldCheck size={20} aria-hidden="true" /><p>{t('صلاحية الإدارة لم تُثبت لهذا الرابط، لذلك لم نفتح لوحة التحكم.', 'Administrator access was not verified for this link, so the dashboard was not opened.')}</p></div>
      </AuthShell>
    );
  }

  const savePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('كلمة المرور لازم تكون 8 أحرف على الأقل.', 'Password must be at least 8 characters.'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('تأكيد كلمة المرور مش مطابق.', 'The passwords do not match.'));
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      clearAdminSetupIntent();
      navigate('/admin/dashboard', { replace: true });
    } catch {
      setError(t('معرفناش نحفظ كلمة المرور. جرّب تاني.', 'Could not save the password. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell audience="admin" badge={t('دعوة إدارة PHANTOMS', 'PHANTOMS administrator invitation')} title={t('أنشئ كلمة المرور', 'Create a password')} description={`${t('اختار كلمة مرور لحساب الإدارة', 'Choose a password for administrator account')} ${user.email ?? ''}.`} footer={<Link to="/login" className="auth-inline-link"><span>{t('بوابة الأعضاء', 'Member portal')}</span><ArrowLeft size={16} /></Link>}>
      {error && <div className="auth-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={(event) => void savePassword(event)} className="auth-form" noValidate>
        <label className="auth-field" htmlFor="invite-password">{t('كلمة المرور الجديدة', 'New password')}
          <span className="auth-input-wrap"><input id="invite-password" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span>
        </label>
        <label className="auth-field" htmlFor="invite-password-confirm">{t('تأكيد كلمة المرور', 'Confirm password')}
          <span className="auth-input-wrap"><input id="invite-password-confirm" type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></span>
        </label>
        <Button type="submit" icon={<KeyRound size={17} />} isLoading={saving} loadingText={t('بنحفظ...', 'Saving...')} fullOnMobile>{t('حفظ وفتح لوحة الإدارة', 'Save and open administrator workspace')}</Button>
      </form>
    </AuthShell>
  );
}

export function AdminRecoveryCallbackPage() {
  const { t } = useLocale();
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
  if (callbackStateKey !== callback.key) return <PhantomLoader message={t('بنتجهز لتغيير كلمة المرور...', 'Preparing to change your password...')} />;
  if (error) return <CallbackStatus message={error} />;
  return <PhantomLoader message={t('بنتجهز لتغيير كلمة المرور...', 'Preparing to change your password...')} />;
}
