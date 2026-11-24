import { useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight, CheckCircle2, Info, KeyRound, LockKeyhole, Save, Send, ShieldCheck, Trash2, UserRound,
} from 'lucide-react';
import { gsap } from 'gsap';
import { useLocale } from '../../i18n/useLocale';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { PhantomLoader } from '../../components/motion/PhantomLoader';
import { GithubMark } from '../dashboard/GithubMark';
import { MemberProfileFields } from './MemberProfileFields';
import { MissingProfileFields } from './MissingProfileFields';
import { MemberGithubCard } from './MemberGithubCard';
import { MemberTelegramCard } from '../telegram/MemberTelegramCard';
import { MemberPasswordCard } from './MemberPasswordCard';
import { MemberDangerZone } from './MemberDangerZone';
import { validateMemberProfile, type MemberProfileInput } from './profile-fields';
import { memberProfileKey, MemberProfileApiError, profileToInput, saveMemberProfile, useMemberProfile, type MemberProfileSnapshot } from './profile-api';
import { useGithubLinkState } from './github-link-api';
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
      <label className="auth-field settings-login-email" htmlFor="settings-email">{t('البريد الإلكتروني المسجل *', 'Registered email address *')}<input id="settings-email" type="email" dir="ltr" readOnly value={saved.email} aria-describedby="settings-email-note" /><span id="settings-email-note" className="settings-hint">{t('بريد تسجيل الدخول ثابت هنا لحماية ربط حسابك. لتغييره تواصل مع الإدارة.', 'Your sign-in email is read-only to protect your account binding. Contact the administrators to change it.')}</span></label>
      {error && <div id="settings-error" className="auth-error" role="alert">{error}</div>}
      <MemberProfileFields idPrefix="settings" profile={profile} disabled={saving} invalidField={invalidField} errorId="settings-error" onChange={(key, value) => { setProfile((current) => ({ ...current, [key]: value })); setInvalidField(null); setError(''); setSuccess(false); }} />
      <div className="settings-save-bar"><p role="status">{saving ? t('ننتظر تأكيد الحفظ من الخادم...', 'Waiting for the server to confirm the save...') : dirty ? t('لديك تعديلات لم تُحفظ بعد.', 'You have unsaved changes.') : saved.profile_complete ? t('البيانات المطلوبة محفوظة ومكتملة.', 'Your required information is saved and complete.') : t('أكمل البيانات المطلوبة ثم احفظ.', 'Complete the required fields, then save.')}</p><Button type="submit" icon={<Save size={17} />} isLoading={saving} disabled={!dirty && saved.profile_complete} loadingText={t('جارٍ الحفظ...', 'Saving...')}>{t('حفظ معلوماتي', 'Save my information')}</Button></div>
      {success && <div className="settings-success" role="status" aria-live="polite"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>{t('تم حفظ معلوماتك بنجاح', 'Your information was saved')}</strong><p>{t('أكّد الخادم اكتمال البيانات المطلوبة.', 'The server confirmed that all required information is complete.')}</p></div><Link to="/portal">{t('فتح مساحة العمل', 'Open workspace')}<ArrowUpRight size={16} aria-hidden="true" /></Link></div>}
    </form>
  </>;
}

const SECTIONS: { id: string; icon: ComponentType<{ size?: number }>; ar: string; en: string }[] = [
  { id: 'mset-profile', icon: UserRound, ar: 'معلوماتي', en: 'My information' },
  { id: 'mset-github', icon: GithubMark, ar: 'ربط الكود', en: 'Code linking' },
  { id: 'mset-telegram', icon: Send, ar: 'تيليجرام', en: 'Telegram' },
  { id: 'mset-security', icon: KeyRound, ar: 'كلمة المرور', en: 'Password' },
  { id: 'mset-danger', icon: Trash2, ar: 'حذف الحساب', en: 'Delete account' },
];

function SectionBlock({ id, index, title, description, children }: { id: string; index: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="mset-block settings-reveal" aria-labelledby={`${id}-title`}>
      <header className="mset-block-head">
        <span className="mset-block-index" aria-hidden="true">{index}</span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export default function MemberSettingsPage() {
  const { t, dir } = useLocale();
  const profile = useMemberProfile();
  const github = useGithubLinkState();
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>('mset-profile');
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

  useEffect(() => {
    if (!ready) return;
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target.id) setActive(visible.target.id);
    }, { rootMargin: '-30% 0px -55% 0px', threshold: 0 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ready]);

  const jump = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  }, []);

  const complete = profile.data?.profile_complete ?? false;
  const githubLinked = github.data?.linked === true;

  return <div ref={root} dir={dir} className="member-settings-page member-settings-page--embedded">
    <div className="member-settings-main">
      <header className="mset-hero settings-reveal">
        <div className="mset-hero-copy">
          <span className="settings-eyebrow">PHANTOMS / {t('حسابي', 'MY ACCOUNT')}</span>
          <h1>{t('الإعدادات', 'Settings')}</h1>
          <p>{t('كل حاجة عن حسابك في مكان واحد: بياناتك، ربط الكود، تيليجرام والأمان.', 'Everything about your account in one place: your details, code linking, Telegram and security.')}</p>
          <div className="mset-hero-chips">
            <span className={`mset-chip ${complete ? 'is-on' : 'is-warn'}`}>
              <ShieldCheck size={14} aria-hidden="true" />
              {complete ? t('البيانات مكتملة', 'Details complete') : t('بيانات ناقصة', 'Details missing')}
            </span>
            <span className={`mset-chip ${githubLinked ? 'is-on' : 'is-off'}`}>
              <GithubMark size={14} />
              {githubLinked ? `@${github.data?.handle ?? ''}` : t('الكود مش مربوط', 'Code not linked')}
            </span>
          </div>
        </div>
        <div className="mset-hero-actions">
          {complete && <Link to="/portal" className="mset-hero-link">{t('مساحة العمل', 'Workspace')}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
          <Link to="/download" className="mset-hero-link">{t('تطبيق الموبايل', 'Mobile app')}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </header>

      {profile.isPending || !profile.isFetchedAfterMount ? <PhantomLoader message={t('بنحمّل معلوماتك...', 'Loading your information...')} /> : profile.isError || !profile.data ? <ErrorState message={t('تعذّر تحميل معلوماتك. أعد المحاولة؛ لم تتغير بيانات حسابك.', 'Your information could not be loaded. Retry; your account details have not changed.')} onRetry={() => { void profile.refetch(); }} /> : <div className="mset-grid">
        <aside className="mset-side settings-reveal" aria-label={t('تنقل سريع في الإعدادات', 'Settings navigation')}>
          <div className="mset-id">
            <div className="mset-id-mark" aria-hidden="true">{profile.data.full_name.trim().slice(0, 1) || <UserRound size={24} />}</div>
            <div className="mset-id-copy">
              <h2>{profile.data.full_name}</h2>
              <p dir="ltr">{profile.data.email}</p>
            </div>
          </div>
          <div className={`settings-status ${complete ? 'is-complete' : ''}`}>
            <ShieldCheck size={17} aria-hidden="true" />
            {complete ? t('معلوماتك مكتملة', 'Information complete') : t('معلومات مطلوبة', 'Information required')}
          </div>
          <nav className="mset-nav" aria-label={t('أقسام الإعدادات', 'Settings sections')}>
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button key={section.id} type="button" className="mset-nav-item" data-active={active === section.id} aria-current={active === section.id ? 'true' : undefined} onClick={() => jump(section.id)}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{t(section.ar, section.en)}</span>
                  {section.id === 'mset-github' && <span className="mset-nav-dot" data-on={githubLinked} aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
          <div className="settings-security">
            <LockKeyhole size={19} aria-hidden="true" />
            <h3>{t('أمان الحساب', 'Account security')}</h3>
            <p>{t('استعادة كلمة المرور تتم عبر البريد المسجل أو رابط إدارة آمن.', 'Recover your password through your registered email or a secure administrator link.')}</p>
            <Link to="/forgot-password">{t('استعادة كلمة المرور', 'Password recovery')}<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </aside>

        <div className="mset-column">
          <SectionBlock id="mset-profile" index="01" title={t('معلوماتي', 'My information')} description={t('البيانات دي بتظهر للإدارة وأعضاء تيمك، وكل حقولها إلزامية.', 'These details are visible to the admins and your team, and every field is required.')}>
            <SettingsForm key={`${profile.data.member_id}:${profile.data.email}`} initial={profile.data} />
          </SectionBlock>

          <SectionBlock id="mset-github" index="02" title={t('ربط الكود', 'Code linking')} description={t('لينك GitHub هو مصدر مساهماتك وأفاتارك في الداشبورد.', 'Your GitHub link powers your contributions and avatar across the dashboard.')}>
            <MemberGithubCard />
          </SectionBlock>

          <SectionBlock id="mset-telegram" index="03" title={t('تيليجرام', 'Telegram')} description={t('اربط تيليجرام عشان الإشعارات والمهام توصلك على طول.', 'Link Telegram so notifications and tasks reach you instantly.')}>
            <MemberTelegramCard />
          </SectionBlock>

          <SectionBlock id="mset-security" index="04" title={t('كلمة المرور', 'Password')} description={t('غيّر كلمة المرور بشكل دوري، واستخدم كلمة قوية مش مستخدمة في مكان تاني.', 'Rotate your password regularly and use a strong one you do not reuse elsewhere.')}>
            <MemberPasswordCard />
          </SectionBlock>

          <SectionBlock id="mset-danger" index="05" title={t('حذف الحساب', 'Delete account')} description={t('إجراء نهائي — بيتشال معاه وصولك لكل حاجة في PHANTOMS.', 'A permanent action — it removes your access to everything in PHANTOMS.')}>
            <MemberDangerZone />
          </SectionBlock>
        </div>
      </div>}
    </div>
  </div>;
}
