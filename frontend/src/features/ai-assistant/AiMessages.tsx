import { AlertTriangle, Bot, CheckCircle2, LoaderCircle, Sparkles, UserRound } from 'lucide-react';
import type { RefObject } from 'react';
import type { AiAction, AiMessage } from './api';
import { useLocale } from '../../i18n/useLocale';

type Translate = (arabic: string, english: string) => string;
type ActionDetail = { label: string; value: string };

function readableValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => typeof item === 'string' || typeof item === 'number' ? String(item) : null)
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join('، ') : null;
  }
  return null;
}

function firstValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readableValue(value);
    if (text) return text;
  }
  return null;
}

function fieldLabel(key: string, t: Translate): string {
  const labels: Record<string, [string, string]> = {
    title: ['العنوان', 'Title'],
    description: ['الوصف', 'Description'],
    deadline_date: ['الموعد النهائي', 'Deadline'],
    assigned_to: ['المكلّفون', 'Assignees'],
    text: ['نص الملاحظة', 'Note text'],
    targetName: ['الاسم المستهدف', 'Target name'],
    full_name: ['الاسم الكامل', 'Full name'],
    email: ['البريد الإلكتروني', 'Email'],
    phone: ['الهاتف', 'Phone'],
    device: ['الجهاز', 'Device'],
    bio: ['نبذة', 'Bio'],
    can_go_alexandria: ['متاح للإسكندرية', 'Available for Alexandria'],
    work_status: ['حالة العمل', 'Work status'],
  };
  const label = labels[key];
  return label ? t(label[0], label[1]) : key.replace(/_/g, ' ');
}

function getActionSummary(action: AiAction, t: Translate): { title: string; details: ActionDetail[]; isDestructive: boolean } {
  const payload = action.payload ?? {};
  const actionType = typeof action.type === 'string' ? action.type.trim().toLowerCase() : '';
  const details: ActionDetail[] = [];
  const addDetail = (label: string, value: unknown) => {
    const text = readableValue(value);
    if (text) details.push({ label, value: text });
  };
  let title: string;
  let isDestructive = false;

  switch (actionType) {
    case 'delete_member':
      title = t('حذف عضو', 'Delete member');
      isDestructive = true;
      addDetail(t('العضو', 'Member'), firstValue(action.name, payload.name, action.id, payload.id));
      break;
    case 'delete_task':
      title = t('حذف مهمة', 'Delete task');
      isDestructive = true;
      addDetail(t('المهمة', 'Task'), firstValue(action.title, payload.title, action.name, action.id, payload.id));
      break;
    case 'delete_note':
      title = t('حذف ملاحظة', 'Delete note');
      isDestructive = true;
      addDetail(t('رقم الملاحظة', 'Note ID'), firstValue(action.id, payload.id));
      addDetail(t('نص الملاحظة', 'Note text'), payload.text);
      break;
    case 'create_task':
      title = t('إنشاء مهمة', 'Create task');
      addDetail(t('العنوان', 'Title'), payload.title);
      addDetail(t('الوصف', 'Description'), payload.description);
      addDetail(t('الموعد النهائي', 'Deadline'), payload.deadline_date);
      addDetail(t('المكلّفون', 'Assignees'), payload.assigned_to);
      break;
    case 'add_note':
      title = t('إضافة ملاحظة', 'Add note');
      addDetail(t('نص الملاحظة', 'Note text'), payload.text);
      addDetail(t('الاسم المستهدف', 'Target name'), payload.targetName);
      break;
    case 'create_member':
      title = t('إضافة عضو', 'Add member');
      addDetail(t('الاسم الكامل', 'Full name'), payload.full_name);
      addDetail(t('البريد الإلكتروني', 'Email'), payload.email);
      addDetail(t('الهاتف', 'Phone'), payload.phone);
      addDetail(t('الجهاز', 'Device'), payload.device);
      break;
    case 'update_member': {
      title = t('تحديث بيانات عضو', 'Update member');
      addDetail(t('العضو', 'Member'), firstValue(action.name, payload.name, action.id, payload.id));
      const patch = action.patch ?? payload.patch;
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        for (const [key, value] of Object.entries(patch)) {
          addDetail(fieldLabel(key, t), value);
        }
      }
      break;
    }
    default:
      title = t('اقتراح إجراء', 'Suggested action');
  }

  return { title, details, isDestructive };
}

export function AiMessages({
  messages,
  isPending,
  onExecute,
  endRef,
}: {
  messages: AiMessage[];
  isPending: boolean;
  onExecute: (id: string, action: AiAction) => void;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useLocale();

  return (
    <div
      className="flex min-h-72 flex-1 flex-col gap-4 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-5"
      role="log"
      aria-label={t('سجل المحادثة مع مساعد PHANTOMS', 'Conversation with PHANTOMS Assistant')}
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={isPending}
      tabIndex={0}
    >
      {messages.map((message) => {
        const isUser = message.sender === 'user';
        const action = message.action;
        const summary = action ? getActionSummary(action, t) : null;
        const messageText = message.id === 'welcome'
          ? t('أهلاً بيك! أنا مساعد PHANTOMS الذكي. اسألني عن الفريق والمهام أو اطلب مني أعمل مهمة أو ملاحظة.', 'Hello! I’m the PHANTOMS assistant. Ask about the team and tasks, or request a task or note.')
          : message.text;

        return (
          <article
            key={message.id}
            className={`flex w-full max-w-3xl flex-col gap-1 ${isUser ? 'self-end' : 'self-start'}`}
            aria-label={isUser ? t('رسالة منك', 'Your message') : message.status === 'error' ? t('تعذّر إكمال الطلب', 'Request could not be completed') : t('رسالة من المساعد', 'Assistant message')}
          >
            <div className={`flex items-center gap-1.5 px-1 text-xs font-bold ${isUser ? 'self-end text-[var(--link)]' : 'self-start text-[var(--text-muted)]'}`}>
              {isUser ? <UserRound size={14} aria-hidden="true" /> : message.status === 'error' ? <AlertTriangle size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
              <span>{isUser ? t('أنت', 'You') : 'PHANTOMS Assistant'}</span>
            </div>
            <div
              className={`min-w-0 max-w-full rounded-2xl p-3 text-sm leading-6 shadow-[var(--shadow-sm)] sm:p-4 ${
                message.status === 'error'
                  ? 'border border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]'
                  : isUser
                    ? 'bg-[var(--primary)] text-white'
                    : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]'
              }`}
            >
              <p className="whitespace-pre-wrap break-words" dir="auto" role={message.status === 'error' ? 'alert' : undefined}>{messageText}</p>
              {action && summary && (
                <section className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--text)]" aria-label={t('تفاصيل الإجراء المقترح', 'Suggested action details')}>
                  <h3 className={`flex items-center gap-2 text-sm font-bold ${summary.isDestructive ? 'text-[var(--danger)]' : 'text-[var(--link)]'}`}>
                    {summary.isDestructive ? <AlertTriangle size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
                    {summary.title}
                  </h3>
                  {summary.details.length > 0 ? (
                    <dl className="grid min-w-0 gap-x-3 gap-y-2 rounded-lg bg-[var(--bg)] p-3 text-sm sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)]">
                      {summary.details.map((detail, index) => (
                        <div key={`${detail.label}-${index}`} className="grid min-w-0 gap-x-3 gap-y-0.5 sm:col-span-2 sm:grid-cols-subgrid">
                          <dt className="font-semibold text-[var(--text-muted)]">{detail.label}</dt>
                          <dd className="min-w-0 break-words text-[var(--text)]" dir="auto">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-xs leading-5 text-[var(--text-muted)]">{t('لا تتوفر تفاصيل إضافية للعرض.', 'No additional details are available to display.')}</p>
                  )}
                  {message.actionExecuted ? (
                    <p className="flex items-center gap-2 text-sm font-bold text-[var(--success-text)]" role="status">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      {t('تم تنفيذ الإجراء بنجاح', 'Action executed successfully')}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onExecute(message.id, action)}
                      className={`min-h-11 rounded-lg px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
                        summary.isDestructive ? 'bg-[var(--danger)] focus-visible:outline-[var(--danger)]' : 'bg-[var(--primary)]'
                      }`}
                    >
                      {summary.isDestructive ? t('مراجعة وتأكيد الحذف', 'Review and confirm deletion') : t('مراجعة وتنفيذ الإجراء', 'Review and execute action')}
                    </button>
                  )}
                </section>
              )}
            </div>
            <time className="px-2 text-xs text-[var(--text-muted)]" dir="ltr">{message.timestamp}</time>
          </article>
        );
      })}
      {isPending && (
        <p className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text-muted)]" role="status">
          <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
          {t('جارٍ إعداد الرد...', 'Preparing a response...')}
        </p>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
