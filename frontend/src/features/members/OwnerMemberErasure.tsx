import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eraser, ShieldAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useLocale } from '../../i18n/useLocale';
import {
  ownerMemberErasureApi,
  ownerMemberErasureConfirmation,
  ownerMemberErasureErrorCode,
  ownerMemberErasureHandoverKey,
  type OwnerMemberErasureApi,
  type OwnerMemberErasurePreview,
  type OwnerMemberErasureResult,
  type OwnerMemberErasureStatus,
  type OwnerMemberErasureSuccessorAssignments,
  type OwnerMemberErasureErrorCode,
} from './owner-member-erasure-api';

interface OwnerMemberErasureProps {
  member: { id: number; full_name: string };
  currentOwnerUserId: string | null;
  isOwner: boolean;
  api?: OwnerMemberErasureApi;
}
type ErasurePhase = 'idle' | 'previewing' | 'executing' | 'checking' | 'retrying' | 'partial' | 'complete' | 'pending' | 'uncertain';

function errorCopy(code: OwnerMemberErasureErrorCode, t: (arabic: string, english: string) => string) {
  switch (code) {
    case 'binding_unconfirmed':
      return t(
        'تعذّر تأكيد ربط دقيق بين سجل العضو وحساب الدخول. لن نحذف أي حساب، ولن نبحث بالبريد أو الاسم أو نخمن الهوية.',
        'An exact Member-to-sign-in binding could not be confirmed. No account will be erased; email/name matching is never used to guess an identity.',
      );
    case 'owner_prohibited':
      return t('حساب المالك الأساسي أو حسابك الحالي محمي ولا يمكن محوه من هذا المسار.', 'The primary owner or your current account is protected and cannot be erased through this flow.');
    case 'owner_required':
      return t('لم يتم تأكيد صلاحية المالك. أعد التحقق قبل المتابعة.', 'Owner access is not confirmed. Verify your access before continuing.');
    case 'invalid_preview':
      return t('المعاينة غير صالحة أو انتهت صلاحيتها. اطلب معاينة دقيقة جديدة.', 'The preview is invalid or expired. Request a fresh exact preview.');
    case 'scope_blocked':
      return t(
        'المحو الشامل محظور من الخادم لأن نطاق السجلات أو المراجع المشتركة لا يمكن فصله بأمان. لم يبدأ أي حذف. لا يمكن حذف الفرق أو المشروعات المشتركة من هذه الشاشة.',
        'The server blocked erasure because the record or shared-attribution scope cannot be detached safely. No deletion started. Shared teams and projects cannot be erased from this screen.',
      );
    default:
      return t('تعذّر إكمال الطلب بأمان. لم يتم تأكيد نجاح أي حذف.', 'The request could not be safely completed. No deletion success is confirmed.');
  }
}

const safePartialMessage = (t: (arabic: string, english: string) => string) => t(
  'لم يكتمل المحو بالكامل، ولا نعرضه كنجاح. لا تبدأ عملية محو جديدة. يمكن فقط إعادة محاولة العملية نفسها إذا صرّح الخادم بذلك.',
  'Erasure is not fully complete and is not reported as a success. Do not start a new erasure. Retry only this same operation when the server designates it as retryable.',
);

export function OwnerMemberErasure({ member, currentOwnerUserId, isOwner, api = ownerMemberErasureApi }: OwnerMemberErasureProps) {
  const { t, number, date } = useLocale();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<ErasurePhase>('idle');
  const [preview, setPreview] = useState<OwnerMemberErasurePreview | null>(null);
  const [successorAssignments, setSuccessorAssignments] = useState<OwnerMemberErasureSuccessorAssignments>({});
  const [confirmation, setConfirmation] = useState('');
  const [errorCode, setErrorCode] = useState<OwnerMemberErasureErrorCode | null>(null);
  const [outcome, setOutcome] = useState<OwnerMemberErasureResult | null>(null);
  const [operationStatus, setOperationStatus] = useState<OwnerMemberErasureStatus | null>(null);
  const [errorContext, setErrorContext] = useState<'preview' | 'operation' | null>(null);
  const busy = phase === 'previewing' || phase === 'executing' || phase === 'checking' || phase === 'retrying';

  if (!isOwner) return null;

  const close = () => {
    if (!busy) setIsOpen(false);
  };
  const clearOperationState = () => {
    setOutcome(null);
    setOperationStatus(null);
    setErrorCode(null);
    setErrorContext(null);
  };
  const requestPreview = async () => {
    setPhase('previewing');
    setErrorCode(null);
    setErrorContext(null);
    setPreview(null);
    setSuccessorAssignments({});
    setConfirmation('');
    clearOperationState();
    try {
      const next = await api.preview(member.id);
      setPreview(next);
      setPhase('idle');
    } catch (error) {
      setErrorCode(ownerMemberErasureErrorCode(error));
      setErrorContext('preview');
      setPhase('idle');
    }
  };
  const completeOperation = (result: OwnerMemberErasureResult) => {
    setOutcome(result);
    setOperationStatus(null);
    if (result.status === 'complete') {
      setPhase('complete');
      setConfirmation('');
      void queryClient.invalidateQueries({ queryKey: ['members'] }).catch(() => undefined);
    } else {
      setPhase('partial');
    }
  };
  const execute = async () => {
    if (!preview || blockedByOwner || !canExecute || expired || !isConfirmationValid || !allHandoversSelected) return;
    setPhase('executing');
    setErrorCode(null);
    setErrorContext(null);
    try {
      const result = await api.execute(preview, successorAssignments, confirmation);
      completeOperation(result);
    } catch (error) {
      setErrorCode(ownerMemberErasureErrorCode(error));
      setErrorContext('operation');
      setPhase('uncertain');
    }
  };
  const checkStatus = async () => {
    if (!preview) return;
    setPhase('checking');
    setErrorCode(null);
    setErrorContext(null);
    try {
      const status = await api.status(preview.operation_id);
      setOperationStatus(status);
      setOutcome(null);
      if (status.status === 'complete') {
        completeOperation({
          ok: true,
          status: 'complete',
          operation_id: status.operation_id,
          database_complete: true,
          storage_complete: true,
          auth_complete: true,
          deleted: status.deleted,
        });
      } else if (status.status === 'partial') {
        setPhase('partial');
      } else {
        setPhase('pending');
      }
    } catch (error) {
      setErrorCode(ownerMemberErasureErrorCode(error));
      setErrorContext('operation');
      setPhase('uncertain');
    }
  };
  const retry = async () => {
    const retryable = outcome?.status === 'partial'
      ? outcome.retryable
      : operationStatus?.status === 'partial' && operationStatus.retryable;
    if (!preview || phase !== 'partial' || !retryable) return;
    setPhase('retrying');
    setErrorCode(null);
    setErrorContext(null);
    try {
      const result = await api.retry(preview.operation_id);
      completeOperation(result);
    } catch (error) {
      setErrorCode(ownerMemberErasureErrorCode(error));
      setErrorContext('operation');
      setPhase('uncertain');
    }
  };

  const isSelfTarget = Boolean(preview && currentOwnerUserId && preview.auth_user_id === currentOwnerUserId);
  const blockedByOwner = Boolean(preview && (preview.owner_target || isSelfTarget));
  const expired = Boolean(preview && Date.parse(preview.expires_at) <= Date.now());
  const expectedConfirmation = preview ? ownerMemberErasureConfirmation(preview.member_id, preview.auth_user_id) : '';
  const isConfirmationValid = Boolean(preview && confirmation === expectedConfirmation);
  const canExecute = Boolean(preview && preview.can_execute && preview.blockers.length === 0);
  const allHandoversSelected = Boolean(preview && preview.handover_requirements.every((requirement) => {
    const key = ownerMemberErasureHandoverKey(requirement);
    const memberId = successorAssignments[key];
    return Number.isSafeInteger(memberId) && requirement.candidates.some((candidate) => candidate.member_id === memberId);
  }));
  const showRequestPreview = !preview || (expired && !outcome && !operationStatus && phase !== 'uncertain');
  const retryablePartial = phase === 'partial' && (outcome?.status === 'partial'
    ? outcome.retryable
    : operationStatus?.status === 'partial' && operationStatus.retryable);
  const operationId = outcome?.operation_id ?? operationStatus?.operation_id ?? preview?.operation_id;

  return (
    <>
      <Button
        type="button"
        variant="danger"
        fullOnMobile
        className="w-full border border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger-text)] hover:bg-[var(--danger)] hover:text-[var(--on-danger)]"
        icon={<Eraser size={16} aria-hidden="true" />}
        onClick={() => setIsOpen(true)}
        aria-label={t('محو الهوية وحساب الدخول والبيانات المرتبطة', 'Erase identity, sign-in account, and linked data')}
      >
        {t('محو الهوية + حساب الدخول + البيانات المرتبطة', 'Erase identity + sign-in account + linked data')}
      </Button>
      <Modal
        isOpen={isOpen}
        onClose={close}
        title={t('محو الهوية وحساب الدخول والبيانات المرتبطة', 'Erase identity, sign-in account, and linked data')}
        icon={<ShieldAlert size={20} />}
        maxWidth="3xl"
      >
        <div className="grid gap-4">
          <div className="rounded-xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] p-4 text-[var(--danger-text)]" role="note">
            <p className="flex items-start gap-2 text-sm font-extrabold leading-6">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t('هذا الإجراء نهائي ولا يمكن التراجع عنه. راجع المعاينة الدقيقة قبل أي تنفيذ.', 'This operation is permanent and cannot be undone. Review the exact preview before any execution.')}</span>
            </p>
            <p className="mt-2 text-sm leading-6">
              {t('استخدام رقم العضو هو طلب المعاينة فقط؛ الهوية النهائية لا تُقبل إلا بعد أن يعيد الخادم معرّف العضو وحساب Auth الدقيقين. لا نبحث بالبريد أو الاسم.', 'The member ID is used only to request a preview; the target is accepted only after the server returns the exact member and Auth IDs. We never look up by email or name.')}
            </p>
            <p className="mt-2 text-sm leading-6">
              {t('تُمحى بيانات الهوية الشخصية المستهدفة فقط. الفرق والمشروعات المشتركة وكل الأعضاء الآخرين خارج النطاق وتظل محفوظة؛ إذا تعذّر فصل الإسناد بأمان، يحظر الخادم التنفيذ.', 'Only the target’s personal identity records are erased. Shared teams, projects, and every other member remain preserved; if attribution cannot be detached safely, the server must block execution.')}
            </p>
          </div>

          {showRequestPreview && !outcome && !operationStatus && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <p className="text-sm leading-6 text-[var(--text-2)]">
                {t('الخطوة الأولى تطلب معاينة من الخادم باستخدام رقم العضو فقط. لا يبدأ الحذف في هذه الخطوة.', 'Step one requests a server preview using only the member ID. This step does not begin deletion.')}
              </p>
              <Button type="button" onClick={() => void requestPreview()} isLoading={phase === 'previewing'} loadingText={t('بنطلب المعاينة الدقيقة...', 'Requesting exact preview...')} fullOnMobile>
                {expired ? t('طلب معاينة دقيقة جديدة', 'Request a fresh exact preview') : t('طلب المعاينة الدقيقة', 'Request exact preview')}
              </Button>
            </div>
          )}

          {errorCode && errorContext === 'preview' && (
            <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger-text)]" role="alert">
              {errorCopy(errorCode, t)}
            </p>
          )}

          {preview && (
            <div className="grid gap-4">
              <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="owner-erasure-target-title">
                <h3 id="owner-erasure-target-title" className="text-sm font-black">{t('الهوية الدقيقة التي أكدها الخادم', 'Exact identity confirmed by the server')}</h3>
                <p className="text-xs leading-5 text-[var(--text-muted)]">{t('الاسم والبريد المقنّع للعرض فقط؛ لا يُستخدم أيٌّ منهما لمطابقة الهوية.', 'Name and masked email are display-only; neither is used to match identity.')}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="grid gap-1"><dt className="text-xs font-bold text-[var(--text-muted)]">{t('رقم العضو الدقيق', 'Exact member ID')}</dt><dd className="break-all font-mono font-bold" dir="ltr">{preview.member_id}</dd></div>
                  <div className="grid gap-1"><dt className="text-xs font-bold text-[var(--text-muted)]">{t('معرّف حساب Auth الدقيق', 'Exact Auth account UUID')}</dt><dd className="break-all font-mono text-xs font-bold" dir="ltr">{preview.auth_user_id}</dd></div>
                  <div className="grid gap-1"><dt className="text-xs font-bold text-[var(--text-muted)]">{t('اسم العرض من الخادم', 'Display name returned by server')}</dt><dd className="break-words font-bold">{preview.member_name}</dd></div>
                  {preview.email_masked && <div className="grid gap-1"><dt className="text-xs font-bold text-[var(--text-muted)]">{t('البريد المقنّع من الخادم', 'Masked email returned by server')}</dt><dd className="break-all font-mono text-xs" dir="ltr">{preview.email_masked}</dd></div>}
                </dl>
                <p className="text-xs leading-5 text-[var(--text-muted)]">{t('تنتهي صلاحية المعاينة في ', 'Preview expires at ')}{date(preview.expires_at)}. {t('أي تغيير يتطلب معاينة جديدة.', 'Any change requires a new preview.')}</p>
                <p className="text-xs leading-5 text-[var(--text-muted)]">{preview.is_admin
                  ? t('أعاد الخادم أن هذا الحساب Admin؛ إدارة الصلاحيات منفصلة عن هذا المسار.', 'The server marked this account as Admin; permission management is separate from this flow.')
                  : t('أعاد الخادم أن هذا الحساب ليس Admin.', 'The server marked this account as not Admin.')}</p>
              </section>

              {blockedByOwner && (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold leading-6 text-amber-700 dark:text-amber-300" role="alert">
                  {t('تم إيقاف التنفيذ: الهدف هو حسابك الحالي أو حساب المالك الأساسي. لن نرسل طلب المحو؛ الخادم يطبق الحماية أيضاً.', 'Execution is blocked: this is your current account or the primary owner. No erase request will be sent; the server enforces this protection too.')}
                </p>
              )}

              {(!preview.can_execute || preview.blockers.length > 0) && (
                <section className="grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200" role="alert">
                  <h3 className="font-black">{t('الخادم حظر التنفيذ', 'The server blocked execution')}</h3>
                  <p>{t('لم يبدأ أي حذف. لم يتمكن الخادم من تأكيد نطاق آمن قابل للفصل. الفرق والمشروعات المشتركة والأعضاء الآخرون يظلون محفوظين؛ لا يوجد خيار لتضمينهم في المحو.', 'No deletion started. The server could not confirm a safely detachable scope. Shared teams, projects, and other members remain preserved; there is no option to include them in erasure.')}</p>
                  {preview.blockers.length > 0 && <p className="text-xs">{t('عدد موانع التنفيذ التي أعادها الخادم: ', 'Server-reported blockers: ')}{number(preview.blockers.length)}</p>}
                </section>
              )}

              <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="owner-erasure-impact-title">
                <h3 id="owner-erasure-impact-title" className="text-sm font-black">{t('أعداد البيانات المتأثرة', 'Impact counts')}</h3>
                {preview.impacts.length ? (
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {preview.impacts.map((impact) => (
                      <div key={impact.key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
                        <dt className="min-w-0 break-words text-[var(--text-2)]">{t(impact.label_ar, impact.label_en)}</dt>
                        <dd className="shrink-0 font-black tabular-nums" dir="ltr">{number(impact.count)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="text-sm text-[var(--text-muted)]">{t('لا توجد أعداد إضافية في المعاينة.', 'No additional domain counts were returned.')}</p>}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
                  <span>{t('كائنات Storage للهدف', 'Target Storage objects')}</span><strong className="tabular-nums" dir="ltr">{number(preview.storage_object_count)}</strong>
                </div>
              </section>

              <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="owner-erasure-shared-title">
                <h3 id="owner-erasure-shared-title" className="text-sm font-black">{t('نطاق مشترك محفوظ — للعرض فقط', 'Shared scope preserved — read-only')}</h3>
                <p className="text-xs leading-5 text-[var(--text-muted)]">{t('هذه القوائم لا تضيف أي سجل أو عضو أو مشروع إلى طلب المحو. لا يوجد مربع اختيار لحذف المشاريع المشتركة.', 'These lists never add any record, member, or project to the erasure request. No checkbox exists to erase shared projects.')}</p>
                <div className="grid gap-2">
                  <h4 className="text-xs font-extrabold text-[var(--text-muted)]">{t('الفرق المشتركة المحفوظة', 'Preserved shared teams')}</h4>
                  {preview.shared_teams.length ? preview.shared_teams.map((team) => (
                    <div key={team.id} className="grid min-w-0 gap-1 rounded-lg bg-[var(--surface-2)] p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="break-words font-bold">{team.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">{t('أعضاء آخرون: ', 'Other members: ')}<strong className="tabular-nums">{number(team.other_member_count)}</strong></span>
                      <span className="break-all font-mono text-[11px] text-[var(--text-muted)] sm:col-span-2" dir="ltr">{team.id}</span>
                    </div>
                  )) : <p className="text-xs text-[var(--text-muted)]">{t('لا توجد فرق مشتركة.', 'No shared teams.')}</p>}
                </div>
                <div className="grid gap-2 border-t border-[var(--border)] pt-3">
                  <h4 className="text-xs font-extrabold text-[var(--text-muted)]">{t('المشروعات المشتركة المحفوظة', 'Preserved shared projects')}</h4>
                  {preview.shared_projects.length ? preview.shared_projects.map((project) => (
                    <div key={project.id} className="grid gap-1 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
                      <span className="break-words font-bold">{project.name}</span>
                      <span className="break-all font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">{project.id}</span>
                      <p className="text-xs leading-5 text-[var(--text-muted)]">
                        {t('أعضاء آخرون: ', 'Other members: ')}<strong className="tabular-nums">{number(project.other_member_count)}</strong>
                        {' · '}{t('صفوف تابعة: ', 'Dependent rows: ')}<strong className="tabular-nums">{number(project.dependent_rows)}</strong>
                      </p>
                    </div>
                  )) : <p className="text-xs text-[var(--text-muted)]">{t('لا توجد مشروعات مشتركة.', 'No shared projects.')}</p>}
                </div>
              </section>

              {preview.handover_requirements.length > 0 && (
                <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="owner-erasure-handover-title">
                  <h3 id="owner-erasure-handover-title" className="text-sm font-black">{t('تسليم كل الإسنادات المطلوبة', 'Hand over every required attribution')}</h3>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">{t('اختر لكل بند خلفاً واحداً من المرشحين الذين أعادهم الخادم فقط. لا توجد قيمة افتراضية ولا تخمين.', 'Choose one successor per item from only the candidates returned by the server. There is no default or guessed successor.')}</p>
                  {preview.handover_requirements.map((requirement) => {
                    const key = ownerMemberErasureHandoverKey(requirement);
                    const selectId = `owner-erasure-handover-${key}`;
                    return (
                      <div key={key} className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                        <label htmlFor={selectId} className="text-sm font-bold">{requirement.entity_name} <span className="text-xs font-normal text-[var(--text-muted)]">({requirement.kind})</span></label>
                        <span className="break-all font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">{String(requirement.entity_id)}</span>
                        {requirement.candidates.length ? (
                          <select
                            id={selectId}
                            value={successorAssignments[key] === undefined ? '' : String(successorAssignments[key])}
                            onChange={(event) => {
                              const rawValue = event.target.value;
                              setSuccessorAssignments((current) => {
                                const next = { ...current };
                                if (rawValue === '') delete next[key];
                                else next[key] = Number(rawValue);
                                return next;
                              });
                            }}
                            disabled={busy || Boolean(outcome) || Boolean(operationStatus)}
                            className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]"
                          >
                            <option value="">{t('اختر خلفاً من قائمة الخادم', 'Select a server-listed successor')}</option>
                            {requirement.candidates.map((candidate) => (
                              <option key={candidate.member_id} value={candidate.member_id}>{candidate.full_name} — {t('رقم العضو ', 'Member ID ')}{candidate.member_id}</option>
                            ))}
                          </select>
                        ) : <p className="text-sm font-bold text-[var(--danger-text)]">{t('لم يُعِد الخادم أي مرشح صالح لهذا البند؛ التنفيذ غير متاح.', 'The server returned no eligible candidate for this item; execution is unavailable.')}</p>}
                      </div>
                    );
                  })}
                </section>
              )}

              {!blockedByOwner && canExecute && !expired && !outcome && !operationStatus && (phase === 'idle' || phase === 'executing') && (
                <section className="grid gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--surface)] p-4" aria-labelledby="owner-erasure-confirm-title">
                  <h3 id="owner-erasure-confirm-title" className="text-sm font-black text-[var(--danger-text)]">{t('الخطوة الثانية: تأكيد المحو نهائياً', 'Step two: confirm permanent erasure')}</h3>
                  <p className="text-sm leading-6 text-[var(--text-2)]">{t('اكتب العبارة التالية كما هي تماماً، بما فيها الأحرف الكبيرة والمسافات:', 'Type the following phrase exactly, including capitalization and spaces:')}</p>
                  <code className="block select-all overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-start font-mono text-sm font-black" dir="ltr">{expectedConfirmation}</code>
                  <label htmlFor="owner-erasure-confirmation" className="text-xs font-extrabold">{t('عبارة التأكيد', 'Confirmation phrase')}</label>
                  <input
                    id="owner-erasure-confirmation"
                    type="text"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={busy}
                    aria-describedby="owner-erasure-confirmation-help"
                    className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 text-start font-mono text-base focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]"
                  />
                  <p id="owner-erasure-confirmation-help" className="text-xs leading-5 text-[var(--text-muted)]">{t('يلزم التطابق الحرفي. لا يمكن التراجع عن العملية بعد تنفيذها.', 'An exact match is required. The operation cannot be undone once executed.')}</p>
                  {!allHandoversSelected && preview.handover_requirements.length > 0 && <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{t('يجب إكمال كل الإسنادات المطلوبة قبل التنفيذ.', 'Every required handover must be selected before execution.')}</p>}
                  <Button type="button" variant="danger" icon={<Eraser size={17} />} isLoading={phase === 'executing'} loadingText={t('جارٍ تنفيذ المحو...', 'Erasing...')} disabled={!isConfirmationValid || !allHandoversSelected || busy || phase !== 'idle'} onClick={() => void execute()} fullOnMobile>
                    {t('تنفيذ محو الهوية والحساب والبيانات الشخصية', 'Erase identity, account, and personal data')}
                  </Button>
                </section>
              )}

              {expired && !outcome && !operationStatus && phase !== 'uncertain' && (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-700 dark:text-amber-300" role="alert">
                  {t('انتهت صلاحية المعاينة. لا يمكن استخدامها للتنفيذ؛ اطلب معاينة جديدة.', 'This preview has expired and cannot be used. Request a new preview before execution.')}
                </p>
              )}
            </div>
          )}

          {(phase === 'partial' || phase === 'retrying' || phase === 'checking') && (outcome?.status === 'partial' || operationStatus?.status === 'partial') && (
            <section className="grid gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200" role="alert" aria-live="assertive">
              <h3 className="font-black">{t('العملية جزئية — لا يوجد تأكيد بالاكتمال', 'Partial operation — completion is not confirmed')}</h3>
              <p className="text-sm leading-6">{safePartialMessage(t)}</p>
              {operationId && <p className="text-xs">{t('مرجع العملية: ', 'Operation reference: ')}<span className="break-all font-mono" dir="ltr">{operationId}</span></p>}
              {retryablePartial ? (
                <Button type="button" variant="secondary" isLoading={busy} loadingText={t('بنراجع العملية نفسها...', 'Retrying this operation...')} onClick={() => void retry()} fullOnMobile>
                  {t('إعادة محاولة العملية المحددة من الخادم', 'Retry the server-designated operation')}
                </Button>
              ) : <p className="text-sm font-bold">{t('الخادم لم يصرّح بإعادة المحاولة. لا يوجد إجراء إعادة محاولة متاح هنا.', 'The server did not designate this operation as retryable. No retry action is available here.')}</p>}
            </section>
          )}

          {(phase === 'pending' || phase === 'checking') && operationStatus?.status === 'pending' && (
            <section className="grid gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200" role="status" aria-live="polite">
              <h3 className="font-black">{t('العملية ما زالت قيد المعالجة', 'Operation is still pending')}</h3>
              <p className="text-sm leading-6">{t('لم يؤكد الخادم الاكتمال. لا نعرض نجاحاً ولا نرسل عملية تنفيذ جديدة.', 'The server has not confirmed completion. No success is shown and no new execute request is sent.')}</p>
              {operationId && <p className="text-xs">{t('مرجع العملية: ', 'Operation reference: ')}<span className="break-all font-mono" dir="ltr">{operationId}</span></p>}
            </section>
          )}

          {phase === 'complete' && outcome?.status === 'complete' && (
            <section className="grid gap-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-soft)] p-4 text-[var(--success-text)]" role="status" aria-live="polite">
              <h3 className="font-black">{t('اكتمل المحو بتأكيد الخادم', 'Erasure complete — confirmed by the server')}</h3>
              <p className="text-sm leading-6">{t('هذه هي الحالة الوحيدة التي نعرضها كاكتمال ناجح.', 'This is the only state reported as successfully complete.')}</p>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt>{t('صفوف قاعدة البيانات', 'Database rows')}</dt><dd className="font-black tabular-nums">{number(outcome.deleted.database_rows)}</dd></div>
                <div><dt>{t('كائنات Storage', 'Storage objects')}</dt><dd className="font-black tabular-nums">{number(outcome.deleted.storage_objects)}</dd></div>
                <div><dt>{t('حسابات Auth', 'Auth accounts')}</dt><dd className="font-black tabular-nums">{number(outcome.deleted.auth_users)}</dd></div>
              </dl>
              <p className="text-xs">{t('مرجع العملية: ', 'Operation reference: ')}<span className="break-all font-mono" dir="ltr">{outcome.operation_id}</span></p>
            </section>
          )}

          {(phase === 'uncertain' || (phase === 'checking' && !operationStatus)) && (
            <section className="grid gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200" role="alert" aria-live="assertive">
              <h3 className="font-black">{t('النتيجة غير مؤكدة', 'Outcome is uncertain')}</h3>
              <p className="text-sm leading-6">{errorCode ? errorCopy(errorCode, t) : t('تعذّر التحقق من حالة العملية. لا تعِد إرسال التنفيذ؛ افحص حالة رقم العملية نفسه.', 'The operation status could not be confirmed. Do not resubmit execution; check the status of this same operation ID.')}</p>
              {operationId && <p className="text-xs">{t('مرجع العملية: ', 'Operation reference: ')}<span className="break-all font-mono" dir="ltr">{operationId}</span></p>}
              {preview && <Button type="button" variant="secondary" isLoading={busy} loadingText={t('بنستعلم عن الحالة...', 'Checking operation status...')} onClick={() => void checkStatus()} fullOnMobile>{t('التحقق من حالة العملية نفسها', 'Check this operation’s status')}</Button>}
            </section>
          )}

          {errorCode && errorContext === 'operation' && phase !== 'uncertain' && (
            <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger-text)]" role="alert">
              {errorCopy(errorCode, t)}
            </p>
          )}

          {(phase === 'pending' || phase === 'partial' || (phase === 'checking' && Boolean(operationStatus))) && preview && (
            <Button type="button" variant="secondary" isLoading={busy} loadingText={t('بنستعلم عن الحالة...', 'Checking operation status...')} onClick={() => void checkStatus()} fullOnMobile>
              {t('تحديث حالة العملية نفسها', 'Refresh this operation’s status')}
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={close} disabled={busy} fullOnMobile>{t('إغلاق', 'Close')}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
