import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Info, ShieldCheck } from 'lucide-react';
import { gsap } from 'gsap';
import { useLocale } from '../../i18n/useLocale';
import { Button } from '../../components/ui/Button';
import { MemberProfileFields } from './MemberProfileFields';
import { EMPTY_MEMBER_PROFILE, validateMemberProfile, type MemberProfileField, type MemberProfileInput } from './profile-fields';
import '../../styles/member-settings.css';

const demoProfile = (complete = false): MemberProfileInput => ({
  ...EMPTY_MEMBER_PROFILE, fullName: 'PHANTOMS Demo', phone: '+201000000000',
  ...(complete ? { academicNumber: '003001', academicGroup: 'G-1', specialization: 'software' } : {}),
});

/** Local form preview only. Deliberately has no auth, profile API or storage imports. */
export default function MemberExperiencePreviewPage() {
  const { t, dir } = useLocale();
  const [profile, setProfile] = useState(demoProfile);
  const [invalid, setInvalid] = useState<MemberProfileField | null>(null);
  const [feedback, setFeedback] = useState<'invalid' | 'validated' | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (invalid) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalid]);
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(root.current!.querySelectorAll('.settings-reveal'), { y: 12, autoAlpha: 0, duration: .4, stagger: .06, clearProps: 'all' });
    });
    return () => media.revert();
  }, []);
  const reset = (complete: boolean) => { setProfile(demoProfile(complete)); setInvalid(null); setFeedback(null); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateMemberProfile(profile);
    if (!result.ok) { setInvalid(result.field); setFeedback('invalid'); return; }
    setProfile(result.profile); setInvalid(null); setFeedback('validated');
  };
  return <section ref={root} dir={dir} className="grid min-w-0 gap-5" aria-label={t('معاينة واجهة العضو', 'Member experience preview')}>
    <div className="settings-title-row"><div><span className="settings-eyebrow">PHANTOMS / PREVIEW</span><h1>{t('شوف وجرب معلومات العضو', 'See and try member information')}</h1><p>{t('نفس الحقول والتحقق — من غير تغيير أي حساب حقيقي.', 'The same fields and validation — without changing a real account.')}</p></div><Link to="/admin/members" className="settings-back-link">{t('دليل الأعضاء', 'Member directory')}</Link></div>
    <div className="settings-completion-notice settings-reveal" role="note"><Eye size={22} aria-hidden="true" /><div><strong>{t('معاينة تجريبية فقط، وليست حساب عضو', 'Demo preview only, not a member account')}</strong><p>{t('يمكنك كتابة البيانات وتجربة التحقق. لن تُحفظ معلومات على الخادم، ولن تتغير جلستك أو الصلاحيات، ولن يُرسل بريد أو رابط استعادة.', 'You can enter information and try validation. Nothing is saved to the server, your session and permissions stay unchanged, and no email or recovery link is sent.')}</p></div></div>
    <div className="member-settings-layout">
      <aside className="settings-summary settings-reveal"><ShieldCheck size={28} aria-hidden="true" /><h2>{t('تجربة الاستكمال', 'Try profile completion')}</h2><p className="settings-hint">{t('جرّب عضوًا سابقًا تنقصه بيانات الدراسة، أو بيانات مكتملة. البريد الجامعي يتولّد تلقائيًا ويحافظ على الأصفار الأولية.', 'Try an existing member missing academic details, or a complete profile. University email is derived automatically and preserves leading zeros.')}</p>
        <div className="mt-4 grid gap-2"><Button variant="secondary" onClick={() => reset(false)}>{t('مثال بيانات ناقصة', 'Incomplete example')}</Button><Button variant="secondary" onClick={() => reset(true)}>{t('مثال بيانات مكتملة', 'Complete example')}</Button></div>
        <div className="settings-summary-divider" />
        <h3 className="text-sm font-black">{t('الروابط الحقيقية للأعضاء', 'Actual member routes')}</h3><p className="settings-hint mt-2">{t('Settings تحتاج حساب عضو، وليست حساب Owner. التسجيل يحتاج رابط دعوة صالحًا من الإدارة. الاستعادة تحتاج بريد العضو والتحقق من التسليم؛ لا تستخدمها كتجربة على شخص آخر.', 'Settings requires a member account, not an Owner account. Registration requires a valid administrator invitation. Recovery requires the member email and verified delivery; do not test it on someone else.')}</p>
        <div className="mt-3 grid gap-2 text-sm font-bold text-[var(--link)]">{[['/login', t('دخول العضو', 'Member login')], ['/portal/settings', t('إعدادات العضو', 'Member Settings')], ['/forgot-password', t('نسيت كلمة المرور', 'Forgot password')]].map(([path, label]) => <Link key={path} to={path} target="_blank" rel="noopener noreferrer" className="flex min-h-11 flex-wrap items-center justify-between gap-2"><span>{label}</span><code dir="ltr" className="break-all text-xs">{path}</code></Link>)}</div>
      </aside>
      <form ref={form} onSubmit={submit} noValidate className="settings-form settings-reveal min-w-0">
        <div className="settings-section-heading"><span className="settings-section-number" aria-hidden="true">01</span><div><h2>{t('معلومات العضو — معاينة', 'Member information — preview')}</h2><p>{t('كل البيانات هنا تجريبية. تخصص الملف لا يمنح أي صلاحية أو عضوية فريق.', 'All data here is for demonstration. Profile specialization grants no permissions or team membership.')}</p></div></div>
        <label className="auth-field" htmlFor="preview-email">{t('البريد المسجل (تجريبي) *', 'Registered email (demo) *')}<input id="preview-email" type="email" dir="ltr" readOnly value="preview@example.com" /></label>
        {feedback === 'invalid' && <div id="preview-error" role="alert" className="auth-error">{t('راجع الحقل المحدد. بيانات الدراسة والاسم وWhatsApp والتخصص مطلوبة؛ الروابط اختيارية ويجب أن تكون HTTPS صحيحة.', 'Check the highlighted field. Academic details, name, WhatsApp and specialization are required; optional links must use valid HTTPS.')}</div>}
        <MemberProfileFields idPrefix="preview" profile={profile} invalidField={invalid} errorId="preview-error" onChange={(key, value) => { setProfile((current) => ({ ...current, [key]: value })); setInvalid(null); setFeedback(null); }} />
        <div className="settings-save-bar"><p>{t('التحقق محلي فقط — لا يوجد حفظ على الخادم.', 'Local validation only — no server save.')}</p><Button type="submit">{t('تجربة التحقق والحفظ محليًا', 'Try validation locally')}</Button></div>
        {feedback === 'validated' && <div className="settings-success" role="status"><Info size={20} aria-hidden="true" /><div><strong>{t('نجح التحقق في المعاينة فقط', 'Preview validation passed')}</strong><p>{t('لم يُحفظ أو يتغير أي عضو حقيقي.', 'No real member was saved or changed.')}</p></div></div>}
      </form>
    </div>
  </section>;
}
