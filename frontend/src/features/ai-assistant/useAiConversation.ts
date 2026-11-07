import { useEffect, useRef, useState } from 'react';
import { useAskWaslaAi, type AiAction, type AiMessage } from './api';
import { useCreateTask, useDeleteTask } from '../tasks/api';
import { useCreateNote, useDeleteNote } from '../notes/api';
import { useAddMember, useUpdateMember, useDeleteMember } from '../members/api';
import { toast } from '../../store/toast';
import type { Member, Task } from '../../types/db';

export function useAiConversation(members: Member[], tasks: Task[]) {
  const ask = useAskWaslaAi();
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
    text: 'أهلاً بيك! أنا مساعد وصلة الذكي. اسألني عن الفريق والمهام أو اطلب مني أعمل مهمة أو ملاحظة.',
    timestamp: new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }),
  }]);
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
    try {
      const response = await ask.mutateAsync({ question: text, context: buildContext() });
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

  const executeAction = async (messageId: string, action: AiAction) => {
    const payload = action.payload ?? {};
    const actionType = typeof action.type === 'string' ? action.type.trim().toLowerCase() : '';
    const stringValue = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
    try {
      if (actionType === 'create_task') {
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
      } else if (actionType === 'delete_task') {
        const taskIdStr = stringValue(action.id) ?? stringValue(payload.id);
        const taskId = Number(taskIdStr);
        if (!taskIdStr || isNaN(taskId)) {
          // Try finding by title if id is not provided
          const title = stringValue(action.title) ?? stringValue(payload.title) ?? action.name;
          const task = tasks.find((t) => t.title === title);
          if (!task) throw new Error('ملقيناش المهمة عشان نمسحها.');
          await deleteTask.mutateAsync(task.id);
        } else {
          await deleteTask.mutateAsync(taskId);
        }
      } else if (actionType === 'add_note') {
        await createNote.mutateAsync({
          text: stringValue(payload.text) ?? 'ملاحظة من مساعد وصلة الذكي (بدون نص).',
          author: 'مساعد وصلة الذكي (AI)', author_role: 'AI Assistant',
          date: new Date().toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }),
          target_member_id: null,
          target_name: stringValue(payload.targetName),
        });
      } else if (actionType === 'delete_note') {
        const noteId = Number(stringValue(action.id) ?? stringValue(payload.id));
        if (isNaN(noteId)) throw new Error('رقم الملاحظة مش صحيح.');
        await deleteNote.mutateAsync(noteId);
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
        const targetName = action.name?.trim();
        const patch = action.patch;
        if (!targetName || !patch) {
          throw new Error('بيانات العضو أو التعديل ناقصة في رد المساعد.');
        }

        // Find the member by name — exact, then contains, then first-name match
        // (AI often returns first name only, e.g. "حنين" instead of full name).
        const normalized = targetName.replace(/\s+/g, ' ');
        const member = members.find((m) => m.full_name === normalized)
          ?? members.find((m) => m.full_name.includes(normalized) || normalized.includes(m.full_name))
          ?? members.find((m) => m.full_name.split(/\s+/)[0] === normalized.split(/\s+/)[0]);
        if (!member) {
          throw new Error(`ملقيناش عضو اسمه: ${targetName}`);
        }

        await updateMember.mutateAsync({
          id: member.id,
          ...patch,
        });
      } else if (actionType === 'delete_member') {
        const targetName = action.name?.trim() ?? stringValue(payload.name);
        if (!targetName) throw new Error('اكتب اسم العضو.');
        const normalized = targetName.replace(/\s+/g, ' ');
        const member = members.find((m) => m.full_name === normalized)
          ?? members.find((m) => m.full_name.includes(normalized) || normalized.includes(m.full_name))
          ?? members.find((m) => m.full_name.split(/\s+/)[0] === normalized.split(/\s+/)[0]);
        if (!member) throw new Error(`ملقيناش عضو اسمه: ${targetName}`);
        await deleteMember.mutateAsync(member.id);
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

  return { messages, messagesEndRef, isPending: ask.isPending, sendMessage, executeAction };
}
