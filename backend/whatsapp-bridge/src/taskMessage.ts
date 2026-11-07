import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { AdminRequest } from './adminAuth.js';

type TaskRecord = { id: number; title: string; has_deadline: boolean; deadline_date: string | null; assigned_to: string[] | string | null; bonus_points?: number | null };
type MemberRecord = { id: number; full_name: string; phone: string | null; work_status: string | null };

export function normalizePhone(raw: string) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('01') && digits.length === 11) digits = `20${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export async function resolveTaskMessage(admin: AdminRequest, taskId: number, memberId: number, baseUrl: string) {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${admin.token}` } } });
  const [{ data: taskData, error: taskError }, { data: memberData, error: memberError }] = await Promise.all([
    // "*" بدل قائمة أعمدة: يعمل قبل وبعد migration 0012 (bonus_points)
    client.from('tasks').select('*').eq('id', taskId).single(),
    client.from('members').select('id,full_name,phone,work_status').eq('id', memberId).single(),
  ]);
  const task = taskData as TaskRecord | null;
  const member = memberData as MemberRecord | null;
  if (taskError || !task) throw new Error('المهمة مش موجودة أو مش قادرين نوصل لها.');
  if (memberError || !member) throw new Error('العضو مش موجود أو مش قادرين نوصل له.');
  const assigned = task.assigned_to === 'ALL' ? null : new Set((Array.isArray(task.assigned_to) ? task.assigned_to : []).map(String));
  if (member.work_status === 'inactive' || (assigned && !assigned.has(String(member.id)))) throw new Error('لازم تختار عضو نشط ومتسند له المهمة.');
  if (!member.phone || !normalizePhone(member.phone)) throw new Error('رقم العضو مش صالح. ضيف رقم دولي من صفحة الأعضاء.');
  // YYYY-MM-DD = نهاية اليوم (بدون ساعة) — وإلا ظهر "12:00 ص" وهمياً. التوقيت دائماً بتوقيت القاهرة لا توقيت الخادم.
  const formatArabicDate = (value: string) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    try {
      return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
        timeZone: 'Africa/Cairo',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit', hour12: true }),
      }).format(dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value));
    } catch {
      return value;
    }
  };
  const due = task.has_deadline && task.deadline_date ? `\n\n📅 *الموعد النهائي لإنجاز المهمة:* ${formatArabicDate(task.deadline_date)}` : '';
  const bonus = Math.max(0, Math.trunc(Number(task.bonus_points ?? 0)) || 0);
  const reward = bonus > 0 ? `\n🎁 *بونص المهمة بعد الاعتماد:* ${bonus} نقطة` : '';
  const text = `أهلًا ${member.full_name} 👋،\n\nحابين نبلغك إن اتسندت لك مهمة جديدة على منصة وصلة بعنوان:\n📌 *«${task.title}»*${due}${reward}\n\nمن فضلك ادخل على بوابة وصلة عشان تراجع تفاصيل المهمة وتبدأ التنفيذ:\n🔗 ${baseUrl}/login\n\nنتمنالك التوفيق،\nفريق إدارة وصلة.`;
  return { phone: normalizePhone(member.phone)!, memberName: member.full_name, taskTitle: task.title, text };
}

export async function resolveAnnouncementMessage(admin: AdminRequest, announcementId: number, memberId: number, baseUrl: string) {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${admin.token}` } } });
  const [{ data: annData, error: annError }, { data: memberData, error: memberError }] = await Promise.all([
    client.from('announcements').select('id,title,content,priority').eq('id', announcementId).single(),
    client.from('members').select('id,full_name,phone,work_status').eq('id', memberId).single(),
  ]);
  const ann = annData as { id: number, title: string, content: string, priority: string } | null;
  const member = memberData as MemberRecord | null;
  if (annError || !ann) throw new Error('الإعلان مش موجود أو مش قادرين نوصل له.');
  if (memberError || !member) throw new Error('العضو مش موجود أو مش قادرين نوصل له.');
  if (!member.phone || !normalizePhone(member.phone)) throw new Error('رقم العضو مش صالح.');
  
  const icon = ann.priority === 'urgent' ? '🚨' : ann.priority === 'high' ? '⚠️' : '📢';
  const text = `أهلًا ${member.full_name} 👋،\n\n${icon} *إعلان إداري مهم!*\n📌 *«${ann.title}»*\n\n${ann.content}\n\nادخل على بوابة وصلة عشان تعرف تفاصيل أكتر:\n🔗 ${baseUrl}/login\n\nإدارة وصلة.`;
  return { phone: normalizePhone(member.phone)!, memberName: member.full_name, announcementTitle: ann.title, text };
}
