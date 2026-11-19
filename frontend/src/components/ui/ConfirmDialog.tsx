import { Modal } from './Modal';
import { Button } from './Button';

import { useLocale } from '../../i18n/useLocale';
/** حوار تأكيد موحد يعرض اسم العنصر. يستخدم Modal + toast المركزيين. */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  itemName,
  description,
  confirmLabel = 'تأكيد',
  isPending = false,
  pendingLabel = 'بننفذ...',
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemName?: string;
  description?: string;
  confirmLabel?: string;
  isPending?: boolean;
  pendingLabel?: string;
}) {
  const { t } = useLocale();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={itemName ? `${itemName}` : undefined}
      maxWidth="sm"
    >
      {description && <p className="text-sm leading-7 text-[var(--text-2)]">{description}</p>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} fullOnMobile>
          {t("إلغاء", "Cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} isLoading={isPending} loadingText={pendingLabel} fullOnMobile>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
