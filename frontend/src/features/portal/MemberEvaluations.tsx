import { Check, CheckCheck, ClipboardCheck } from 'lucide-react';
import {
  EVALUATION_GRADE_LABELS,
  useMarkEvaluationRead,
  useMemberEvaluations,
} from '../evaluations/api';
import { getGradeBadgeVariant } from '../evaluations/EvaluationsPage';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';

interface Props {
  memberId: number;
}

export function MemberEvaluations({ memberId }: Props) {
  const evaluationsQuery = useMemberEvaluations(memberId);
  const markRead = useMarkEvaluationRead();

  const evaluations = evaluationsQuery.data ?? [];
  const unreadCount = evaluations.filter((e) => !e.read_at).length;

  const handleMarkRead = async (evaluationId: number, mode: 'native' | 'fallback') => {
    try {
      await markRead.mutateAsync({ evaluationId, memberId, mode });
      toast.success('تم تأكيد اطلاعك على التقييم.');
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(dateString));
    } catch {
      return dateString;
    }
  };

  if (evaluationsQuery.isLoading) {
    return (
      <div dir="rtl" aria-label="بنحمّل التقييمات">
        <CardSkeletons count={2} />
      </div>
    );
  }

  if (evaluationsQuery.isError) {
    return (
      <div dir="rtl">
        <ErrorState
          message="معرفناش نحمّل تقييمات الأداء."
          onRetry={() => {
            void evaluationsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <section className="grid gap-3" dir="rtl" aria-labelledby="member-evaluations-title">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
            <ClipboardCheck size={20} aria-hidden="true" />
          </span>
          <h2 id="member-evaluations-title" className="text-lg font-black text-[var(--text)]">
            تقييماتي وملاحظات الأداء
          </h2>
          {unreadCount > 0 && (
            <Badge variant="danger">
              {unreadCount === 1 ? 'تقييم جديد' : `${unreadCount} تقييمات جديدة`}
            </Badge>
          )}
        </div>

        {evaluations.length > 0 && (
          <p className="shrink-0 text-sm text-[var(--text-muted)]">
            {evaluations.length === 1 ? 'تقييم واحد' : `${evaluations.length} تقييمات`}
          </p>
        )}
      </div>

      {evaluations.length === 0 ? (
        <EmptyState
          title="مفيش تقييمات مسجلة لحد دلوقتي"
          description="هتظهر هنا تقييمات الأداء والملاحظات الموجهة ليك من الإدارة."
        />
      ) : (
        <div className="grid gap-3">
          {evaluations.map((ev) => {
            const isRead = Boolean(ev.read_at);
            return (
              <Card
                key={`${ev.mode}-${ev.id}`}
                className={`grid gap-3 p-4 transition-colors sm:p-5 ${
                  !isRead
                    ? 'border-s-4 border-s-[var(--primary)] bg-[var(--primary-soft)]'
                    : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <h3 className="font-black text-[var(--text)]">{ev.title}</h3>
                    <Badge variant={getGradeBadgeVariant(ev.grade)}>
                      التقدير: {EVALUATION_GRADE_LABELS[ev.grade]}
                    </Badge>
                    {ev.points !== 0 && (
                      <Badge variant={ev.points > 0 ? 'success' : 'danger'}>
                        {ev.points > 0 ? `+${ev.points} نقاط بونص` : `${ev.points} نقاط`}
                      </Badge>
                    )}
                    {!isRead && <Badge variant="info">جديد</Badge>}
                  </div>

                  <time className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDate(ev.created_at)}
                  </time>
                </div>

                <p
                  className={`whitespace-pre-wrap text-sm leading-6 ${
                    !isRead ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'
                  }`}
                >
                  {ev.feedback}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    المقيّم: {ev.evaluator_name}
                  </span>

                  <div>
                    {!isRead ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleMarkRead(ev.id, ev.mode);
                        }}
                        isLoading={markRead.isPending}
                        loadingText="بنسجّل..."
                        icon={<Check size={16} aria-hidden="true" />}
                      >
                        اطلعت على التقييم
                      </Button>
                    ) : (
                      <span className="flex min-h-9 items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCheck size={16} aria-hidden="true" />
                        تم الاطلاع
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
