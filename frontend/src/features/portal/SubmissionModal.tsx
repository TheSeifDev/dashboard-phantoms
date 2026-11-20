import { AlertCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import type { Task } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { isValidUrl } from '../../lib/validators';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';

interface SubmissionModalProps {
  task: Task | null;
  url: string;
  note: string;
  isSubmitting: boolean;
  onUrlChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function SubmissionModal({ task, url, note, isSubmitting, onUrlChange, onNoteChange, onClose, onSubmit }: SubmissionModalProps) {
  const { t, dir } = useLocale();
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isValidUrl(trimmedUrl) ? t('الرابط مش صالح — لازم يبدأ بـ http:// أو https://', 'Invalid link — it must start with http:// or https://') : '';
  return (
    <Modal isOpen={!!task} onClose={onClose} title={t('تسليم المهمة للإدارة', 'Submit task to the administration')} subtitle={task?.title}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <label dir={dir} className="grid gap-2 text-sm font-bold">{t('رابط التسليم', 'Submission link')}
          <input type="url" dir="ltr" placeholder="https://drive.google.com/... or https://github.com/..." value={url} onChange={(event) => onUrlChange(event.target.value)} aria-invalid={Boolean(urlError) || undefined} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-start" />
        </label>
        {urlError && <p role="alert" className="text-xs font-bold text-[var(--danger-text)] dark:text-[var(--danger-text)]">{urlError}</p>}
        <label dir={dir} className="grid gap-2 text-sm font-bold">{t('ملاحظات التسليم', 'Submission notes')}
          <textarea rows={4} placeholder={t('اكتب اللي أنجزته والتفاصيل اللي حابب تشاركها.', 'Describe what you completed and any details you would like to share.')} value={note} onChange={(event) => onNoteChange(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 leading-6" />
        </label>
        <p dir={dir} className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertCircle size={18} className="mt-1 shrink-0" />{t('بعد الإرسال، المهمة هتبقى تحت المراجعة لحد ما الإدارة تعتمدها.', 'After submission, the task stays under review until the administration approves it.')}</p>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting} loadingText={t('بنبعت...', 'Submitting...')} disabled={Boolean(urlError)} fullOnMobile>{t('تأكيد التسليم', 'Confirm submission')}</Button>
        </div>
      </form>
    </Modal>
  );
}
