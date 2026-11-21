import { Check, CheckCheck, ClipboardCheck } from 'lucide-react';
import {
  EVALUATION_GRADE_LABELS,
  useMarkEvaluationRead,
  useMemberEvaluations,
} from '../evaluations/api';
import { getGradeBadgeVariant } from '../evaluations/EvaluationsPage';
import { EvalStars } from '../evaluations/StarRating';
import '../evaluations/evaluations.css';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';

const GRADE_LABELS_ENGLISH = {
  excellent: 'Excellent',
  very_good: 'Very good',
  good: 'Good',
  needs_improvement: 'Needs improvement',
  warning: 'Warning',
} as const;

interface Props {
  memberId: number;
}

export function MemberEvaluations({ memberId }: Props) {
  const { t, dir, number, date } = useLocale();
  const evaluationsQuery = useMemberEvaluations(memberId);
  const markRead = useMarkEvaluationRead();

  const evaluations = evaluationsQuery.data ?? [];
  const unreadCount = evaluations.filter((e) => !e.read_at).length;
  const starBalance = evaluations.reduce((sum, e) => sum + Math.max(0, e.points), 0);

  const handleMarkRead = async (evaluationId: number, mode: 'native' | 'fallback') => {
    try {
      await markRead.mutateAsync({ evaluationId, memberId, mode });
      toast.success(t('تم تأكيد اطلاعك على التقييم.', 'You confirmed that you have read this evaluation.'));
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return date(dateString, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  if (evaluationsQuery.isLoading) {
    return (
      <div dir={dir} role="status" aria-label={t('بنحمّل التقييمات', 'Loading evaluations')}>
        <CardSkeletons count={2} />
      </div>
    );
  }

  if (evaluationsQuery.isError) {
    return (
      <div dir={dir}>
        <ErrorState
          message={t('معرفناش نحمّل تقييمات الأداء.', 'We could not load your performance evaluations.')}
          onRetry={() => {
            void evaluationsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <section className="grid gap-3" dir={dir} aria-labelledby="member-evaluations-title" aria-busy={markRead.isPending}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
            <ClipboardCheck size={20} aria-hidden="true" />
          </span>
          <h2 id="member-evaluations-title" className="text-lg font-black text-[var(--text)]">
            {t('تقييماتي وملاحظات الأداء', 'My evaluations and performance feedback')}
          </h2>
          {starBalance > 0 && (
            <span className="eval-star-pill" title={t('إجمالي النجوم التي جمعتها', 'Total stars you collected')}>
              {t(`رصيدك ${number(starBalance)} نجمة`, `${number(starBalance)} stars collected`)}
            </span>
          )}
          {unreadCount > 0 && (
            <Badge variant="danger">
              {unreadCount === 1 ? t('تقييم جديد', 'New evaluation') : t(`${number(unreadCount)} تقييمات جديدة`, `${number(unreadCount)} new evaluations`)}
            </Badge>
          )}
        </div>

        {evaluations.length > 0 && (
          <p className="shrink-0 text-sm text-[var(--text-muted)]">
            {evaluations.length === 1 ? t('تقييم واحد', '1 evaluation') : t(`${number(evaluations.length)} تقييمات`, `${number(evaluations.length)} evaluations`)}
          </p>
        )}
      </div>

      {evaluations.length === 0 ? (
        <EmptyState
          title={t('مفيش تقييمات مسجلة لحد دلوقتي', 'No evaluations yet')}
          description={t('هتظهر هنا تقييمات الأداء والملاحظات الموجهة ليك من الإدارة.', 'Performance evaluations and feedback from the administration will appear here.')}
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
                    <h3 dir="auto" className="font-black text-[var(--text)]">{ev.title}</h3>
                    <Badge variant={getGradeBadgeVariant(ev.grade)}>
                      {t('التقدير: ', 'Grade: ')}{t(EVALUATION_GRADE_LABELS[ev.grade], GRADE_LABELS_ENGLISH[ev.grade])}
                    </Badge>
                    {ev.points > 0 ? (
                      <span className="eval-star-pill">
                        <EvalStars value={ev.points} size="sm" />
                        {t(`+${number(ev.points)} نجمة`, `+${number(ev.points)} stars`)}
                      </span>
                    ) : ev.points < 0 ? (
                      <span className="eval-star-pill eval-star-pill--minus">
                        {t(`${number(ev.points)} نقطة خصم`, `${number(ev.points)} points`)}
                      </span>
                    ) : null}
                    {!isRead && <Badge variant="info">{t('جديد', 'New')}</Badge>}
                  </div>

                  <time dateTime={ev.created_at} className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDate(ev.created_at)}
                  </time>
                </div>

                <p
                  dir="auto"
                  className={`whitespace-pre-wrap text-sm leading-6 ${
                    !isRead ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'
                  }`}
                >
                  {ev.feedback}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    {t('المقيّم: ', 'Evaluator: ')}<span dir="auto">{ev.evaluator_name}</span>
                  </span>

                  <div>
                    {!isRead ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void handleMarkRead(ev.id, ev.mode);
                        }}
                        isLoading={markRead.isPending}
                        loadingText={t('بنسجّل...', 'Saving...')}
                        icon={<Check size={16} aria-hidden="true" />}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                      >
                        {t('اطلعت على التقييم', 'Mark as read')}
                      </Button>
                    ) : (
                      <span className="flex min-h-9 items-center gap-1.5 text-xs font-bold text-[var(--success-text)] dark:text-[var(--success-text)]">
                        <CheckCheck size={16} aria-hidden="true" />
                        {t('تم الاطلاع', 'Read')}
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
