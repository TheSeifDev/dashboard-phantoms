import type { Locale } from '../../i18n/useLocale';

export type MemberDeletionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';

export interface MemberDeletionState {
  requestId: string;
  status: MemberDeletionStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface MemberDeletionRequestRecord extends MemberDeletionState {
  memberId: number | null;
  memberName: string;
  memberEmail: string;
  memberReason: string | null;
}

export const MEMBER_DELETION_STATE_KEY = ['member_deletion_state'] as const;
export const MEMBER_DELETION_QUEUE_KEY = ['member_deletion_requests'] as const;
export const MEMBER_DELETION_POLL_MS = 20_000;
export const MEMBER_DELETION_REASON_MAX = 1000;

const STATUSES: readonly MemberDeletionStatus[] = ['pending', 'approved', 'rejected', 'cancelled', 'completed'];

/** كلمة التأكيد المطلوبة قبل إرسال الطلب (عربي/إنجليزي). */
export const DELETION_CONFIRM_WORDS = { ar: 'حذف', en: 'DELETE' } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const KNOWN_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'MEMBER_NOT_FOUND',
  'MEMBER_NOT_ACTIVE',
  'OWNER_CANNOT_DELETE_ACCOUNT',
  'DELETION_REQUEST_EXISTS',
  'DELETION_REQUEST_NOT_FOUND',
  'DELETION_REQUEST_NOT_PENDING',
  'DELETION_REQUEST_NOT_APPROVED',
  'DELETION_REQUEST_INCOMPLETE',
  'SELF_DELETION_FORBIDDEN',
  'OWNER_DELETION_FORBIDDEN',
  'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS',
  'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR',
  'MEMBER_DELETION_DELETE_FAILED',
  'DELETION_IDENTITY_RESIDUAL',
  'DELETION_IDENTIFIER_RESIDUAL',
  'DELETION_JSON_IDENTITY_RESIDUAL',
  'AUTH_DELETE_FAILED',
  'DELETION_TARGET_MISSING',
  'COMPLETION_MARK_FAILED',
  'ACCESS_CHECK_FAILED',
  'INVALID_REQUEST_ID',
  'METHOD_NOT_ALLOWED',
  'SERVER_CONFIG',
  'DELETION_FAILED',
] as const;

export type MemberDeletionErrorCode = (typeof KNOWN_CODES)[number] | 'request_failed';

export class MemberDeletionApiError extends Error {
  readonly code: MemberDeletionErrorCode;

  constructor(code: MemberDeletionErrorCode) {
    super(code);
    this.name = 'MemberDeletionApiError';
    this.code = code;
  }
}

export function isDeletionStatus(value: unknown): value is MemberDeletionStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isDeletionRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * تأكيد العضو لازم يكتب كلمة التأكيد كاملة (بدون مسافات زائدة، وحروف إنجليزية
 * غير حساسة لحالة الأحرف) عشان الزرار يتفعّل.
 */
export function deletionConfirmationMatches(input: string, locale: Locale): boolean {
  const word = locale === 'ar' ? DELETION_CONFIRM_WORDS.ar : DELETION_CONFIRM_WORDS.en;
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return locale === 'ar' ? normalized === word : normalized.toUpperCase() === word;
}

/** رسالة الخطأ المعروضة للمستخدم حسب كود الخادم. */
export function memberDeletionErrorMessage(code: MemberDeletionErrorCode, locale: Locale): string {
  const ar = locale === 'ar';
  switch (code) {
    case 'UNAUTHORIZED':
      return ar ? 'الجلسة انتهت. سجّل الدخول من جديد وحاول.' : 'Your session expired. Sign in again and retry.';
    case 'FORBIDDEN':
      return ar ? 'مالكش صلاحية تنفيذ الإجراء ده.' : 'You do not have permission for this action.';
    case 'MEMBER_NOT_FOUND':
      return ar ? 'مش لاقيين ملف العضوية المرتبط بحسابك. تواصل مع الأدمن.' : 'We could not find the membership linked to your account. Contact an admin.';
    case 'MEMBER_NOT_ACTIVE':
      return ar ? 'العضوية مش نشطة، فمينفعش تطلب حذف الحساب من هنا.' : 'Your membership is not active, so you cannot request deletion here.';
    case 'OWNER_CANNOT_DELETE_ACCOUNT':
      return ar ? 'حساب المالك لا يمكن حذفه من هنا.' : 'The owner account cannot be deleted here.';
    case 'DELETION_REQUEST_EXISTS':
      return ar ? 'عندك طلب حذف مفتوح بالفعل، مستني مراجعة الأدمن.' : 'You already have an open deletion request awaiting review.';
    case 'DELETION_REQUEST_NOT_FOUND':
      return ar ? 'الطلب مش موجود أو اتشال. حدّث الصفحة.' : 'That request no longer exists. Refresh the page.';
    case 'DELETION_REQUEST_NOT_PENDING':
      return ar ? 'الطلب ده اتراجع خلاص. حدّث الصفحة.' : 'That request was already handled. Refresh the page.';
    case 'DELETION_REQUEST_NOT_APPROVED':
      return ar ? 'الطلب مش في حالة موافقة، فمينفعش نكمل الحذف.' : 'The request is not approved, so deletion cannot continue.';
    case 'DELETION_REQUEST_INCOMPLETE':
      return ar ? 'بيانات الطلب ناقصة. ارفضه واطلب من العضو يبعت طلب جديد.' : 'The request is missing data. Reject it and ask the member to send a new one.';
    case 'SELF_DELETION_FORBIDDEN':
      return ar ? 'مينفعش تحذف حسابك انت من شاشة المراجعة.' : 'You cannot delete your own account from the review screen.';
    case 'OWNER_DELETION_FORBIDDEN':
      return ar ? 'حساب المالك محمي من الحذف.' : 'The owner account is protected from deletion.';
    case 'MEMBER_AUTH_BINDING_MISSING_OR_AMBIGUOUS':
      return ar ? 'ربط الحساب بعضوية العضو غير سليم (مش موجود أو مكرر). راجع ربط الحسابات الأول.' : 'The account-to-member link is missing or duplicated. Fix the account binding first.';
    case 'DELETION_OWNED_WORK_WITHOUT_SUCCESSOR':
      return ar ? 'العضو ده مالك شغل مشترك (مشروع أو فكرة) ومفيش عضو بديل نشط يستلمه. انقل الملكية يدويًا الأول أو ارفض الطلب.' : 'This member owns shared work (a project or idea) with no active successor. Transfer ownership first, or reject the request.';
    case 'MEMBER_DELETION_DELETE_FAILED':
      return ar ? 'فشل حذف صف العضوية. أعد المحاولة؛ لو تكرر راجع سجلات الخادم.' : 'Deleting the membership row failed. Retry; if it repeats, check server logs.';
    case 'DELETION_IDENTITY_RESIDUAL':
    case 'DELETION_IDENTIFIER_RESIDUAL':
    case 'DELETION_JSON_IDENTITY_RESIDUAL':
      return ar ? 'في سجلات لسه بتشاور على العضو فمنعنا الحذف الناقص. ارفض الطلب وبلّغ فريق التقنية.' : 'Some records still reference this member, so the partial deletion was blocked. Reject the request and report it to the tech team.';
    case 'AUTH_DELETE_FAILED':
      return ar ? 'اتحذفت بيانات العضو من اللوحة، لكن حساب الدخول لسه موجود. اضغط "إعادة المحاولة" لإكمال الحذف.' : 'Member data was removed from the dashboard, but the sign-in account still exists. Press retry to finish.';
    case 'DELETION_TARGET_MISSING':
      return ar ? 'مش لاقيين حساب الدخول المرتبط بالطلب. راجع ربط الحسابات.' : 'The sign-in account for this request was not found. Check the account binding.';
    case 'COMPLETION_MARK_FAILED':
      return ar ? 'اتنفذ الحذف لكن تعليم الطلب كمكتمل فشل. اضغط "إعادة المحاولة".' : 'Deletion ran but marking the request complete failed. Press retry.';
    case 'ACCESS_CHECK_FAILED':
      return ar ? 'تعذّر التحقق من صلاحياتك. أعد المحاولة.' : 'We could not verify your permissions. Retry.';
    case 'INVALID_REQUEST_ID':
      return ar ? 'معرّف الطلب غير صالح. حدّث الصفحة.' : 'The request id is invalid. Refresh the page.';
    case 'SERVER_CONFIG':
      return ar ? 'إعدادات الخادم ناقصة. بلّغ فريق التقنية.' : 'Server configuration is incomplete. Report it to the tech team.';
    case 'METHOD_NOT_ALLOWED':
      return ar ? 'طلب غير مدعوم.' : 'Unsupported request.';
    case 'DELETION_FAILED':
      return ar ? 'الحذف لم يكتمل. أعد المحاولة، ولو تكرر ابعت التفاصيل لفريق التقنية.' : 'Deletion did not complete. Retry, and share the details with the tech team if it repeats.';
    default:
      return ar ? 'تعذّر تنفيذ العملية. أعد المحاولة.' : 'The operation could not be completed. Retry.';
  }
}
