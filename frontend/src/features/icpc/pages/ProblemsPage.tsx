import { useMemo, useState } from 'react';
import { ExternalLink, ListChecks, Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Modal } from '../../../components/ui/Modal';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useAssignProblem, useDeleteProblem, useIcpcProblems, useSaveProblem, useSetProgress } from '../api';
import { Chip, Panel } from '../components/IcpcPanels';
import {
  DIFFICULTY_LABELS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  type IcpcMode,
  type IcpcProblem,
  type ProblemDifficulty,
  type ProblemStatus,
} from '../types';

const PLATFORMS = ['codeforces', 'codechef', 'atcoder', 'cses', 'other'] as const;
const DIFFICULTIES: ProblemDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
const STATUSES: ProblemStatus[] = ['todo', 'solving', 'solved', 'upsolving', 'revisit'];

interface ProblemDraft {
  id?: number;
  title: string;
  url: string;
  platform: string;
  external_id: string;
  difficulty: ProblemDifficulty;
  topics: string;
  description: string;
  editorial_url: string;
}

const EMPTY_DRAFT: ProblemDraft = {
  title: '',
  url: '',
  platform: 'codeforces',
  external_id: '',
  difficulty: 'medium',
  topics: '',
  description: '',
  editorial_url: '',
};

export function ProblemsPage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [status, setStatus] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ProblemDraft>(EMPTY_DRAFT);
  const [assignTarget, setAssignTarget] = useState<IcpcProblem | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [pendingDelete, setPendingDelete] = useState<IcpcProblem | null>(null);

  const filters = useMemo(
    () => ({ query, platform, difficulty, topic, status }),
    [query, platform, difficulty, topic, status],
  );
  const problems = useIcpcProblems(mode, filters);
  const saveProblem = useSaveProblem(mode);
  const deleteProblem = useDeleteProblem(mode);
  const assignProblem = useAssignProblem(mode);
  const setProgress = useSetProgress(mode);

  const canManage = mode === 'admin';
  const rows = problems.data?.problems ?? [];

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setEditorOpen(true);
  };

  const openEdit = (problem: IcpcProblem) => {
    setDraft({
      id: problem.id,
      title: problem.title,
      url: problem.url ?? '',
      platform: problem.platform,
      external_id: problem.external_id ?? '',
      difficulty: problem.difficulty,
      topics: problem.topics.join(', '),
      description: problem.description ?? '',
      editorial_url: problem.editorial_url ?? '',
    });
    setEditorOpen(true);
  };

  const submit = async () => {
    try {
      await saveProblem.mutateAsync({
        ...(draft.id ? { id: draft.id } : {}),
        title: draft.title,
        url: draft.url,
        platform: draft.platform,
        external_id: draft.external_id,
        difficulty: draft.difficulty,
        topics: draft.topics.split(',').map((entry) => entry.trim()).filter(Boolean),
        description: draft.description,
        editorial_url: draft.editorial_url,
      });
      toast.success(t('اتحفظت المسألة.', 'Problem saved.'));
      setEditorOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحفظ المسألة.', 'Could not save the problem.'));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteProblem.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذفت المسألة.', 'Problem deleted.'));
      setPendingDelete(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف المسألة.', 'Could not delete the problem.'));
    }
  };

  const submitAssign = async () => {
    if (!assignTarget) return;
    try {
      await assignProblem.mutateAsync({ problemId: assignTarget.id, userIds: assignees, due: dueDate || null });
      toast.success(t('اتكلّفت المسألة.', 'Problem assigned.'));
      setAssignTarget(null);
      setAssignees([]);
      setDueDate('');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نكلّف المسألة.', 'Could not assign the problem.'));
    }
  };

  const updateStatus = async (assignmentId: number, next: string) => {
    try {
      await setProgress.mutateAsync({ assignmentId, status: next });
      toast.success(t('اتحدّثت الحالة.', 'Status updated.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحدّث الحالة.', 'Could not update status.'));
    }
  };

  if (problems.isLoading) return <CardSkeletons count={3} />;
  if (problems.isError) {
    return <ErrorState message={(problems.error as Error | null)?.message ?? t('معرفناش نحمّل المسائل.', 'Could not load problems.')} onRetry={() => void problems.refetch()} />;
  }

  return (
    <div className="grid gap-4">
      <Panel
        title={t('بنك المسائل', 'Problem bank')}
        icon={<ListChecks size={15} aria-hidden="true" />}
        hint={t(`${number(rows.length)} مسألة`, `${number(rows.length)} problems`)}
        action={canManage ? <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('مسألة جديدة', 'New problem')}</Button> : undefined}
        flush
      >
        <div className="icpc-toolbar">
          <label className="icpc-field" style={{ flex: '1 1 200px' }}>
            <span>{t('بحث', 'Search')}</span>
            <span className="relative">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('اسم المسألة', 'Problem title')} style={{ paddingInlineStart: 34 }} />
            </span>
          </label>
          <label className="icpc-field">
            <span>{t('المنصة', 'Platform')}</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="">{t('الكل', 'All')}</option>
              {PLATFORMS.map((value) => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('الصعوبة', 'Difficulty')}</span>
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="">{t('الكل', 'All')}</option>
              {DIFFICULTIES.map((value) => <option key={value} value={value}>{DIFFICULTY_LABELS[value][locale]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('الموضوع', 'Topic')}</span>
            <select value={topic} onChange={(event) => setTopic(event.target.value)}>
              <option value="">{t('الكل', 'All')}</option>
              {(problems.data?.topics ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('الحالة', 'Status')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('الكل', 'All')}</option>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value][locale]}</option>)}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('مفيش مسائل مطابقة', 'No matching problems')}
              description={canManage
                ? t('ابدأ بإضافة أول مسألة في البنك وكلّفها على أعضاء الفريق.', 'Add the first problem to the bank and assign it to the team.')
                : t('لسه مفيش مسائل مكلّفة ليك في الفلتر الحالي.', 'No problems assigned to you in this filter yet.')}
              action={canManage ? <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('أضف مسألة', 'Add problem')}</Button> : undefined}
            />
          </div>
        ) : (
          <div className="icpc-list">
            {rows.map((problem) => (
              <div key={problem.id} className="icpc-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="icpc-row-main">
                  <span className="icpc-row-title">{problem.title}</span>
                  <span className="icpc-row-sub">
                    <Chip>{PLATFORM_LABELS[problem.platform] ?? problem.platform}</Chip>
                    <Chip tone={problem.difficulty === 'easy' ? 'success' : problem.difficulty === 'medium' ? 'warning' : 'danger'}>
                      {DIFFICULTY_LABELS[problem.difficulty][locale]}
                    </Chip>
                    {problem.topics.slice(0, 3).map((entry) => <Chip key={entry}>{entry}</Chip>)}
                  </span>
                  {problem.assignments.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {problem.assignments.map((assignment) => (
                        <span key={assignment.id} className="icpc-chip" title={assignment.due_date ? t(`تسليم ${date(assignment.due_date)}`, `Due ${date(assignment.due_date)}`) : undefined}>
                          {assignment.member}
                          <select
                            value={assignment.status}
                            onChange={(event) => void updateStatus(assignment.id, event.target.value)}
                            aria-label={t('حالة التكليف', 'Assignment status')}
                            style={{ background: 'transparent', border: 0, color: 'inherit', fontSize: 11, fontWeight: 700 }}
                          >
                            {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value][locale]}</option>)}
                          </select>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="icpc-row-meta">
                  {problem.url && (
                    <a className="icpc-chip" href={problem.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={12} aria-hidden="true" /> {t('افتح', 'Open')}
                    </a>
                  )}
                  {canManage && (
                    <>
                      <Button variant="secondary" icon={<UserPlus size={14} aria-hidden="true" />} onClick={() => { setAssignTarget(problem); setAssignees([]); }}>{t('كلّف', 'Assign')}</Button>
                      <Button variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => openEdit(problem)} aria-label={t('تعديل', 'Edit')} />
                      <Button variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setPendingDelete(problem)} aria-label={t('حذف', 'Delete')} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={draft.id ? t('تعديل مسألة', 'Edit problem') : t('مسألة جديدة', 'New problem')}
        subtitle={t('اللينك الخارجي هو المصدر الأساسي — مفيش رفع كود.', 'The external link is the source of truth — no code upload.')}
        maxWidth="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={() => void submit()} isLoading={saveProblem.isPending}>{t('حفظ', 'Save')}</Button>
          </>
        )}
      >
        <div className="icpc-form-grid">
          <label className="icpc-field icpc-span-2">
            <span>{t('اسم المسألة', 'Title')}</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('لينك المسألة', 'Problem URL')}</span>
            <input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://codeforces.com/problemset/problem/..." />
          </label>
          <label className="icpc-field">
            <span>{t('المنصة', 'Platform')}</span>
            <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>
              {PLATFORMS.map((value) => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('معرّف المسألة', 'External ID')}</span>
            <input value={draft.external_id} onChange={(event) => setDraft({ ...draft, external_id: event.target.value })} placeholder="1920C" />
          </label>
          <label className="icpc-field">
            <span>{t('الصعوبة', 'Difficulty')}</span>
            <select value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value as ProblemDifficulty })}>
              {DIFFICULTIES.map((value) => <option key={value} value={value}>{DIFFICULTY_LABELS[value][locale]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('المواضيع (بفاصلة)', 'Topics (comma separated)')}</span>
            <input value={draft.topics} onChange={(event) => setDraft({ ...draft, topics: event.target.value })} placeholder="dp, graphs" />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('وصف مختصر', 'Description')}</span>
            <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('لينك الإيديتوريال', 'Editorial URL')}</span>
            <input type="url" value={draft.editorial_url} onChange={(event) => setDraft({ ...draft, editorial_url: event.target.value })} />
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        title={t('تكليف المسألة', 'Assign problem')}
        subtitle={assignTarget?.title}
        maxWidth="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setAssignTarget(null)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={() => void submitAssign()} isLoading={assignProblem.isPending} disabled={assignees.length === 0}>{t('كلّف', 'Assign')}</Button>
          </>
        )}
      >
        <div className="grid gap-3">
          <label className="icpc-field">
            <span>{t('تاريخ التسليم', 'Due date')}</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <div className="grid max-h-64 gap-1 overflow-y-auto">
            {(problems.data?.directory ?? []).map((member) => (
              <label key={member.user_id} className="icpc-chip" style={{ justifyContent: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={assignees.includes(member.user_id)}
                  onChange={(event) => setAssignees((current) => event.target.checked
                    ? [...current, member.user_id]
                    : current.filter((id) => id !== member.user_id))}
                />
                {member.full_name}
                {member.team ? ` — ${member.team}` : ''}
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('حذف المسألة', 'Delete problem')}
        itemName={pendingDelete?.title}
        description={t('هتتحذف المسألة وكل تكليفاتها. مش ممكن الرجوع.', 'The problem and its assignments will be removed. This cannot be undone.')}
        confirmLabel={t('احذف', 'Delete')}
        isPending={deleteProblem.isPending}
      />
    </div>
  );
}
