import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { useWebInvitations, useWebQuery, useWebRpc } from './api';
import { Field, Progress, StatusBadge } from './common';
import { isOverdue, memberWorkload, trackedProgress } from './domain';
import { IdeasPanel } from './IdeasPanel';
import { ResourcesPanel } from './ResourcesPanel';
import type { WebAssignee, WebDeliverable, WebInvitation, WebMembership, WebProject, WebReport, WebTask, WebUpdate } from './types';

export default function MemberWebProjectsPage() {
  const { t, dir, number, date, locale, setLocale } = useLocale();
  const member = useAuthStore((state) => state.currentMember);
  const projects = useWebQuery<WebProject>('member', 'web_projects');
  const tasks = useWebQuery<WebTask>('member', 'web_project_tasks');
  const assignees = useWebQuery<WebAssignee>('member', 'web_project_task_assignees');
  const deliverables = useWebQuery<WebDeliverable>('member', 'web_project_deliverables');
  const reports = useWebQuery<WebReport>('member', 'web_project_member_reports');
  const updates = useWebQuery<WebUpdate>('member', 'web_project_updates');
  const memberships = useWebQuery<WebMembership>('member', 'web_project_members');
  const invitations = useWebInvitations();
  const rpc = useWebRpc('member');
  const [tab, setTab] = useState('projects');
  const [invitation, setInvitation] = useState<WebInvitation | null>(null);
  const [accepted, setAccepted] = useState(false);
  const dataQueries = [projects, tasks, assignees, deliverables, reports, updates, memberships];
  const ready = dataQueries.every((query) => query.isSuccess);
  const failed = dataQueries.find((query) => query.isError);
  const workload = ready ? memberWorkload(member?.id ?? -1, tasks.data ?? [], assignees.data ?? [], deliverables.data ?? [], reports.data ?? [], updates.data ?? []) : null;
  const stats: [string, string, number][] = workload ? [
    ['مشروعات نشطة', 'Active projects', (projects.data ?? []).filter((item) => item.status === 'active').length],
    ['مهام مسندة', 'Assigned tasks', workload.assigned.length], ['مهام منجزة', 'Completed tasks', workload.completed],
    ['قيد التنفيذ', 'In progress', workload.inProgress], ['مهام متأخرة', 'Overdue tasks', workload.overdue],
    ['مراحل مرتبطة بالمهام', 'Assigned milestones', workload.milestones], ['تسليمات مرسلة', 'Submitted deliverables', workload.submitted],
    ['مراجعات معلقة', 'Pending reviews', workload.pendingReviews], ['عوائق مفتوحة', 'Open blockers', workload.blockers],
  ] : [];
  const ledProjects = (projects.data ?? []).filter((project) => project.lead_member_id === member?.id);
  const ledIds = new Set(ledProjects.map((project) => project.id));
  const ledMembers = (memberships.data ?? []).filter((row) => ledIds.has(row.project_id) && row.status === 'active');
  const ledDeliverables = (deliverables.data ?? []).filter((row) => ledIds.has(row.project_id) && ['submitted', 'under_review'].includes(row.status));
  const ledBlockers = (updates.data ?? []).filter((row) => ledIds.has(row.project_id) && row.update_type === 'blocker' && row.blocker_status !== 'resolved');
  const ledReports = (reports.data ?? []).filter((row) => ledIds.has(row.project_id) && row.status === 'submitted');
  const roleOf = (projectId: string) => (memberships.data ?? []).find((row) => row.project_id === projectId && row.member_id === member?.id)?.role ?? null;
  const accept = async () => {
    if (!invitation || !accepted) return;
    try {
      await rpc.mutateAsync({ name: 'web_accept_project_agreement', args: { p_project_id: invitation.project_id, p_version: invitation.current_agreement_version } });
      setInvitation(null); setAccepted(false); toast.success(t('تم تسجيل قبول الاتفاق الحالي.', 'Acceptance of the current agreement was recorded.'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('تعذر قبول الاتفاق.', 'Could not accept agreement.')); }
  };
  return <main className="wp-portal" dir={dir}><div className="wp-page">
    <header className="wp-header"><div><Link to="/portal" className="wp-link wp-actions"><ArrowLeft size={16} />{t('بوابة العضو', 'Member portal')}</Link><span className="wp-eyebrow">PHANTOMS · {member?.full_name}</span><h1>{t('مشروعاتي ومساهماتي', 'My projects & contributions')}</h1><p>{t('أدوارك ومسؤولياتك والعمل المسند إليك؛ عضويات المشروعات مستقلة عن الفرق الداخلية.', 'Your roles, responsibilities and assigned work. Project memberships are independent of Internal Teams.')}</p></div><Button variant="secondary" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? 'English' : 'العربية'}</Button></header>
    <nav className="wp-tabs" aria-label={t('أقسام مشروعات العضو', 'Member project sections')}>{[['projects', 'المشروعات', 'Projects'], ['work', 'عملي', 'My work'], ['ideas', 'أفكاري', 'My ideas'], ['resources', 'الموارد المعتمدة', 'Approved resources']].map(([key, ar, en]) => <button key={key} aria-selected={tab === key} onClick={() => setTab(key)}>{t(ar, en)}</button>)}</nav>
    {invitations.isError && <ErrorState message={invitations.error.message} onRetry={() => void invitations.refetch()} />}
    {invitations.data && invitations.data.length > 0 && <section className="wp-panel wp-stack"><h2>{t('دعوات تحتاج قبول الاتفاق', 'Invitations awaiting agreement acceptance')}</h2><p className="wp-muted">{t('لن يظهر العمل الخاص بالمشروع قبل قبول نسخة الاتفاق الحالية.', 'Private project work is not accessible until you accept the current agreement version.')}</p>{invitations.data.map((invite) => <article key={invite.project_id} className="wp-row"><div><strong>{invite.project_name}</strong><div className="wp-actions"><StatusBadge status={invite.role} /><span className="wp-muted">{t('نسخة الاتفاق', 'Agreement version')} {number(invite.current_agreement_version)}</span></div></div><Button variant="secondary" onClick={() => { setInvitation(invite); setAccepted(false); }}>{t('قراءة الاتفاق', 'Read agreement')}</Button></article>)}</section>}
    {ready && ledProjects.length > 0 && <section className="wp-panel wp-stack" aria-label={t('لوحة قائد المشروع', 'Project lead panel')}>
      <div className="wp-row"><div><span className="wp-eyebrow">{t('صلاحيات المالك على مشروعك', 'Owner-level access on your project')}</span><h2>{t('أنت قائد مشروع', 'You lead a project')}</h2></div><StatusBadge status="approved" /></div>
      <p className="wp-muted">{t('كقائد، شاشتك هي شاشة المالك: تراجع تسليمات الأعضاء، تدير الفريق والاتفاق، وتعتمد التقارير الأسبوعية — بدون ما تحتاج دخول لوحة الإدارة.', 'As lead, your view matches the owner view: review member deliverables, manage the team and agreement, and approve weekly reports without entering the admin dashboard.')}</p>
      <div className="wp-metrics">
        <div className="wp-metric"><span>{t('أعضاء نشطين', 'Active members')}</span><strong>{number(ledMembers.length)}</strong></div>
        <div className="wp-metric"><span>{t('تسليمات للمراجعة', 'Deliverables to review')}</span><strong>{number(ledDeliverables.length)}</strong></div>
        <div className="wp-metric"><span>{t('تقارير للمراجعة', 'Reports to review')}</span><strong>{number(ledReports.length)}</strong></div>
        <div className="wp-metric"><span>{t('عوائق مفتوحة', 'Open blockers')}</span><strong>{number(ledBlockers.length)}</strong></div>
      </div>
      <div className="wp-stack">{ledProjects.map((project) => <article className="wp-row" key={project.id}><div><strong>{project.name}</strong><p className="wp-muted">{t('أعضاء', 'Members')}: {number(ledMembers.filter((row) => row.project_id === project.id).length)} · {t('التسليم المتوقع', 'Expected delivery')}: {project.expected_delivery_date ? date(project.expected_delivery_date) : '—'}</p></div><div className="wp-actions"><Link className="wp-link" to={`/portal/projects/${project.id}?tab=tasks`}>{t('راجع التسليمات', 'Review deliverables')}</Link><Link className="wp-link" to={`/portal/projects/${project.id}?tab=team`}>{t('إدارة الفريق', 'Manage team')}</Link><Link className="wp-link" to={`/portal/projects/${project.id}?tab=reports`}>{t('التقارير', 'Reports')}</Link></div></article>)}</div>
    </section>}
    {tab === 'ideas' ? <IdeasPanel mode="member" /> : tab === 'resources' ? <ResourcesPanel mode="member" /> : <>
      {failed && <ErrorState message={failed.error?.message ?? t('تعذر تحميل العمل.', 'Could not load workload.')} onRetry={() => { for (const query of dataQueries) void query.refetch(); }} />}
      {!failed && !ready && <CardSkeletons count={3} />}
      {ready && <><div className="wp-metrics">{stats.map(([ar, en, value]) => <div className="wp-metric" key={en}><span>{t(ar, en)}</span><strong>{number(value)}</strong></div>)}</div>
        {tab === 'projects' ? <div className="wp-grid">{projects.data?.map((project) => <article key={project.id} className="wp-panel wp-stack"><div className="wp-row"><span className="wp-project-icon"><Layers size={20} /></span><div className="wp-actions">{project.lead_member_id === member?.id && <StatusBadge status="lead" />}{roleOf(project.id) && <StatusBadge status={roleOf(project.id) as string} />}<StatusBadge status={project.status} /></div></div><h2>{project.name}</h2><p className="wp-muted">{project.short_description}</p><Progress {...trackedProgress((tasks.data ?? []).filter((task) => task.project_id === project.id))} /><p className="wp-muted">{t('التسليم المتوقع', 'Expected delivery')}: {project.expected_delivery_date ? date(project.expected_delivery_date) : '—'}</p><Link className="wp-link" to={`/portal/projects/${project.id}`}>{t('افتح مساحة المشروع', 'Open project workspace')}</Link></article>)}{projects.data?.length === 0 && <EmptyState title={t('لا توجد مشروعات متاحة بعد', 'No accessible projects yet')} description={t('تظهر هنا مشروعاتك بعد إضافتك وقبول الاتفاق.', 'Projects appear after you are added and accept the agreement.')} />}</div> : <>
          <section className="wp-panel"><h2>{t('مهامي المسندة', 'My assigned tasks')}</h2><div className="wp-stack">{workload?.assigned.map((task) => <article className="wp-row" key={task.id}><div><Link className="wp-link" to={`/portal/projects/${task.project_id}?tab=tasks&task=${task.id}`}>{task.title}</Link><p className="wp-muted">{projects.data?.find((project) => project.id === task.project_id)?.name ?? '—'} · {task.due_date ? date(task.due_date) : t('بدون موعد', 'No deadline')}</p></div><div className="wp-actions"><StatusBadge status={task.status} />{isOverdue(task.due_date, ['done', 'cancelled'].includes(task.status)) && <StatusBadge status="blocked" />}</div></article>)}{workload?.assigned.length === 0 && <p className="wp-muted">{t('لا توجد مهام مسندة إليك.', 'No tasks are assigned to you.')}</p>}</div></section>
          <div className="wp-grid"><section className="wp-panel"><h2>{t('آخر تحديثاتي', 'My recent updates')}</h2><div className="wp-activity">{updates.data?.filter((item) => item.author_member_id === member?.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10).map((item) => <article key={item.id}><Link className="wp-link" to={`/portal/projects/${item.project_id}?tab=reports`}>{item.title}</Link><p className="wp-muted">{item.body}</p><StatusBadge status={item.update_type === 'blocker' ? item.blocker_status : 'in_progress'} /></article>)}{updates.data?.filter((item) => item.author_member_id === member?.id).length === 0 && <p className="wp-muted">{t('أضف تحديثًا أو عائقًا من تقارير المشروع.', 'Add a progress update or blocker in project reports.')}</p>}</div></section><section className="wp-panel"><h2>{t('مراجعات التقارير الأسبوعية', 'Weekly report reviews')}</h2><div className="wp-activity">{reports.data?.filter((item) => item.member_id === member?.id).sort((a, b) => b.period_start.localeCompare(a.period_start)).slice(0, 10).map((report) => <article key={report.id}><Link className="wp-link" to={`/portal/projects/${report.project_id}?tab=reports`}>{date(report.period_start)} — {date(report.period_end)}</Link><StatusBadge status={report.status} /><p className="wp-muted">{report.review_notes}</p></article>)}{reports.data?.length === 0 && <p className="wp-muted">{t('لم تقدم تقارير بعد.', 'No reports submitted yet.')}</p>}</div></section></div>
        </>}
      </>}
    </>}
    <Modal isOpen={invitation !== null} onClose={() => setInvitation(null)} title={invitation?.project_name ?? ''} subtitle={t('اقرأ البنود؛ القبول يسجل هويتك والنسخة والتاريخ.', 'Read the terms. Acceptance records your identity, version and timestamp.')} maxWidth="lg" footer={<Button onClick={() => void accept()} disabled={!accepted} isLoading={rpc.isPending}>{t('قبول هذه النسخة والمشاركة', 'Accept this version & participate')}</Button>}>
      {invitation && <div className="wp-stack">{[['الملكية', 'Ownership', invitation.ownership_model], ['ملاحظات الملكية', 'Ownership notes', invitation.ownership_notes], ['الترخيص', 'License', invitation.license_name], ['الإسناد', 'Attribution', invitation.attribution_notes]].map(([ar, en, content]) => <section key={en}><h3>{t(ar, en)}</h3><p className="wp-detail-copy">{content || t('غير محدد — راجع قائد المشروع قبل القبول.', 'Unspecified—consult the project lead before accepting.')}</p></section>)}<section><h3>{t('بنود الاتفاق', 'Agreement terms')}</h3><pre className="wp-detail-copy" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{JSON.stringify(invitation.terms, null, 2)}</pre></section><div className="wp-notice">{t('قبول الاتفاق لا يمنح PHANTOMS ملكية تلقائية ولا يُعد موافقة على عرض المنتج أو استخدام العلامة. هذه الموافقات مستقلة ويمكنك منحها أو سحبها من إعدادات المشروع.', 'Agreement acceptance does not automatically give PHANTOMS ownership or consent to branding/showcase. Those opt-ins are separate and can be granted or revoked in project settings.')}</div><Field label={t('قرأت هذه النسخة وأوافق صراحةً على بنودها.', 'I have read this version and explicitly accept its terms.')}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /></Field></div>}
    </Modal>
  </div></main>;
}
