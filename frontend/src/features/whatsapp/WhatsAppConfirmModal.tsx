import { CheckCircle2, Send, ShieldAlert, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

import { useLocale } from '../../i18n/useLocale';
interface WhatsAppConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskTitle: string;
  recipientCount: number;
  previewMemberName: string;
  messagePreview: string;
  isDryRun: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

export function WhatsAppConfirmModal({ isOpen, onClose, taskTitle, recipientCount, previewMemberName, messagePreview, isDryRun, isPending, onConfirm }: WhatsAppConfirmModalProps) {
  const { t, number, dir } = useLocale();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isDryRun ? t('مراجعة الإرسال التجريبي', 'Review test send') : t('مراجعة الإرسال إلى واتساب', 'Review WhatsApp send')}
      subtitle={t(`المهمة: «${taskTitle}»`, `Task: “${taskTitle}”`)}
      maxWidth="lg"
    >
      <div className="grid gap-4" dir={dir}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <Users className="shrink-0 text-[var(--primary-ink)]" size={20} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-[var(--text-muted)]">{t('عدد المستلمين', 'Recipients')}</p>
              <p className="text-sm font-extrabold text-[var(--text)]">{number(recipientCount)} {t('مستلم', 'recipients')}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-soft)] p-3">
            <CheckCircle2 className="shrink-0 text-[var(--success-text)]" size={20} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-[var(--success-text)]">{t('الموافقة', 'Consent')}</p>
              <p className="text-sm font-extrabold text-[var(--success-text)]">{t('تم تأكيد الموافقة', 'Consent confirmed')}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-extrabold text-[var(--text)]">{t('معاينة الرسالة', 'Message preview')}</span>
            <span className="text-xs text-[var(--text-muted)]">{t('مثال المستلم:', 'Example recipient:')} {previewMemberName}</span>
          </div>
          <div dir="auto" className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-sans text-xs leading-6 text-[var(--text)] whitespace-pre-wrap">{messagePreview}</div>
        </div>

        {isDryRun ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)] bg-[var(--primary-soft)] p-3 text-sm leading-6 text-[var(--text)]">
            <ShieldAlert className="mt-0.5 shrink-0 text-[var(--link)]" size={18} aria-hidden="true" />
            <p>{t('هذا وضع محاكاة معزول؛ لا يفترض أن يرسل رسائل إلى شبكة واتساب. ستُختبر سجلات التسليم الداخلية.', 'This is isolated simulation mode; it should not send messages to the WhatsApp network. Internal delivery logging will be tested.')}</p>
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <ShieldAlert className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={18} aria-hidden="true" />
            <p><strong>{t('إرسال خارجي فعلي.', 'External send.')}</strong> {t('سيتم إرسال الرسائل إلى مستلمي واتساب المحددين. لا تؤكد إلا بعد مراجعة المحتوى والتحقق من موافقتهم.', 'Messages will be sent to the selected WhatsApp recipients. Confirm only after reviewing the content and verifying their consent.')}</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending} fullOnMobile>{t('العودة دون إرسال', 'Back without sending')}</Button>
          <Button
            type="button"
            variant={isDryRun ? 'primary' : 'danger'}
            icon={<Send size={16} aria-hidden="true" />}
            disabled={isPending}
            isLoading={isPending}
            loadingText={isDryRun ? t('جارٍ تشغيل المحاكاة…', 'Running simulation…') : t('جارٍ الإرسال…', 'Sending…')}
            onClick={onConfirm}
            fullOnMobile
          >
            {isDryRun ? t('أكد المحاكاة', 'Confirm simulation') : t('أكد الإرسال الخارجي', 'Confirm external send')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
