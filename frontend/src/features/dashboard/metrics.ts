import type { Member, Task, Note } from '../../types/db';
import { isOverdue } from '../../lib/dateUtils';
import { compareMemberBonusRank } from '../ranking/rankingUtils';

export interface ActivityItem {
  id: string;
  type: 'note' | 'task' | 'member';
  title: string;
  description: string;
  date: Date;
  meta: string;
}

export interface MetricMember extends Member {
  totalBonus: number;
}

export interface TimelineDataPoint {
  date: string;
  bonus: number;
}

export interface DashboardMetrics {
  totalMembers: number;
  laptopCount: number;
  pcCount: number;
  alexCount: number;
  laptopPercentage: number;
  alexPercentage: number;
  approvedTasks: number;
  underReview: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  topMembers: MetricMember[];
  lowestMembers: MetricMember[];
  lateMembers: { member: Member; taskTitle: string }[];
  recentActivity: ActivityItem[];
  timelineData: TimelineDataPoint[];
}

export function calculateBonus(notes: Note[], memberId: number): number {
  return notes.reduce((total, note) => {
    if (note.target_member_id === memberId) {
      const match = (note.text || '').match(/\[B:([+-]?\d+)\]/);
      if (match) {
        return total + parseInt(match[1], 10);
      }
    }
    return total;
  }, 0);
}

export function getDashboardMetrics(members: Member[], tasks: Task[], notes: Note[]): DashboardMetrics {
  const totalMembers = members.length;
  
  // Devices & Logistics
  const laptopCount = members.filter((member) => {
    const d = member.device || '';
    return d.includes('لاب') || d.includes('الاثنان') || d.toLowerCase().includes('laptop');
  }).length;
  
  const pcCount = members.filter((member) => {
    const d = member.device || '';
    return d.includes('كمبيوتر') && !d.includes('الاثنان');
  }).length;
  
  const alexCount = members.filter((member) => member.can_go_alexandria).length;

  // Tasks Analysis
  let approvedTasks = 0;
  let underReview = 0;
  let inProgress = 0;
  let overdue = 0;
  let notStarted = 0;
  const lateMembers: { member: Member; taskTitle: string }[] = [];

  tasks.forEach((task) => {
    const assignedIds = task.assigned_to === 'ALL' 
      ? members.map(m => m.id) 
      : (Array.isArray(task.assigned_to) ? task.assigned_to.map(Number) : []);
    
    let localLate = 0;
    // الموعد بدون وقت = نهاية اليوم المحلي (isOverdue) — لا تظهر مهمة "اليوم" متأخرة من الصباح
    const isDeadlinePassed = Boolean(task.has_deadline && isOverdue(task.deadline_date));

    Object.entries(task.tracking ?? {}).forEach(([mId, entry]) => {
      const status = entry.status;
      if (status === 'approved') {
        approvedTasks++;
      }
      else if (status === 'under_review') {
        underReview++;
      }
      else if (isDeadlinePassed) {
        // كل من لم يسلّم بعد انتهاء الموعد متأخر (لم يبدأ / قيد التنفيذ / مطلوب تعديل) — يُعد مرة واحدة
        localLate++;
        const m = members.find(x => x.id === Number(mId));
        if (m) lateMembers.push({ member: m, taskTitle: task.title });
      }
      else if (status === 'in_progress' || status === 'revision_requested') {
        inProgress++;
      }
      else {
        notStarted++;
      }
    });

    const totalHandled = Object.keys(task.tracking ?? {}).length;
    if (assignedIds.length > totalHandled) {
      const remaining = assignedIds.length - totalHandled;
      if (isDeadlinePassed) {
        overdue += remaining;
        assignedIds.forEach(id => {
          if (!task.tracking?.[String(id)]) {
            const m = members.find(x => x.id === id);
            if (m) lateMembers.push({ member: m, taskTitle: task.title });
          }
        });
      } else {
        notStarted += remaining;
      }
    }
    overdue += localLate;
  });

  // Calculate Member Bonuses
  const membersWithBonus: MetricMember[] = members.map(m => ({
    ...m,
    totalBonus: calculateBonus(notes, m.id)
  }));

  // Rankings
  const topMembers = [...membersWithBonus]
    .filter(m => m.bonus_infinite === true || m.totalBonus > 0)
    .sort(compareMemberBonusRank)
    .slice(0, 3);

  const lowestMembers = [...membersWithBonus]
    .filter(m => m.bonus_infinite !== true && m.totalBonus < 0)
    .sort((a, b) => a.totalBonus - b.totalBonus)
    .slice(0, 4);

  // Recent Activity Feed
  const recentActivity: ActivityItem[] = [];
  
  notes.forEach(n => {
    recentActivity.push({
      id: `n-${n.id}`,
      type: 'note',
      title: `${n.author} ضاف ملاحظة لـ ${n.target_name || 'عضو'}`,
      description: n.text || '',
      date: new Date(n.created_at || Date.now()),
      meta: 'الملاحظات'
    });
  });

  tasks.forEach(t => {
    recentActivity.push({
      id: `t-${t.id}`,
      type: 'task',
      title: `اتعمل تكليف جديد: ${t.title}`,
      description: t.description || 'مفيش وصف',
      date: new Date(t.created_at || Date.now()),
      meta: 'المهام'
    });
  });

  members.forEach(m => {
    recentActivity.push({
      id: `m-${m.id}`,
      type: 'member',
      title: `عضو جديد انضم: ${m.full_name}`,
      description: `مكان الإقامة: ${m.residence || 'مش محدد'}`,
      date: new Date(m.created_at || Date.now()),
      meta: 'الأعضاء'
    });
  });

  recentActivity.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Timeline (Bonus points over time)
  const dateMap: Record<string, number> = {};
  notes.forEach(n => {
    if (n.date || n.created_at) {
      const d = (n.date || n.created_at).slice(0, 10);
      if (!dateMap[d]) dateMap[d] = 0;
      const match = (n.text || '').match(/\[B:([+-]?\d+)\]/);
      if (match) {
        dateMap[d] += parseInt(match[1], 10);
      }
    }
  });

  const sortedDates = Object.keys(dateMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const recentDates = sortedDates.slice(-7);
  const timelineData = recentDates.length > 0 ? recentDates.map(d => ({ date: d, bonus: dateMap[d] })) : [{ date: 'النهارده', bonus: 0 }];

  return {
    totalMembers,
    laptopCount,
    pcCount,
    alexCount,
    laptopPercentage: totalMembers ? Math.round((laptopCount / totalMembers) * 100) : 0,
    alexPercentage: totalMembers ? Math.round((alexCount / totalMembers) * 100) : 0,
    approvedTasks,
    underReview,
    inProgress,
    overdue,
    notStarted,
    topMembers,
    lowestMembers,
    lateMembers,
    recentActivity: recentActivity.slice(0, 8),
    timelineData
  };
}
