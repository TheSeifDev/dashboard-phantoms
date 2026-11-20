import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Field, StatusBadge, SafeLink } from './common';
import { useWebCandidates, useWebQuery, useWebRpc } from './api';
import type { WebIdea, WebMode } from './types';

const TEXT_FIELDS = [
  ['title', 'عنوان الفكرة', 'Idea title'], ['short_description', 'وصف مختصر', 'Short description'],
  ['problem_statement', 'المشكلة', 'Problem statement'], ['proposed_solution', 'الحل المقترح', 'Proposed solution'],
  ['target_audience', 'الجمهور المستهدف', 'Target audience'], ['phantoms_benefit', 'الفائدة لـPHANTOMS', 'PHANTOMS benefit'],
] as const;
const ARRAY_FIELDS = [
  ['potential_use_cases', 'حالات الاستخدام (سطر لكل حالة)', 'Use cases (one per line)'],
  ['suggested_tech_stack', 'التقنيات (سطر لكل تقنية)', 'Tech stack (one per line)'],
  ['required_skills', 'المهارات المطلوبة (سطر لكل مهارة)', 'Required skills (one per line)'],
  ['supporting_documents', 'المراجع والوثائق (رابط لكل سطر)', 'Documents and references (one URL per line)'],
] as const;
export function IdeasPanel({ mode }: { mode: WebMode }) {
  const { t, date } = useLocale();
  const memberId = useAuthStore((state) => state.currentMember?.id);
  const ideas = useWebQuery<WebIdea>(mode, 'web_ideas');
  const candidates = useWebCandidates(mode, undefined, mode === 'admin');
  const rpc = useWebRpc(mode);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<WebIdea | null>(null);
  const [decision, setDecision] = useState('under_review');
  const [notes, setNotes] = useState('');
  const [slug, setSlug] = useState('');
  const [leader, setLeader] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [proposalMembers, setProposalMembers] = useState<number[]>([]);
  const run = async (action: () => Promise<unknown>) => {
    try { await action(); toast.success(t('تم حفظ العملية.', 'Changes saved.')); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : t('تعذر الحفظ.', 'Could not save.')); return false; }
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const [key] of TEXT_FIELDS) payload[key] = String(data.get(key) ?? '').trim();
    for (const [key] of ARRAY_FIELDS) payload[key] = String(data.get(key) ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    payload.estimated_complexity = data.get('estimated_complexity');
    payload.graduation_project = data.get('graduation_project') === 'on';
    payload.submitted_by_member_id = mode === 'member' ? memberId : Number(data.get('submitter'));
    payload.suggested_leader_member_id = data.get('suggested_leader_member_id') ? Number(data.get('suggested_leader_member_id')) : null;
    const ok = await run(() => rpc.mutateAsync({ name: 'web_create_idea', args: { p_details: payload, p_contributor_member_ids: proposalMembers } }));
    if (ok) { setCreating(false); setProposalMembers([]); }
  };
  const visible = (ideas.data ?? []).filter((idea) => (status === 'all' || idea.review_status === status) && `${idea.title} ${idea.short_description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <section className="wp-stack">
    <div className="wp-row"><div><h2>{t('من الفكرة إلى المنتج', 'From idea to product')}</h2><p className="wp-muted">{t('مقترحات موثقة، مراجعة واضحة، وتحويل واحد فقط لكل فكرة معتمدة.', 'Documented proposals, recorded review, and one project per approved idea.')}</p></div><Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t('اقتراح فكرة', 'Propose an idea')}</Button></div>
    <div className="wp-toolbar"><Field label={t('البحث', 'Search')}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></Field><Field label={t('مرحلة المراجعة', 'Review stage')}><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t('كل المراحل', 'All stages')}</option>{['proposed', 'under_review', 'approved', 'rejected'].map((value) => <option key={value} value={value}>{t({ proposed: 'مقترح', under_review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض' }[value] ?? value, value.replaceAll('_', ' '))}</option>)}</select></Field></div>
    {ideas.isPending && <p role="status">{t('جارٍ تحميل الأفكار…', 'Loading ideas…')}</p>}
    {ideas.isError && <ErrorState message={ideas.error.message} onRetry={() => void ideas.refetch()} />}
    {ideas.data && visible.length === 0 && <EmptyState title={t('لا توجد أفكار مطابقة', 'No matching ideas')} description={t('أضف فكرة أو عدل البحث والمرشح.', 'Add a proposal or change the search and filter.')} />}
    <div className="wp-grid">{visible.map((idea) => <article className="wp-panel wp-stack" key={idea.id}><div className="wp-row"><StatusBadge status={idea.review_status} /><time className="wp-muted">{date(idea.submitted_at)}</time></div><h3>{idea.title}</h3><p className="wp-muted">{idea.short_description}</p><div className="wp-actions"><Button variant="secondary" onClick={() => { setSelected(idea); setNotes(idea.review_notes); setSlug(''); setLeader(String(idea.suggested_leader_member_id ?? '')); }}>{t('تفاصيل ومراجعة', 'Details & review')}</Button>{idea.converted_project_id && <Link className="wp-link" to={`${mode === 'admin' ? '/admin/web-projects/projects' : '/portal/projects'}/${idea.converted_project_id}`}>{t('افتح المشروع', 'Open project')}</Link>}</div></article>)}</div>
    <Modal isOpen={creating} onClose={() => { if (!rpc.isPending) setCreating(false); }} title={t('اقتراح منتج جديد', 'Propose a new product')} maxWidth="2xl" footer={<Button type="submit" form="wp-idea-create" isLoading={rpc.isPending}>{t('إرسال الفكرة', 'Submit idea')}</Button>}>
      <form id="wp-idea-create" onSubmit={(event) => void create(event)} className="wp-stack">
        {mode === 'admin' && <Field label={t('مقدم الفكرة من دليل الأعضاء', 'Submitter from the member directory')}><select name="submitter" required><option value="">{t('اختار عضوًا', 'Select a member')}</option>{candidates.data?.map((candidate) => <option key={candidate.member_id} value={candidate.member_id}>{candidate.full_name}</option>)}</select></Field>}
        {candidates.isError && mode === 'admin' && <ErrorState message={candidates.error.message} onRetry={() => void candidates.refetch()} />}
        {TEXT_FIELDS.map(([key, ar, en]) => <Field key={key} label={t(ar, en)}>{key === 'title' ? <input name={key} required minLength={3} maxLength={180} /> : <textarea name={key} required={key === 'short_description'} maxLength={key === 'short_description' ? 800 : 10000} />}</Field>)}
        <div className="wp-grid">{ARRAY_FIELDS.map(([key, ar, en]) => <Field key={key} label={t(ar, en)}><textarea name={key} /></Field>)}</div>
        <Field label={t('التعقيد المتوقع', 'Estimated complexity')}><select name="estimated_complexity">{['unspecified', 'small', 'medium', 'large', 'research'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        {mode === 'admin' && <><Field label={t('قائد مقترح', 'Suggested leader')}><select name="suggested_leader_member_id"><option value="">{t('يحدد لاحقًا', 'Assign later')}</option>{candidates.data?.map((candidate) => <option key={candidate.member_id} value={candidate.member_id}>{candidate.full_name}</option>)}</select></Field><fieldset className="wp-checks"><legend>{t('مساهمون مقترحون', 'Proposed contributors')}</legend>{candidates.data?.map((candidate) => <label key={candidate.member_id} className="wp-actions"><input type="checkbox" checked={proposalMembers.includes(candidate.member_id)} onChange={(event) => setProposalMembers((current) => event.target.checked ? [...current, candidate.member_id] : current.filter((id) => id !== candidate.member_id))} />{candidate.full_name}</label>)}</fieldset></>}
        <Field label={t('مشروع تخرج', 'Graduation project')}><input type="checkbox" name="graduation_project" /></Field>
      </form>
    </Modal>
    <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? ''} maxWidth="2xl">
      {selected && <div className="wp-stack"><StatusBadge status={selected.review_status} />{TEXT_FIELDS.slice(1).map(([key, ar, en]) => <section key={key}><h3>{t(ar, en)}</h3><p className="wp-detail-copy">{selected[key] || '—'}</p></section>)}{ARRAY_FIELDS.map(([key, ar, en]) => <section key={key}><h3>{t(ar, en)}</h3><div className="wp-detail-copy">{selected[key].map((item, index) => key === 'supporting_documents' ? <div key={index}><SafeLink href={String(item)}>{String(item)}</SafeLink></div> : <div key={index}>{String(item)}</div>)}</div></section>)}<p className="wp-muted">{t('مقدم الفكرة', 'Original submitter')}: {candidates.data?.find((person) => person.member_id === selected.submitted_by_member_id)?.full_name ?? `#${selected.submitted_by_member_id}`} · {date(selected.submitted_at)}</p>
        <p className="wp-detail-copy">{selected.review_notes}</p>
        {mode === 'admin' && !selected.converted_project_id && <><Field label={t('قرار المراجعة', 'Review decision')}><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="under_review">{t('قيد المراجعة', 'Under review')}</option><option value="approved">{t('اعتماد', 'Approve')}</option><option value="rejected">{t('رفض', 'Reject')}</option></select></Field><Field label={t('ملاحظات المراجعة', 'Review notes')}><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><Button isLoading={rpc.isPending} onClick={() => void run(() => rpc.mutateAsync({ name: 'web_review_idea', args: { p_idea_id: selected.id, p_decision: decision, p_notes: notes } })).then((ok) => { if (ok) setSelected(null); })}>{t('تسجيل قرار المراجعة', 'Record review decision')}</Button></>}
        {mode === 'admin' && selected.review_status === 'approved' && !selected.converted_project_id && <section className="wp-panel wp-stack"><h3>{t('تحويل الفكرة المعتمدة', 'Convert approved idea')}</h3><Field label={t('معرّف المشروع', 'Project slug')}><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="project-name" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></Field><Field label={t('قائد المشروع', 'Project leader')}><select value={leader} onChange={(event) => setLeader(event.target.value)}><option value="">{t('يحدد لاحقًا', 'Assign later')}</option>{candidates.data?.map((person) => <option key={person.member_id} value={person.member_id}>{person.full_name}</option>)}</select></Field><Button disabled={!slug} isLoading={rpc.isPending} onClick={() => void run(() => rpc.mutateAsync({ name: 'web_convert_idea_to_project', args: { p_idea_id: selected.id, p_project_slug: slug, p_lead_member_id: leader ? Number(leader) : null } })).then((ok) => { if (ok) setSelected(null); })}>{t('إنشاء المشروع مع حفظ المصدر', 'Create project & preserve source')}</Button></section>}
      </div>}
    </Modal>
  </section>;
}
