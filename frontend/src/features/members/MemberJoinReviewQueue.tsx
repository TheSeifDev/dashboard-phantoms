import { useState } from 'react';
import { Check, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { MemberInviteApiError, useApproveMemberJoin, usePendingMemberJoinReviews } from './memberInviteApi';
import type { MemberJoinReview } from './memberInviteApi';
import { toast } from '../../store/toast';

function formatSubmittedAt(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '—';
}

function reviewActionError(error: unknown): string {
  if (error instanceof MemberInviteApiError) return error.message;
  return 'تعذر اعتماد العضوية. حدّث القائمة وحاول مرة أخرى.';
}

export function MemberJoinReviewQueue() {
  const reviewsQuery = usePendingMemberJoinReviews();
  const approve = useApproveMemberJoin();
  const [target, setTarget] = useState<MemberJoinReview | null>(null);
  const [actionError, setActionError] = useState('');
  const reviews = reviewsQuery.data?.pages.flatMap((page) => page) ?? [];

  const confirmApproval = async () => {
    if (!target) return;
    setActionError('');
    try {
      const result = await approve.mutateAsync(target.memberId);
      setTarget(null);
      toast.success(result.alreadyApproved
        ? 'تمت مراجعة هذا الطلب مسبقاً؛ حدّثنا القائمة.'
        : `تم قبول ${target.fullName} وتفعيل عضويته.`);
    } catch (error) {
      setActionError(reviewActionError(error));
    }
  };

  return (
    <section
      id="member-join-review-queue"
      data-testid="member-join-review-queue"
      dir="rtl"
      className="grid gap-3 rounded-[var(--radius-lg)] border border-amber-500/30 bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"
      aria-labelledby="member-join-review-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="member-join-review-title" className="m-0 text-base font-black text-[var(--text)]">
              طلبات انضمام جديدة بانتظار المراجعة
              <span className="ms-2 inline-flex min-w-6 justify-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs tabular-nums text-amber-800 dark:text-amber-200" data-testid="member-join-review-count">
                {reviews.length}
              </span>
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              لا يظهر الطلب إلا بعد أن يحفظ العضو بياناته وكلمة مروره بنجاح. راجع الملف ثم وافق لتفعيل العضوية.
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={() => void reviewsQuery.refetch()}
          icon={<RefreshCw size={15} aria-hidden="true" />}
          disabled={reviewsQuery.isFetching}
          className="whitespace-nowrap"
        >
          تحديث الطلبات
        </Button>
      </div>

      {actionError && <p role="alert" className="m-0 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">{actionError}</p>}

      {reviewsQuery.isLoading && !reviewsQuery.data ? (
        <p className="m-0 rounded-xl bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]" role="status">جارٍ تحميل طلبات الانضمام…</p>
      ) : reviewsQuery.isError && !reviewsQuery.data ? (
        <ErrorState message="معرفناش نحمّل طلبات الانضمام للمراجعة." onRetry={() => { void reviewsQuery.refetch(); }} />
      ) : reviews.length ? (
        <ul className="grid gap-3" aria-label="طلبات الانضمام الجديدة">
          {reviews.map((review) => (
            <li key={review.invitationId} data-testid="member-join-review-item" className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="m-0 text-base font-black text-[var(--text)]">{review.fullName}</h3>
                  <p className="mt-1 text-sm text-[var(--text-2)]" dir="ltr">{review.email}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]">
                  <Clock3 size={14} aria-hidden="true" /> أُرسل {formatSubmittedAt(review.submittedAt)}
                </span>
              </div>

              {!review.emailIdentityMatches && (
                <p role="alert" data-testid="member-join-review-email-mismatch" className="m-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold leading-6 text-amber-900 dark:text-amber-100">
                  بريد الحساب الحالي لا يطابق بيانات الدعوة والعضوية. راجع البريد والربط قبل الموافقة؛ التفعيل متوقف لحين تطابق الهوية.
                </p>
              )}

              <dl className="grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 text-sm sm:grid-cols-2">
                <div><dt className="inline font-semibold text-[var(--text-muted)]">الهاتف: </dt><dd className="inline font-bold text-[var(--text-2)]" dir="ltr">{review.phone || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">بريد الدعوة: </dt><dd className="inline font-bold text-[var(--text-2)]" dir="ltr">{review.invitationEmail}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">الإقامة: </dt><dd className="inline font-bold text-[var(--text-2)]">{review.residence || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">ظروف العمل: </dt><dd className="inline font-bold text-[var(--text-2)]">{review.workConditions || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">الجهاز: </dt><dd className="inline font-bold text-[var(--text-2)]">{review.device || '—'}</dd></div>
                <div><dt className="inline font-semibold text-[var(--text-muted)]">الجنس: </dt><dd className="inline font-bold text-[var(--text-2)]">{review.gender || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="inline font-semibold text-[var(--text-muted)]">نبذة: </dt><dd className="inline whitespace-pre-wrap font-bold text-[var(--text-2)]">{review.bio || '—'}</dd></div>
              </dl>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">{review.emailIdentityMatches
                  ? 'الحساب غير مفعّل؛ لن يستطيع العضو دخول البوابة قبل موافقتك.'
                  : 'الحساب غير مفعّل، والموافقة متوقفة حتى مراجعة تطابق البريد.'}</p>
                <Button
                  variant="primary"
                  icon={<Check size={16} aria-hidden="true" />}
                  disabled={approve.isPending || !review.emailIdentityMatches}
                  onClick={() => { setActionError(''); setTarget(review); }}
                  className="whitespace-nowrap"
                >
                  قبول وتفعيل العضوية
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]" data-testid="member-join-review-empty">
          لا توجد تسجيلات مكتملة تنتظر المراجعة حاليًا.
        </p>
      )}

      {reviewsQuery.isFetchNextPageError && (
        <p role="alert" className="m-0 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          تعذر تحميل الطلبات الأقدم؛ حاول مرة أخرى.
        </p>
      )}
      {reviewsQuery.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => { void reviewsQuery.fetchNextPage(); }}
          disabled={reviewsQuery.isFetchingNextPage}
          className="justify-self-center whitespace-nowrap"
        >
          {reviewsQuery.isFetchingNextPage ? 'جارٍ تحميل الطلبات الأقدم…' : 'عرض الطلبات الأقدم'}
        </Button>
      )}

      <ConfirmDialog
        isOpen={Boolean(target)}
        onClose={() => { if (!approve.isPending) setTarget(null); }}
        onConfirm={() => { void confirmApproval(); }}
        title="تأكيد تفعيل العضوية"
        itemName={target?.fullName}
        description="بعد الموافقة ستصبح العضوية نشطة وسيتمكن صاحب الحساب من تسجيل الدخول إلى بوابة الأعضاء. سيتم تسجيل قرار المراجعة."
        confirmLabel="موافقة وتفعيل"
        isPending={approve.isPending}
        pendingLabel="جارٍ تفعيل العضوية…"
      />
    </section>
  );
}
