import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageCircle } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  revokeWhatsAppSession,
  sendWhatsAppTask,
  simulatePairWhatsApp,
} from './api';
import { WhatsAppDispatch } from './WhatsAppDispatch';
import { WhatsAppMemberPicker } from './WhatsAppMemberPicker';
import { WhatsAppQRViewer } from './WhatsAppQRViewer';

import { useLocale } from '../../i18n/useLocale';
export default function WhatsAppQRPage() {
  const { t, dir } = useLocale();
  const [taskId, setTaskId] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: getWhatsAppStatus,
    retry: false,
    refetchInterval: (query) => query.state.data?.enabled && !query.state.data.connected ? 2000 : false,
  });

  const tasks = useTasks();
  const members = useMembers();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });

  const connect = useMutation({ mutationFn: connectWhatsApp, onSuccess: refresh });
  const simulatePair = useMutation({ mutationFn: simulatePairWhatsApp, onSuccess: refresh });
  const disconnect = useMutation({ mutationFn: disconnectWhatsApp, onSuccess: refresh });
  const revoke = useMutation({ mutationFn: revokeWhatsAppSession, onSuccess: refresh });
  const dispatch = useMutation({
    mutationFn: (confirmed: boolean) => sendWhatsAppTask(Number(taskId), memberIds, confirmed),
  });

  const task = tasks.data?.find((item) => String(item.id) === taskId);

  const eligible = useMemo(() => {
    if (!task || !members.data) return [];
    const assigned = task.assigned_to === 'ALL'
      ? null
      : new Set((Array.isArray(task.assigned_to) ? task.assigned_to : []).map(String));
    return members.data.filter(
      (member) => member.phone?.trim() && (!assigned || assigned.has(String(member.id))) && member.work_status !== 'inactive'
    );
  }, [members.data, task]);

  const actionPending = connect.isPending || simulatePair.isPending || disconnect.isPending || revoke.isPending;
  const actionError = connect.error ?? simulatePair.error ?? disconnect.error ?? revoke.error;

  const toggleMember = (id: number) => {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    dispatch.reset();
  };

  return (
    <section className="grid gap-4" dir={dir}>
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--success-soft)] text-[var(--success-text)]">
          <MessageCircle aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[var(--fs-xl)] font-black">{t('ربط واتساب التجريبي عبر QR', 'Connect WhatsApp test session via QR')}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
            {t('اربط رقم الاختبار، ثم اختر مهمة ومستلمين مؤهلين. راجع الرسالة وأكد الإرسال يدويًا.', 'Link the test number, then choose a task and eligible recipients. Review the message and confirm sending manually.')}
          </p>
        </div>
      </header>

      <WhatsAppQRViewer
        status={status.data}
        loading={status.isLoading}
        statusError={status.isError}
        error={status.isError ? status.error.message : actionError?.message}
        pending={actionPending}
        onRetryStatus={() => { void status.refetch(); }}
        onConnect={() => connect.mutate()}
        onSimulatePair={() => simulatePair.mutate()}
        onDisconnect={() => disconnect.mutate()}
        onRevoke={() => revoke.mutate()}
      />

      <Card className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor="whatsapp-task-select" className="text-sm font-bold text-[var(--text)]">{t('المهمة', 'Task')}</label>
          <select
            id="whatsapp-task-select"
            className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            value={taskId}
            disabled={tasks.isLoading}
            onChange={(event) => {
              setTaskId(event.target.value);
              setMemberIds([]);
              dispatch.reset();
            }}
          >
            <option value="">{t('اختر مهمة…', 'Select a task…')}</option>
            {(tasks.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {tasks.isLoading && <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">{t('جارٍ تحميل المهام…', 'Loading tasks…')}</p>}
        </div>

        {tasks.isError && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {t('تعذر تحميل المهام.', 'Could not load tasks.')}{' '}
            <button type="button" className="min-h-11 rounded px-1 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => void tasks.refetch()}>{t('إعادة المحاولة', 'Try again')}</button>
          </p>
        )}

        {!task && !tasks.isLoading && !tasks.isError && (
          <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm leading-6 text-[var(--text-muted)]">{t('ابدأ باختيار المهمة لعرض الأعضاء المسندة إليهم فقط.', 'Select a task to see only the members assigned to it.')}</p>
        )}

        {task && (
          <>
            {members.isError ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {t('تعذر تحميل قائمة الأعضاء.', 'Could not load the recipient list.')}{' '}
                <button type="button" className="min-h-11 rounded px-1 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => void members.refetch()}>{t('إعادة المحاولة', 'Try again')}</button>
              </p>
            ) : (
              <WhatsAppMemberPicker
                eligible={eligible}
                memberIds={memberIds}
                loading={members.isLoading}
                onToggle={toggleMember}
                onSelectAll={() => setMemberIds(eligible.map((item) => item.id))}
                onDeselectAll={() => setMemberIds([])}
              />
            )}

            <WhatsAppDispatch
              task={task}
              members={eligible.filter((item) => memberIds.includes(item.id))}
              isConnected={Boolean(status.data?.connected || status.data?.dryRun)}
              isDryRun={Boolean(status.data?.dryRun)}
              isPending={dispatch.isPending}
              result={dispatch.data}
              error={dispatch.error?.message}
              onSend={(confirmed) => dispatch.mutate(confirmed)}
            />
          </>
        )}
      </Card>

      <Card className="flex items-start gap-3 border-amber-300 bg-amber-50 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-1 shrink-0 text-amber-600 dark:text-amber-400" size={18} aria-hidden="true" />
        <p>
          {t('تنبيه: Baileys عميل مش رسمي، واستخدامه ممكن يخالف إرشادات واتساب ويعرّض الرقم للإيقاف. استخدمه على مسؤوليتك وللتواصل الداخلي المسموح فقط. راجع موافقة كل مستلم ومحتوى الرسالة قبل التأكيد.', 'Warning: Baileys is unofficial and may violate WhatsApp guidelines or put the number at risk of suspension. Use it at your own risk and only for permitted internal communication. Verify each recipient’s consent and review the message before confirming.')}
        </p>
      </Card>
    </section>
  );
}
