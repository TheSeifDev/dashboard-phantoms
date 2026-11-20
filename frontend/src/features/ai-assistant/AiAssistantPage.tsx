import { AlertTriangle, Bot } from 'lucide-react';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { AiComposer } from './AiComposer';
import { AiMessages } from './AiMessages';
import { useAiConversation } from './useAiConversation';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';

export default function AiAssistantPage() {
  const { t, dir } = useLocale();
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const conversation = useAiConversation(membersQuery.data ?? [], tasksQuery.data ?? []);
  const contextError = membersQuery.isError || tasksQuery.isError;
  const pending = conversation.pendingConfirmation;

  return (
    <section id="page-ai-assistant" className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4" dir={dir}>
      <header className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
        <div className="flex min-w-0 items-start gap-3 sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-white sm:size-12" aria-hidden="true">
            <Bot size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[var(--fs-xl)] font-black leading-tight">{t('مساعد PHANTOMS الذكي', 'PHANTOMS AI Assistant')}</h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              {t('اسأل عن الفريق والمهام، أو اطلب إنشاء مهمة أو ملاحظة.', 'Ask about the team and tasks, or request a task or note.')}
            </p>
          </div>
        </div>
        {contextError && (
          <p className="mt-4 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger)]" role="status">
            {t('تعذّر تحميل بعض بيانات الفريق؛ قد تكون الإجابات غير مكتملة.', 'Some team data could not be loaded, so responses may be incomplete.')}
          </p>
        )}
      </header>

      <AiMessages
        messages={conversation.messages}
        isPending={conversation.isPending}
        onExecute={conversation.executeAction}
        endRef={conversation.messagesEndRef}
      />
      <AiComposer isPending={conversation.isPending} onSend={conversation.sendMessage} />

      {pending && (
        <Modal
          isOpen={Boolean(pending)}
          onClose={conversation.cancelAction}
          title={t('تأكيد إجراء الحذف', 'Confirm deletion')}
          subtitle={t('راجع تفاصيل الإجراء قبل المتابعة.', 'Review the action details before continuing.')}
          icon={<AlertTriangle className="text-[var(--danger)]" size={22} />}
          footer={
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={conversation.cancelAction} className="w-full sm:w-auto">
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button variant="danger" onClick={conversation.confirmAction} className="w-full sm:w-auto">
                {t('تأكيد الحذف النهائي', 'Confirm permanent deletion')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger)]">
              <strong>{t('تحذير أمني:', 'Security warning:')}</strong>{' '}
              {t('أنت على وشك تنفيذ حذف نهائي بناءً على اقتراح المساعد. لا يمكن التراجع عن هذا الإجراء بعد تأكيده.', 'You are about to permanently delete data based on the assistant’s suggestion. This cannot be undone after confirmation.')}
            </div>

            <dl className="grid grid-cols-1 gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm sm:grid-cols-[minmax(0,110px)_minmax(0,1fr)]">
              <dt className="font-bold text-[var(--text-muted)]">{t('نوع الإجراء', 'Action type')}</dt>
              <dd className="break-words font-bold text-[var(--danger)]" dir="auto">{pending.actionTypeName}</dd>

              <dt className="font-bold text-[var(--text-muted)]">{t('الهدف المحدد', 'Target')}</dt>
              <dd className="break-words font-bold text-[var(--text)]" dir="auto">{pending.targetEntityName}</dd>

              <dt className="font-bold text-[var(--text-muted)]">{t('معرّف السجل', 'Record ID')}</dt>
              <dd className="break-all font-mono text-xs" dir="ltr">{String(pending.targetId)}</dd>

              {pending.details && (
                <>
                  <dt className="font-bold text-[var(--text-muted)]">{t('بيانات إضافية', 'Additional details')}</dt>
                  <dd className="break-words text-[var(--text-muted)]" dir="auto">{pending.details}</dd>
                </>
              )}
            </dl>
          </div>
        </Modal>
      )}
    </section>
  );
}
