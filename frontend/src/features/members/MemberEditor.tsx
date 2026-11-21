import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link2, Plus, Settings2, X } from 'lucide-react';
import type {
  Member,
  MemberCustomField,
  MemberCustomFieldType,
  MemberInsert,
} from '../../types/db';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  getMemberCustomFieldValue,
  useSaveMemberCustomField,
} from './customFieldsApi';
import { parseOptionsText } from './MemberCustomFieldsModal';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import { MemberAcademicDetails, MemberInformationStatus } from './MemberAcademicDetails';

interface Props {
  isOpen: boolean;
  isSaving: boolean;
  member: Member | null;
  value: MemberInsert;
  customFields: MemberCustomField[];
  error: string;
  onChange: (value: MemberInsert) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onManageCustomFields?: () => void;
  onOpenInviteModal?: () => void;
}

export function MemberEditor({
  isOpen,
  isSaving,
  member,
  value,
  customFields,
  error,
  onChange,
  onClose,
  onSubmit,
  onManageCustomFields,
  onOpenInviteModal,
}: Props) {
  const { t, dir } = useLocale();
  const saveCustomField = useSaveMemberCustomField();
  const fieldTypeLabel = (type: MemberCustomFieldType) => t(CUSTOM_FIELD_TYPE_LABELS[type], ({
    short_text: 'Free text (any value)',
    select: 'Choice list',
    number: 'Number',
    yes_no: 'Yes / No',
    date: 'Date',
    long_text: 'Long text / details',
  } as const)[type]);
  const [addingInlineField, setAddingInlineField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<MemberCustomFieldType>('short_text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [inlineFieldError, setInlineFieldError] = useState('');

  const textField = (key: keyof MemberInsert, label: string, type = 'text') => (
    <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
      {label}
      <input
        type={type}
        required={key === 'email' || key === 'full_name'}
        dir={key === 'email' || key === 'phone' ? 'ltr' : undefined}
        value={String(value[key] ?? '')}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
      />
    </label>
  );

  const selectField = (key: keyof MemberInsert, label: string, options: Array<string | { value: string; label: string }>) => (
    <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
      {label}
      <select
        value={String(value[key] ?? '')}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
      >
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return <option key={optionValue} value={optionValue}>{optionLabel || t('— غير محدد —', '— Not specified —')}</option>;
        })}
      </select>
    </label>
  );

  const updateCustomFieldValue = (field: MemberCustomField, nextVal: string | number | boolean | null) => {
    const nextMap = value.custom_fields ? { ...value.custom_fields } : {};
    delete nextMap[field.label];
    if (nextVal === null || nextVal === '') {
      delete nextMap[String(field.id)];
    } else {
      nextMap[String(field.id)] = nextVal;
    }
    onChange({
      ...value,
      custom_fields: nextMap,
    });
  };

  const handleAddInlineField = async () => {
    setInlineFieldError('');
    const cleanLabel = newFieldLabel.trim();
    if (!cleanLabel) {
      setInlineFieldError(t('اكتب عنوان المعلومة الأول (مثال: نوع الثانوية).', 'Enter a field name first (for example: High school type).'));
      return;
    }
    const options = newFieldType === 'select' ? parseOptionsText(newFieldOptions) : [];
    if (newFieldType === 'select' && options.length === 0) {
      setInlineFieldError(t('اكتب الاختيارات المتاحة مفصولة بفاصلة.', 'Enter the available choices, separated by commas.'));
      return;
    }

    try {
      await saveCustomField.mutateAsync({
        field: {
          label: cleanLabel,
          field_type: newFieldType,
          options,
          placeholder: '',
          show_in_card: true,
          is_required: false,
          is_active: true,
          sort_order: customFields.length,
        },
      });
      toast.success(t(`اتضاف حقل «${cleanLabel}» لكل الأعضاء.`, `Added “${cleanLabel}” for all members.`));
      setNewFieldLabel('');
      setNewFieldType('short_text');
      setNewFieldOptions('');
      setAddingInlineField(false);
    } catch (cause) {
      setInlineFieldError(handleSupabaseError(cause).message);
    }
  };

  const renderCustomInput = (field: MemberCustomField) => {
    const currentVal = getMemberCustomFieldValue(value, field);

    if (field.field_type === 'select') {
      const strVal = currentVal !== null && currentVal !== undefined ? String(currentVal) : '';
      const allOptions = strVal && !field.options.includes(strVal)
        ? [strVal, ...field.options]
        : field.options;
      return (
        <select
          value={strVal}
          onChange={(e) => updateCustomFieldValue(field, e.target.value || null)}
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
        >
          <option value="">{t('— اختر —', '— Select —')}</option>
          {allOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (field.field_type === 'yes_no') {
      const strVal =
        currentVal === true || currentVal === 'true' || currentVal === 'نعم'
          ? 'true'
          : currentVal === false || currentVal === 'false' || currentVal === 'لا'
          ? 'false'
          : '';
      return (
        <select
          value={strVal}
          onChange={(e) => {
            const v = e.target.value;
            updateCustomFieldValue(field, v === 'true' ? true : v === 'false' ? false : null);
          }}
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
        >
          <option value="">{t('— غير محدد —', '— Not specified —')}</option>
          <option value="true">{t('نعم', 'Yes')}</option>
          <option value="false">{t('لا', 'No')}</option>
        </select>
      );
    }

    if (field.field_type === 'long_text') {
      return (
        <textarea
          rows={2}
          placeholder={field.placeholder || undefined}
          value={currentVal !== null && currentVal !== undefined ? String(currentVal) : ''}
          onChange={(e) => updateCustomFieldValue(field, e.target.value)}
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
        placeholder={field.placeholder || undefined}
        value={currentVal !== null && currentVal !== undefined ? String(currentVal) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (field.field_type === 'number') {
            updateCustomFieldValue(field, raw === '' ? null : Number(raw));
          } else {
            updateCustomFieldValue(field, raw);
          }
        }}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
      />
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={member ? t('تعديل بيانات العضو', 'Edit member') : t('إضافة عضو جديد', 'Add a member')} maxWidth="lg">
      <form onSubmit={onSubmit} className="grid gap-4" dir={dir} noValidate>
        {!member && onOpenInviteModal && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-[var(--text)]">
                {t('عايز العضو يملا بياناته بنفسه؟', 'Would you like the member to enter their own details?')}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-2)]">
                {t('بدل الإدخال اليدوي، ولّد رابط دعوة عشوائي محمي وابعته للعضو يسجّل بيه بياناته كاملة.', 'Instead of entering details manually, generate a secure invitation link so the member can register their details.')}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenInviteModal}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white hover:opacity-95"
            >
              <Link2 size={14} aria-hidden="true" />
              {t('توليد رابط تسجيل للعضو', 'Generate member registration link')}
            </button>
          </div>
        )}

        {error && (
          <p
            className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {textField('full_name', t('الاسم الكامل', 'Full name'))}
          {textField('email', t('البريد الإلكتروني', 'Email'), 'email')}
          {textField('phone', t('رقم الهاتف (01xxxxxxxxx)', 'Phone number (01xxxxxxxxx)'), 'tel')}
          {textField('work_conditions', t('ظروف العمل', 'Work conditions'))}
          {selectField('device', t('الجهاز المتوفر', 'Available device'), [
            { value: 'لابتوب', label: t('لابتوب', 'Laptop') },
            { value: 'كمبيوتر مكتبي (PC)', label: t('كمبيوتر مكتبي (PC)', 'Desktop computer (PC)') },
            { value: 'بدون جهاز', label: t('بدون جهاز', 'No device') },
            { value: 'هاتف محمول', label: t('هاتف محمول', 'Mobile phone') },
            { value: 'لابتوب، هاتف محمول', label: t('لابتوب، هاتف محمول', 'Laptop, mobile phone') },
            { value: 'لابتوب، جهاز لوحي، هاتف محمول', label: t('لابتوب، جهاز لوحي، هاتف محمول', 'Laptop, tablet, mobile phone') },
          ])}
          {textField('residence', t('محل الإقامة', 'Residence'))}
          {selectField('gender', t('الجنس', 'Gender'), [
            { value: '', label: t('— غير محدد —', '— Not specified —') },
            { value: 'ذكر', label: t('ذكر', 'Male') },
            { value: 'أنثى', label: t('أنثى', 'Female') },
          ])}
          {selectField('work_status', t('حالة الحساب', 'Account status'), [
            { value: 'active', label: t('active', 'Active') },
            { value: 'inactive', label: t('inactive', 'Inactive') },
          ])}
        </div>

        {textField('bio', t('نبذة / الدور', 'Bio / role'))}

        {/* Dynamic Custom Fields Section */}
        <section className="grid min-w-0 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5" aria-label={t('معلومات العضو المطلوبة', 'Required member information')}>
          <h3 className="text-sm font-black text-[var(--text)]">{t('الدراسة والتخصص والروابط', 'Academic details, specialization and links')}</h3>
          <p className="text-xs leading-6 text-[var(--text-muted)]">{t('العضو يستكمل هذه المعلومات بنفسه من الإعدادات بعد دخوله. التخصص منفصل عن عضوية الفرق وصلاحيات الإدارة.', 'Members complete this information in their Settings after signing in. Specialization is separate from team membership and administrator permissions.')}</p>
          {member ? <><div><MemberInformationStatus member={member} /></div><MemberAcademicDetails member={member} showSpecialization /></> : <p className="text-xs leading-6 text-[var(--text-muted)]">{t('الإضافة اليدوية تنشئ سجلًا تمهيديًا غير مكتمل، وليست تسجيل العضو. رابط التسجيل يطلب جميع البيانات الإلزامية قبل الإرسال.', 'Manual entry creates an incomplete provisional record, not member registration. The registration link requires all mandatory information before submission.')}</p>}
        </section>

        <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-black text-[var(--text)]">{t('بيانات إضافية مخصصة', 'Custom additional details')}</h4>
              <p className="text-xs text-[var(--text-muted)]">
                {t('ضيف أي خانة جديدة (زي: نوع الثانوية، الكلية، إلخ) وهتظهر لكل الأعضاء تلقائياً', 'Add a field (such as high school type or college) and it will appear for all members.')}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setInlineFieldError('');
                  setAddingInlineField((prev) => !prev);
                }}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[var(--primary-soft)] px-2.5 text-xs font-bold text-[var(--link)] hover:bg-[var(--primary)] hover:text-white"
              >
                {addingInlineField ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                {addingInlineField ? t('إغلاق', 'Close') : t('إضافة معلومة جديدة', 'Add a new field')}
              </button>
              {onManageCustomFields && (
                <button
                  type="button"
                  onClick={onManageCustomFields}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)]"
                  title={t('إدارة وتعديل الحقول المخصصة', 'Manage custom fields')}
                >
                  <Settings2 size={14} aria-hidden="true" />
                  {t('إدارة الحقول', 'Manage fields')}
                </button>
              )}
            </div>
          </div>

          {/* Inline quick-add field box */}
          {addingInlineField && (
            <div className="grid gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              {inlineFieldError && (
                <p className="text-xs font-bold text-[var(--danger)]" role="alert">
                  {inlineFieldError}
                </p>
              )}
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-[var(--text-2)]">
                  {t('اسم المعلومة الجديدة', 'New field name')}
                  <input
                    type="text"
                    placeholder={t('مثال: نوع الثانوية', 'Example: High school type')}
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm font-normal text-[var(--text)]"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-[var(--text-2)]">
                  {t('طريقة الإدخال', 'Input type')}
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as MemberCustomFieldType)}
                    className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm font-normal text-[var(--text)]"
                  >
                    {(Object.keys(CUSTOM_FIELD_TYPE_LABELS) as MemberCustomFieldType[]).map((type) => (
                      <option key={type} value={type}>
                        {fieldTypeLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {newFieldType === 'select' && (
                <label className="grid gap-1 text-xs font-bold text-[var(--text-2)]">
                  {t('الاختيارات المتاحة (افصل بينها بفاصلة «،»)', 'Available choices (separate with commas)')}
                  <input
                    type="text"
                    placeholder={t('مثال: ثانوي عام، ثانوي أزهري، فني / صناعي، STEM', 'Example: General, Azhar, technical / industrial, STEM')}
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm font-normal text-[var(--text)]"
                  />
                </label>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    void handleAddInlineField();
                  }}
                  isLoading={saveCustomField.isPending}
                  loadingText={t('بنضيف...', 'Adding...')}
                  icon={<Plus size={15} aria-hidden="true" />}
                >
                  {t('تثبيت الحقل لكل الأعضاء', 'Add field for all members')}
                </Button>
              </div>
            </div>
          )}

          {customFields.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {customFields.map((field) => (
                <label
                  key={field.id}
                  className={`grid gap-1.5 text-sm font-bold text-[var(--text-2)] ${
                    field.field_type === 'long_text' ? 'md:col-span-2' : ''
                  }`}
                >
                  <span>{field.label}</span>
                  {renderCustomInput(field)}
                </label>
              ))}
            </div>
          ) : (
            !addingInlineField && (
              <p className="text-xs text-[var(--text-muted)]">
                {t('مفيش حقول مخصصة مضافة لسه. اضغط «إضافة معلومة جديدة» لإضافة أي بيان جديد بدون تعديل الكود.', 'No custom fields yet. Select “Add a new field” to add one without changing the code.')}
              </p>
            )
          )}
        </div>

        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-bold">
          <input
            type="checkbox"
            checked={value.can_go_alexandria}
            onChange={(event) => onChange({ ...value, can_go_alexandria: event.target.checked })}
          />
          {t('جاهز للنزول الميداني واجتماعات الإسكندرية', 'Available for field work and Alexandria meetings')}
        </label>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>
            {t('إلغاء', 'Cancel')}
          </Button>
          <Button type="submit" isLoading={isSaving} loadingText={t('بنحفظ...', 'Saving...')} fullOnMobile>
            {member ? t('حفظ التعديلات', 'Save changes') : t('إضافة العضو', 'Add member')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
