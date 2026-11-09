import { AlertTriangle, Bot } from 'lucide-react';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { AiComposer } from './AiComposer';
import { AiMessages } from './AiMessages';
import { useAiConversation } from './useAiConversation';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';

export default function AiAssistantPage() {
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const conversation = useAiConversation(membersQuery.data ?? [], tasksQuery.data ?? []);
  const contextError = membersQuery.isError || tasksQuery.isError;
  const pending = conversation.pendingConfirmation;

  return (
    <section id="page-ai-assistant" className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4" dir="rtl">
      <header className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-white ">
            <Bot size={24} />
          </span>
          <div>
            <h1 className="text-[var(--fs-xl)] font-black">مساعد PHANTOMS الذكي (PHANTOMS Assistant)</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">اسأل عن الفريق والمهام أو اطلب مني أعمل مهمة وملاحظة.</p>
          </div>
        </div>
        {contextError && (
          <p className="mt-4 text-sm text-[var(--danger)]" role="status">
            معرفناش نحمّل بعض بيانات الفريق؛ ممكن إجابات المساعد تكون ناقصة.
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
          title="تأكيد تنفيذ إجراء تخريبي"
          subtitle="طلب المساعد الذكي تنفيذ حذف مباشر في قاعدة البيانات"
          icon={<AlertTriangle className="text-[var(--danger)]" size={22} />}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={conversation.cancelAction}>
                إلغاء الإجراء
              </Button>
              <Button variant="danger" onClick={conversation.confirmAction}>
                تأكيد الحذف النهائي
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger)]">
              <strong>تحذير أمني:</strong> أنت على وشك تنفيذ حذف نهائي بناءً على اقتراح المساعد الذكي. لا يمكن التراجع عن هذه العملية بعد تأكيدها.
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span className="font-bold text-[var(--text-muted)]">نوع الإجراء:</span>
                <span className="font-bold text-[var(--danger)]">{pending.actionTypeName}</span>

                <span className="font-bold text-[var(--text-muted)]">الهدف المحدد:</span>
                <span className="font-bold text-[var(--text)]">{pending.targetEntityName}</span>

                <span className="font-bold text-[var(--text-muted)]">معرّف السجل:</span>
                <span className="font-mono text-xs">{String(pending.targetId)}</span>

                {pending.details && (
                  <>
                    <span className="font-bold text-[var(--text-muted)]">بيانات إضافية:</span>
                    <span className="text-[var(--text-muted)]">{pending.details}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
