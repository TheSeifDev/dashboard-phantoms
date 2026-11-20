import { useMemo, useState } from 'react';
import {
  CheckCheck,
  ClipboardCheck,
  Clock,
  Eye,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useMembers } from '../members/api';
import {
  EVALUATION_GRADE_LABELS,
  useAdminEvaluations,
  useDeleteEvaluation,
} from './api';
import type { EvaluationGrade, MemberEvaluation } from './api';
import { EvaluationCreateModal } from './EvaluationCreateModal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';

type ReadStatusFilter = 'ALL' | 'READ' | 'UNREAD';

export function getGradeBadgeVariant(
  grade: EvaluationGrade,
): 'success' | 'info' | 'neutral' | 'warning' | 'danger' {
  switch (grade) {
    case 'excellent':
      return 'success';
    case 'very_good':
      return 'info';
    case 'good':
      return 'neutral';
    case 'needs_improvement':
      return 'warning';
    case 'warning':
      return 'danger';
  }
}

function getGradeLabel(grade: EvaluationGrade, t: (ar: string, en: string) => string) {
  const english: Record<EvaluationGrade, string> = {
    excellent: 'Excellent',
    very_good: 'Very good',
    good: 'Good',
    needs_improvement: 'Needs improvement',
    warning: 'Notice',
  };
  return t(EVALUATION_GRADE_LABELS[grade], english[grade]);
}

export default function EvaluationsPage() {
  const { t, number, date, dir } = useLocale();
  const evaluationsQuery = useAdminEvaluations();
  const membersQuery = useMembers();
  const deleteEval = useDeleteEvaluation();

  const [createOpen, setCreateOpen] = useState(false);
  const [preselectedMemberId, setPreselectedMemberId] = useState<number | null>(null);
  const [evalToDelete, setEvalToDelete] = useState<MemberEvaluation | null>(null);
  const [search, setSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<string>('ALL');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [readFilter, setReadFilter] = useState<ReadStatusFilter>('ALL');

  const members = membersQuery.data ?? [];
  const evaluations = evaluationsQuery.data ?? [];

  const memberNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const member of members) map[member.id] = member.full_name;
    return map;
  }, [members]);

  const stats = useMemo(() => {
    const total = evaluations.length;
    const readOrViewed = evaluations.filter((evaluation) => Boolean(evaluation.read_at || evaluation.viewed_at)).length;
    return { total, readOrViewed, unread: total - readOrViewed };
  }, [evaluations]);

  const filteredEvaluations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return evaluations.filter((evaluation) => {
      const memberName = (memberNameMap[evaluation.member_id] ?? t(`عضو #${evaluation.member_id}`, `Member #${evaluation.member_id}`)).toLowerCase();
      const matchSearch =
        !query ||
        memberName.includes(query) ||
        evaluation.title.toLowerCase().includes(query) ||
        evaluation.feedback.toLowerCase().includes(query);
      const matchMember = memberFilter === 'ALL' || String(evaluation.member_id) === memberFilter;
      const matchGrade = gradeFilter === 'ALL' || evaluation.grade === gradeFilter;
      const isRead = Boolean(evaluation.read_at || evaluation.viewed_at);
      const matchRead =
        readFilter === 'ALL' ||
        (readFilter === 'READ' && isRead) ||
        (readFilter === 'UNREAD' && !isRead);
      return matchSearch && matchMember && matchGrade && matchRead;
    });
  }, [evaluations, memberNameMap, search, memberFilter, gradeFilter, readFilter, t]);

  const handleOpenCreate = (memberId?: number) => {
    setPreselectedMemberId(memberId ?? null);
    setCreateOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setMemberFilter('ALL');
    setGradeFilter('ALL');
    setReadFilter('ALL');
  };

  const handleConfirmDelete = async () => {
    if (!evalToDelete) return;
    try {
      await deleteEval.mutateAsync(evalToDelete);
      toast.success(t('تم حذف التقييم بنجاح.', 'Evaluation deleted successfully.'));
      setEvalToDelete(null);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return date(iso, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  if (evaluationsQuery.isLoading || membersQuery.isLoading) {
    return (
      <section className="grid gap-4" dir={dir} aria-busy="true" aria-label={t('تحميل سجل التقييمات', 'Loading evaluations')}>
        <h1 className="text-xl font-black text-[var(--text)]">{t('تقييمات الأعضاء', 'Member evaluations')}</h1>
        <p className="sr-only" role="status" aria-live="polite">{t('جارٍ تحميل سجل التقييمات وقائمة الأعضاء…', 'Loading evaluations and members…')}</p>
        <CardSkeletons count={4} />
      </section>
    );
  }

  if (evaluationsQuery.isError || membersQuery.isError) {
    const evaluationsFailed = evaluationsQuery.isError;
    return (
      <section className="grid gap-4" dir={dir}>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <h1 className="text-xl font-black text-[var(--text)]">{t('تقييمات الأعضاء', 'Member evaluations')}</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t('تعذّر تجهيز سجل التقييمات. أعد تحميل البيانات للمتابعة.', 'We could not prepare the evaluations view. Reload the data to continue.')}</p>
        </div>
        <ErrorState
          message={evaluationsFailed
            ? t('معرفناش نحمّل سجل التقييمات.', 'Could not load the evaluation history.')
            : t('تعذر تحميل قائمة الأعضاء اللازمة لعرض وإضافة التقييمات.', 'Could not load the member list needed to view and create evaluations.')}
          onRetry={() => {
            if (evaluationsFailed) void evaluationsQuery.refetch();
            if (membersQuery.isError) void membersQuery.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="flex min-w-0 w-full flex-col gap-4" dir={dir}>
      <header className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true">
            <ClipboardCheck size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-[var(--fs-xl)] font-black text-[var(--text)]">
              {t('تقييمات الأعضاء ومتابعة الاطلاع', 'Member evaluations & read status')}
            </h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              {t('أرسل تقييمات الأداء والملاحظات للأعضاء لتظهر لهم في بوابتهم، وتابع حالة اطلاعهم عليها.', 'Send performance feedback to members’ portal and follow whether they have viewed it.')}
            </p>
          </div>
        </div>
        <Button
          onClick={() => handleOpenCreate()}
          icon={<Plus size={18} aria-hidden="true" />}
          fullOnMobile
          className="shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          {t('إضافة تقييم جديد', 'Add evaluation')}
        </Button>
      </header>

      <section aria-label={t('ملخص التقييمات', 'Evaluation summary')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">{t('إجمالي التقييمات المرسلة', 'Evaluations sent')}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text)]">{number(stats.total)}</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">{t('اطّلع عليها الأعضاء', 'Viewed by members')}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[var(--success-text)]">{number(stats.readOrViewed)}</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">{t('بانتظار اطلاع العضو', 'Awaiting member review')}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-amber-700 dark:text-amber-400">{number(stats.unread)}</p>
        </div>
      </section>

      <section aria-label={t('البحث والتصفية', 'Search and filters')} className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-sm)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            aria-label={t('ابحث باسم العضو أو عنوان التقييم أو تفاصيله', 'Search member, evaluation title, or feedback')}
            placeholder={t('ابحث بالاسم أو عنوان التقييم...', 'Search by member or evaluation title…')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-3 ps-9 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
        </div>
        <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} aria-label={t('تصفية حسب العضو', 'Filter by member')} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
          <option value="ALL">{t('كل الأعضاء', 'All members')} ({number(members.length)})</option>
          {members.map((member) => <option key={member.id} value={String(member.id)}>{member.full_name}</option>)}
        </select>
        <select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)} aria-label={t('تصفية حسب التقدير', 'Filter by grade')} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
          <option value="ALL">{t('كل التقديرات', 'All grades')}</option>
          {(Object.keys(EVALUATION_GRADE_LABELS) as EvaluationGrade[]).map((grade) => <option key={grade} value={grade}>{getGradeLabel(grade, t)}</option>)}
        </select>
        <select value={readFilter} onChange={(event) => setReadFilter(event.target.value as ReadStatusFilter)} aria-label={t('تصفية حسب حالة القراءة', 'Filter by read status')} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
          <option value="ALL">{t('كل حالات الاطلاع', 'All read statuses')}</option>
          <option value="READ">{t('اطّلع عليه العضو', 'Viewed by member')}</option>
          <option value="UNREAD">{t('لم يطلع عليه بعد', 'Not yet viewed')}</option>
        </select>
      </section>

      {evaluations.length === 0 ? (
        <EmptyState
          title={t('لا توجد تقييمات حتى الآن', 'No evaluations yet')}
          description={t('ابدأ بإرسال أول تقييم لأحد أعضاء الفريق، وسيظهر له في بوابته.', 'Create the first evaluation for a team member; it will appear in their portal.')}
          action={<Button onClick={() => handleOpenCreate()} icon={<Plus size={16} aria-hidden="true" />} fullOnMobile>{t('إضافة تقييم جديد', 'Add evaluation')}</Button>}
        />
      ) : filteredEvaluations.length === 0 ? (
        <EmptyState
          title={t('لا توجد نتائج مطابقة', 'No matching evaluations')}
          description={t('جرّب تعديل البحث أو المرشحات لعرض تقييمات أخرى.', 'Try changing the search or filters to see other evaluations.')}
          action={<Button type="button" variant="secondary" onClick={clearFilters} fullOnMobile>{t('مسح البحث والمرشحات', 'Clear search and filters')}</Button>}
        />
      ) : (
        <div className="grid gap-3" aria-live="polite" aria-label={t('نتائج التقييمات', 'Evaluation results')}>
          <p className="sr-only" role="status">{t(`عدد النتائج: ${filteredEvaluations.length}`, `${filteredEvaluations.length} results`)}</p>
          {filteredEvaluations.map((evaluation) => {
            const memberName = memberNameMap[evaluation.member_id] ?? t(`عضو #${evaluation.member_id}`, `Member #${evaluation.member_id}`);
            const viewed = Boolean(evaluation.read_at || evaluation.viewed_at);
            return (
              <article key={`${evaluation.mode}-${evaluation.id}`} className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-sm font-black text-[var(--link)]" aria-hidden="true">{memberName.trim().charAt(0) || 'ع'}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-black text-[var(--text)]">{memberName}</h2>
                        <Badge variant={getGradeBadgeVariant(evaluation.grade)}>{getGradeLabel(evaluation.grade, t)}</Badge>
                        {evaluation.points !== 0 && <Badge variant={evaluation.points > 0 ? 'success' : 'danger'}>{evaluation.points > 0 ? t(`+${number(evaluation.points)} مكافأة`, `+${number(evaluation.points)} bonus`) : t(`${number(evaluation.points)} خصم`, `${number(evaluation.points)} deduction`)}</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs font-bold text-[var(--text-muted)]">
                        {evaluation.title} <span aria-hidden="true">—</span> {t('بواسطة:', 'By:')} {evaluation.evaluator_name}
                      </p>
                    </div>
                  </div>
                  <time className="shrink-0 text-xs text-[var(--text-muted)]" dateTime={evaluation.created_at}>{formatDate(evaluation.created_at)}</time>
                </div>

                <p className="whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5 text-sm leading-6 text-[var(--text)]">{evaluation.feedback}</p>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                  <div className="flex min-h-11 items-center gap-2 text-xs font-bold" role="status" aria-label={t('حالة اطلاع العضو', 'Member read status')}>
                    {evaluation.read_at ? (
                      <span className="inline-flex flex-wrap items-center gap-1 text-[var(--success-text)]"><CheckCheck size={15} aria-hidden="true" />{t('أكد العضو قراءة التقييم', 'Member confirmed reading')} ({formatDate(evaluation.read_at)})</span>
                    ) : evaluation.viewed_at ? (
                      <span className="inline-flex flex-wrap items-center gap-1 text-[var(--link)]"><Eye size={15} aria-hidden="true" />{t('شاهد التقييم في البوابة', 'Viewed in portal')} ({formatDate(evaluation.viewed_at)})</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--text-muted)]"><Clock size={15} aria-hidden="true" />{t('لم يفتح العضو التقييم بعد', 'Not viewed yet')}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => handleOpenCreate(evaluation.member_id)} aria-label={t(`إضافة تقييم جديد للعضو ${memberName}`, `Add another evaluation for ${memberName}`)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                      <UserPlus size={14} aria-hidden="true" />{t('تقييم جديد للعضو', 'New evaluation')}
                    </button>
                    <button type="button" onClick={() => setEvalToDelete(evaluation)} aria-label={t(`حذف تقييم ${evaluation.title} للعضو ${memberName}`, `Delete “${evaluation.title}” for ${memberName}`)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]">
                      <Trash2 size={14} aria-hidden="true" />{t('حذف', 'Delete')}
                    </button>
                  </div>
                  <span className="sr-only">{viewed ? t('تمت مشاهدة التقييم', 'Evaluation has been viewed') : t('لم تتم مشاهدة التقييم', 'Evaluation has not been viewed')}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <EvaluationCreateModal isOpen={createOpen} members={members} preselectedMemberId={preselectedMemberId} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        isOpen={Boolean(evalToDelete)}
        onClose={() => setEvalToDelete(null)}
        onConfirm={() => { void handleConfirmDelete(); }}
        title={t('تأكيد حذف التقييم', 'Confirm evaluation deletion')}
        itemName={evalToDelete?.title}
        description={t('سيتم حذف هذا التقييم من بوابة العضو، وإذا كان مرتبطاً بنقاط بونص فسيتم إلغاء النقاط المرتبطة به أيضاً.', 'This evaluation will be removed from the member portal. Any bonus points linked to it will also be reversed.')}
        confirmLabel={t('حذف التقييم', 'Delete evaluation')}
        isPending={deleteEval.isPending}
        pendingLabel={t('جارٍ الحذف…', 'Deleting…')}
      />
    </section>
  );
}
