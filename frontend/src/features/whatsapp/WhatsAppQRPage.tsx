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

export default function WhatsAppQRPage() {
  const [taskId, setTaskId] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: getWhatsAppStatus,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.enabled && !query.state.data.connected ? 2000 : false,
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
    const assigned =
      task.assigned_to === 'ALL'
        ? null
        : new Set((Array.isArray(task.assigned_to) ? task.assigned_to : []).map(String));
    return members.data.filter(
      (member) =>
        member.phone?.trim() &&
        (!assigned || assigned.has(String(member.id))) &&
        member.work_status !== 'inactive'
    );
  }, [members.data, task]);

  const actionPending =
    connect.isPending || simulatePair.isPending || disconnect.isPending || revoke.isPending;
  const actionError = connect.error ?? simulatePair.error ?? disconnect.error ?? revoke.error;

  const toggleMember = (id: number) => {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    dispatch.reset();
  };

  return (
    <section className="grid gap-4" dir="rtl">
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          <MessageCircle />
        </span>
        <div>
          <h2 className="text-[var(--fs-xl)] font-black">ربط واتساب عن طريق QR (Baileys Mock)</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            اربط رقم البعت التاني باستخدام محاكاة Baileys، وبعد كده اختار الأعضاء عشان تبعت لهم التكليفات مرة واحدة.
          </p>
        </div>
      </header>

      <WhatsAppQRViewer
        status={status.data}
        loading={status.isLoading}
        error={status.isError ? status.error.message : actionError?.message}
        pending={actionPending}
        onConnect={() => connect.mutate()}
        onSimulatePair={() => simulatePair.mutate()}
        onDisconnect={() => disconnect.mutate()}
        onRevoke={() => revoke.mutate()}
      />

      <Card className="grid gap-4">
        <label className="grid gap-2 text-sm font-bold">
          اختار المهمة
          <select
            className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            value={taskId}
            onChange={(event) => {
              setTaskId(event.target.value);
              setMemberIds([]);
              dispatch.reset();
            }}
          >
            <option value="">اختار مهمة...</option>
            {(tasks.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        {tasks.isError && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            منعرفناش نحمّل المهام.{' '}
            <button className="underline" onClick={() => void tasks.refetch()}>
              جرّب تاني
            </button>
          </p>
        )}

        {task && (
          <>
            <WhatsAppMemberPicker
              eligible={eligible}
              memberIds={memberIds}
              loading={members.isLoading}
              onToggle={toggleMember}
              onSelectAll={() => setMemberIds(eligible.map((item) => item.id))}
              onDeselectAll={() => setMemberIds([])}
            />

            <WhatsAppDispatch
              task={task}
              members={eligible.filter((item) => memberIds.includes(item.id))}
              isConnected={Boolean(status.data?.connected || status.data?.dryRun)}
              isPending={dispatch.isPending}
              result={dispatch.data}
              error={dispatch.error?.message}
              onSend={(confirmed) => dispatch.mutate(confirmed)}
            />
          </>
        )}
      </Card>

      <Card className="flex items-start gap-3 bg-amber-50 text-sm leading-6 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-1 shrink-0" size={18} />
        <p>
          تنبيه: Baileys عميل مش رسمي، واستخدامه ممكن يخالف إرشادات واتساب ويعرّض الرقم للإيقاف. استخدمه على مسؤوليتك، وللتواصل الداخلي المسموح بس. مفيش رسائل تلقائية أو بعت جماعي؛ راجع موافقة العضو وشكل كل رسالة قبل ما تأكدها.
        </p>
      </Card>
    </section>
  );
}
