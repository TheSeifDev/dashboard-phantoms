import { Bot } from 'lucide-react';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { AiComposer } from './AiComposer';
import { AiMessages } from './AiMessages';
import { useAiConversation } from './useAiConversation';

export default function AiAssistantPage() {
  const membersQuery = useMembers();
  const tasksQuery = useTasks();
  const conversation = useAiConversation(membersQuery.data ?? [], tasksQuery.data ?? []);
  const contextError = membersQuery.isError || tasksQuery.isError;

  return <section id="page-ai-assistant" className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4" dir="rtl">
    <header className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-white"><Bot size={24} /></span>
        <div><h1 className="text-[var(--fs-xl)] font-black">مساعد وصلة الذكي</h1><p className="mt-1 text-sm text-[var(--text-muted)]">اسأل عن الفريق والمهام أو اطلب مني أعمل مهمة وملاحظة.</p></div>
      </div>
      {contextError && <p className="mt-4 text-sm text-[var(--danger)]" role="status">معرفناش نحمّل بعض بيانات الفريق؛ ممكن إجابات المساعد تكون ناقصة.</p>}
    </header>
    <AiMessages messages={conversation.messages} isPending={conversation.isPending} onExecute={conversation.executeAction} endRef={conversation.messagesEndRef} />
    <AiComposer isPending={conversation.isPending} onSend={conversation.sendMessage} />
  </section>;
}
