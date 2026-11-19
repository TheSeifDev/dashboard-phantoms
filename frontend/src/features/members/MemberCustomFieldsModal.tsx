import { useState } from 'react';
import type { FormEvent } from 'react';
import { Edit2, ListPlus, Plus, Trash2, X } from 'lucide-react';
import type { MemberCustomField, MemberCustomFieldInsert, MemberCustomFieldType } from '../../types/db';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  useDeleteMemberCustomField,
  useSaveMemberCustomField,
} from './customFieldsApi';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';

interface Props {
  isOpen: boolean;
  fields: MemberCustomField[];
  onClose: () => void;
}

const FIELD_TYPES: MemberCustomFieldType[] = [
  'short_text',
  'select',
  'number',
  'yes_no',
  'date',
  'long_text',
];

interface DraftState {
  id?: number;
  label: string;
  field_type: MemberCustomFieldType;
  optionsText: string;
  placeholder: string;
  show_in_card: boolean;
  is_required: boolean;
  sort_order: number;
}

const emptyDraft = (nextOrder = 0): DraftState => ({
  label: '',
  field_type: 'short_text',
  optionsText: '',
  placeholder: '',
  show_in_card: true,
  is_required: false,
  sort_order: nextOrder,
});

export function parseOptionsText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,،]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function MemberCustomFieldsModal({ isOpen, fields, onClose }: Props) {
  const { t, dir } = useLocale();
  const saveField = useSaveMemberCustomField();
  const deleteField = useDeleteMemberCustomField();
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(fields.length));
  const [error, setError] = useState('');

  const resetDraft = () => {
    setDraft(emptyDraft(fields.length));
    setError('');
  };

  const startEdit = (field: MemberCustomField) => {
    setError('');
    setDraft({
      id: field.id,
      label: field.label,
      field_type: field.field_type,
      optionsText: (field.options ?? []).join('، '),
      placeholder: field.placeholder ?? '',
      show_in_card: field.show_in_card !== false,
      is_required: Boolean(field.is_required),
      sort_order: field.sort_order ?? 0,
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const cleanLabel = draft.label.trim();
    if (!cleanLabel) {
      setError(t('اكتب اسم الحقل أو المعلومة الأول (مثال: نوع الثانوية).', 'Enter a field name first (for example: High school type).'));
      return;
    }

    const options = draft.field_type === 'select' ? parseOptionsText(draft.optionsText) : [];
    if (draft.field_type === 'select' && options.length === 0) {
      setError(t('اكتب اختيارين على الأقل لقائمة الاختيارات (افصل بينهم بفاصلة أو سطر جديد).', 'Enter at least two choices for this list, separated by commas or new lines.'));
      return;
    }

    const payload: MemberCustomFieldInsert = {
      label: cleanLabel,
      field_type: draft.field_type,
      options,
      placeholder: draft.placeholder.trim(),
      show_in_card: draft.show_in_card,
      is_required: draft.is_required,
      is_active: true,
      sort_order: draft.id ? draft.sort_order : fields.length,
    };

    try {
      await saveField.mutateAsync({ id: draft.id, field: payload });
      toast.success(draft.id ? t('اتحدّث الحقل المخصص بنجاح.', 'Custom field updated.') : t(`اتضاف حقل «${cleanLabel}» لكل الأعضاء.`, `Added “${cleanLabel}” for all members.`));
      resetDraft();
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  const handleRemove = async (field: MemberCustomField) => {
    try {
      await deleteField.mutateAsync(field.id);
      if (draft.id === field.id) resetDraft();
      toast.success(t(`اتحذف حقل «${field.label}».`, `Deleted the “${field.label}” field.`));
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('إدارة الحقول المخصصة لبيانات الأعضاء', 'Manage custom member fields')} maxWidth="2xl">
      <div className="grid gap-5" dir={dir}>
        <p className="text-sm leading-6 text-[var(--text-muted)]">
          {t('أي حقل تضيفه هنا هيظهر تلقائيًا في نافذة «تعديل بيانات العضو» و«إضافة عضو» وفي ملف العضو وشيت الإكسيل، بدون أي تعديل في الكود.', 'Fields added here appear automatically in the Edit Member and Add Member forms, member profiles, and Excel exports, without code changes.')}
        </p>

        {/* Form to add or edit a field */}
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="grid gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
          noValidate
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-[var(--text)]">
              {draft.id ? t(`تعديل حقل: ${draft.label}`, `Edit field: ${draft.label}`) : t('إضافة معلومة / حقل جديد للأعضاء', 'Add a new member field')}
            </h3>
            {draft.id && (
              <button
                type="button"
                onClick={resetDraft}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)]"
              >
                <X size={14} aria-hidden="true" />
                {t('إلغاء التعديل', 'Cancel editing')}
              </button>
            )}
          </div>

          {error && (
            <p
              className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              {t('اسم المعلومة / الحقل', 'Field name')}
              <input
                type="text"
                required
                placeholder={t('مثال: نوع الثانوية / الكلية / سنة التخرج', 'Example: High school type / college / graduation year')}
                value={draft.label}
                onChange={(e) => setDraft((curr) => ({ ...curr, label: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              {t('نوع الحقل', 'Field type')}
              <select
                value={draft.field_type}
                onChange={(e) =>
                  setDraft((curr) => ({ ...curr, field_type: e.target.value as MemberCustomFieldType }))
                }
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(CUSTOM_FIELD_TYPE_LABELS[type], ({ short_text: 'Free text', select: 'Choice list', number: 'Number', yes_no: 'Yes / No', date: 'Date', long_text: 'Long text / details' } as const)[type])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draft.field_type === 'select' ? (
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              {t('الاختيارات المتاحة (افصل بين كل اختيار بفاصلة «،» أو سطر جديد)', 'Available choices (separate each with a comma or new line)')}
              <input
                type="text"
                placeholder={t('مثال: ثانوي عام، ثانوي أزهري، فني / صناعي، STEM', 'Example: General, Azhar, technical / industrial, STEM')}
                value={draft.optionsText}
                onChange={(e) => setDraft((curr) => ({ ...curr, optionsText: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>
          ) : (
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              {t('نص توضيحي داخل الخانة (اختياري)', 'Placeholder text (optional)')}
              <input
                type="text"
                placeholder={t('مثال: اكتب نوع الثانوية أو الشعبة...', 'Example: Enter high school type or section...')}
                value={draft.placeholder}
                onChange={(e) => setDraft((curr) => ({ ...curr, placeholder: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2.5 text-sm font-bold text-[var(--text-2)]">
              <input
                type="checkbox"
                checked={draft.show_in_card}
                onChange={(e) => setDraft((curr) => ({ ...curr, show_in_card: e.target.checked }))}
              />
              {t('إظهار هذه المعلومة في الكارت الخارجي للعضو', 'Show this field on the member card')}
            </label>

            <Button
              type="submit"
              isLoading={saveField.isPending}
              loadingText={t('بنحفظ...', 'Saving...')}
              icon={<Plus size={16} aria-hidden="true" />}
            >
              {draft.id ? t('حفظ تعديل الحقل', 'Save field changes') : t('إضافة الحقل للنظام', 'Add field')}
            </Button>
          </div>
        </form>

        {/* Existing custom fields list */}
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-[var(--text)]">
              {t('الحقول المضافة حالياً', 'Current fields')} ({fields.length})
            </h4>
          </div>

          {fields.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-muted)]">
              <ListPlus size={24} className="mx-auto mb-2 text-[var(--text-muted)]" aria-hidden="true" />
              {t('مفيش حقول إضافية مضافة لسه. ضيف أي معلومة فوق (زي «نوع الثانوية») وهتظهر فوراً لكل الأعضاء.', 'No custom fields yet. Add a field above and it will appear for all members immediately.')}
            </div>
          ) : (
            <ul className="grid gap-2" aria-label={t('قائمة الحقول المخصصة', 'Custom fields list')}>
              {fields.map((field) => (
                <li
                  key={field.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-black text-[var(--text)]">{field.label}</strong>
                      <span className="rounded-md bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-bold text-[var(--link)]">
                          {t(CUSTOM_FIELD_TYPE_LABELS[field.field_type], ({ short_text: 'Free text', select: 'Choice list', number: 'Number', yes_no: 'Yes / No', date: 'Date', long_text: 'Long text / details' } as const)[field.field_type])}
                      </span>
                      {field.show_in_card && (
                        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)]">
                          {t('يظهر في الكارت', 'Shown on card')}
                        </span>
                      )}
                    </div>
                    {field.field_type === 'select' && field.options.length > 0 && (
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                        {t('الاختيارات:', 'Choices:')} {field.options.join(' ، ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(field)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--primary-soft)] hover:text-[var(--link)]"
                      aria-label={t(`تعديل حقل ${field.label}`, `Edit field ${field.label}`)}
                    >
                      <Edit2 size={14} aria-hidden="true" />
                      {t('تعديل', 'Edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRemove(field);
                      }}
                      disabled={deleteField.isPending}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--danger-soft)]"
                      aria-label={t(`حذف حقل ${field.label}`, `Delete field ${field.label}`)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t('حذف', 'Delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('إغلاق', 'Close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
