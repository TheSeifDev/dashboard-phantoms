import { Trophy, TrendingDown, Clock, Activity, History, Laptop, BarChart3, Users, PieChart as PieChartIcon, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid } from 'recharts';
import type { Task } from '../../types/db';
import type { DashboardMetrics } from './metrics';
import { useThemeStore } from '../../store/theme';
import { formatDate, formatRelativeTime } from '../../lib/dateUtils';
import { formatSigned } from '../../lib/arabic';

/** ألوان الرسوم من الـ design tokens حتى تتبع الثيم (فاتح/داكن) */
function useChartColors() {
  // الاشتراك في الثيم يعيد الرسم عند التبديل فتبقى الألوان متزامنة
  useThemeStore((s) => s.theme);
  const css = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return {
    success: css('--success'),
    info: css('--info'),
    danger: css('--danger'),
    warning: css('--warning'),
    muted: css('--text-muted'),
    primary: css('--primary'),
  };
}

const tooltipStyle = { borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 'bold' } as const;

function Panel({ title, icon, action, tone = 'default', className = '', children }: { title: string; icon: ReactNode; action?: { label: string; onClick: () => void }; tone?: 'default' | 'danger' | 'warning'; className?: string; children: ReactNode }) {
  const tones = {
    default: 'border-[var(--border)] bg-[var(--surface)]',
    danger: 'border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/15',
    warning: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/15',
  };
  return (
    <section className={`flex min-w-0 flex-col rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-sm)] sm:p-5 ${tones[tone]} ${className}`}>
      <header className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 font-black">{icon}<span className="truncate">{title}</span></h3>
        {action && (
          <button type="button" onClick={action.onClick} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-bold text-[var(--link)] hover:bg-[var(--primary-soft)]">
            {action.label}<ChevronLeft size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="grid min-h-32 flex-1 place-items-center content-center gap-2 text-center text-sm font-bold text-[var(--text-muted)]">{icon}<span>{text}</span></div>;
}

export function DashboardWidgets({ metrics }: { metrics: DashboardMetrics; tasks: Task[] }) {
  const navigate = useNavigate();
  const chart = useChartColors();

  // اللون مربوط بالفئة نفسها (وليس بترتيبها بعد الفلترة) حتى لا تتبدل الألوان
  const taskSlices = [
    { name: 'اتعتمدت', value: metrics.approvedTasks ?? 0, color: chart.success, token: 'var(--success)' },
    { name: 'تحت التنفيذ', value: metrics.inProgress ?? 0, color: chart.info, token: 'var(--info)' },
    { name: 'تحت المراجعة', value: metrics.underReview ?? 0, color: chart.warning, token: 'var(--warning)' },
    { name: 'متأخر', value: metrics.overdue ?? 0, color: chart.danger, token: 'var(--danger)' },
    { name: 'لسه مبدأش', value: metrics.notStarted ?? 0, color: chart.muted, token: 'var(--text-muted)' },
  ];
  const tasksData = taskSlices.filter((slice) => slice.value > 0);
  const totalAssignments = taskSlices.reduce((sum, slice) => sum + slice.value, 0);

  const deviceData = [
    { name: 'لابتوب', count: metrics.laptopCount ?? 0, fill: chart.success },
    { name: 'كمبيوتر', count: metrics.pcCount ?? 0, fill: chart.info },
    { name: 'تابلت/هاتف', count: Math.max(0, (metrics.totalMembers ?? 0) - (metrics.laptopCount ?? 0) - (metrics.pcCount ?? 0)), fill: chart.warning },
  ];
  const timeline = metrics.timelineData ?? [];
  const hasTimeline = timeline.some((point) => Number(point.bonus) !== 0);
  const activity = (metrics.recentActivity ?? []).slice(0, 6);

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-5">
      {/* 1. حالة المهام */}
      <Panel title="حالة التكليفات" icon={<PieChartIcon size={18} className="shrink-0 text-[var(--link)]" aria-hidden="true" />} action={{ label: 'إدارة المهام', onClick: () => navigate('/admin/tasks') }}>
        {tasksData.length > 0 ? (
          <>
            <div className="relative h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={tasksData} innerRadius={62} outerRadius={84} paddingAngle={3} dataKey="value" stroke="none">
                    {tasksData.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text)' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center content-center text-center">
                <span className="text-2xl font-black tabular-nums">{totalAssignments}</span>
                <span className="text-xs font-bold text-[var(--text-muted)]">تكليف</span>
              </div>
            </div>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-[var(--text-2)]">
              {tasksData.map((slice) => (
                <li key={slice.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: slice.token }} aria-hidden="true" />{slice.name} <span className="tabular-nums text-[var(--text-muted)]">{slice.value}</span></li>
              ))}
            </ul>
          </>
        ) : <Empty icon={<PieChartIcon size={28} className="opacity-40" aria-hidden="true" />} text="مفيش تكليفات لسه" />}
      </Panel>

      {/* 2. أعلى 3 */}
      <Panel title="الأعلى نقاطًا" icon={<Trophy size={18} className="shrink-0 text-amber-500" aria-hidden="true" />} action={{ label: 'لوحة الترتيب', onClick: () => navigate('/admin/ranking') }}>
        {(metrics.topMembers ?? []).length > 0 ? (
          <ol className="grid gap-2">
            {metrics.topMembers.map((m, i) => (
              <li key={m.id}>
                <button type="button" onClick={() => navigate('/admin/ranking')} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-start transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-lg font-black text-white ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : 'bg-amber-700'}`}>{i + 1}</span>
                    <span className="truncate font-bold">{m.full_name}</span>
                  </span>
                  <span aria-label={m.bonus_infinite === true ? 'بونص غير محدود' : `${formatSigned(m.totalBonus)} نقطة`} className="shrink-0 rounded-lg bg-[var(--primary-soft)] px-2.5 py-1 text-sm font-black tabular-nums text-[var(--link)]">{m.bonus_infinite === true ? '∞' : formatSigned(m.totalBonus)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : <Empty icon={<Trophy size={28} className="opacity-40" aria-hidden="true" />} text="لسه مفيش بونص متسجل" />}
      </Panel>

      {/* 3. الأجهزة */}
      <Panel title="جاهزية الأجهزة" icon={<Laptop size={18} className="shrink-0 text-[var(--link)]" aria-hidden="true" />}>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={deviceData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)', fontWeight: 600 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
              <Tooltip cursor={{ fill: 'transparent' }} contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text)' }} formatter={(value) => [value, 'عضو']} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={40}>
                {deviceData.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* 4. الأقل نقاطاً */}
      <Panel title="محتاجين متابعة (الأقل نقاط)" tone="danger" icon={<TrendingDown size={18} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />}>
        {(metrics.lowestMembers ?? []).length > 0 ? (
          <ul className="grid gap-1">
            {metrics.lowestMembers.map((m) => (
              <li key={m.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-dashed border-red-200 py-1.5 last:border-0 dark:border-red-900/50">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-red-200 bg-[var(--surface)] font-black text-red-600 dark:border-red-800" aria-hidden="true">{m.full_name.charAt(0)}</span>
                  <span className="truncate font-bold">{m.full_name}</span>
                </span>
                <span className="shrink-0 rounded-md bg-[var(--surface)] px-2 py-0.5 font-black tabular-nums text-red-600 dark:text-red-400">{formatSigned(m.totalBonus)}</span>
              </li>
            ))}
          </ul>
        ) : <Empty icon={<TrendingDown size={28} className="text-emerald-600 opacity-60" aria-hidden="true" />} text="مفيش أعضاء في نطاق الخطر" />}
      </Panel>

      {/* 5. الأداء عبر الوقت */}
      <Panel title="البونص عبر الوقت" className="lg:col-span-2" icon={<BarChart3 size={18} className="shrink-0 text-[var(--link)]" aria-hidden="true" />}>
        {hasTimeline ? (
          <div className="h-56 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={(v) => typeof v === 'string' && v.includes('-') ? formatDate(v, 'd MMM') : v} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)', fontWeight: 600 }} dy={10} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                <Tooltip labelFormatter={(v) => typeof v === 'string' && v.includes('-') ? formatDate(v as string, 'd MMMM yyyy') : v} contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text)' }} />
                <Area type="monotone" dataKey="bonus" name="إجمالي البونص" stroke={chart.primary} strokeWidth={2} fill={chart.primary} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty icon={<BarChart3 size={28} className="opacity-40" aria-hidden="true" />} text="المنحنى هيظهر بعد تسجيل أول بونص أو خصم" />}
      </Panel>

      {/* 6. المتأخرون */}
      <Panel title="متأخرين عن مواعيد التسليم" tone="warning" icon={<Clock size={18} className="shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />} action={{ label: 'عرض المهام', onClick: () => navigate('/admin/tasks') }}>
        {(metrics.lateMembers ?? []).length > 0 ? (
          <ul className="grid gap-1">
            {metrics.lateMembers.slice(0, 6).map((item, idx) => (
              <li key={`${item.member.id}-${idx}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-dashed border-amber-200 py-1.5 last:border-0 dark:border-amber-900/50">
                <span className="grid min-w-0 leading-5">
                  <span className="truncate font-bold">{item.member.full_name}</span>
                  <span className="truncate text-xs text-[var(--text-muted)]">{item.taskTitle}</span>
                </span>
                <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-black text-red-700 dark:bg-red-900/50 dark:text-red-300">متأخر</span>
              </li>
            ))}
            {metrics.lateMembers.length > 6 && <li className="pt-1 text-xs font-bold text-[var(--text-muted)]">و{metrics.lateMembers.length - 6} تانيين…</li>}
          </ul>
        ) : <Empty icon={<Clock size={28} className="text-amber-600 opacity-50" aria-hidden="true" />} text="الكل ملتزم بالمواعيد" />}
      </Panel>

      {/* 7. أحدث النشاطات */}
      <Panel title="أحدث النشاطات" icon={<History size={18} className="shrink-0 text-[var(--link)]" aria-hidden="true" />}>
        {activity.length > 0 ? (
          <ol className="relative grid gap-3 before:absolute before:start-[15px] before:top-2 before:h-[calc(100%-20px)] before:w-0.5 before:bg-[var(--border)]">
            {activity.map((item) => (
              <li key={item.id} className="relative z-10 flex items-start gap-3">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-[var(--surface)] text-white ${item.type === 'note' ? 'bg-[var(--primary)]' : item.type === 'task' ? 'bg-[var(--info)]' : 'bg-[var(--success)]'}`} aria-hidden="true">
                  {item.type === 'note' ? <Activity size={14} /> : item.type === 'task' ? <Clock size={14} /> : <Users size={14} />}
                </span>
                <div className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                  <p className="break-words text-sm font-bold leading-6">{item.title}</p>
                  <p className="mt-0.5 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-muted)]">
                    <span className="truncate">{item.meta}</span>
                    <span className="shrink-0">{item.date instanceof Date ? formatRelativeTime(item.date.toISOString()) : 'دلوقتي'}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : <Empty icon={<History size={28} className="opacity-40" aria-hidden="true" />} text="مفيش نشاطات متسجلة" />}
      </Panel>
    </div>
  );
}
