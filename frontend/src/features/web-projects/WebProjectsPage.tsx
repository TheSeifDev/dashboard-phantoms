import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Layers, Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import { useWebCandidates, useWebQuery, useWebRpc } from './api';
import { Field, Progress, StatusBadge, WebNav, safeHref } from './common';
import { projectAttention, trackedProgress } from './domain';
import { IdeasPanel } from './IdeasPanel';
import { ResourcesPanel } from './ResourcesPanel';
import { MemberPicker } from './MemberPicker';
import ProjectWorkspacePage from './ProjectWorkspacePage';
import type { WebActivity, WebIdea, WebMembership, WebMilestone, WebProject, WebTask, WebUpdate } from './types';

const TITLES: Record<string, [string, string, string, string]> = {
  overview: ['مشروعات الويب', 'Web Projects', 'مساحة مستقلة لتطوير منتجات حقيقية، بمساهمات موثقة ومراجعات واضحة.', 'An independent workspace for real products, verified contributions and clear reviews.'],
  ideas: ['الأفكار والمقترحات', 'Ideas & proposals', 'اجمع الأفكار، سجل المراجعة، وحوّل المقترح المعتمد إلى مشروع.', 'Collect ideas, record reviews and turn approved proposals into projects.'],
  projects: ['دليل المشروعات', 'Project directory', 'اعثر على المنتج ومسؤوليه وحالته وموعد تسليمه في مساحة واحدة.', 'Find products, their leads, lifecycle and delivery dates in one place.'],
  timeline: ['المخطط الزمني', 'Project timeline', 'مراحل ومواعيد واعتماديات تستند إلى خطة كل مشروع الفعلية.', 'Phases, deadlines and dependencies grounded in each project’s real plan.'],
  agile: ['لوحات Agile', 'Agile boards', 'خطط السبرنت وتابع العمل الجاري؛ كل انتقال يُحفظ فعليًا.', 'Plan sprints and track work in progress; every transition is persisted.'],
  tasks: ['مهام المشروعات', 'Project tasks', 'محرك مهام مستقل عن الفرق الداخلية، داخل نطاق المشروع فقط.', 'A task engine independent of Internal Teams, scoped to each project.'],
  reports: ['التقارير والمراجعات', 'Reports & reviews', 'تسليمات ومراجعات وعوائق موثقة، وليس درجات إنتاجية مصطنعة.', 'Verified deliverables, reviews and blockers—not artificial productivity scores.'],
  resources: ['موارد PHANTOMS', 'PHANTOMS resources', 'أصول وروابط معتمدة بمراجع مشتركة دون تكرار الملفات.', 'Approved assets and links, referenced without duplicating files.'],
};
export default function WebProjectsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, number, date } = useLocale();
  const section = location.pathname.replace('/admin/web-projects', '').split('/').filter(Boolean)[0] ?? 'overview';
  const title = TITLES[section] ?? TITLES.overview;
  const projects = useWebQuery<WebProject>('admin', 'web_projects');
  const tasks = useWebQuery<WebTask>('admin', 'web_project_tasks');
  const milestones = useWebQuery<WebMilestone>('admin', 'web_project_milestones');
  const members = useWebQuery<WebMembership>('admin', 'web_project_members');
  const ideas = useWebQuery<WebIdea>('admin', 'web_ideas');
  const updates = useWebQuery<WebUpdate>('admin', 'web_project_updates');
  const activity = useWebQuery<WebActivity>('admin', 'web_project_activity_logs');
  const candidates = useWebCandidates('admin');
  const rpc = useWebRpc('admin');
  const [creating, setCreating] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedProject, setSelectedProject] = useState('');
  const execution = ['timeline', 'agile', 'tasks', 'reports'].includes(section);
  const dataset = projects.data ?? [];
  const filtered = useMemo(() => dataset.filter((project) => (status === 'all' || project.status === status) && `${project.name} ${project.slug} ${project.short_description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())), [dataset, search, status]);
  const allQueries = [projects, tasks, milestones, members, ideas, updates, activity, candidates];
  const errorQuery = allQueries.find((query) => query.isError);
  const ready = allQueries.every((query) => query.isSuccess);
  const selected = dataset.some((project) => project.id === selectedProject) ? selectedProject : dataset[0]?.id ?? '';
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!ownerId) {
      toast.error(t('اختار مسؤول المنتج الأول.', 'Select the product owner first.'));
      return;
    }
    try {
      const id = await rpc.mutateAsync({ name: 'web_create_project', args: { p_name: String(form.get('name')).trim(), p_slug: String(form.get('slug')).trim(), p_owner_member_id: Number(form.get('owner')), p_lead_member_id: form.get('leader') ? Number(form.get('leader')) : null } });
      setCreating(false); setOwnerId(''); setLeaderId('');
      toast.success(t('تم إنشاء المشروع. سجل الاتفاق وأضف الأعضاء قبل التفعيل.', 'Project created. Record agreement terms and add members before activation.'));
      navigate(`/admin/web-projects/projects/${String(id)}?tab=settings`);
    } catch (error) { toast.error(error instanceof Error ? error.message : t('تعذر إنشاء المشروع.', 'Could not create project.')); }
  };
  const metrics: [string, string, number][] = ready ? [
    ['إجمالي المشروعات', 'Total projects', dataset.length], ['مشروعات نشطة', 'Active projects', dataset.filter((item) => item.status === 'active').length],
    ['في التخطيط', 'Planning', dataset.filter((item) => item.status === 'planning').length], ['مكتملة', 'Completed', dataset.filter((item) => item.status === 'completed').length],
    ['متوقفة مؤقتًا', 'On hold', dataset.filter((item) => item.status === 'on_hold').length], ['أفكار تنتظر القرار', 'Pending ideas', (ideas.data ?? []).filter((item) => ['proposed', 'under_review'].includes(item.review_status)).length],
    ['مساهمون نشطون', 'Active contributors', new Set((members.data ?? []).filter((item) => item.status === 'active' && item.role !== 'viewer').map((item) => item.member_id)).size],
    ['تحتاج متابعة', 'Require attention', dataset.filter((project) => projectAttention(project, tasks.data ?? [], milestones.data ?? [], updates.data ?? [])).length],
  ] : [];
  return <div className="wp-page">
    <header className="wp-header"><div><span className="wp-eyebrow">PHANTOMS · {t('تطوير المنتجات', 'Product development')}</span><h1>{t(title[0], title[1])}</h1><p>{t(title[2], title[3])}</p></div><Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t('مشروع جديد', 'New project')}</Button></header>
    <WebNav />
    {section === 'ideas' ? <IdeasPanel mode="admin" /> : section === 'resources' ? <ResourcesPanel /> : <>
      {errorQuery && <ErrorState message={errorQuery.error?.message ?? t('تعذر تحميل بيانات البرنامج.', 'Could not load program data.')} onRetry={() => { for (const query of allQueries) void query.refetch(); }} />}
      {!errorQuery && !ready && <CardSkeletons count={3} />}
      {ready && <>
        {section === 'overview' && <div className="wp-metrics">{metrics.map(([ar, en, value]) => <div className="wp-metric" key={en}><span>{t(ar, en)}</span><strong>{number(value)}</strong></div>)}</div>}
        {execution ? <><Field label={t('اختر المشروع', 'Select project')}><select value={selected} onChange={(event) => setSelectedProject(event.target.value)}>{dataset.length === 0 && <option value="">{t('لا توجد مشروعات', 'No projects yet')}</option>}{dataset.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></Field>{selected ? <ProjectWorkspacePage key={`${selected}-${section}`} projectIdOverride={selected} initialTab={section} embedded /> : <EmptyState title={t('أنشئ مشروعًا لبدء التنفيذ', 'Create a project to start execution')} description={t('سيظهر المخطط والمهام والتقارير من بيانات المشروع الحقيقي.', 'Timeline, tasks and reports will use the project’s persisted data.')} />}</> : <>
          <div className="wp-toolbar"><Field label={t('البحث في المشروعات', 'Search projects')}><input type="search" placeholder={t('الاسم، المعرف، الوصف', 'Name, slug, description')} value={search} onChange={(event) => setSearch(event.target.value)} /></Field><Field label={t('حالة المشروع', 'Project status')}><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t('كل الحالات', 'All statuses')}</option>{['proposed', 'reviewing', 'approved', 'planning', 'active', 'on_hold', 'completed', 'archived', 'rejected'].map((value) => <option key={value} value={value}>{t({ proposed: 'مقترح', reviewing: 'قيد التقييم', approved: 'معتمد', planning: 'التخطيط', active: 'نشط', on_hold: 'متوقف', completed: 'مكتمل', archived: 'مؤرشف', rejected: 'مرفوض' }[value] ?? value, value.replaceAll('_', ' '))}</option>)}</select></Field><Button variant="secondary" onClick={() => { setSearch(''); setStatus('all'); }}>{t('مسح المرشحات', 'Clear filters')}</Button><span className="wp-muted">{number(filtered.length)} {t('نتيجة', 'results')}</span></div>
          {filtered.length === 0 && <EmptyState title={dataset.length === 0 ? t('لا توجد مشروعات بعد', 'No projects yet') : t('لا توجد نتائج مطابقة', 'No matching projects')} description={t('أضف مشروعًا أو عدل معايير البحث.', 'Create a project or adjust the search criteria.')} />}
          <div className="wp-project-list">{filtered.map((project) => {
            const projectTasks = (tasks.data ?? []).filter((task) => task.project_id === project.id);
            const completion = trackedProgress(projectTasks);
            const milestone = (milestones.data ?? []).filter((item) => item.project_id === project.id && !['completed', 'cancelled'].includes(item.status)).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))[0];
            const recent = (activity.data ?? []).filter((item) => item.project_id === project.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
            return <article key={project.id} className="wp-project-row"><div className="wp-project-identity"><span className="wp-project-icon">{safeHref(project.logo_url) ? <img src={safeHref(project.logo_url) ?? ''} alt="" loading="lazy" /> : <Layers size={20} />}</span><div><Link className="wp-link" to={`/admin/web-projects/projects/${project.id}`}><h3>{project.name}</h3></Link><p>{project.short_description || t('أكمل معلومات المنتج من الإعدادات.', 'Complete product information in settings.')}</p><p>{t('القائد', 'Lead')}: {candidates.data?.find((person) => person.member_id === project.lead_member_id)?.full_name ?? t('لم يحدد', 'Unassigned')} · {number((members.data ?? []).filter((person) => person.project_id === project.id && person.status === 'active' && person.role !== 'viewer').length)} {t('مساهم', 'contributors')}</p></div></div><div className="wp-stack"><StatusBadge status={project.status} /><Progress {...completion} /></div><div className="wp-muted"><p>{t('المرحلة الحالية', 'Current milestone')}</p><strong>{milestone?.title ?? '—'}</strong><p>{t('التسليم', 'Delivery')}: {project.expected_delivery_date ? date(project.expected_delivery_date) : '—'}</p></div><div className="wp-muted"><p>{t('آخر نشاط', 'Last activity')}</p><time>{date(recent?.occurred_at ?? project.created_at)}</time>{projectAttention(project, tasks.data ?? [], milestones.data ?? [], updates.data ?? []) && <StatusBadge status="blocked" />}</div><Link className="wp-link wp-actions" to={`/admin/web-projects/projects/${project.id}`}>{t('افتح', 'Open')}<ArrowUpRight size={16} /></Link></article>;
          })}</div>
          {section === 'overview' && <section className="wp-panel"><div className="wp-row"><h2>{t('نشاط حديث', 'Recent activity')}</h2><p className="wp-muted">{t('تغييرات فعلية موثقة من المشروعات.', 'Actual recorded project changes.')}</p></div><div className="wp-activity">{(activity.data ?? []).slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 12).map((event) => <article key={event.id}><Link className="wp-link" to={`/admin/web-projects/projects/${event.project_id}`}>{dataset.find((project) => project.id === event.project_id)?.name ?? event.project_id}</Link><span>{event.action.replaceAll('_', ' ')} · {event.entity_type.replaceAll('_', ' ')}</span><time className="wp-muted">{date(event.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}</time></article>)}{activity.data?.length === 0 && <p className="wp-muted">{t('سيظهر النشاط عند أول تغيير محفوظ.', 'Activity will appear after the first persisted change.')}</p>}</div></section>}
        </>}
      </>}
    </>}
    <Modal isOpen={creating} onClose={() => setCreating(false)} title={t('إنشاء مشروع ويب', 'Create a Web Project')} maxWidth="lg" footer={<Button form="wp-project-create" type="submit" isLoading={rpc.isPending} disabled={!candidates.data?.length || !ownerId}>{t('إنشاء المشروع', 'Create project')}</Button>}><form id="wp-project-create" onSubmit={(event) => void create(event)} className="wp-stack"><Field label={t('اسم المنتج', 'Product name')}><input name="name" required minLength={3} maxLength={180} /></Field><Field label={t('المعرف الفريد', 'Unique slug')}><input name="slug" required minLength={3} maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="product-name" dir="ltr" /></Field><Field label={t('مسؤول المنتج', 'Product owner')}><MemberPicker name="owner" value={ownerId} onChange={setOwnerId} candidates={candidates.data ?? []} placeholder={t('اختار عضو واحد', 'Select one member')} invalid={!ownerId} /></Field><p className="wp-hint">{t('شخص واحد بس لكل مشروع: هو اللي بيستلم دعوة المشروع كمساهم، وبيتحول لقائد تلقائيًا لو ما اخترتش قائد أساسي. مفيش حد أقصى لعدد المشروعات اللي الشخص يقدر يكون مسؤول عنها.', 'One person per project: they receive the project invitation as a contributor, and become the lead automatically if you do not pick a primary leader. There is no cap on how many projects one person can own.')}</p><Field label={t('القائد الأساسي (اختياري)', 'Primary leader (optional)')}><MemberPicker name="leader" value={leaderId} onChange={setLeaderId} candidates={candidates.data ?? []} placeholder={t('يحدد لاحقًا قبل التفعيل', 'Assign later, before activation')} clearLabel={t('بدون قائد دلوقتي', 'No leader yet')} /></Field><p className="wp-hint">{t('القائد هو اللي بيدير المهام والمراجعات والموافقات جوه المشروع. تقدر تسيبه فاضي وتحدده من إعدادات المشروع قبل التفعيل، ولو حددت نفس الشخص كمسؤول وقائد بياخد دور lead مباشرة.', 'The leader runs tasks, reviews and approvals inside the project. You can leave it empty and assign it from project settings before activation; if the same person is owner and leader, they get the lead role directly.')}</p><p className="wp-hint">{t(`${number(candidates.data?.length ?? 0)} عضو مؤهل للاختيار (لازم يكون عضوية نشطة وحساب دخول جاهز).`, `${number(candidates.data?.length ?? 0)} eligible members (active membership and a ready sign-in account).`)}</p>{candidates.isError && <ErrorState message={candidates.error.message} onRetry={() => void candidates.refetch()} />}<div className="wp-notice">{t('الملكية الفكرية لا تنتقل تلقائيًا إلى PHANTOMS. يجب تسجيل الاتفاق والترخيص والإسناد وموافقة المساهمين بوضوح قبل المشاركة.', 'Intellectual property is not automatically assigned to PHANTOMS. Record ownership, licensing, attribution and contributor acceptance explicitly before participation.')}</div></form></Modal>
  </div>;
}
