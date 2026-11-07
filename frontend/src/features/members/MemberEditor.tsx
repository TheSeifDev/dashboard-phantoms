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
  const saveCustomField = useSaveMemberCustomField();
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

  const selectField = (key: keyof MemberInsert, label: string, options: string[]) => (
    <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
      {label}
      <select
        value={String(value[key] ?? '')}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base font-normal text-[var(--text)]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option || '— غير محدد —'}
          </option>
        ))}
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
      setInlineFieldError('اكتب عنوان المعلومة الأول (مثال: نوع الثانوية).');
      return;
    }
    const options = newFieldType === 'select' ? parseOptionsText(newFieldOptions) : [];
    if (newFieldType === 'select' && options.length === 0) {
      setInlineFieldError('اكتب الاختيارات المتاحة مفصولة بفاصلة.');
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
      toast.success(`اتضاف حقل «${cleanLabel}» لكل الأعضاء.`);
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
          <option value="">— اختر —</option>
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
          <option value="">— غير محدد —</option>
          <option value="true">نعم</option>
          <option value="false">لا</option>
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
    <Modal isOpen={isOpen} onClose={onClose} title={member ? 'تعديل بيانات العضو' : 'إضافة عضو جديد'} maxWidth="lg">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {!member && onOpenInviteModal && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-[var(--text)]">
                عايز العضو يملا بياناته بنفسه؟
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-2)]">
                بدل الإدخال اليدوي، ولّد رابط دعوة عشوائي محمي وابعته للعضو يسجّل بيه بياناته كاملة.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenInviteModal}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-white hover:opacity-95"
            >
              <Link2 size={14} aria-hidden="true" />
              توليد رابط تسجيل للعضو
            </button>
          </div>
        )}

        {error && (
          <p
            className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {textField('full_name', 'الاسم الكامل')}
          {textField('email', 'البريد الإلكتروني', 'email')}
          {textField('phone', 'رقم الهاتف (01xxxxxxxxx)', 'tel')}
          {textField('work_conditions', 'ظروف العمل')}
          {selectField('device', 'الجهاز المتوفر', [
            'لابتوب',
            'كمبيوتر مكتبي (PC)',
            'بدون جهاز',
            'هاتف محمول',
            'لابتوب، هاتف محمول',
            'لابتوب، جهاز لوحي، هاتف محمول',
          ])}
          {textField('residence', 'محل الإقامة')}
          {selectField('gender', 'الجنس', ['', 'ذكر', 'أنثى'])}
          {selectField('work_status', 'حالة الحساب', ['active', 'inactive'])}
        </div>

        {textField('bio', 'نبذة / الدور')}

        {/* Dynamic Custom Fields Section */}
        <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-black text-[var(--text)]">بيانات إضافية مخصصة</h4>
              <p className="text-xs text-[var(--text-muted)]">
                ضيف أي خانة جديدة (زي: نوع الثانوية، الكلية، إلخ) وهتظهر لكل الأعضاء تلقائياً
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
                {addingInlineField ? 'إغلاق' : 'إضافة معلومة جديدة'}
              </button>
              {onManageCustomFields && (
                <button
                  type="button"
                  onClick={onManageCustomFields}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)]"
                  title="إدارة وتعديل الحقول المخصصة"
                >
                  <Settings2 size={14} aria-hidden="true" />
                  إدارة الحقول
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
                  اسم المعلومة الجديدة
                  <input
                    type="text"
                    placeholder="مثال: نوع الثانوية"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm font-normal text-[var(--text)]"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-[var(--text-2)]">
                  طريقة الإدخال
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as MemberCustomFieldType)}
                    className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm font-normal text-[var(--text)]"
                  >
                    {(Object.keys(CUSTOM_FIELD_TYPE_LABELS) as MemberCustomFieldType[]).map((type) => (
                      <option key={type} value={type}>
                        {CUSTOM_FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {newFieldType === 'select' && (
                <label className="grid gap-1 text-xs font-bold text-[var(--text-2)]">
                  الاختيارات المتاحة (افصل بينها بفاصلة «،»)
                  <input
                    type="text"
                    placeholder="مثال: ثانوي عام، ثانوي أزهري، فني / صناعي، STEM"
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
                  loadingText="بنضيف..."
                  icon={<Plus size={15} aria-hidden="true" />}
                >
                  تثبيت الحقل لكل الأعضاء
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
                مفيش حقول مخصصة مضافة لسه. اضغط «إضافة معلومة جديدة» لإضافة أي بيان جديد بدون تعديل الكود.
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
          جاهز للنزول الميداني واجتماعات الإسكندرية
        </label>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>
            إلغاء
          </Button>
          <Button type="submit" isLoading={isSaving} loadingText="بنحفظ..." fullOnMobile>
            {member ? 'حفظ التعديلات' : 'إضافة العضو'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
