import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Copy, KeyRound, Link2, MessageCircle, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import {
  fetchApprovedMembersForInvite,
  useCreateMemberInvite,
  usePendingMemberInvites,
  useRevokeMemberInvite,
} from './memberInviteApi';
import type { CreatedMemberInvite, MemberInvitePurpose } from './memberInviteApi';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { MemberInviteApiError } from './memberInviteApi';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { hours: 24 },
  { hours: 72 },
  { hours: 168 },
  { hours: 720 },
] as const;

function inviteErrorMessage(cause: unknown, t: (arabic: string, english: string) => string): string {
  if (cause instanceof MemberInviteApiError) return cause.message;
  return t('تعذر تنفيذ الدعوة. راجع صلاحيات الإدارة وحاول مرة أخرى.', 'Could not process the invitation. Check administrator permissions and try again.');
}

function purposeLabel(purpose: MemberInvitePurpose, t: (arabic: string, english: string) => string): string {
  if (purpose === 'join') return t('تسجيل عضو جديد', 'New member registration');
  if (purpose === 'reset') return t('إعادة تعيين كلمة المرور', 'Password reset');
  return t('إعداد كلمة المرور لعضو موجود', 'Set up a password for an existing member');
}

export function MemberInviteModal({ isOpen, onClose }: Props) {
  const { t, date, dir } = useLocale();
  const createInvite = useCreateMemberInvite();
  const pendingInvites = usePendingMemberInvites(isOpen);
  const revokeInvite = useRevokeMemberInvite();
  const membersQuery = useQuery({
    queryKey: ['approved-members-for-password-invite'],
    queryFn: fetchApprovedMembersForInvite,
    enabled: isOpen,
  });

  const [memberId, setMemberId] = useState('');
  const [email, setEmail] = useState('');
  const [whatsAppName, setWhatsAppName] = useState('');
  const [purpose, setPurpose] = useState<MemberInvitePurpose>('join');
  const [expiresInHours, setExpiresInHours] = useState<number>(24);
  const [createdInvite, setCreatedInvite] = useState<CreatedMemberInvite | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'message' | null>(null);
  const [error, setError] = useState('');
  const visibleRef = useRef(isOpen);
  const issueBusyRef = useRef(false);
  const generationRef = useRef(0);
  const resetIssuedInvite = createInvite.reset;
  const isNewMember = purpose === 'join';

  useEffect(() => {
    generationRef.current += 1;
    visibleRef.current = isOpen;
    if (!isOpen) {
      setCreatedInvite(null);
      setCopiedType(null);
      setWhatsAppName('');
      setError('');
      resetIssuedInvite();
    }
    return () => {
      visibleRef.current = false;
      generationRef.current += 1;
    };
  }, [isOpen, resetIssuedInvite]);

  const handlePurposeChange = (value: MemberInvitePurpose) => {
    setPurpose(value);
    setMemberId('');
    setEmail('');
    setWhatsAppName('');
    setError('');
    setCreatedInvite(null);
  };

  const handleMemberChange = (value: string) => {
    setMemberId(value);
    const member = membersQuery.data?.find((candidate) => String(candidate.id) === value);
    setEmail(member?.email ?? '');
    setError('');
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (issueBusyRef.current) return;
    setError('');
    setCopiedType(null);
    const selectedMemberId = isNewMember ? null : Number(memberId);
    if (!isNewMember && (!Number.isSafeInteger(selectedMemberId) || (selectedMemberId ?? 0) <= 0 || !email.trim())) {
      setError(t('اختر عضواً مفعّلاً من القائمة.', 'Select an active member from the list.'));
      return;
    }
    issueBusyRef.current = true;
    const generation = generationRef.current;
    try {
      const result = await createInvite.mutateAsync({
        memberId: selectedMemberId,
        email: isNewMember ? null : email.trim(),
        purpose,
        expiresInHours,
      });
      resetIssuedInvite();
      if (!visibleRef.current || generation !== generationRef.current) return;
      setCreatedInvite(result);
      toast.success(purpose === 'join'
        ? t('تم إصدار رابط تسجيل خاص؛ العضو سيكتب بياناته بنفسه.', 'A registration link was created; the member will enter their own details.')
        : purpose === 'reset' ? t('تم إصدار رابط إعادة تعيين كلمة المرور.', 'A password reset link was created.') : t('تم إصدار رابط إعداد كلمة المرور.', 'A password setup link was created.'));
    } catch (cause) {
      if (visibleRef.current && generation === generationRef.current) setError(inviteErrorMessage(cause, t));
    } finally {
      issueBusyRef.current = false;
    }
  };

  const copyText = async (text: string, type: 'url' | 'message') => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      fallback.style.pointerEvents = 'none';
      try {
        document.body.appendChild(fallback);
        fallback.focus();
        fallback.select();
        fallback.setSelectionRange(0, fallback.value.length);
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        fallback.remove();
      }
    }
    if (!copied) {
      toast.error(type === 'url'
        ? t('تعذر نسخ الرابط تلقائياً؛ حدّده من المربع الظاهر وانسخه يدوياً.', 'Could not copy the link automatically. Select it in the box and copy it manually.')
        : t('تعذر نسخ الرسالة تلقائياً؛ حدّدها من معاينة واتساب وانسخها يدوياً.', 'Could not copy the message automatically. Select it in the WhatsApp preview and copy it manually.'));
      return;
    }
    setCopiedType(type);
    toast.success(type === 'url' ? t('تم نسخ الرابط.', 'Link copied.') : t('تم نسخ رسالة واتساب.', 'WhatsApp message copied.'));
    window.setTimeout(() => setCopiedType(null), 2500);
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvite.mutateAsync(id);
      if (createdInvite?.id === id) setCreatedInvite(null);
      toast.success(t('تم إلغاء الرابط فوراً.', 'The link was revoked immediately.'));
    } catch (cause) {
      toast.error(inviteErrorMessage(cause, t));
    }
  };

  const formatDate = (iso: string) => {
    try {
      return date(iso, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  const buildWhatsAppMessage = (invite: CreatedMemberInvite, name: string) => {
    const displayName = name.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 100);
    const greeting = displayName ? t(`أهلًا يا ${displayName}،`, `Hello ${displayName},`) : t('أهلًا،', 'Hello,');
    const linkIntro = invite.purpose === 'join'
      ? t('ده رابط الدعوة لمنصة PHANTOMS:', 'Here is your PHANTOMS registration link:')
      : invite.purpose === 'reset' ? t('ده رابط إعادة تعيين كلمة المرور لمنصة PHANTOMS:', 'Here is your PHANTOMS password reset link:') : t('ده رابط إعداد كلمة المرور لمنصة PHANTOMS:', 'Here is your PHANTOMS password setup link:');
    const instructions = invite.purpose === 'join'
      ? t('افتح الرابط واكتب بريدك الإلكتروني وبياناتك وكلمة مرورك بنفسك. بعد التسجيل، هتفضل عضويتك في انتظار مراجعة الإدارة.', 'Open the link and enter your email, details, and password. After registration, your membership will remain pending administrator review.')
      : invite.purpose === 'reset'
        ? t('استخدم الرابط لإعادة تعيين كلمة المرور فقط؛ لن تتغير بيانات ملفك.', 'Use this link only to reset your password; your profile details will not change.')
        : t('افتح الرابط لإعداد كلمة مرور حسابك بنفسك.', 'Open the link to set up your account password.');
    const expiry = t(`الرابط صالح لحد ${formatDate(invite.expires_at)} ويُستخدم مرة واحدة فقط.`, `This link expires ${formatDate(invite.expires_at)} and can only be used once.`);
    return `${greeting}\n${linkIntro}\n${invite.url}\n\n${instructions}\n\n${expiry}`;
  };

  const activeList = pendingInvites.data ?? [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('روابط تسجيل ودخول الأعضاء', 'Member registration and sign-in links')} maxWidth="lg">
      <div className="grid gap-4" dir={dir}>
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div className="min-w-0 text-xs leading-6 text-[var(--text-2)]">
            <p className="font-black text-[var(--text)]">{t('أنت ترسل الرابط فقط — العضو يكتب بياناته وكلمة مروره', 'You only send the link — the member enters their own details and password')}</p>
            <p>{t('لعضو جديد: لا نطلب بريده هنا؛ يكتبه بنفسه عند التسجيل وتبقى عضويته بانتظار مراجعة الإدارة. الاسم اختياري لتحية واتساب فقط. انسخ الرابط وحده أو انسخ رسالة واتساب وأرسلها بنفسك. ولعضو موجود، اختره لإعداد كلمة مروره لأول مرة فقط؛ إعادة التعيين بقت من كارت العضو بزر المفتاح وتُعيّن 123456789 فوراً. لا يُرسل بريد أو واتساب تلقائياً، والرابط يُستخدم مرة واحدة وينتهي في الموعد المحدد.', 'For a new member, do not enter an email here; they provide it during registration and remain pending administrator review. The optional name is used only in the WhatsApp greeting. Copy the link or WhatsApp message and send it yourself. For an existing member, choose them to set their password for the first time only; resets now run from the member card key button and apply 123456789 immediately. Nothing is sent automatically; each link is single-use and expires at the selected time.')}</p>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {error && <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{error}</p>}
          <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-purpose">
            {t('نوع الرابط', 'Link type')}
            <select id="member-invite-purpose" value={purpose} onChange={(event) => handlePurposeChange(event.target.value as MemberInvitePurpose)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
              <option value="join">{t('عضو جديد — يسجل بياناته بنفسه (بانتظار المراجعة)', 'New member — enters their own details (pending review)')}</option>
              <option value="enroll">{t('عضو موجود — إعداد كلمة المرور لأول مرة', 'Existing member — set a password for the first time')}</option>
            </select>
          </label>

          {isNewMember ? (
            <div data-testid="member-invite-join-options" className="grid gap-2.5">
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-message-name">
                {t('اسم الطالب في رسالة واتساب (اختياري)', 'Member name in WhatsApp message (optional)')}
                <input id="member-invite-message-name" type="text" autoComplete="off" value={whatsAppName} onChange={(event) => setWhatsAppName(event.target.value)} maxLength={100} placeholder={t('مثال: سلمى', 'Example: Sam') } className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
                <span className="text-[11px] font-normal leading-5 text-[var(--text-muted)]">{t('يُستخدم في التحية داخل الرسالة فقط؛ لا يُحفظ ولا يُرسل إلى الخادم.', 'Used only in the message greeting; it is not saved or sent to the server.')}</span>
              </label>
            </div>
          ) : (
            <>
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-member">
                <span className="flex items-center gap-1.5"><UserRound size={14} aria-hidden="true" /> {t('العضو الموجود *', 'Existing member *')}</span>
                <select id="member-invite-member" value={memberId} onChange={(event) => handleMemberChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" required>
                  <option value="">{t('— اختر عضواً مفعّلاً —', '— Select an active member —')}</option>
                  {(membersQuery.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.full_name} — {member.email}</option>)}
                </select>
              </label>
              {membersQuery.isError && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950" role="alert"><span>{t('تعذر تحميل قائمة الأعضاء الحاليين. أعد المحاولة، أو اختر «عضو جديد» إذا كان هذا تسجيلًا جديدًا.', 'Could not load members. Try again, or choose “New member” for a new registration.')}</span><Button type="button" variant="secondary" onClick={() => { void membersQuery.refetch(); }}>{t('إعادة التحميل', 'Reload')}</Button></div>}
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-email">{t('البريد المرتبط', 'Associated email')}
                <input id="member-invite-email" type="email" dir="ltr" value={email} readOnly required className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)] read-only:opacity-80" />
              </label>
            </>
          )}

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">{t('مدة الصلاحية', 'Link duration')}
              <select id="member-invite-expiry" value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
                {EXPIRY_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{option.hours === 24 ? t('يوم واحد (24 ساعة)', '1 day (24 hours)') : option.hours === 72 ? t('3 أيام', '3 days') : option.hours === 168 ? t('7 أيام', '7 days') : t('30 يوماً', '30 days')}</option>)}
              </select>
              <span className="text-[11px] font-normal leading-5 text-[var(--text-muted)]">{t('الافتراضي 24 ساعة؛ اختر 3 أيام أو مدة أخرى عند الحاجة. الرابط لمرة واحدة فقط.', 'The default is 24 hours; choose 3 days or another duration if needed. The link can only be used once.')}</span>
            </label>
          </div>
          <div className="flex justify-end pt-1"><Button type="submit" isLoading={createInvite.isPending} loadingText={t('بنجهز الرابط...', 'Creating link...')} icon={<KeyRound size={16} aria-hidden="true" />} fullOnMobile>{t('إنشاء رابط خاص', 'Create secure link')}</Button></div>
        </form>

        {createdInvite && (
          <div data-testid="member-invite-created-result" className="grid gap-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Link2 size={18} className="text-[var(--link)]" aria-hidden="true" /><span className="text-sm font-black text-[var(--text)]">{purposeLabel(createdInvite.purpose, t)}</span><span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">{t('مرة واحدة فقط', 'Single use')}</span></div><span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">{t('صالح حتى', 'Expires')} {formatDate(createdInvite.expires_at)}</span></div>
            {createdInvite.purpose === 'join' && <p className="text-xs leading-5 text-[var(--text-2)]">{t('بعد أن يرسل العضو بياناته، ستظهر العضوية بحالة غير مفعّلة لتراجعها الإدارة قبل السماح بالدخول.', 'After the member submits their details, their membership will remain inactive until an administrator reviews it.')}</p>}
            <div className="grid gap-2">
              <span className="text-xs font-bold text-[var(--text-2)]">{t('انسخ الرابط وحده', 'Copy the link only')}</span>
              <div dir="ltr" className="max-h-24 overflow-y-auto break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)] select-all">{createdInvite.url}</div>
              <Button type="button" variant="primary" onClick={() => { void copyText(createdInvite.url, 'url'); }} icon={copiedType === 'url' ? <Check size={16} /> : <Copy size={16} />}>{copiedType === 'url' ? t('تم نسخ الرابط', 'Link copied') : t('نسخ رابط الدعوة', 'Copy invitation link')}</Button>
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-bold text-[var(--text-2)]">{t('أو انسخ الدعوة في رسالة واتساب وأرسلها بنفسك', 'Or copy the WhatsApp message and send it yourself')}</span>
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-whatsapp-preview">{t('معاينة الرسالة', 'Message preview')}
                <textarea id="member-invite-whatsapp-preview" dir="auto" rows={5} readOnly value={buildWhatsAppMessage(createdInvite, whatsAppName)} onFocus={(event) => event.currentTarget.select()} className="min-h-28 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-normal leading-6 text-[var(--text)]" />
              </label>
              <Button data-testid="member-invite-copy-whatsapp" type="button" variant="secondary" onClick={() => { void copyText(buildWhatsAppMessage(createdInvite, whatsAppName), 'message'); }} icon={copiedType === 'message' ? <Check size={16} /> : <MessageCircle size={16} />}>{copiedType === 'message' ? t('تم نسخ الرسالة', 'Message copied') : t('نسخ الدعوة في رسالة واتساب', 'Copy invitation as WhatsApp message')}</Button>
            </div>
          </div>
        )}

        <div className="grid gap-2.5"><h4 className="text-sm font-black text-[var(--text)]">{t('الروابط المعلقة', 'Pending links')} ({activeList.length})</h4>{pendingInvites.isError ? <p role="alert">{t('تعذر تحميل الدعوات. حاول مرة أخرى.', 'Could not load invitations. Try again.')}</p> : pendingInvites.isLoading ? <p className="py-3 text-center text-xs text-[var(--text-muted)]">{t('بنحمّل الدعوات...', 'Loading invitations...')}</p> : activeList.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">{t('لا توجد روابط معلقة حالياً.', 'There are no pending links.')}</div> : <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">{activeList.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="min-w-0"><p className="text-sm font-bold text-[var(--text)]">{item.email ?? t('البريد يكتبه العضو عند التسجيل', 'Member enters email during registration')} — {purposeLabel(item.purpose, t)}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Clock size={13} aria-hidden="true" />{t('تنتهي في:', 'Expires:')} {formatDate(item.expires_at)}</p>{item.status !== 'pending' && <p className="text-xs font-bold text-amber-700">{t('محاولة محجوزة أو تحتاج مراجعة؛ لا تُلغى ولا تُعاد تلقائياً.', 'Attempt is reserved or requires review; it cannot be revoked or retried automatically.')}</p>}</div><button type="button" onClick={() => { void handleRevoke(item.id); }} disabled={revokeInvite.isPending || item.status !== 'pending'} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50"><Trash2 size={14} aria-hidden="true" />{t('إلغاء الرابط', 'Revoke link')}</button></div>)}</div>}</div>
        <div className="flex justify-end border-t border-[var(--border)] pt-3"><Button type="button" variant="secondary" onClick={onClose}>{t('إغلاق', 'Close')}</Button></div>
      </div>
    </Modal>
  );
}