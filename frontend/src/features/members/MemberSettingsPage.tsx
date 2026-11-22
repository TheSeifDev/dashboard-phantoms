import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ArrowUpRight, Info, LockKeyhole, Save, ShieldCheck, UserRound } from 'lucide-react';
import { gsap } from 'gsap';
import { useLocale } from '../../i18n/useLocale';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { PortalHeader } from '../portal/PortalHeader';
import { cleanupMemberState } from '../auth/MemberAccessGuard';
import { MemberProfileFields } from './MemberProfileFields';
import { MissingProfileFields } from './MissingProfileFields';
import { validateMemberProfile, type MemberProfileInput } from './profile-fields';
import { memberProfileKey, MemberProfileApiError, profileToInput, saveMemberProfile, useMemberProfile, type MemberProfileSnapshot } from './profile-api';
import '../../styles/member-settings.css';

function SettingsForm({ initial }: { initial: MemberProfileSnapshot }) {
  const { t } = useLocale();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [profile, setProfile] = useState(() => profileToInput(initial));
  const [invalidField, setInvalidField] = useState<keyof MemberProfileInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const live = useRef(true);
  const latch = useRef(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(profileToInput(saved));
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (invalidField) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidField]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (latch.current) return;
    setError(''); setSuccess(false); setInvalidField(null);
    const valid = validateMemberProfile(profile);
    if (!valid.ok) {
      setInvalidField(valid.field);
      setError(t('راجع الحقل المحدد. كل حقول الملف إلزامية: البيانات الأساسية، الروابط المهنية (HTTPS صحيحة)، ومعلوماتك الإضافية.', 'Check the highlighted field. Every profile field is required: core details, professional links (valid HTTPS) and your additional information.'));
      return;
    }
    const device = getDeviceToken();
    if (!device) { setError(t('تعذّر التحقق من الجهاز. سجّل الدخول من جديد.', 'Your device could not be verified. Sign in again.')); return; }
    latch.current = true; setSaving(true);
    try {
      const result = await saveMemberProfile(saved.member_id, saved.email, device, valid.profile);
      if (!live.current) return;
      const current = useAuthStore.getState().currentMember;
      if (!current || current.id !== result.member_id || current.email.toLowerCase() !== result.email || getDeviceToken() !== device) return;
      // Keep identity, Teams and permissions untouched; refresh display information only.
      useAuthStore.getState().setMember({ ...current, full_name: result.full_name, phone: result.phone, residence: result.residence, work_conditions: result.work_conditions, bio: result.bio, device: result.device, gender: result.gender });
      cache.setQueryData(memberProfileKey(result.member_id, result.email), result);
      setSaved(result); setProfile(profileToInput(result)); setSuccess(true);
    } catch (cause) {
      if (!live.current) return;
      const code = cause instanceof MemberProfileApiError ? cause.code : 'SERVER_UNAVAILABLE';
      if (code === 'ACADEMIC_NUMBER_CONFLICT') {
        setInvalidField('academicNumber');
        setError(t('الرقم الأكاديمي مسجل بالفعل. راجعه أو تواصل مع الإدارة؛ لم نحفظ أي تغييرات.', 'This academic number is already registered. Check it or contact the administrators; no changes were saved.'));
      } else {
        setError(t('تعذّر تأكيد حفظ البيانات. بقيت مدخلاتك هنا؛ أعد المحاولة أو تواصل مع الإدارة.', 'The profile save could not be confirmed. Your entries remain here; retry or contact the administrators.'));
      }
    } finally { latch.current = false; if (live.current) setSaving(false); }
  };

  return <>
    {!saved.profile_complete && <div className="settings-completion-notice settings-reveal" role="status"><Info size={21} aria-hidden="true" /><div><strong>{t('كل بيانات حسابك إلزامية الآن', 'Every profile field is required now')}</strong><p>{t('أكمل الحقول الناقصة واحفظها لتعود إلى مساحة العمل. لحد ما تكمّلها هيوصلك تذكير باستمرار. حسابك وعضويات التيم محفوظة كما هي.', 'Fill in the missing fields and save to return to your workspace. You keep getting reminders until they are complete. Your account and team memberships are unchanged.')}</p><MissingProfileFields fields={saved.missing_fields} /></div></div>}
    <form ref={formRef} onSubmit={(event) => { void submit(event); }} noValidate aria-busy={saving || undefined} className="settings-form settings-reveal">
      <div className="settings-section-heading"><span className="settings-section-number" aria-hidden="true">01</span><div><h2>{t('معلوماتك في PHANTOMS', 'Your PHANTOMS information')}</h2><p>{t('كل الحقول إلزامية لاستكمال حسابك. بياناتك لا تغيّر صلاحيات التيم.', 'Every field is required to complete your account. Your profile does not change team permissions.')}</p></div></div>
      <label className="auth-field settings-login-email" htmlFor="settings-email">{t('البريد الإلكتروني المسجل *', 'Registered email address *')}<input id="settings-email" type="email" dir="ltr" readOnly value={saved.email} aria-describedby="settings-email-note" /><span id="settings-email-note" className="settings-hint">{t('بريد تسجيل الدخول ثابت هنا لحماية ربط حسابك. لتغييره تواصل مع الإدارة.', 'Your sign-in email is read-only to protect your account binding. Contact the administrators to change it.')}</span></label>
      {error && <div id="settings-error" className="auth-error" role="alert">{error}</div>}
      <MemberProfileFields idPrefix="settings" profile={profile} disabled={saving} invalidField={invalidField} errorId="settings-error" onChange={(key, value) => { setProfile((current) => ({ ...current, [key]: value })); setInvalidField(null); setError(''); setSuccess(false); }} />
      <div className="settings-save-bar"><p role="status">{saving ? t('ننتظر تأكيد الحفظ من الخادم...', 'Waiting for the server to confirm the save...') : dirty ? t('لديك تعديلات لم تُحفظ بعد.', 'You have unsaved changes.') : saved.profile_complete ? t('البيانات المطلوبة محفوظة ومكتملة.', 'Your required information is saved and complete.') : t('أكمل البيانات المطلوبة ثم احفظ.', 'Complete the required fields, then save.')}</p><Button type="submit" icon={<Save size={17} />} isLoading={saving} disabled={!dirty && saved.profile_complete} loadingText={t('جارٍ الحفظ...', 'Saving...')}>{t('حفظ معلوماتي', 'Save my information')}</Button></div>
      {success && <div className="settings-success" role="status" aria-live="polite"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>{t('تم حفظ معلوماتك بنجاح', 'Your information was saved')}</strong><p>{t('أكّد الخادم اكتمال البيانات المطلوبة.', 'The server confirmed that all required information is complete.')}</p></div><Link to="/portal">{t('فتح مساحة العمل', 'Open workspace')}<ArrowUpRight size={16} aria-hidden="true" /></Link></div>}
    </form>
  </>;
}

export default function MemberSettingsPage() {
  const { t, dir } = useLocale();
  const profile = useMemberProfile();
  const root = useRef<HTMLDivElement>(null);
  const ready = Boolean(profile.data);
  useEffect(() => {
    if (!root.current || !ready) return;
    const media = gsap.matchMedia();
    media.add({ reduced: '(prefers-reduced-motion: reduce)', desktop: '(min-width: 900px)' }, (context) => {
      if (context.conditions?.reduced) return;
      gsap.from(root.current!.querySelectorAll('.settings-reveal'), { y: context.conditions?.desktop ? 22 : 10, autoAlpha: 0, duration: .5, stagger: .065, ease: 'power2.out', clearProps: 'all' });
    });
    return () => media.revert();
  }, [ready]);
  return <div ref={root} dir={dir} className="member-settings-page">
    <PortalHeader onLogout={() => { void cleanupMemberState(); }} />
    <main className="member-settings-main">
      <Link to="/download" className="settings-back-link self-start">{t('تطبيق PHANTOMS للموبايل (أندرويد و iOS)', 'Get the PHANTOMS app (Android and iOS)')}<ArrowUpRight size={17} aria-hidden="true" /></Link>
      <div className="settings-title-row"><div><span className="settings-eyebrow">PHANTOMS / {t('حسابي', 'MY ACCOUNT')}</span><h1>{t('الإعدادات ومعلوماتي', 'Settings & information')}</h1><p>{t('ملف واضح. تواصل أسهل. حساب أكثر أماناً.', 'A clear profile. Easier collaboration. A safer account.')}</p></div>{profile.data?.profile_complete && <Link to="/portal" className="settings-back-link">{t('مساحة العمل', 'Workspace')}<ArrowUpRight size={17} aria-hidden="true" /></Link>}</div>
      {profile.isPending || !profile.isFetchedAfterMount ? <PhantomLoader message={t('بنحمّل معلوماتك...', 'Loading your information...')} /> : profile.isError || !profile.data ? <ErrorState message={t('تعذّر تحميل معلوماتك. أعد المحاولة؛ لم تتغير بيانات حسابك.', 'Your information could not be loaded. Retry; your account details have not changed.')} onRetry={() => { void profile.refetch(); }} /> : <div className="member-settings-layout">
        <aside className="settings-summary settings-reveal" aria-label={t('حالة الملف الشخصي', 'Profile status')}><div className="settings-profile-mark" aria-hidden="true"><UserRound size={30} /></div><h2>{profile.data.full_name}</h2><p className="settings-summary-email" dir="ltr">{profile.data.email}</p><div className={`settings-status ${profile.data.profile_complete ? 'is-complete' : ''}`}><ShieldCheck size={17} aria-hidden="true" />{profile.data.profile_complete ? t('معلوماتك مكتملة', 'Information complete') : t('معلومات مطلوبة', 'Information required')}</div><div className="settings-summary-divider" /><p className="settings-hint">{t('تخصصك يصف مجال اهتمامك. عضويات Software وHardware وAI يديرها الفريق بصورة مستقلة.', 'Your specialization describes your focus. Software, Hardware and AI team memberships are managed separately.')}</p><div className="settings-security"><LockKeyhole size={19} aria-hidden="true" /><h3>{t('أمان الحساب', 'Account security')}</h3><p>{t('استعادة كلمة المرور تتم عبر البريد المسجل أو رابط إدارة آمن.', 'Recover your password through your registered email or a secure administrator link.')}</p><Link to="/forgot-password">{t('استعادة كلمة المرور', 'Password recovery')}<ArrowUpRight size={15} aria-hidden="true" /></Link></div></aside>
        <section className="settings-editor" aria-label={t('تعديل البيانات', 'Edit information')}><SettingsForm key={`${profile.data.member_id}:${profile.data.email}`} initial={profile.data} /></section>
      </div>}
    </main>
  </div>;
}
