import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { MemberInviteApiError, useApproveMemberJoin, usePendingMemberJoinReviews } from './memberInviteApi';
import type { MemberJoinReview } from './memberInviteApi';
import { toast } from '../../store/toast';
import { useLocale, type Locale } from '../../i18n/useLocale';

function formatSubmittedAt(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(date)
    : '—';
}

function reviewActionError(error: unknown, fallback: string): string {
  return error instanceof MemberInviteApiError ? error.message : fallback;
}

function isNewerReview(candidate: MemberJoinReview, previous: MemberJoinReview): boolean {
  const candidateTime = Date.parse(candidate.submittedAt);
  const previousTime = Date.parse(previous.submittedAt);
  if (candidateTime !== previousTime) return candidateTime > previousTime;
  if (candidate.memberId !== previous.memberId) return candidate.memberId > previous.memberId;
  return candidate.invitationId > previous.invitationId;
}

export function MemberJoinReviewQueue() {
  const { t, dir, locale } = useLocale();
  const reviewsQuery = usePendingMemberJoinReviews();
  const approve = useApproveMemberJoin();
  const [target, setTarget] = useState<MemberJoinReview | null>(null);
  const [actionError, setActionError] = useState('');
  const reviews = reviewsQuery.data?.pages.flatMap((page) => page) ?? [];
  const latestReview = reviewsQuery.data?.pages[0]?.[0] ?? null;
  const hasLoadedQueue = useRef(false);
  const newestSeenReview = useRef<MemberJoinReview | null>(null);

  useEffect(() => {
    if (!reviewsQuery.isSuccess) return;
    const previous = newestSeenReview.current;
    if (hasLoadedQueue.current && latestReview && (!previous || isNewerReview(latestReview, previous))) {
      toast.success(t('وصل طلب انضمام جديد للمراجعة.', 'A new join request is ready for review.'));
    }
    if (latestReview && (!previous || isNewerReview(latestReview, previous))) newestSeenReview.current = latestReview;
    hasLoadedQueue.current = true;
  }, [latestReview?.invitationId, latestReview?.memberId, latestReview?.submittedAt, reviewsQuery.isSuccess, locale]);

  const confirmApproval = async () => {
    if (!target) return;
    setActionError('');
    try {
      const result = await approve.mutateAsync(target.memberId);
      setTarget(null);
      toast.success(result.alreadyApproved
        ? t('تمت مراجعة هذا الطلب مسبقاً؛ حدّثنا القائمة.', 'This request was already reviewed; the queue was refreshed.')
        : t(`تم قبول ${target.fullName} وتفعيل عضويته.`, `${target.fullName} was approved and their membership activated.`));
    } catch (error) {
      setActionError(reviewActionError(error, t('تعذر اعتماد العضوية. حدّث القائمة وحاول مرة أخرى.', 'Unable to approve membership. Refresh the queue and try again.')));
    }
  };

  const waiting = reviews.length;

  return (
    <section
      id="member-join-review-queue"
      data-testid="member-join-review-queue"
      dir={dir}
      className="member-dir-review"
      aria-labelledby="member-join-review-title"
    >
      <header className="member-dir-review-head">
        <span className="member-dir-review-icon" aria-hidden="true"><ShieldCheck size={17} /></span>
        <div className="member-dir-review-copy">
          <h2 id="member-join-review-title" className="member-dir-review-title">
            {t('طلبات انضمام بانتظار المراجعة', 'Join requests awaiting review')}
            <span
              className="member-dir-review-count"
              data-testid="member-join-review-count"
              role="status"
              aria-live="polite"
              aria-label={t(`${waiting} طلبات بانتظار المراجعة`, `${waiting} requests awaiting review`)}
            >
              {waiting}
            </span>
          </h2>
          <p className="member-dir-review-hint">
            {t(
              'يظهر الطلب بعد حفظ العضو بياناته وكلمة مروره · تحديث تلقائي كل 15 ثانية',
              'Requests appear after the member saves their profile and password · refreshes every 15 seconds',
            )}
          </p>
        </div>
        <button
          type="button"
          className="member-dir-review-refresh"
          onClick={() => { void reviewsQuery.refetch(); }}
          disabled={reviewsQuery.isFetching}
          aria-label={t('تحديث الطلبات', 'Refresh requests')}
          title={t('تحديث الطلبات', 'Refresh requests')}
        >
          <RefreshCw size={15} aria-hidden="true" className={reviewsQuery.isFetching ? 'member-dir-spin' : undefined} />
          <span>{reviewsQuery.isFetching ? t('جارٍ التحديث…', 'Refreshing…') : t('تحديث', 'Refresh')}</span>
        </button>
      </header>

      {actionError && <p role="alert" className="member-dir-review-alert">{actionError}</p>}

      {reviewsQuery.isLoading && !reviewsQuery.data ? (
        <p className="member-dir-review-empty" role="status">{t('جارٍ تحميل طلبات الانضمام…', 'Loading join requests…')}</p>
      ) : reviewsQuery.isError && !reviewsQuery.data ? (
        <ErrorState message={t('معرفناش نحمّل طلبات الانضمام للمراجعة.', 'Could not load join requests for review.')} onRetry={() => { void reviewsQuery.refetch(); }} />
      ) : waiting ? (
        <>
          {reviewsQuery.isError && reviewsQuery.data && (
            <p role="alert" className="member-dir-review-alert">
              {t('تعذر تحديث الطابور؛ ما زالت الطلبات المحمّلة ظاهرة. حاول التحديث مرة أخرى.', 'Could not refresh the queue. Previously loaded requests are still shown; try refreshing again.')}
            </p>
          )}
          <ul className="member-dir-review-list" aria-label={t('طلبات الانضمام الجديدة', 'New join requests')}>
            {reviews.map((review) => (
              <li key={review.invitationId} data-testid="member-join-review-item" className="member-dir-review-item">
                <div className="member-dir-review-identity">
                  <span className="member-dir-review-avatar" aria-hidden="true">{review.fullName.trim().charAt(0) || '؟'}</span>
                  <div className="member-dir-review-identity-copy">
                    <h3>{review.fullName}</h3>
                    <p dir="ltr">{review.email}</p>
                  </div>
                  <span className="member-dir-review-time">
                    <Clock3 size={13} aria-hidden="true" />
                    {formatSubmittedAt(review.submittedAt, locale)}
                  </span>
                </div>

                {!review.emailIdentityMatches && (
                  <p role="alert" data-testid="member-join-review-email-mismatch" className="member-dir-review-alert">
                    {t('بريد الحساب الحالي لا يطابق بيانات الدعوة والعضوية. راجع البريد والربط قبل الموافقة؛ التفعيل متوقف لحين تطابق الهوية.', 'The current account email does not match the invitation and membership. Review the email binding before approval; activation is blocked until the identity matches.')}
                  </p>
                )}

                <dl className="member-dir-review-facts">
                  <div><dt>{t('الهاتف', 'Phone')}</dt><dd dir="ltr">{review.phone || '—'}</dd></div>
                  <div><dt>{t('بريد الدعوة', 'Invitation email')}</dt><dd dir="ltr">{review.invitationEmail}</dd></div>
                  <div><dt>{t('الإقامة', 'Residence')}</dt><dd>{review.residence || '—'}</dd></div>
                  <div><dt>{t('ظروف العمل', 'Work conditions')}</dt><dd>{review.workConditions || '—'}</dd></div>
                  <div><dt>{t('الجهاز', 'Device')}</dt><dd>{review.device || '—'}</dd></div>
                  <div><dt>{t('الجنس', 'Gender')}</dt><dd>{review.gender || '—'}</dd></div>
                </dl>

                <p className="member-dir-review-bio">
                  <span>{t('نبذة', 'Bio')}</span>
                  {review.bio || '—'}
                </p>

                <div className="member-dir-review-foot">
                  <p>
                    {review.emailIdentityMatches
                      ? t('الحساب غير مفعّل؛ لن يستطيع العضو دخول البوابة قبل موافقتك.', 'Membership is inactive; the member cannot access the portal before your approval.')
                      : t('الحساب غير مفعّل، والموافقة متوقفة حتى مراجعة تطابق البريد.', 'Membership is inactive and approval is blocked until the email match is reviewed.')}
                  </p>
                  <Button
                    variant="primary"
                    icon={<Check size={16} aria-hidden="true" />}
                    disabled={approve.isPending || !review.emailIdentityMatches}
                    onClick={() => { setActionError(''); setTarget(review); }}
                    className="whitespace-nowrap"
                  >
                    {t('قبول وتفعيل العضوية', 'Approve and activate membership')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="member-dir-review-empty" data-testid="member-join-review-empty" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          {t('لا توجد تسجيلات مكتملة تنتظر المراجعة حاليًا. سيظهر الطلب هنا بعد إكمال التسجيل بنجاح.', 'No completed registrations are awaiting review. A request will appear here after registration is completed successfully.')}
        </p>
      )}

      {reviewsQuery.isFetchNextPageError && (
        <p role="alert" className="member-dir-review-alert">{t('تعذر تحميل الطلبات الأقدم؛ حاول مرة أخرى.', 'Unable to load older requests; try again.')}</p>
      )}
      {reviewsQuery.hasNextPage && (
        <button
          type="button"
          className="member-dir-review-more"
          onClick={() => { void reviewsQuery.fetchNextPage(); }}
          disabled={reviewsQuery.isFetchingNextPage}
        >
          {reviewsQuery.isFetchingNextPage ? t('جارٍ تحميل الطلبات الأقدم…', 'Loading older requests…') : t('عرض الطلبات الأقدم', 'Load older requests')}
        </button>
      )}

      <ConfirmDialog isOpen={Boolean(target)} onClose={() => { if (!approve.isPending) setTarget(null); }} onConfirm={() => { void confirmApproval(); }} title={t('تأكيد تفعيل العضوية', 'Confirm member activation')} itemName={target?.fullName} description={t('بعد الموافقة ستصبح العضوية نشطة وسيتمكن صاحب الحساب من تسجيل الدخول إلى بوابة الأعضاء. سيتم تسجيل قرار المراجعة.', 'After approval, the member will become active and can sign in to the member portal. The review decision will be recorded.')} confirmLabel={t('موافقة وتفعيل', 'Approve and activate')} isPending={approve.isPending} pendingLabel={t('جارٍ تفعيل العضوية…', 'Activating member…')} />
    </section>
  );
}
