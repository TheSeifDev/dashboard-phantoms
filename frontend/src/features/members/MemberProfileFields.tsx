import type { ChangeEvent } from 'react';
import { useLocale } from '../../i18n/useLocale';
import {
  MEMBER_DEVICE_OPTIONS,
  MEMBER_GENDER_OPTIONS,
  MEMBER_SPECIALIZATION_OPTIONS,
  deriveMemberUniversityEmail,
  type MemberProfileField,
  type MemberProfileInput,
} from './profile-fields';

export interface MemberProfileFieldsProps {
  profile: MemberProfileInput;
  onChange: (key: MemberProfileField, value: string) => void;
  disabled?: boolean;
  invalidField?: MemberProfileField | null;
  errorId?: string;
  idPrefix?: string;
}

export function getMemberProfileFieldId(field: MemberProfileField, idPrefix = 'member-profile'): string {
  const suffix = {
    fullName: 'full-name',
    phone: 'phone',
    residence: 'residence',
    workConditions: 'work-conditions',
    bio: 'bio',
    device: 'device',
    gender: 'gender',
    academicNumber: 'academic-number',
    academicGroup: 'academic-group',
    specialization: 'specialization',
    linkedinUrl: 'linkedin-url',
    portfolioUrl: 'portfolio-url',
  }[field];
  return `${idPrefix}-${suffix}`;
}

const deviceEnglish: Record<string, string> = {
  'لابتوب': 'Laptop',
  'كمبيوتر مكتبي (PC)': 'Desktop computer (PC)',
  'بدون جهاز': 'No device',
  'هاتف محمول': 'Mobile phone',
  'لابتوب، هاتف محمول': 'Laptop, mobile phone',
  'لابتوب، جهاز لوحي، هاتف محمول': 'Laptop, tablet, mobile phone',
};

const genderEnglish: Record<string, string> = { ذكر: 'Male', أنثى: 'Female' };
const specializationEnglish: Record<string, string> = { software: 'Software', hardware: 'Hardware', ai: 'AI' };
const specializationArabic: Record<string, string> = { software: 'برمجيات', hardware: 'هاردوير', ai: 'ذكاء اصطناعي' };

export function MemberProfileFields({
  profile,
  onChange,
  disabled = false,
  invalidField = null,
  errorId,
  idPrefix = 'member-profile',
}: MemberProfileFieldsProps) {
  const { t } = useLocale();

  const update = (key: MemberProfileField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onChange(key, event.target.value);
  };
  const fieldProps = (field: MemberProfileField) => ({
    id: getMemberProfileFieldId(field, idPrefix),
    name: field,
    value: profile[field],
    disabled,
    onChange: update(field),
    'aria-invalid': invalidField === field || undefined,
    'aria-describedby': invalidField === field ? errorId : undefined,
  });
  const requiredMark = t(' *', ' *');

  return (
    <section className="profile-fields grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5" aria-labelledby={`${idPrefix}-heading`}>
      <div>
        <h2 id={`${idPrefix}-heading`} className="text-sm font-black text-[var(--text)]">{t('بيانات الدراسة والتواصل', 'Academic & contact details')}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('الحقول بعلامة * مطلوبة لاستكمال معلوماتك.', 'Fields marked * are required to complete your information.')}</p>
      </div>

      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="mb-1 text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">{t('المعلومات المطلوبة', 'Required information')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="auth-field" htmlFor={getMemberProfileFieldId('fullName', idPrefix)}>{t('الاسم الكامل', 'Full name')}{requiredMark}
            <input {...fieldProps('fullName')} type="text" dir="auto" autoComplete="name" required maxLength={160} />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('phone', idPrefix)}>{t('رقم الهاتف (WhatsApp)', 'WhatsApp phone number')}{requiredMark}
            <input {...fieldProps('phone')} type="tel" dir="ltr" autoComplete="tel" required maxLength={32} placeholder="+20 ..." />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('academicNumber', idPrefix)}>{t('الرقم الأكاديمي', 'Academic number')}{requiredMark}
            <input {...fieldProps('academicNumber')} type="text" dir="ltr" inputMode="numeric" autoComplete="off" required maxLength={32} />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('academicGroup', idPrefix)}>{t('المجموعة الأكاديمية', 'Academic group')}{requiredMark}
            <input {...fieldProps('academicGroup')} type="text" dir="auto" autoComplete="organization-title" required maxLength={80} />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('specialization', idPrefix)}>{t('التخصص', 'Specialization')}{requiredMark}
            <select {...fieldProps('specialization')} required>
              <option value="">{t('— اختر التخصص —', '— Choose specialization —')}</option>
              {MEMBER_SPECIALIZATION_OPTIONS.map((option) => <option key={option} value={option}>{t(specializationArabic[option], specializationEnglish[option])}</option>)}
            </select>
          </label>
          <label className="auth-field" htmlFor={`${idPrefix}-university-email`}>{t('البريد الجامعي *', 'University email *')}
            <input id={`${idPrefix}-university-email`} type="email" dir="ltr" readOnly value={deriveMemberUniversityEmail(profile.academicNumber)} placeholder={t('يظهر بعد إدخال الرقم الأكاديمي', 'Appears after entering the academic number')} aria-readonly="true" />
          </label>
        </div>
        <p className="text-xs leading-5 text-[var(--text-muted)]">{t('البريد الجامعي = الرقم الأكاديمي + @batechu.com؛ يحسبه الخادم تلقائياً دون تغيير بريد الدخول.', 'University email = academic number + @batechu.com. The server derives it without changing your sign-in email.')}</p>
      </fieldset>

      <fieldset className="grid gap-3 border-0 border-t border-[var(--border-subtle)] p-0 pt-3">
        <legend className="mb-1 text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">{t('روابطك المهنية', 'Professional links')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="auth-field" htmlFor={getMemberProfileFieldId('linkedinUrl', idPrefix)}>{t('LinkedIn (اختياري)', 'LinkedIn (optional)')}
            <input {...fieldProps('linkedinUrl')} type="url" dir="ltr" autoComplete="url" maxLength={2048} placeholder="https://www.linkedin.com/in/..." />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('portfolioUrl', idPrefix)}>{t('GitHub / Portfolio / Behance (اختياري)', 'GitHub / Portfolio / Behance (optional)')}
            <input {...fieldProps('portfolioUrl')} type="url" dir="ltr" autoComplete="url" maxLength={2048} placeholder="https://example.com" />
          </label>
        </div>
      </fieldset>

      <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-black text-[var(--text-2)]">{t('معلومات إضافية (اختياري)', 'Additional information (optional)')}</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="auth-field" htmlFor={getMemberProfileFieldId('residence', idPrefix)}>{t('محل الإقامة (اختياري)', 'Residence (optional)')}
              <input {...fieldProps('residence')} type="text" dir="auto" autoComplete="address-level2" maxLength={160} />
            </label>
            <label className="auth-field" htmlFor={getMemberProfileFieldId('device', idPrefix)}>{t('الجهاز المتوفر (اختياري)', 'Available device (optional)')}
              <select {...fieldProps('device')}>
                {profile.device && !MEMBER_DEVICE_OPTIONS.includes(profile.device as (typeof MEMBER_DEVICE_OPTIONS)[number]) && <option value={profile.device} disabled>{t(`قيمة قديمة — عدّلها: ${profile.device}`, `Legacy value — change it: ${profile.device}`)}</option>}
                <option value="">{t('— غير محدد —', '— Not specified —')}</option>
                {MEMBER_DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{t(device, deviceEnglish[device] ?? device)}</option>)}
              </select>
            </label>
            <label className="auth-field" htmlFor={getMemberProfileFieldId('gender', idPrefix)}>{t('الجنس (اختياري)', 'Gender (optional)')}
              <select {...fieldProps('gender')}>
                {profile.gender && !MEMBER_GENDER_OPTIONS.includes(profile.gender as (typeof MEMBER_GENDER_OPTIONS)[number]) && <option value={profile.gender} disabled>{t(`قيمة قديمة — عدّلها: ${profile.gender}`, `Legacy value — change it: ${profile.gender}`)}</option>}
                <option value="">{t('— غير محدد —', '— Not specified —')}</option>
                {MEMBER_GENDER_OPTIONS.map((gender) => <option key={gender} value={gender}>{t(gender, genderEnglish[gender] ?? gender)}</option>)}
              </select>
            </label>
          </div>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('workConditions', idPrefix)}>{t('ظروف العمل أو الدراسة (اختياري)', 'Work or study conditions (optional)')}
            <textarea {...fieldProps('workConditions')} dir="auto" maxLength={2000} rows={3} />
          </label>
          <label className="auth-field" htmlFor={getMemberProfileFieldId('bio', idPrefix)}>{t('نبذة أو الدور (اختياري)', 'Bio or role (optional)')}
            <textarea {...fieldProps('bio')} dir="auto" maxLength={4000} rows={3} />
          </label>
        </div>
      </details>
    </section>
  );
}

export { deriveMemberUniversityEmail };
