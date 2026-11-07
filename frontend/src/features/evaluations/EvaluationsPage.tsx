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

export default function EvaluationsPage() {
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
    for (const m of members) {
      map[m.id] = m.full_name;
    }
    return map;
  }, [members]);

  const stats = useMemo(() => {
    const total = evaluations.length;
    const readOrViewed = evaluations.filter((e) => Boolean(e.read_at || e.viewed_at)).length;
    const unread = total - readOrViewed;
    return { total, readOrViewed, unread };
  }, [evaluations]);

  const filteredEvaluations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return evaluations.filter((ev) => {
      const mName = (memberNameMap[ev.member_id] ?? `عضو #${ev.member_id}`).toLowerCase();
      const matchSearch =
        !q ||
        mName.includes(q) ||
        ev.title.toLowerCase().includes(q) ||
        ev.feedback.toLowerCase().includes(q);
      const matchMember =
        memberFilter === 'ALL' || String(ev.member_id) === memberFilter;
      const matchGrade =
        gradeFilter === 'ALL' || ev.grade === gradeFilter;
      const isRead = Boolean(ev.read_at || ev.viewed_at);
      const matchRead =
        readFilter === 'ALL' ||
        (readFilter === 'READ' && isRead) ||
        (readFilter === 'UNREAD' && !isRead);
      return matchSearch && matchMember && matchGrade && matchRead;
    });
  }, [evaluations, memberNameMap, search, memberFilter, gradeFilter, readFilter]);

  const handleOpenCreate = (memberId?: number) => {
    setPreselectedMemberId(memberId ?? null);
    setCreateOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!evalToDelete) return;
    try {
      await deleteEval.mutateAsync(evalToDelete);
      toast.success('تم حذف التقييم بنجاح.');
      setEvalToDelete(null);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  if (evaluationsQuery.isLoading || membersQuery.isLoading) {
    return (
      <div className="grid gap-4" dir="rtl">
        <CardSkeletons count={4} />
      </div>
    );
  }

  if (evaluationsQuery.isError) {
    return (
      <div className="grid gap-4" dir="rtl">
        <ErrorState
          message="معرفناش نحمّل سجل التقييمات."
          onRetry={() => {
            void evaluationsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <section className="flex min-w-0 w-full flex-col gap-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]"
            aria-hidden="true"
          >
            <ClipboardCheck size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-[var(--fs-xl)] font-black text-[var(--text)]">
              تقييمات الأعضاء ومتابعة الاطلاع
            </h1>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              أرسل تقييمات الأداء والملاحظات للأعضاء لتظهر لهم مباشرة في بوابتهم بجانب المهام والإعلانات.
            </p>
          </div>
        </div>

        <Button
          onClick={() => handleOpenCreate()}
          icon={<Plus size={18} aria-hidden="true" />}
          fullOnMobile
          className="shrink-0 whitespace-nowrap"
        >
          إضافة تقييم جديد
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">إجمالي التقييمات المرسلة</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text)]">{stats.total}</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">اطّلع عليها الأعضاء</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-400">
            {stats.readOrViewed}
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold text-[var(--text-muted)]">بانتظار اطلاع العضو</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-amber-700 dark:text-amber-400">
            {stats.unread}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-sm)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="ابحث بالاسم أو عنوان التقييم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-3 ps-9 text-sm text-[var(--text)]"
          />
        </div>

        <select
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          aria-label="تصفية حسب العضو"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)]"
        >
          <option value="ALL">كل الأعضاء ({members.length})</option>
          {members.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.full_name}
            </option>
          ))}
        </select>

        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          aria-label="تصفية حسب التقدير"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)]"
        >
          <option value="ALL">كل التقديرات</option>
          {(Object.keys(EVALUATION_GRADE_LABELS) as EvaluationGrade[]).map((g) => (
            <option key={g} value={g}>
              {EVALUATION_GRADE_LABELS[g]}
            </option>
          ))}
        </select>

        <select
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as ReadStatusFilter)}
          aria-label="تصفية حسب حالة القراءة"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)]"
        >
          <option value="ALL">كل حالات الاطلاع</option>
          <option value="READ">اطّلع عليه العضو</option>
          <option value="UNREAD">لم يطلع عليه بعد</option>
        </select>
      </div>

      {/* Evaluations List */}
      {filteredEvaluations.length === 0 ? (
        <div className="py-10">
          <EmptyState
            title="مفيش تقييمات مسجلة"
            description="اضغط «إضافة تقييم جديد» لإرسال أول تقييم لأي عضو في الفريق ليظهر له في بوابته."
          />
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredEvaluations.map((ev) => {
            const memberName = memberNameMap[ev.member_id] ?? `عضو #${ev.member_id}`;
            return (
              <article
                key={`${ev.mode}-${ev.id}`}
                className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-sm font-black text-[var(--link)]">
                      {memberName.trim().charAt(0) || 'ع'}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-black text-[var(--text)]">{memberName}</h3>
                        <Badge variant={getGradeBadgeVariant(ev.grade)}>
                          {EVALUATION_GRADE_LABELS[ev.grade]}
                        </Badge>
                        {ev.points !== 0 && (
                          <Badge variant={ev.points > 0 ? 'success' : 'danger'}>
                            {ev.points > 0 ? `+${ev.points} بونص` : `${ev.points} خصم`}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs font-bold text-[var(--text-muted)]">
                        {ev.title} — بواسطة: {ev.evaluator_name}
                      </p>
                    </div>
                  </div>

                  <time className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDate(ev.created_at)}
                  </time>
                </div>

                <p className=" whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5 text-sm leading-6 text-[var(--text)]">
                  {ev.feedback}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    {ev.read_at ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCheck size={15} aria-hidden="true" />
                        أكد العضو قراءة التقييم ({formatDate(ev.read_at)})
                      </span>
                    ) : ev.viewed_at ? (
                      <span className="inline-flex items-center gap-1 text-[var(--link)]">
                        <Eye size={15} aria-hidden="true" />
                        شاهد التقييم في البوابة ({formatDate(ev.viewed_at)})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                        <Clock size={15} aria-hidden="true" />
                        لم يفتحه العضو بعد
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenCreate(ev.member_id)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs font-bold text-[var(--text-2)] hover:bg-[var(--bg)]"
                    >
                      <UserPlus size={14} aria-hidden="true" />
                      تقييم جديد للعضو
                    </button>
                    <button
                      type="button"
                      onClick={() => setEvalToDelete(ev)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-red-50"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      حذف
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <EvaluationCreateModal
        isOpen={createOpen}
        members={members}
        preselectedMemberId={preselectedMemberId}
        onClose={() => setCreateOpen(false)}
      />

      <ConfirmDialog
        isOpen={Boolean(evalToDelete)}
        onClose={() => setEvalToDelete(null)}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        title="تأكيد حذف التقييم"
        itemName={evalToDelete?.title}
        description="سيتم حذف هذا التقييم من بوابة العضو، وإذا كان مرتبطاً بنقاط بونص فسيتم إلغاء النقاط المرتبطة به أيضاً."
        confirmLabel="حذف التقييم"
        isPending={deleteEval.isPending}
        pendingLabel="بنحذف..."
      />
    </section>
  );
}
