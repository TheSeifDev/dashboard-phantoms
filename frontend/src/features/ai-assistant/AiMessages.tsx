import { Bot, CheckCircle2, Sparkles } from 'lucide-react';
import type { RefObject } from 'react';
import type { AiAction, AiMessage } from './api';

export function AiMessages({ messages, isPending, onExecute, endRef }: { messages: AiMessage[]; isPending: boolean; onExecute: (id: string, action: AiAction) => void; endRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex min-h-72 flex-1 flex-col gap-4 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-5" aria-live="polite">
      {messages.map((message) => {
        const isUser = message.sender === 'user';
        const action = message.action;
        return <article key={message.id} className={`grid max-w-3xl gap-1 ${isUser ? 'justify-self-end justify-items-start' : 'justify-self-start justify-items-end'}`}>
          <div className={`rounded-2xl p-3 text-sm leading-6 sm:p-4 ${isUser ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]'}`}>
            <p className="whitespace-pre-line">{message.text}</p>
            {action && <div className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--text)]">
              <p className="flex items-center gap-2 text-sm font-bold text-[var(--link)]"><Sparkles size={17} />اقتراح من المساعد</p>
              <pre className="max-h-44 overflow-auto rounded-lg bg-[var(--bg)] p-3 text-xs leading-5" dir="ltr">{JSON.stringify(action, null, 2)}</pre>
              {message.actionExecuted ? <p className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300"><CheckCircle2 size={17} />اتنفّذ الإجراء</p>
                : <button type="button" onClick={() => onExecute(message.id, action)} className="min-h-11 rounded-lg bg-[var(--primary)] px-3 text-sm font-bold text-white">نفّذ الإجراء</button>}
            </div>}
          </div>
          <time className="px-2 text-xs text-[var(--text-muted)]">{message.timestamp}</time>
        </article>;
      })}
      {isPending && <p className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text-muted)]" role="status"><Bot size={17} className="animate-pulse" />مساعد وصلة بيحلّل بيانات الفريق...</p>}
      <div ref={endRef} />
    </div>
  );
}
