import { useEffect, useRef, useState } from 'react';
import { useAskPhantomsAi, type AiAction, type AiChatTurn, type AiMessage } from './api';
import { useCreateTask, useDeleteTask } from '../tasks/api';
import { useCreateNote, useDeleteNote } from '../notes/api';
import { useAddMember, useUpdateMember, useDeleteMember } from '../members/api';
import { toast } from '../../store/toast';
import type { Member, Task } from '../../types/db';

export interface AiPendingConfirmation {
  messageId: string;
  action: AiAction;
  actionType: 'delete_member' | 'delete_task' | 'delete_note';
  actionTypeName: string;
  targetEntityName: string;
  targetId: string | number;
  details?: string;
}

export function useAiConversation(members: Member[], tasks: Task[]) {
  const ask = useAskPhantomsAi();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const addMember = useAddMember();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const [messages, setMessages] = useState<AiMessage[]>([{
    id: 'welcome',
    sender: 'assistant',
    text: 'أهلاً بيك! أنا مساعد PHANTOMS الذكي. اسألني عن الفريق والمهام أو اطلب مني أعمل مهمة أو ملاحظة.',
    timestamp: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
  }]);
  const [pendingConfirmation, setPendingConfirmation] = useState<AiPendingConfirmation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildContext = () => JSON.stringify({
    metrics: {
      totalMembers: members.length,
      laptopCount: members.filter((member) => member.device?.includes('لابتوب')).length,
      alexandriaReadinessCount: members.filter((member) => member.can_go_alexandria).length,
      activeTasksCount: tasks.filter((task) => Object.values(task.tracking ?? {}).some((entry) => entry.status !== 'approved')).length,
    },
    members: members.slice(0, 50).map((member) => ({
      id: member.id, name: member.full_name, email: member.email,
      device: member.device, can_go_alexandria: member.can_go_alexandria,
      bio: (member.bio ?? '').slice(0, 200),
    })),
    tasks: tasks.slice(0, 20).map((task) => ({ id: task.id, title: task.title, deadline: task.deadline_date, tracking: task.tracking })),
  });

  const sendMessage = async (value: string) => {
    const text = value.trim();
    if (!text || ask.isPending) return;
    const userMessage: AiMessage = {
      id: Date.now().toString(), sender: 'user', text,
      timestamp: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((current) => [...current, userMessage]);

    // Build chat history turns for multi-turn conversational context (BUG-01 fix)
    const history: AiChatTurn[] = messages
      .filter((m) => m.id !== 'welcome')
      .slice(-10)
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        parts: [{ text: m.text }],
      }));

    try {
      const response = await ask.mutateAsync({ question: text, context: buildContext(), history });
      setMessages((current) => [...current, {
        id: (Date.now() + 1).toString(), sender: 'assistant', text: response.answer || 'اتنفّذ طلبك.',
        timestamp: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
        action: response.action || null, actionExecuted: false,
      }]);
    } catch (cause) {
      setMessages((current) => [...current, {
        id: (Date.now() + 1).toString(), sender: 'assistant',
        text: `آسف، حصلت مشكلة وأنا بعالج طلبك: ${cause instanceof Error ? cause.message : 'معرفناش نوصل للمساعد الذكي.'}`,
        timestamp: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
      }]);
    }
  };

  /**
   * Strict member resolution: requires exact ID or exact full name.
   * Rejects ambiguous, partial, or multiple matches to prevent accidental mutations.
   */
  const resolveTargetMember = (actionId?: unknown, targetName?: string | null): Member => {
    const memberId = Number(actionId);
    if (!isNaN(memberId) && memberId > 0) {
      const byId = members.find((m) => m.id === memberId);
      if (byId) return byId;
    }

    if (!targetName || !targetName.trim()) {
      throw new Error('اسم أو معرّف العضو مطلوب لتنفيذ هذا الإجراء.');
    }

    const clean = targetName.trim().replace(/\s+/g, ' ').toLowerCase();
    const exact = members.find((m) => m.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === clean);
    if (exact) return exact;

    // Strict rejection of partial/loose substring matches
    const candidates = members.filter((m) => {
      const name = m.full_name.trim().replace(/\s+/g, ' ').toLowerCase();
      return name.includes(clean) || clean.includes(name);
    });

    if (candidates.length > 0) {
      const list = candidates.map((c) => c.full_name).join('، ');
      throw new Error(`لم يتم العثور على تطابق دقيق للاسم "${targetName}". المقترحات المحتملة: (${list}). يرجى كتابة الاسم كاملاً كما هو مسجل أو استخدام معرّف العضو.`);
    }

    throw new Error(`لم يتم العثور على أي عضو يطابق الاسم: "${targetName}".`);
  };

  /**
   * Strict task resolution: requires exact numeric ID or exact title match.
   */
  const resolveTargetTask = (actionId?: unknown, title?: string | null): Task => {
    const taskId = Number(actionId);
    if (!isNaN(taskId) && taskId > 0) {
      const byId = tasks.find((t) => t.id === taskId);
      if (byId) return byId;
    }
    if (!title || !title.trim()) {
      throw new Error('عنوان أو معرّف المهمة مطلوب لتنفيذ هذا الإجراء.');
    }
    const clean = title.trim().toLowerCase();
    const exact = tasks.find((t) => t.title.trim().toLowerCase() === clean);
    if (exact) return exact;
    throw new Error(`لم يتم العثور على مهمة تطابق العنوان "${title}" بدقة. يرجى تحديد العنوان الدقيق أو معرّف المهمة.`);
  };

  const executeAction = async (messageId: string, action: AiAction, isConfirmed = false) => {
    const payload = action.payload ?? {};
    const actionType = typeof action.type === 'string' ? action.type.trim().toLowerCase() : '';
    const stringValue = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

    try {
      // 1. Destructive Actions: Require explicit user confirmation modal first
      if (actionType === 'delete_member') {
        const targetName = action.name?.trim() ?? stringValue(payload.name);
        const member = resolveTargetMember(action.id ?? payload.id, targetName);
        if (!isConfirmed) {
          setPendingConfirmation({
            messageId,
            action,
            actionType: 'delete_member',
            actionTypeName: 'حذف عضو نهائيًا',
            targetEntityName: member.full_name,
            targetId: member.id,
            details: `البريد: ${member.email} | الجهاز: ${member.device || 'غير محدد'}`,
          });
          return;
        }
        await deleteMember.mutateAsync(member.id);
      } else if (actionType === 'delete_task') {
        const taskIdStr = stringValue(action.id) ?? stringValue(payload.id);
        const title = stringValue(action.title) ?? stringValue(payload.title) ?? action.name;
        const task = resolveTargetTask(taskIdStr, title);
        if (!isConfirmed) {
          setPendingConfirmation({
            messageId,
            action,
            actionType: 'delete_task',
            actionTypeName: 'حذف مهمة نهائيًا',
            targetEntityName: task.title,
            targetId: task.id,
            details: task.deadline_date ? `الموعد النهائي: ${task.deadline_date}` : 'بدون موعد نهائي',
          });
          return;
        }
        await deleteTask.mutateAsync(task.id);
      } else if (actionType === 'delete_note') {
        const noteId = Number(stringValue(action.id) ?? stringValue(payload.id));
        if (isNaN(noteId) || noteId <= 0) throw new Error('رقم الملاحظة غير صحيح.');
        if (!isConfirmed) {
          setPendingConfirmation({
            messageId,
            action,
            actionType: 'delete_note',
            actionTypeName: 'حذف ملاحظة نهائيًا',
            targetEntityName: `ملاحظة رقم #${noteId}`,
            targetId: noteId,
            details: stringValue(payload.text) ? `النص: "${payload.text}"` : undefined,
          });
          return;
        }
        await deleteNote.mutateAsync(noteId);
      } else if (actionType === 'create_task') {
        const rawAssigned = payload.assigned_to;
        const assignedTo: string[] | string = Array.isArray(rawAssigned) ? rawAssigned.map(String) : stringValue(rawAssigned) ?? 'ALL';
        await createTask.mutateAsync({
          title: stringValue(payload.title) ?? 'مهمة جديدة من المساعد الذكي',
          description: stringValue(payload.description),
          has_deadline: Boolean(payload.deadline_date),
          deadline_date: stringValue(payload.deadline_date),
          assigned_to: assignedTo,
          tracking: {},
        });
      } else if (actionType === 'add_note') {
        await createNote.mutateAsync({
          text: stringValue(payload.text) ?? 'ملاحظة من مساعد PHANTOMS الذكي (بدون نص).',
          author: 'PHANTOMS Assistant', author_role: 'AI Assistant',
          date: new Date().toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }),
          target_member_id: null,
          target_name: stringValue(payload.targetName),
        });
      } else if (actionType === 'create_member') {
        const fullName = stringValue(payload.full_name);
        const email = stringValue(payload.email)?.toLowerCase();
        if (!fullName || !email) throw new Error('اكتب الاسم والبريد عشان نعمل عضو.');
        await addMember.mutateAsync({
          full_name: fullName,
          email,
          phone: stringValue(payload.phone),
          device: stringValue(payload.device) ?? 'بدون',
          bio: stringValue(payload.bio),
          completion_rank: 0,
          team_notes: null,
          residence: null,
          work_conditions: null,
          gender: null,
          meeting_attendance: null,
          work_status: 'active',
          can_go_alexandria: false,
        });
      } else if (actionType === 'update_member') {
        const targetName = action.name?.trim() ?? stringValue(payload.name);
        const patch = action.patch ?? (payload.patch as Record<string, unknown> | undefined);
        if (!patch) {
          throw new Error('بيانات التعديل ناقصة في رد المساعد.');
        }
        const member = resolveTargetMember(action.id ?? payload.id, targetName);
        await updateMember.mutateAsync({
          id: member.id,
          ...patch,
        });
      } else {
        toast.warning(`نوع الإجراء "${action.type}" مش مدعوم للتنفيذ التلقائي دلوقتي — نفّذ التعديل يدويًا من صفحات الإدارة.`);
        return;
      }

      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, actionExecuted: true } : message));
      toast.success('اتنفّذ الإجراء فعليًا في قاعدة البيانات.');
    } catch (cause) {
      toast.error(`معرفناش ننفّذ الإجراء: ${cause instanceof Error ? cause.message : 'مشكلة مش معروفة'} — مفيش حاجة اتكتبت في قاعدة البيانات.`);
    }
  };

  const confirmAction = async () => {
    if (!pendingConfirmation) return;
    const { messageId, action } = pendingConfirmation;
    setPendingConfirmation(null);
    await executeAction(messageId, action, true);
  };

  const cancelAction = () => {
    setPendingConfirmation(null);
    toast.info('تم إلغاء تنفيذ الإجراء.');
  };

  return {
    messages,
    messagesEndRef,
    isPending: ask.isPending,
    sendMessage,
    executeAction,
    pendingConfirmation,
    confirmAction,
    cancelAction,
  };
}
