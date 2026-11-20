import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { useLocale } from '../../i18n/useLocale';
import './styles.css';

export const STATUS_COPY: Record<string, [string, string]> = {
  proposed: ['مقترح', 'Proposed'], reviewing: ['قيد التقييم', 'Reviewing'], under_review: ['قيد المراجعة', 'Under review'],
  approved: ['معتمد', 'Approved'], planning: ['التخطيط', 'Planning'], active: ['نشط', 'Active'], on_hold: ['متوقف مؤقتًا', 'On hold'],
  completed: ['مكتمل', 'Completed'], archived: ['مؤرشف', 'Archived'], rejected: ['مرفوض', 'Rejected'],
  backlog: ['قائمة المنتج', 'Backlog'], todo: ['للعمل', 'To do'], in_progress: ['قيد التنفيذ', 'In progress'],
  in_review: ['للمراجعة', 'In review'], blocked: ['عائق', 'Blocked'], done: ['منجز', 'Done'], cancelled: ['ملغى', 'Cancelled'],
  pending: ['بانتظار الموافقة', 'Pending'], suspended: ['موقوف', 'Suspended'], removed: ['مزال', 'Removed'], planned: ['مخطط', 'Planned'],
  draft: ['مسودة', 'Draft'], submitted: ['مرسل', 'Submitted'], accepted: ['مقبول', 'Accepted'], revision_requested: ['مطلوب تعديل', 'Revision requested'],
  needs_clarification: ['مطلوب توضيح', 'Needs clarification'], reviewed: ['تمت المراجعة', 'Reviewed'], open: ['مفتوح', 'Open'], escalated: ['مصعّد', 'Escalated'], resolved: ['محلول', 'Resolved'],
  low: ['منخفضة', 'Low'], normal: ['عادية', 'Normal'], high: ['عالية', 'High'], urgent: ['عاجلة', 'Urgent'],
  lead: ['قائد المشروع', 'Project lead'], contributor: ['مساهم', 'Contributor'], viewer: ['مشاهد', 'Viewer'],
};
export function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const label = STATUS_COPY[status];
  const variant = ['done', 'completed', 'accepted', 'active', 'reviewed', 'approved'].includes(status) ? 'success'
    : ['blocked', 'rejected', 'urgent'].includes(status) ? 'danger'
    : ['pending', 'in_review', 'under_review', 'needs_clarification', 'on_hold'].includes(status) ? 'warning' : 'neutral';
  return <Badge variant={variant}>{label ? t(...label) : status.replaceAll('_', ' ')}</Badge>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="wp-field"><span>{label}</span>{children}</label>;
}
export function Progress({ done, total }: { done: number; total: number }) {
  const { t, number } = useLocale();
  const percent = total > 0 ? Math.min(100, Math.max(0, done / total * 100)) : 0;
  return <div className="wp-progress"><div className="wp-row"><span>{total ? `${number(done)} / ${number(total)}` : t('لم يُسجل عمل بعد', 'No tracked work yet')}</span>{total > 0 && <strong>{number(percent, { maximumFractionDigits: 0 })}%</strong>}</div><progress value={done} max={Math.max(total, 1)} aria-label={t('اكتمال العمل المسجل', 'Tracked work completion')} /></div>;
}
export function safeHref(value: string | null | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function SafeLink({ href, children }: { href?: string | null; children: ReactNode }) {
  const safe = safeHref(href);
  return safe ? <a className="wp-link" href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span className="wp-muted">{children}</span>;
}
const NAV = [
  ['', 'نظرة عامة', 'Overview'], ['/ideas', 'الأفكار', 'Ideas'], ['/projects', 'المشروعات', 'Projects'],
  ['/timeline', 'المخطط الزمني', 'Timeline'], ['/agile', 'لوحات Agile', 'Agile boards'], ['/tasks', 'المهام', 'Tasks'],
  ['/reports', 'التقارير', 'Reports'], ['/resources', 'الموارد', 'Resources'],
] as const;
export function WebNav({ base = '/admin/web-projects' }: { base?: string }) {
  const { t } = useLocale();
  return <nav className="wp-tabs" aria-label={t('تنقل مشروعات الويب', 'Web Projects navigation')}>{NAV.map(([path, ar, en]) => <NavLink key={path} to={`${base}${path}`} end={path === ''}>{t(ar, en)}</NavLink>)}</nav>;
}
