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

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { hours: 24, label: 'يوم واحد (24 ساعة)' },
  { hours: 72, label: '3 أيام' },
  { hours: 168, label: '7 أيام' },
  { hours: 720, label: '30 يوماً' },
] as const;

function inviteErrorMessage(cause: unknown): string {
  if (cause instanceof MemberInviteApiError) return cause.message;
  return 'تعذر تنفيذ الدعوة. راجع صلاحيات الإدارة وحاول مرة أخرى.';
}

function purposeLabel(purpose: MemberInvitePurpose): string {
  if (purpose === 'join') return 'تسجيل عضو جديد';
  if (purpose === 'reset') return 'إعادة تعيين كلمة المرور';
  return 'إعداد كلمة المرور لعضو موجود';
}

export function MemberInviteModal({ isOpen, onClose }: Props) {
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
  const [note, setNote] = useState('');
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
    if ((!isNewMember && (!Number.isSafeInteger(selectedMemberId) || (selectedMemberId ?? 0) <= 0)) || !email.trim()) {
      setError(isNewMember ? 'اكتب البريد الإلكتروني للعضو الجديد.' : 'اختر عضواً مفعّلاً من القائمة.');
      return;
    }
    issueBusyRef.current = true;
    const generation = generationRef.current;
    try {
      const result = await createInvite.mutateAsync({
        memberId: selectedMemberId,
        email,
        purpose,
        note,
        expiresInHours,
      });
      resetIssuedInvite();
      if (!visibleRef.current || generation !== generationRef.current) return;
      setCreatedInvite(result);
      setNote('');
      toast.success(purpose === 'join'
        ? 'تم إصدار رابط تسجيل خاص؛ العضو سيكتب بياناته بنفسه.'
        : purpose === 'reset' ? 'تم إصدار رابط إعادة تعيين كلمة المرور.' : 'تم إصدار رابط إعداد كلمة المرور.');
    } catch (cause) {
      if (visibleRef.current && generation === generationRef.current) setError(inviteErrorMessage(cause));
    } finally {
      issueBusyRef.current = false;
    }
  };

  const copyText = async (text: string, type: 'url' | 'message') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      toast.success(type === 'url' ? 'تم نسخ الرابط.' : 'تم نسخ رسالة واتساب.');
      window.setTimeout(() => setCopiedType(null), 2500);
    } catch {
      toast.error('تعذر النسخ التلقائي — حدّد القيمة وانسخها يدوياً.');
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvite.mutateAsync(id);
      if (createdInvite?.id === id) setCreatedInvite(null);
      toast.success('تم إلغاء الرابط فوراً.');
    } catch (cause) {
      toast.error(inviteErrorMessage(cause));
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const buildWhatsAppMessage = (invite: CreatedMemberInvite, name: string) => {
    const displayName = name.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 100);
    const greeting = displayName ? `أهلًا ${displayName}،` : 'أهلًا،';
    const instructions = invite.purpose === 'join'
      ? 'افتح الرابط واكتب بياناتك وكلمة مرورك بنفسك. بعد التسجيل، ستبقى عضويتك بانتظار مراجعة الإدارة.'
      : invite.purpose === 'reset'
        ? 'استخدم الرابط لإعادة تعيين كلمة المرور فقط؛ لن تتغير بيانات ملفك.'
        : 'افتح الرابط لإعداد كلمة مرور حسابك بنفسك.';
    return `${greeting}\n${instructions}\n\n${invite.url}\n\nالرابط صالح حتى ${formatDate(invite.expires_at)} ويُستخدم مرة واحدة فقط.`;
  };

  const activeList = pendingInvites.data ?? [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="روابط تسجيل ودخول الأعضاء" maxWidth="lg">
      <div className="grid gap-4" dir="rtl">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div className="min-w-0 text-xs leading-6 text-[var(--text-2)]">
            <p className="font-black text-[var(--text)]">أنت ترسل الرابط فقط — العضو يكتب بياناته وكلمة مروره</p>
            <p>لعضو جديد: يملأ ملفه بنفسه وتبقى عضويته غير مفعّلة حتى مراجعة الإدارة. ولعضو موجود: أرسل رابط إعداد كلمة المرور أو إعادة تعيينها. لا يُرسل بريد تلقائياً؛ الرابط يُستخدم مرة واحدة وينتهي بعد المدة المحددة.</p>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-bold text-red-900" role="alert">{error}</p>}
          <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-purpose">
            نوع الرابط
            <select id="member-invite-purpose" value={purpose} onChange={(event) => handlePurposeChange(event.target.value as MemberInvitePurpose)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
              <option value="join">عضو جديد — يسجل بياناته بنفسه (بانتظار المراجعة)</option>
              <option value="enroll">عضو موجود — إعداد كلمة المرور لأول مرة</option>
              <option value="reset">عضو موجود — إعادة تعيين كلمة المرور</option>
            </select>
          </label>

          {isNewMember ? (
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-email">
              بريد العضو الجديد *
              <input id="member-invite-email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="name@example.com" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
              <span className="text-[11px] font-normal leading-5 text-[var(--text-muted)]">اكتب بريد العضو يدويًا — لازم يستخدمه نفسه عند التسجيل. انسخ الرابط وأرسله بنفسك.</span>
            </label>
          ) : (
            <>
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-member">
                <span className="flex items-center gap-1.5"><UserRound size={14} aria-hidden="true" /> العضو الموجود *</span>
                <select id="member-invite-member" value={memberId} onChange={(event) => handleMemberChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" required>
                  <option value="">— اختر عضواً مفعّلاً —</option>
                  {(membersQuery.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.full_name} — {member.email}</option>)}
                </select>
              </label>
              {membersQuery.isError && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950" role="alert"><span>تعذر تحميل قائمة الأعضاء الحاليين. أعد المحاولة، أو اختر «عضو جديد» إذا كان هذا تسجيلًا جديدًا.</span><Button type="button" variant="secondary" onClick={() => { void membersQuery.refetch(); }}>إعادة التحميل</Button></div>}
              <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-email">البريد المرتبط
                <input id="member-invite-email" type="email" dir="ltr" value={email} readOnly required className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)] read-only:opacity-80" />
              </label>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">ملاحظة داخلية (اختيارية)
              <input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={purpose === 'join' ? 'مثال: تسجيل فريق جديد' : purpose === 'reset' ? 'مثال: طلب إعادة تعيين' : 'مثال: إعداد أول كلمة مرور'} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">مدة الصلاحية
              <select id="member-invite-expiry" value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
                {EXPIRY_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
              </select>
              <span className="text-[11px] font-normal leading-5 text-[var(--text-muted)]">الافتراضي 24 ساعة؛ اختر 3 أيام أو مدة أخرى عند الحاجة. الرابط لمرة واحدة فقط.</span>
            </label>
          </div>
          <div className="flex justify-end pt-1"><Button type="submit" isLoading={createInvite.isPending} loadingText="بنجهز الرابط..." icon={<KeyRound size={16} aria-hidden="true" />} fullOnMobile>إنشاء رابط خاص</Button></div>
        </form>

        {createdInvite && (
          <div className="grid gap-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Link2 size={18} className="text-[var(--link)]" aria-hidden="true" /><span className="text-sm font-black text-[var(--text)]">{purposeLabel(createdInvite.purpose)}</span><span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">مرة واحدة فقط</span></div><span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">صالح حتى {formatDate(createdInvite.expires_at)}</span></div>
            {createdInvite.purpose === 'join' && <p className="text-xs leading-5 text-[var(--text-2)]">بعد أن يرسل العضو بياناته، ستظهر العضوية بحالة غير مفعّلة لتراجعها الإدارة قبل السماح بالدخول.</p>}
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-message-name">
              اسم الطالب في رسالة واتساب (اختياري)
              <input id="member-invite-message-name" type="text" autoComplete="off" value={whatsAppName} onChange={(event) => setWhatsAppName(event.target.value)} maxLength={100} placeholder="اكتب الاسم أو اتركه فارغًا" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
              <span className="text-[11px] font-normal leading-5 text-[var(--text-muted)]">لرسالة واتساب فقط؛ لا يُحفظ في ملف الطالب، والطالب يكتب اسمه بنفسه.</span>
            </label>
            <div className="grid gap-2">
              <span className="text-xs font-bold text-[var(--text-2)]">الرابط — انسخه وأرسله للعضو</span>
              <div dir="ltr" className="max-h-24 overflow-y-auto break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)] select-all">{createdInvite.url}</div>
              <Button type="button" variant="primary" onClick={() => { void copyText(createdInvite.url, 'url'); }} icon={copiedType === 'url' ? <Check size={16} /> : <Copy size={16} />}>{copiedType === 'url' ? 'تم نسخ الرابط' : 'نسخ الرابط'}</Button>
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-bold text-[var(--text-2)]">رسالة واتساب جاهزة — انسخها وأرسلها بنفسك</span>
              <Button data-testid="member-invite-copy-whatsapp" type="button" variant="secondary" onClick={() => { void copyText(buildWhatsAppMessage(createdInvite, whatsAppName), 'message'); }} icon={copiedType === 'message' ? <Check size={16} /> : <MessageCircle size={16} />}>{copiedType === 'message' ? 'تم نسخ الرسالة' : 'نسخ رسالة واتساب'}</Button>
            </div>
          </div>
        )}

        <div className="grid gap-2.5"><h4 className="text-sm font-black text-[var(--text)]">الروابط المعلقة ({activeList.length})</h4>{pendingInvites.isError ? <p role="alert">تعذر تحميل الدعوات. حاول مرة أخرى.</p> : pendingInvites.isLoading ? <p className="py-3 text-center text-xs text-[var(--text-muted)]">بنحمّل الدعوات...</p> : activeList.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">لا توجد روابط معلقة حالياً.</div> : <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">{activeList.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="min-w-0"><p className="text-sm font-bold text-[var(--text)]">{item.email} — {purposeLabel(item.purpose)}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Clock size={13} aria-hidden="true" />تنتهي في: {formatDate(item.expires_at)}</p>{item.status !== 'pending' && <p className="text-xs font-bold text-amber-700">محاولة محجوزة أو تحتاج مراجعة؛ لا تُلغى ولا تُعاد تلقائياً.</p>}</div><button type="button" onClick={() => { void handleRevoke(item.id); }} disabled={revokeInvite.isPending || item.status !== 'pending'} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} aria-hidden="true" />إلغاء الرابط</button></div>)}</div>}</div>
        <div className="flex justify-end border-t border-[var(--border)] pt-3"><Button type="button" variant="secondary" onClick={onClose}>إغلاق</Button></div>
      </div>
    </Modal>
  );
}
