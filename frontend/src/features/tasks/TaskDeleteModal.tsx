import type { Task } from '../../types/db';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

import { useLocale } from '../../i18n/useLocale';
export function TaskDeleteModal({ task, isDeleting, onClose, onConfirm }: { task: Task | null; isDeleting: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useLocale();
  return <Modal isOpen={Boolean(task)} onClose={onClose} title={t("تأكيد مسح المهمة", "Confirm task deletion")} subtitle={task ? t(`المهمة «${task.title}» هتتمسح نهائي من عند كل الأعضاء.`, `Task “${task.title}” will be permanently deleted for all members.`) : undefined} maxWidth="sm">
    {task && <div className="grid gap-4"><p className="text-sm leading-6">{t("متأكد إنك عايز تمسح المهمة", "Are you sure you want to permanently delete task")} <strong>{task.title}</strong> نهائي؟</p><div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose} fullOnMobile>{t("إلغاء", "Cancel")}</Button><Button variant="danger" isLoading={isDeleting} loadingText={t("بنمسح...", "Deleting...")} onClick={onConfirm} fullOnMobile>{t("تأكيد المسح", "Confirm deletion")}</Button></div></div>}
  </Modal>;
}
