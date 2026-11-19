import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
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

  return (
    <section
      id="member-join-review-queue"
      data-testid="member-join-review-queue"
      dir={dir}
      className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"
      aria-labelledby="member-join-review-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--info-soft)] text-[var(--info)]" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div className="min-w-0">
            <h2 id="member-join-review-title" className="m-0 text-base font-black text-[var(--text)]">
              {t('طلبات انضمام جديدة بانتظار المراجعة', 'New member requests awaiting review')}
              <span className="ms-2 inline-flex min-w-6 justify-center rounded-full bg-[var(--info-soft)] px-2 py-0.5 text-xs tabular-nums text-[var(--info)]" data-testid="member-join-review-count">{reviews.length}</span>
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('لا يظهر الطلب إلا بعد حفظ العضو بياناته وكلمة مروره بنجاح. القائمة تتحدّث تلقائيًا كل 15 ثانية أثناء فتح الصفحة.', 'Requests appear only after the member successfully saves their profile and password. This queue refreshes every 15 seconds while the page is open.')}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => void reviewsQuery.refetch()} icon={<RefreshCw size={15} aria-hidden="true" />} disabled={reviewsQuery.isFetching} className="whitespace-nowrap">{t('تحديث الطلبات', 'Refresh requests')}</Button>
      </div>

      {actionError && <p role="alert" className="m-0 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">{actionError}</p>}
      {reviewsQuery.isLoading && !reviewsQuery.data ? (
        <p className="m-0 rounded-xl bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]" role="status">{t('جارٍ تحميل طلبات الانضمام…', 'Loading join requests…')}</p>
      ) : reviewsQuery.isError && !reviewsQuery.data ? (
        <ErrorState message={t('معرفناش نحمّل طلبات الانضمام للمراجعة.', 'Could not load join requests for review.')} onRetry={() => { void reviewsQuery.refetch(); }} />
      ) : reviews.length ? (
        <ul className="grid gap-3" aria-label={t('طلبات الانضمام الجديدة', 'New join requests')}>
          {reviews.map((review) => (
            <li key={review.invitationId} data-testid="member-join-review-item" className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="m-0 text-base font-black text-[var(--text)]">{review.fullName}</h3>
                  <p className="mt-1 text-sm text-[var(--text-2)]" dir="ltr">{review.email}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]"><Clock3 size={14} aria-hidden="true" /> {t('أُرسل', 'Submitted')} {formatSubmittedAt(review.submittedAt, locale)}</span>
              </div>
              {!review.emailIdentityMatches && <p role="alert" data-testid="member-join-review-email-mismatch" className="m-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold leading-6 text-amber-900 dark:text-amber-100">{t('بريد الحساب الحالي لا يطابق بيانات الدعوة والعضوية. راجع البريد والربط قبل الموافقة؛ التفعيل متوقف لحين تطابق الهوية.', 'The current account email does not match the invitation and membership. Review the email binding before approval; activation is blocked until the identity matches.')}</p>}
              <dl className="grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 text-sm sm:grid-cols-2">
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('الهاتف:', 'Phone:')} </dt><dd className="inline font-bold text-[var(--text-2)]" dir="ltr">{review.phone || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('بريد الدعوة:', 'Invitation email:')} </dt><dd className="inline font-bold text-[var(--text-2)]" dir="ltr">{review.invitationEmail}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('الإقامة:', 'Residence:')} </dt><dd className="inline font-bold text-[var(--text-2)]">{review.residence || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('ظروف العمل:', 'Work conditions:')} </dt><dd className="inline font-bold text-[var(--text-2)]">{review.workConditions || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('الجهاز:', 'Device:')} </dt><dd className="inline font-bold text-[var(--text-2)]">{review.device || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">{t('الجنس:', 'Gender:')} </dt><dd className="inline font-bold text-[var(--text-2)]">{review.gender || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="inline font-semibold text-[var(--text-muted)]">{t('نبذة:', 'Bio:')} </dt><dd className="inline whitespace-pre-wrap font-bold text-[var(--text-2)]">{review.bio || '—'}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">{review.emailIdentityMatches ? t('الحساب غير مفعّل؛ لن يستطيع العضو دخول البوابة قبل موافقتك.', 'Membership is inactive; the member cannot access the portal before your approval.') : t('الحساب غير مفعّل، والموافقة متوقفة حتى مراجعة تطابق البريد.', 'Membership is inactive and approval is blocked until the email match is reviewed.')}</p>
                <Button variant="primary" icon={<Check size={16} aria-hidden="true" />} disabled={approve.isPending || !review.emailIdentityMatches} onClick={() => { setActionError(''); setTarget(review); }} className="whitespace-nowrap">{t('قبول وتفعيل العضوية', 'Approve and activate membership')}</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]" data-testid="member-join-review-empty">{t('لا توجد تسجيلات مكتملة تنتظر المراجعة حاليًا.', 'No completed registrations are awaiting review.')}</p>}
      {reviewsQuery.isFetchNextPageError && <p role="alert" className="m-0 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">{t('تعذر تحميل الطلبات الأقدم؛ حاول مرة أخرى.', 'Unable to load older requests; try again.')}</p>}
      {reviewsQuery.hasNextPage && <Button variant="secondary" onClick={() => { void reviewsQuery.fetchNextPage(); }} disabled={reviewsQuery.isFetchingNextPage} className="justify-self-center whitespace-nowrap">{reviewsQuery.isFetchingNextPage ? t('جارٍ تحميل الطلبات الأقدم…', 'Loading older requests…') : t('عرض الطلبات الأقدم', 'Load older requests')}</Button>}
      <ConfirmDialog isOpen={Boolean(target)} onClose={() => { if (!approve.isPending) setTarget(null); }} onConfirm={() => { void confirmApproval(); }} title={t('تأكيد تفعيل العضوية', 'Confirm member activation')} itemName={target?.fullName} description={t('بعد الموافقة ستصبح العضوية نشطة وسيتمكن صاحب الحساب من تسجيل الدخول إلى بوابة الأعضاء. سيتم تسجيل قرار المراجعة.', 'After approval, the member will become active and can sign in to the member portal. The review decision will be recorded.')} confirmLabel={t('موافقة وتفعيل', 'Approve and activate')} isPending={approve.isPending} pendingLabel={t('جارٍ تفعيل العضوية…', 'Activating member…')} />
    </section>
  );
}
