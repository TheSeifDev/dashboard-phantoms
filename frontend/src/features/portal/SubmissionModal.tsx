import { AlertCircle, Plus, Star, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import type { Task, TaskDifficulty, TaskSubmissionLink } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { isValidUrl } from '../../lib/validators';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';

interface SubmissionModalProps {
  task: Task | null;
  description: string;
  notes: string;
  stars: number;
  difficulty: TaskDifficulty;
  links: TaskSubmissionLink[];
  isSubmitting: boolean;
  onDescriptionChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onStarsChange: (value: number) => void;
  onDifficultyChange: (value: TaskDifficulty) => void;
  onLinksChange: (value: TaskSubmissionLink[]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-base text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]';

export function SubmissionModal({ task, description, notes, stars, difficulty, links, isSubmitting, onDescriptionChange, onNotesChange, onStarsChange, onDifficultyChange, onLinksChange, onClose, onSubmit }: SubmissionModalProps) {
  const { t, dir } = useLocale();
  const urlErrors = links.map((link) => link.url.trim() && !isValidUrl(link.url.trim()));
  const linkError = urlErrors.some(Boolean);
  const updateLink = (index: number, patch: Partial<TaskSubmissionLink>) => onLinksChange(links.map((link, i) => i === index ? { ...link, ...patch } : link));
  return (
    <Modal isOpen={!!task} onClose={onClose} title={t('تسليم المهمة للإدارة', 'Submit task to the administration')} subtitle={task?.title} maxWidth="2xl">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <label dir={dir} className="grid gap-2 text-sm font-bold">{t('وصف الإنجاز', 'What you completed')}
          <textarea required minLength={1} maxLength={4000} rows={4} value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder={t('اكتب بوضوح إيه اللي أنجزته في المهمة.', 'Describe clearly what you completed for this task.')} className={`${fieldClass} min-h-24 p-3 leading-6`} />
        </label>
        <label dir={dir} className="grid gap-2 text-sm font-bold">{t('ملاحظات إضافية (اختياري)', 'Additional notes (optional)')}
          <textarea maxLength={2000} rows={3} value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder={t('أي سياق أو تفاصيل تحب تضيفها.', 'Any context or details you would like to add.')} className={`${fieldClass} min-h-20 p-3 leading-6`} />
        </label>
        <fieldset dir={dir} className="grid gap-2 rounded-xl border border-[var(--border)] p-3">
          <legend className="px-1 text-sm font-bold">{t('قد إيه استفدت من المهمة؟', 'How useful was this task?')}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('تقييم الاستفادة من نجمة إلى خمس نجوم', 'Usefulness rating from one to five stars')}>
            {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={stars === value} aria-label={t(`${value} من 5 نجوم`, `${value} out of 5 stars`)} onClick={() => onStarsChange(value)} className={`inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${stars === value ? 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-[var(--border)] text-[var(--text-muted)]'}`}><Star size={16} fill={stars >= value ? 'currentColor' : 'none'} aria-hidden="true" />{value}</button>)}
          </div>
          <p className="text-xs leading-5 text-[var(--text-muted)]">{t('تقييمك للاستفادة فقط؛ لا يغيّر نقاطك أو ترتيبك.', 'This is only your usefulness feedback; it does not affect your points or ranking.')}</p>
        </fieldset>
        <label dir={dir} className="grid gap-2 text-sm font-bold">{t('مستوى الصعوبة', 'Difficulty level')}
          <select value={difficulty} onChange={(event) => onDifficultyChange(event.target.value as TaskDifficulty)} className={fieldClass}>
            <option value="easy">{t('سهل', 'Easy')}</option><option value="medium">{t('متوسط', 'Medium')}</option><option value="hard">{t('صعب', 'Hard')}</option>
          </select>
        </label>
        <section dir={dir} className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{t('روابط التسليم', 'Submission links')}</h3><Button type="button" variant="secondary" icon={<Plus size={15} aria-hidden="true" />} onClick={() => onLinksChange([...links, { label: '', url: '' }])} disabled={links.length >= 10}>{t('إضافة رابط', 'Add link')}</Button></div>
          {links.map((link, index) => <div key={index} className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_auto] sm:items-start">
            <label className="grid gap-1 text-xs font-bold">{t('اسم الرابط', 'Link label')}<input maxLength={80} value={link.label} onChange={(event) => updateLink(index, { label: event.target.value })} placeholder="GitHub / Wokwi" className={fieldClass} /></label>
            <label className="grid gap-1 text-xs font-bold">{t('الرابط', 'URL')}<input type="url" dir="ltr" maxLength={2048} value={link.url} onChange={(event) => updateLink(index, { url: event.target.value })} placeholder="https://github.com/..." aria-invalid={Boolean(urlErrors[index]) || undefined} className={fieldClass} /></label>
            <Button type="button" variant="danger" className="self-end" aria-label={t(`حذف الرابط ${index + 1}`, `Remove link ${index + 1}`)} onClick={() => onLinksChange(links.filter((_, i) => i !== index))} disabled={links.length <= 1}><Trash2 size={15} aria-hidden="true" /></Button>
          </div>)}
          {linkError && <p role="alert" className="text-xs font-bold text-[var(--danger-text)]">{t('تحقق من الروابط؛ لازم تبدأ بـ http:// أو https://', 'Check the links; each must start with http:// or https://.')}</p>}
        </section>
        <p dir={dir} className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertCircle size={18} className="mt-1 shrink-0" />{t('وقت التسليم بيتسجل تلقائيًا بعد الحفظ. المهمة هتفضل تحت المراجعة لحد ما الإدارة تعتمدها.', 'Submission time is recorded automatically after saving. The task stays under review until approved.')}</p>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting} loadingText={t('بنبعت...', 'Submitting...')} disabled={description.trim().length === 0 || linkError || links.some((link) => Boolean(link.label.trim()) !== Boolean(link.url.trim()))} fullOnMobile>{t('تأكيد التسليم', 'Confirm submission')}</Button>
        </div>
      </form>
    </Modal>
  );
}
