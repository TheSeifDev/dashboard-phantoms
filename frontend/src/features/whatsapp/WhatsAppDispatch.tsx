import { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Member, Task } from '../../types/db';
import type { WhatsAppSendResult } from './api';
import { WhatsAppConfirmModal } from './WhatsAppConfirmModal';
import { formatDeadline } from '../../lib/dateUtils';
import { taskBonus } from '../tasks/taskMeta';

import { useLocale } from '../../i18n/useLocale';
interface Props {
  task: Task;
  members: Member[];
  isConnected: boolean;
  isDryRun: boolean;
  isPending: boolean;
  result?: WhatsAppSendResult;
  error?: string;
  onSend: (confirmed: boolean) => void;
}

export function buildTaskMessage(task: Task, member: Member): string {
  const formatArabicDate = (value: string) => formatDeadline(value, { weekday: true, year: 'always' });

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const deadlineText = task.has_deadline && task.deadline_date
    ? `\nالموعد النهائي لإنجاز المهمة: ${formatArabicDate(task.deadline_date)}`
    : '';
  const bonus = taskBonus(task);
  const bonusText = bonus > 0 ? `\nبونص المهمة بعد الاعتماد: ${bonus} نقطة` : '';

  return (
    `السلام عليكم ${member.full_name}،\n\n` +
    `حابين نبلغك إن اتسندت لك مهمة جديدة على منصة PHANTOMS بعنوان:\n` +
    `«${task.title}»${deadlineText}${bonusText}\n\n` +
    `من فضلك ادخل على بوابة PHANTOMS عشان تراجع تفاصيل المهمة وتبدأ التنفيذ:\n` +
    `${baseUrl}/login\n\n` +
    `نتمنالك التوفيق،\n` +
    `فريق إدارة PHANTOMS.`
  );
}

export function WhatsAppDispatch({ task, members, isConnected, isDryRun, isPending, result, error, onSend }: Props) {
  const { t, dir, number } = useLocale();
  const [openModal, setOpenModal] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [previewMemberIndex, setPreviewMemberIndex] = useState(0);

  const activeMember = members[previewMemberIndex] ?? members[0];
  const renderedPreview = activeMember ? buildTaskMessage(task, activeMember) : '';

  const handleOpenModal = () => {
    if (!consentConfirmed || members.length === 0 || !isConnected) return;
    setOpenModal(true);
  };

  const handleConfirmSend = () => {
    onSend(true);
    setOpenModal(false);
  };

  return (
    <div className="grid gap-4 border-t border-[var(--border)] pt-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-black text-[var(--text)]">{t('3. راجع الرسالة والتأكيد', '3. Review and confirm')}</h3>
        <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-bold text-[var(--text-muted)]">{number(members.length)} {t('مستلم', 'recipients')}</span>
      </div>

      {activeMember ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-extrabold text-[var(--text)]">
              <Eye size={16} className="text-[var(--primary-ink)]" aria-hidden="true" />
              <span>{t('معاينة رسالة المستلم', 'Recipient message preview')}</span>
            </span>

            {members.length > 1 && (
              <label className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>{t('المستلم:', 'Recipient:')}</span>
                <select
                  value={previewMemberIndex}
                  onChange={(event) => setPreviewMemberIndex(Number(event.target.value))}
                  className="min-h-10 max-w-[min(60vw,18rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs font-bold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  {members.map((member, index) => <option key={member.id} value={index}>{member.full_name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div dir="auto" className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-sans text-xs leading-6 text-[var(--text)] whitespace-pre-wrap">{renderedPreview}</div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">{t('اختر مستلمًا واحدًا على الأقل لمراجعة الرسالة.', 'Select at least one recipient to review the message.')}</p>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          checked={consentConfirmed}
          onChange={(event) => setConsentConfirmed(event.target.checked)}
        />
        <span>{t('أؤكد أن المستلمين المحددين وافقوا بوضوح على استقبال إشعارات المهام عبر واتساب، وأن الرسالة تخص مهامًا مسندة إليهم فقط.', 'I confirm the selected recipients explicitly consented to WhatsApp task notifications and that messages concern only tasks assigned to them.')}</span>
      </label>

      <Button
        type="button"
        icon={<Send size={17} aria-hidden="true" />}
        disabled={members.length === 0 || !isConnected || !consentConfirmed || isPending}
        isLoading={isPending}
        loadingText={t('جارٍ تنفيذ الإرسال…', 'Sending…')}
        onClick={handleOpenModal}
        fullOnMobile
      >
        {isDryRun ? t('مراجعة إرسال تجريبي', 'Review test send') : t('مراجعة الإرسال عبر واتساب', 'Review WhatsApp send')} ({number(members.length)})
      </Button>

      {!isConnected && (
        <p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('لا يمكن المتابعة قبل اتصال جلسة واتساب.', 'Connect the WhatsApp session before continuing.')}</p>
      )}
      {isConnected && members.length === 0 && (
        <p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('اختر مستلمًا واحدًا على الأقل للمتابعة.', 'Select at least one recipient to continue.')}</p>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </p>
      )}

      {result && (
        <div role="status" aria-live="polite" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
          <p className="mb-2 flex items-center gap-2 font-bold text-[var(--text)]">
            <CheckCircle2 size={18} className="text-[var(--success-text)]" aria-hidden="true" />
            <span>{t('نتيجة الإرسال:', 'Send result:')}</span>
          </p>
          <ul className="list-inside list-disc">
            <li>{t('تم بنجاح:', 'Sent successfully:')} <b>{number(result.sent)}</b></li>
            <li>{t('لم ينجح:', 'Failed:')} <b>{number(result.failed)}</b></li>
            {result.errors && result.errors.length > 0 && <li className="break-words text-[var(--danger)]">{t('التفاصيل:', 'Details:')} {result.errors.join('، ')}</li>}
          </ul>
        </div>
      )}

      {activeMember && (
        <WhatsAppConfirmModal
          isOpen={openModal}
          onClose={() => setOpenModal(false)}
          taskTitle={task.title}
          recipientCount={members.length}
          previewMemberName={activeMember.full_name}
          messagePreview={renderedPreview}
          isDryRun={isDryRun}
          isPending={isPending}
          onConfirm={handleConfirmSend}
        />
      )}
    </div>
  );
}
