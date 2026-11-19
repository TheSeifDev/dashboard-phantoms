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
  isPending: boolean;
  onConfirm: () => void;
}

export function WhatsAppConfirmModal({
  isOpen,
  onClose,
  taskTitle,
  recipientCount,
  previewMemberName,
  messagePreview,
  isPending,
  onConfirm,
}: WhatsAppConfirmModalProps) {
  const { t, number, dir } = useLocale();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("أكد بدء البعت التجريبي عن طريق واتساب", "Confirm WhatsApp test send")}
      subtitle={t(`لـ ${recipientCount} عضو بخصوص «${taskTitle}»`, `For ${number(recipientCount)} members about “${taskTitle}”`)}
      maxWidth="lg"
    >
      <div className="grid gap-4" dir={dir}>
        {/* Summary Info Cards */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <Users className="text-[var(--primary-ink)]" size={20} aria-hidden="true" />
            <div>
              <p className="text-xs text-[var(--text-muted)]">{t("إجمالي المستلمين:", "Total recipients:")}</p>
              <p className="text-sm font-extrabold text-[var(--text)]">{number(recipientCount)} {t('عضو متأكد منهم', 'consenting members')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-soft)] p-3 dark:border-[var(--success-border)] dark:bg-[var(--success-soft)]">
            <CheckCircle2 className="text-[var(--success-text)] dark:text-[var(--success-text)]" size={20} aria-hidden="true" />
            <div>
              <p className="text-xs text-[var(--success-text)] dark:text-[var(--success-text)]">{t("تأكيد الموافقة الصريحة:", "Consent confirmation:")}</p>
              <p className="text-sm font-extrabold text-[var(--success-text)] dark:text-[var(--success-text)]">{t("متأكد ومعتمد إداريًا", "Confirmed and approved")}</p>
            </div>
          </div>
        </div>

        {/* Message Preview Box */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-extrabold text-[var(--text)]">{t("معاينة الرسالة:", "Message preview:")}</span>
            <span className="text-xs text-[var(--text-muted)]">{t("مثال العضو:", "Example member:")} {previewMemberName}</span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-sans whitespace-pre-wrap text-xs leading-6 text-[var(--text)]">
            {messagePreview}
          </div>
        </div>

        {/* Mock Safety Notice */}
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)] bg-[var(--primary-soft)] p-3 text-xs leading-5 text-[var(--text)]">
          <ShieldAlert className="mt-0.5 shrink-0 text-[var(--link)]" size={17} aria-hidden="true" />
          <p>
            {t("هيتم تنفيذ البعت ده في وضع المحاكاة المنفصل (Baileys Mock) من غير ما نبعت فعليًا على شبكة واتساب، عشان نختبر مسار المهام وسجلات التسليم الداخلية.", "This will run in isolated Baileys Mock mode without sending over WhatsApp, to test task assignment and internal delivery logging.")}
          </p>
        </div>

        {/* Modal Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-[var(--border)] pt-4">
          <Button variant="secondary" onClick={onClose} disabled={isPending} fullOnMobile>
            {t('إلغاء', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<Send size={16} aria-hidden="true" />}
            disabled={isPending}
            onClick={onConfirm}
            fullOnMobile
          >
            {isPending ? t('بنَبعت تجريبي...', 'Sending test...') : t('أكد وابدأ البعت التجريبي', 'Confirm and start test send')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
