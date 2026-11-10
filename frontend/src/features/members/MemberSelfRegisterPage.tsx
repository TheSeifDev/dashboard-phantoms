import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Lock, ShieldAlert, ShieldCheck, UserCheck } from 'lucide-react';
import type { MemberCustomField } from '../../types/db';
import {
  fetchMemberInviteContext,
  submitMemberRegistrationInvite,
} from './memberInviteApi';
import type { MemberInviteContext, MemberSelfRegistrationPayload } from './memberInviteApi';
import { Button } from '../../components/ui/Button';
import { isValidEgyptianPhone, isValidEmail, sanitizeText } from '../../lib/validators';
import { handleSupabaseError } from '../../lib/errorHandler';

const DEVICE_OPTIONS = [
  'لابتوب',
  'كمبيوتر مكتبي (PC)',
  'لابتوب، هاتف محمول',
  'لابتوب، جهاز لوحي، هاتف محمول',
  'هاتف محمول',
  'بدون جهاز',
] as const;

export default function MemberSelfRegisterPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<MemberInviteContext | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<MemberSelfRegistrationPayload>({
    full_name: '',
    email: '',
    phone: '',
    residence: '',
    work_conditions: '',
    device: 'لابتوب',
    gender: '',
    bio: '',
    can_go_alexandria: false,
    custom_fields: {},
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchMemberInviteContext(token)
      .then((res) => {
        if (active) {
          setContext(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setContext({ valid: false, reason: 'INVALID_TOKEN', custom_fields: [] });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const updateCustomField = (field: MemberCustomField, val: string | number | boolean | null) => {
    setForm((prev) => {
      const nextCustom = { ...prev.custom_fields };
      if (val === null || val === '') {
        delete nextCustom[String(field.id)];
      } else {
        nextCustom[String(field.id)] = val;
      }
      return { ...prev, custom_fields: nextCustom };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const cleanName = sanitizeText(form.full_name.trim());
    const cleanEmail = form.email.trim().toLowerCase();
    const cleanPhone = form.phone.trim();
    const cleanResidence = sanitizeText(form.residence.trim());

    if (!cleanName || cleanName.length < 3) {
      setError('اكتب الاسم الكامل بشكل صحيح (ثلاثي أو ثنائي على الأقل).');
      return;
    }

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setError('اكتب بريد إلكتروني صحيح عشان هتستخدمه في تسجيل الدخول بعد كده.');
      return;
    }

    if (!cleanPhone || !isValidEgyptianPhone(cleanPhone)) {
      setError('اكتب رقم هاتف مصري صحيح يبدأ بـ 01 أو +20.');
      return;
    }

    if (!form.gender) {
      setError('اختر الجنس من القائمة.');
      return;
    }

    if (!cleanResidence) {
      setError('اكتب محل الإقامة / المحافظة.');
      return;
    }

    const customFields = context?.custom_fields ?? [];
    for (const field of customFields) {
      if (field.is_required) {
        const v = form.custom_fields[String(field.id)];
        if (v === undefined || v === null || String(v).trim() === '') {
          setError(`يرجى استكمال حقل «${field.label}».`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      await submitMemberRegistrationInvite(token, {
        ...form,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        residence: cleanResidence,
        work_conditions: sanitizeText(form.work_conditions.trim()),
        bio: sanitizeText(form.bio.trim()),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderCustomFieldInput = (field: MemberCustomField) => {
    const currentVal = form.custom_fields[String(field.id)];

    if (field.field_type === 'select') {
      return (
        <select
          required={field.is_required}
          value={currentVal !== undefined && currentVal !== null ? String(currentVal) : ''}
          onChange={(e) => updateCustomField(field, e.target.value || null)}
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
        >
          <option value="">— اختر —</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (field.field_type === 'yes_no') {
      const strVal =
        currentVal === true ? 'true' : currentVal === false ? 'false' : '';
      return (
        <select
          required={field.is_required}
          value={strVal}
          onChange={(e) => {
            const v = e.target.value;
            updateCustomField(field, v === 'true' ? true : v === 'false' ? false : null);
          }}
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
        >
          <option value="">— اختر —</option>
          <option value="true">نعم</option>
          <option value="false">لا</option>
        </select>
      );
    }

    if (field.field_type === 'long_text') {
      return (
        <textarea
          rows={3}
          required={field.is_required}
          placeholder={field.placeholder || undefined}
          value={currentVal !== undefined && currentVal !== null ? String(currentVal) : ''}
          onChange={(e) => updateCustomField(field, e.target.value)}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-base font-normal text-[var(--text)]"
        />
      );
    }

    const inputType =
      field.field_type === 'number'
        ? 'number'
        : field.field_type === 'date'
        ? 'date'
        : 'text';

    return (
      <input
        type={inputType}
        required={field.is_required}
        placeholder={field.placeholder || undefined}
        value={currentVal !== undefined && currentVal !== null ? String(currentVal) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (field.field_type === 'number') {
            updateCustomField(field, raw === '' ? null : Number(raw));
          } else {
            updateCustomField(field, raw);
          }
        }}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
      />
    );
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-4" dir="rtl">
        <div className="grid place-items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-sm)]">
          <span className="size-10 animate-pulse rounded-full bg-[var(--primary-soft)]" />
          <p className="text-sm font-bold text-[var(--text-muted)]">
            بنتحقق من صلاحية وتشفير رابط الدعوة...
          </p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-4" dir="rtl">
        <div className="grid w-full max-w-lg gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-right shadow-[var(--shadow-sm)] sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
              <CheckCircle2 size={26} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-black text-[var(--text)]">تم تسجيل بياناتك بنجاح</h1>
              <p className="text-xs text-[var(--text-muted)]">
                أهلاً بك في فريق PHANTOMS — تم استلام بياناتك لدى الإدارة وحفظها بالكامل.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-xs leading-6 text-[var(--text-2)]">
            <p className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <Lock size={14} aria-hidden="true" />
              تم إغلاق رابط التسجيل تلقائياً
            </p>
            <p className="mt-1">
              لأسباب أمنية، هذا الرابط مخصص للاستخدام مرة واحدة فقط وقد تم إبطاله الآن بعد حفظ بياناتك.
              تقدر تسجّل دخولك لبوابة الأعضاء باستخدام بريدك الإلكتروني ({form.email}).
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" onClick={() => navigate('/login')}>
              الانتقال إلى صفحة تسجيل الدخول
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (!context?.valid) {
    const reason = context?.reason ?? 'INVALID_TOKEN';
    const reasonText =
      reason === 'ALREADY_USED'
        ? 'الرابط ده تم استخدامه بالفعل لتسجيل عضو، واتقفل تلقائياً لأن كل رابط صالح لمرة واحدة فقط.'
        : reason === 'EXPIRED'
        ? 'انتهت المهلة الزمنية المحددة لهذا الرابط. تواصل مع إدارة الفريق لإرسال رابط جديد.'
        : 'رابط التسجيل غير صحيح أو تم إلغاؤه من الإدارة.';

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-4" dir="rtl">
        <div className="grid w-full max-w-lg gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-right shadow-[var(--shadow-sm)] sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-red-100 text-[var(--danger)]">
              <ShieldAlert size={26} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-black text-[var(--text)]">الرابط غير متاح للاستخدام</h1>
              <p className="text-xs text-[var(--text-muted)]">حماية روابط الدعوة في نظام PHANTOMS</p>
            </div>
          </div>

          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm leading-7 text-[var(--text-2)]">
            {reasonText}
          </p>

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => navigate('/login')}>
              الذهاب إلى بوابة الدخول
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const customFields = context.custom_fields ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 sm:py-12" dir="rtl">
      <div className="mx-auto grid w-full max-w-2xl gap-5">
        {/* Header Card */}
        <header className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary-soft)] px-3 py-1 text-xs font-bold text-[var(--link)]">
              <ShieldCheck size={15} aria-hidden="true" />
              رابط دعوة مشفر صالح لمرة واحدة فقط
            </span>
            {context.note && (
              <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-bold text-[var(--text-2)]">
                {context.note}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-black text-[var(--text)] sm:text-2xl">
              استمارة تسجيل عضو جديد — فريق PHANTOMS
            </h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              املا بياناتك الكاملة بدقة. بمجرد الضغط على «تأكيد وتسجيل بياناتي» هيتسجّل حسابك في الفريق ويتقفل الرابط ده نهائياً.
            </p>
          </div>
        </header>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="grid gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] sm:p-6"
          noValidate
        >
          {error && (
            <p
              className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-sm font-bold text-red-900"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>الاسم الكامل *</span>
              <input
                type="text"
                required
                placeholder="اكتب اسمك الثلاثي"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>البريد الإلكتروني (لتسجيل الدخول) *</span>
              <input
                type="email"
                dir="ltr"
                required
                placeholder="example@gmail.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>رقم الهاتف / واتساب (01xxxxxxxxx) *</span>
              <input
                type="tel"
                dir="ltr"
                required
                placeholder="01xxxxxxxxx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>الجنس *</span>
              <select
                required
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              >
                <option value="">— اختر —</option>
                <option value="ذكر">ذكر</option>
                <option value="أنثى">أنثى</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>محل الإقامة / المدينة *</span>
              <input
                type="text"
                required
                placeholder="مثال: الإسكندرية - سموحة"
                value={form.residence}
                onChange={(e) => setForm({ ...form, residence: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              <span>الجهاز المتوفر للشغل *</span>
              <select
                value={form.device}
                onChange={(e) => setForm({ ...form, device: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              >
                {DEVICE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)] sm:col-span-2">
              <span>ظروف العمل أو الدراسة والتفرغ</span>
              <input
                type="text"
                placeholder="مثال: طالب متفرغ / شغال بدوام جزئي"
                value={form.work_conditions}
                onChange={(e) => setForm({ ...form, work_conditions: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)] sm:col-span-2">
              <span>نبذة عن تخصصك أو دورك ومهاراتك</span>
              <textarea
                rows={3}
                placeholder="اكتب تخصصك ومهاراتك باختصار..."
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-base font-normal text-[var(--text)]"
              />
            </label>
          </div>

          {customFields.length > 0 && (
            <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <div>
                <h2 className="text-sm font-black text-[var(--text)]">بيانات إضافية مطلوبة</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  يرجى استكمال البيانات الإضافية الخاصة بملف العضوية
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {customFields.map((field) => (
                  <label
                    key={field.id}
                    className={`grid gap-1.5 text-sm font-bold text-[var(--text-2)] ${
                      field.field_type === 'long_text' ? 'sm:col-span-2' : ''
                    }`}
                  >
                    <span>
                      {field.label} {field.is_required ? '*' : ''}
                    </span>
                    {renderCustomFieldInput(field)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5 text-sm font-bold text-[var(--text)]">
            <input
              type="checkbox"
              checked={form.can_go_alexandria}
              onChange={(e) => setForm({ ...form, can_go_alexandria: e.target.checked })}
              className="size-4"
            />
            <span>جاهز للنزول الميداني وحضور اجتماعات الإسكندرية عند الحاجة</span>
          </label>

          <div className="flex flex-col-reverse items-center justify-between gap-3 border-t border-[var(--border)] pt-4 sm:flex-row">
            <p className="text-xs text-[var(--text-muted)]">
              بمجرد الحفظ يتم قفل الرابط تلقائياً ولا يمكن تعديله إلا عبر الإدارة.
            </p>
            <Button
              type="submit"
              isLoading={submitting}
              loadingText="بنسجّل بياناتك..."
              icon={<UserCheck size={18} aria-hidden="true" />}
              fullOnMobile
            >
              تأكيد وتسجيل بياناتي
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
