import { useEffect, useId, useState, type FormEvent } from 'react';
import { BookMarked, Check, Globe2, Save, Users, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';
import { toAppError } from '../../lib/supabase/errors';
import { useSaveReference } from './api';
import {
  REFERENCE_CATEGORY_LABELS,
  REFERENCE_CATEGORY_ORDER,
  isValidReferenceUrl,
  normalizeReferenceUrl,
  type ReferenceDraft,
  type ReferenceLink,
  type ReferenceTeam,
} from './types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  teams: ReferenceTeam[];
  link: ReferenceLink | null;
  onSaved?: (id: number) => void;
}

export function ReferenceEditorModal({ isOpen, onClose, teams, link, onSaved }: Props) {
  const { t } = useLocale();
  const formId = useId();
  const save = useSaveReference();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ReferenceDraft['category']>('docs');
  const [teamSlug, setTeamSlug] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setTitle(link?.title ?? '');
    setUrl(link?.url ?? '');
    setDescription(link?.description ?? '');
    setCategory(link?.category ?? 'docs');
    setTeamSlug(link?.team_slug ?? null);
  }, [isOpen, link]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (title.trim().length < 2) {
      setError(t('اسم المصدر لازم يكون حرفين على الأقل.', 'The reference title needs at least two characters.'));
      return;
    }
    if (!isValidReferenceUrl(url)) {
      setError(t('الرابط مش صالح — اكتب دومين كامل زي https://react.dev.', 'That link is not valid — use a full URL such as https://react.dev.'));
      return;
    }
    const draft: ReferenceDraft = {
      id: link?.id,
      title: title.trim(),
      url: normalizeReferenceUrl(url),
      description: description.trim(),
      category,
      team_slug: teamSlug,
    };
    try {
      const result = await save.mutateAsync(draft);
      toast.success(link ? t('اتحدّث المصدر.', 'Reference updated.') : t('اتضاف المصدر.', 'Reference added.'));
      onSaved?.(result.id);
      onClose();
    } catch (cause) {
      setError(toAppError(cause, t('معرفناش نحفظ المصدر.', 'Could not save the reference.')).message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={link ? t('تعديل المصدر', 'Edit reference') : t('مصدر جديد', 'New reference')}
      subtitle={t('لينك مهم لأي حد في الفريق، أو خاص بتيم واحد بس.', 'A link that matters to the whole team, or to one team only.')}
      icon={<BookMarked size={18} aria-hidden="true" />}
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" form={formId} icon={<Save size={16} aria-hidden="true" />} isLoading={save.isPending}>
            {link ? t('حفظ التعديل', 'Save changes') : t('إضافة المصدر', 'Add reference')}
          </Button>
        </div>
      }
    >
      <form id={formId} className="ref-form" onSubmit={(event) => void submit(event)}>
        {error && <p className="ref-error" role="alert"><TriangleAlert size={15} aria-hidden="true" />{error}</p>}

        <label className="ref-field">
          {t('اسم المصدر', 'Reference title')}
          <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={140} placeholder={t('مثال: React docs — Hooks', 'e.g. React docs — Hooks')} />
        </label>

        <label className="ref-field">
          {t('الرابط', 'Link')}
          <input type="url" dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://react.dev/reference/react" />
        </label>

        <div className="ref-form-grid">
          <label className="ref-field">
            {t('النوع', 'Category')}
            <select value={category} onChange={(event) => setCategory(event.target.value as ReferenceDraft['category'])}>
              {REFERENCE_CATEGORY_ORDER.map((value) => (
                <option key={value} value={value}>{t(REFERENCE_CATEGORY_LABELS[value].ar, REFERENCE_CATEGORY_LABELS[value].en)}</option>
              ))}
            </select>
          </label>
          <label className="ref-field">
            {t('النطاق', 'Scope')}
            <select value={teamSlug ?? ''} onChange={(event) => setTeamSlug(event.target.value || null)}>
              <option value="">{t('Global — كل الفريق', 'Global — whole team')}</option>
              {teams.map((team) => <option key={team.slug} value={team.slug}>{team.name}</option>)}
            </select>
          </label>
        </div>

        <div className="ref-scope" role="group" aria-label={t('اختيار سريع للنطاق', 'Quick scope picker')}>
          <button type="button" className="ref-scope-btn" aria-pressed={teamSlug === null} onClick={() => setTeamSlug(null)}>
            <Globe2 size={14} aria-hidden="true" />{t('Global', 'Global')}
            {teamSlug === null && <Check size={13} aria-hidden="true" />}
          </button>
          {teams.map((team) => (
            <button key={team.slug} type="button" className="ref-scope-btn" aria-pressed={teamSlug === team.slug} onClick={() => setTeamSlug(team.slug)}>
              <Users size={14} aria-hidden="true" />{team.name}
              {teamSlug === team.slug && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>

        <label className="ref-field">
          {t('وصف مختصر (اختياري)', 'Short description (optional)')}
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={400} placeholder={t('ليه المصدر ده مهم؟ إمتى نستخدمه؟', 'Why does this matter? When should we use it?')} />
        </label>

        <p className="ref-help">
          {t('المرجع الـGlobal بيظهر لكل الأعضاء. المرجع الخاص بتيم بيظهر لأعضاء التيم ده بس (العضوية النشطة وقت القراءة).', 'Global references are visible to every member. Team references are visible only to that team’s active members.')}
        </p>
      </form>
    </Modal>
  );
}