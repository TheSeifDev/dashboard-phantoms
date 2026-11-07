// =====================================================
// طبقة بيانات المهام — Online-First صارمة
// لا قاعدة ظل. لا سقوط صامت. الاعتماد إداري (الخادم يفرضه بالـ Trigger).
// =====================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { TABLES } from '../../types/db';
import type { RevokeTaskApprovalResult, Task, TaskInsert, TaskStatus, TaskTrackingEntry } from '../../types/db';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { isPositiveId, safeHref } from '../../lib/validators';
import { EVAL_CARRIER_PREFIX } from '../evaluations/api';
import { sendPushNotification } from '../../lib/api/push';

/** الحالات المسموحة من بوابة الأعضاء — approved لا تمر من هنا أبداً */
const MEMBER_WRITABLE_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'under_review', 'revision_requested'];

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLES.tasks)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw toAppError(error, 'حصلت مشكلة وإحنا بنحمّل المهام.');
      return ((data ?? []) as Task[]).filter((t) => !t.title.startsWith(EVAL_CARRIER_PREFIX));
    },
  });
};

/** بوابة الأعضاء لا تقرأ جدول المهام مباشرة؛ الخادم يرجع تكليفات العضو وحالة تتبعه فقط. */
export const useMemberTasks = (memberId: number | undefined) => {
  return useQuery({
    queryKey: ['member-tasks', memberId],
    enabled: isPositiveId(memberId),
    queryFn: async (): Promise<Task[]> => {
      const deviceToken = getDeviceToken();
      if (!memberId || !deviceToken) {
        throw new Error('DEVICE_REQUIRED: سجّل دخولك من جديد للتحقق من جلسة الجهاز.');
      }
      const { data, error } = await supabase.rpc('get_member_tasks', {
        p_member_id: memberId,
        p_device_token: deviceToken,
      });
      if (error) throw toAppError(error, 'معرفناش نحمّل مهامك.');
      if (!Array.isArray(data)) throw new Error('INVALID_MEMBER_TASKS: بيانات المهام غير صالحة.');
      return (data as Task[]).filter((t) => !t.title.startsWith(EVAL_CARRIER_PREFIX));
    },
    staleTime: 10_000,
  });
};

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (newTask: TaskInsert): Promise<Task & { bonusSkipped?: boolean }> => {
      const notifyAssigned = (taskTitle: string, taskDesc?: string | null, trackingObj?: Record<string, TaskTrackingEntry> | null) => {
        if (!trackingObj || taskTitle.startsWith(EVAL_CARRIER_PREFIX)) return;
        const members = Object.keys(trackingObj).map(Number).filter((id) => Number.isInteger(id) && id > 0);
        if (members.length === 0) return;
        for (let i = 0; i < members.length; i += 50) {
          const chunk = members.slice(i, i + 50);
          void sendPushNotification(
            `مهمة جديدة: ${taskTitle}`,
            (taskDesc || 'تم إسناد مهمة جديدة ليك على بوابة وصلة تك.').slice(0, 120),
            chunk,
            '/portal',
          ).catch(() => {});
        }
      };

      const insert = (row: TaskInsert) => supabase.from(TABLES.tasks).insert(row).select().single();
      const { data, error } = await insert(newTask);
      if (!error) {
        notifyAssigned(newTask.title, newTask.description, newTask.tracking);
        return data as Task;
      }
      // قبل تطبيق migration 0012 لا يوجد عمود bonus_points — ننشئ المهمة بدونه ولا نخسر ما كتبه المسؤول
      const missingBonusColumn = 'bonus_points' in newTask && /bonus_points/i.test(`${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`);
      if (!missingBonusColumn) throw toAppError(error, 'معرفناش نعمل المهمة.');
      const withoutBonus: TaskInsert = { ...newTask };
      delete withoutBonus.bonus_points;
      const retry = await insert(withoutBonus);
      if (retry.error) throw toAppError(retry.error, 'معرفناش نعمل المهمة.');
      notifyAssigned(newTask.title, newTask.description, newTask.tracking);
      return { ...(retry.data as Task), bonusSkipped: true };
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['member-tasks'] }),
    ]),
  });
};

/** تفويض عضو لحالة داخل تتبع المهمة (tracking JSONB) */
const buildTrackingPatch = (
  currentTracking: Record<string, TaskTrackingEntry>,
  memberId: number,
  entry: TaskTrackingEntry
): Record<string, TaskTrackingEntry> => ({
  ...currentTracking,
  [memberId.toString()]: {
    ...currentTracking[memberId.toString()],
    ...entry,
    updated_at: new Date().toISOString(),
  },
});

export const useUpdateTaskStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      memberId,
      status,
      note,
      submissionUrl,
    }: {
      taskId: number;
      memberId: number;
      status: TaskStatus;
      note?: string;
      submissionUrl?: string;
      currentTracking?: Record<string, TaskTrackingEntry>;
    }) => {
      // تحقق client-side (الدفاع الحقيقي في submit_task_status server-side)
      if (!isPositiveId(taskId) || !isPositiveId(memberId)) {
        throw new Error('بيانات المهمة أو العضو مش صحيحة.');
      }
      if (!MEMBER_WRITABLE_STATUSES.includes(status)) {
        throw new Error('حالة المهمة دي مش مسموحة.');
      }
      const cleanNote = (note || '').slice(0, 2000);
      const rawUrl = (submissionUrl || '').trim().slice(0, 2048);
      if (rawUrl && !safeHref(rawUrl)) {
        throw new Error('رابط التسليم مش صالح — لازم يبدأ بـ http:// أو https://.');
      }
      // الخادم يرقّع مفتاح هذا العضو فقط بعد التحقق من جهازه وتكليفه —
      // لا نرسل tracking كاملاً من العميل (منع الكتابة فوق مفاتيح الآخرين).
      const { error } = await supabase.rpc('submit_task_status', {
        p_task_id: taskId,
        p_member_id: memberId,
        p_device_token: getDeviceToken(),
        p_status: status,
        p_note: cleanNote,
        p_submission_url: rawUrl,
      });

      if (error) throw toAppError(error, 'معرفناش نحدّث حالة المهمة.');
      if (useAuthStore.getState().currentMember?.id === memberId) {
        const deviceToken = getDeviceToken();
        if (!deviceToken) throw new Error('DEVICE_REQUIRED: سجّل دخولك من جديد للتحقق من جلسة الجهاز.');
        const { data: memberTasks, error: memberFetchError } = await supabase.rpc('get_member_tasks', {
          p_member_id: memberId,
          p_device_token: deviceToken,
        });
        if (memberFetchError) throw toAppError(memberFetchError, 'معرفناش نحدّث حالة المهمة.');
        const updatedTask = (memberTasks as Task[] | null)?.find((task) => task.id === taskId);
        if (!updatedTask) throw new Error('MEMBER_TASK_NOT_FOUND: المهمة مش موجودة في تكليفاتك.');
        return updatedTask;
      }
      const { data, error: fetchError } = await supabase
        .from(TABLES.tasks)
        .select('*')
        .eq('id', taskId)
        .single();
      if (fetchError) throw toAppError(fetchError, 'معرفناش نحدّث حالة المهمة.');
      return data as Task;
    },
    // تحديث تفاؤلي يشعر العضو بفورية تسليمه، مع تراجع عند الفشل
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      const optimisticTracking = buildTrackingPatch(vars.currentTracking ?? {}, vars.memberId, {
        status: vars.status,
        note: vars.note || '',
        submission_url: vars.submissionUrl || '',
        updated_at: new Date().toISOString(),
      });
      qc.setQueryData<Task[]>(['tasks'], (old) =>
        old?.map((t) => (t.id === vars.taskId ? { ...t, tracking: optimisticTracking } : t)) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['member-tasks'] }),
    ]),
  });
};

/**
 * اعتماد تسليم عضو + منحه نقاطاً — ذرّياً عبر RPC واحدة.
 * migration 0003: approve_task_submission تحدّث tasks.tracking و members.completion_rank
 * في معاملة PostgreSQL واحدة — لا احتمال لاعتماد بدون نقاط أو العكس.
 */
export const useApproveTaskSubmission = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      memberId,
      bonus = 0,
    }: {
      taskId: number;
      memberId: number;
      bonus?: number;
    }) => {
      const { data, error } = await supabase
        .rpc('approve_task_submission', { p_task_id: taskId, p_member_id: memberId, p_bonus: bonus })
        .single();

      if (error) throw toAppError(error, 'معرفناش نسجّل اعتماد المهمة.');
      void sendPushNotification(
        'تم اعتماد مهمتك',
        'اعتمدت الإدارة تسليم مهمتك وأضافت نقاط البونص لرصيدك.',
        [memberId],
        '/portal',
      ).catch(() => {});
      // bonus_awarded / total_bonus تأتي من migration 0012 — قبلها تغيب فنعرض ما أرسلناه
      const result = (data ?? {}) as { bonus_awarded?: number; total_bonus?: number; completion_rank?: number };
      return {
        bonusAwarded: result.bonus_awarded ?? bonus,
        totalBonus: typeof result.total_bonus === 'number' ? result.total_bonus : null,
        completionRank: result.completion_rank ?? null,
      };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['member-bonus'] });
      qc.invalidateQueries({ queryKey: ['member-tasks'] });
    },
  });
};

export const useRevokeTaskApproval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, memberId, reason }: { taskId: number; memberId: number; reason: string }): Promise<RevokeTaskApprovalResult> => {
      const { data, error } = await supabase.rpc('revoke_task_approval', {
        p_task_id: taskId,
        p_member_id: memberId,
        p_reason: reason.trim(),
      });
      if (error) throw toAppError(error, 'معرفناش نلغي اعتماد المهمة.');
      return data as RevokeTaskApprovalResult;
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['members'] }),
        qc.invalidateQueries({ queryKey: ['notes'] }),
        qc.invalidateQueries({ queryKey: ['member-bonus'] }),
        qc.invalidateQueries({ queryKey: ['member-tasks'] }),
      ]);
    },
  });
};

export const useDeleteTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: number) => {
      const { error } = await supabase.from(TABLES.tasks).delete().eq('id', taskId);
      if (error) throw toAppError(error, 'معرفناش نمسح المهمة.');
      return taskId;
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['member-tasks'] }),
    ]),
  });
};
