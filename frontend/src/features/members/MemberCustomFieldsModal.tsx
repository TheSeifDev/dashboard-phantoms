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
      setError('اكتب اسم الحقل أو المعلومة الأول (مثال: نوع الثانوية).');
      return;
    }

    const options = draft.field_type === 'select' ? parseOptionsText(draft.optionsText) : [];
    if (draft.field_type === 'select' && options.length === 0) {
      setError('اكتب اختيارين على الأقل لقائمة الاختيارات (افصل بينهم بفاصلة أو سطر جديد).');
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
      toast.success(draft.id ? 'اتحدّث الحقل المخصص بنجاح.' : `اتضاف حقل «${cleanLabel}» لكل الأعضاء.`);
      resetDraft();
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  const handleRemove = async (field: MemberCustomField) => {
    try {
      await deleteField.mutateAsync(field.id);
      if (draft.id === field.id) resetDraft();
      toast.success(`اتحذف حقل «${field.label}».`);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="إدارة الحقول المخصصة لبيانات الأعضاء" maxWidth="2xl">
      <div className="grid gap-5" dir="rtl">
        <p className="text-sm leading-6 text-[var(--text-muted)]">
          أي حقل تضيفه هنا هيظهر تلقائيًا في نافذة «تعديل بيانات العضو» و«إضافة عضو» وفي ملف العضو وشيت الإكسيل، بدون أي تعديل في الكود.
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
              {draft.id ? `تعديل حقل: ${draft.label}` : 'إضافة معلومة / حقل جديد للأعضاء'}
            </h3>
            {draft.id && (
              <button
                type="button"
                onClick={resetDraft}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)]"
              >
                <X size={14} aria-hidden="true" />
                إلغاء التعديل
              </button>
            )}
          </div>

          {error && (
            <p
              className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              اسم المعلومة / الحقل
              <input
                type="text"
                required
                placeholder="مثال: نوع الثانوية / الكلية / سنة التخرج"
                value={draft.label}
                onChange={(e) => setDraft((curr) => ({ ...curr, label: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              نوع الحقل
              <select
                value={draft.field_type}
                onChange={(e) =>
                  setDraft((curr) => ({ ...curr, field_type: e.target.value as MemberCustomFieldType }))
                }
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CUSTOM_FIELD_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draft.field_type === 'select' ? (
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              الاختيارات المتاحة (افصل بين كل اختيار بفاصلة «،» أو سطر جديد)
              <input
                type="text"
                placeholder="مثال: ثانوي عام، ثانوي أزهري، فني / صناعي، STEM"
                value={draft.optionsText}
                onChange={(e) => setDraft((curr) => ({ ...curr, optionsText: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>
          ) : (
            <label className="grid gap-1.5 text-sm font-bold text-[var(--text-2)]">
              نص توضيحي داخل الخانة (اختياري)
              <input
                type="text"
                placeholder="مثال: اكتب نوع الثانوية أو الشعبة..."
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
              إظهار هذه المعلومة في الكارت الخارجي للعضو
            </label>

            <Button
              type="submit"
              isLoading={saveField.isPending}
              loadingText="بنحفظ..."
              icon={<Plus size={16} aria-hidden="true" />}
            >
              {draft.id ? 'حفظ تعديل الحقل' : 'إضافة الحقل للنظام'}
            </Button>
          </div>
        </form>

        {/* Existing custom fields list */}
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-[var(--text)]">
              الحقول المضافة حالياً ({fields.length})
            </h4>
          </div>

          {fields.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-muted)]">
              <ListPlus size={24} className="mx-auto mb-2 text-[var(--text-muted)]" aria-hidden="true" />
              مفيش حقول إضافية مضافة لسه. ضيف أي معلومة فوق (زي «نوع الثانوية») وهتظهر فوراً لكل الأعضاء.
            </div>
          ) : (
            <ul className="grid gap-2" aria-label="قائمة الحقول المخصصة">
              {fields.map((field) => (
                <li
                  key={field.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-black text-[var(--text)]">{field.label}</strong>
                      <span className="rounded-md bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-bold text-[var(--link)]">
                        {CUSTOM_FIELD_TYPE_LABELS[field.field_type]}
                      </span>
                      {field.show_in_card && (
                        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)]">
                          يظهر في الكارت
                        </span>
                      )}
                    </div>
                    {field.field_type === 'select' && field.options.length > 0 && (
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                        الاختيارات: {field.options.join(' ، ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(field)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--primary-soft)] hover:text-[var(--link)]"
                      aria-label={`تعديل حقل ${field.label}`}
                    >
                      <Edit2 size={14} aria-hidden="true" />
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRemove(field);
                      }}
                      disabled={deleteField.isPending}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-950/30"
                      aria-label={`حذف حقل ${field.label}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      حذف
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </Modal>
  );
}
