import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Copy, KeyRound, Link2, ShieldCheck, Trash2, UserRound } from 'lucide-react';
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
  const [purpose, setPurpose] = useState<MemberInvitePurpose>('enroll');
  const [expectedAuthUserId, setExpectedAuthUserId] = useState('');
  const [associationEvidence, setAssociationEvidence] = useState('');
  const [note, setNote] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(168);
  const [createdInvite, setCreatedInvite] = useState<CreatedMemberInvite | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'token' | null>(null);
  const [error, setError] = useState('');
  const visibleRef = useRef(isOpen);
  const issueBusyRef = useRef(false);
  const generationRef = useRef(0);
  const resetIssuedInvite = createInvite.reset;

  useEffect(() => {
    generationRef.current += 1;
    visibleRef.current = isOpen;
    if (!isOpen) {
      setCreatedInvite(null);
      setCopiedType(null);
      setAssociationEvidence('');
      resetIssuedInvite();
    }
    return () => {
      visibleRef.current = false;
      generationRef.current += 1;
    };
  }, [isOpen, resetIssuedInvite]);

  const handleMemberChange = (value: string) => {
    setMemberId(value);
    const member = membersQuery.data?.find((candidate) => String(candidate.id) === value);
    if (member) setEmail(member.email);
    setExpectedAuthUserId('');
    setAssociationEvidence('');
    setError('');
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (issueBusyRef.current) return;
    setError('');
    setCopiedType(null);
    const selectedMemberId = Number(memberId);
    if (!Number.isSafeInteger(selectedMemberId) || !email) {
      setError('اختر عضواً مفعّلاً من القائمة.');
      return;
    }
    issueBusyRef.current = true;
    const generation = generationRef.current;
    try {
      const result = await createInvite.mutateAsync({
        memberId: selectedMemberId,
        email,
        purpose,
        expectedAuthUserId,
        associationEvidence,
        note,
        expiresInHours,
      });
      resetIssuedInvite();
      if (!visibleRef.current || generation !== generationRef.current) return;
      setCreatedInvite(result);
      setNote('');
      toast.success(purpose === 'reset' ? 'تم إصدار دعوة إعادة الضبط يدوياً.' : 'تم إصدار دعوة إعداد كلمة المرور.');
    } catch (cause) {
      if (visibleRef.current && generation === generationRef.current) setError(inviteErrorMessage(cause));
    } finally {
      issueBusyRef.current = false;
    }
  };

  const copyText = async (text: string, type: 'url' | 'token') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      toast.success(type === 'url' ? 'تم نسخ الرابط.' : 'تم نسخ رمز الدعوة اليدوي.');
      window.setTimeout(() => setCopiedType(null), 2500);
    } catch {
      toast.error('معرفناش ننسخ تلقائياً — انسخ القيمة يدوياً.');
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvite.mutateAsync(id);
      if (createdInvite?.id === id) setCreatedInvite(null);
      toast.success('تم إلغاء الدعوة فوراً.');
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

  const activeList = pendingInvites.data ?? [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="دعوة كلمة مرور لعضو موجود" maxWidth="lg">
      <div className="grid gap-4" dir="rtl">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div className="min-w-0 text-xs leading-6 text-[var(--text-2)]">
            <p className="font-black text-[var(--text)]">دعوة خاصة بدون إرسال بريد</p>
            <p>اختر عضواً موجوداً، ثم انسخ الرابط أو الكود ووزّعه بشكل خاص. لا يتم إنشاء سجل عضو جديد ولا إرسال رسالة تلقائية.</p>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-bold text-red-900" role="alert">{error}</p>}
          <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-member">
            <span className="flex items-center gap-1.5"><UserRound size={14} aria-hidden="true" /> العضو الموجود *</span>
            <select id="member-invite-member" value={memberId} onChange={(event) => handleMemberChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" required>
              <option value="">— اختر عضواً مفعّلاً —</option>
              {(membersQuery.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.full_name} — {member.email}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-email">البريد المرتبط
              <input id="member-invite-email" type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-purpose">الغرض
              <select id="member-invite-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value as MemberInvitePurpose)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
                <option value="enroll">إعداد كلمة المرور لأول مرة</option>
                <option value="reset">إعادة ضبط كلمة المرور</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-auth-id">Auth User ID الدقيق (مطلوب للحسابات الموجودة وإعادة الضبط)
              <input id="member-invite-auth-id" type="text" dir="ltr" value={expectedAuthUserId} onChange={(event) => setExpectedAuthUserId(event.target.value)} required={purpose === 'reset'} placeholder="بعد مراجعة هوية العضو" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-invite-evidence">دليل ربط الهوية (عند الحاجة)
              <input id="member-invite-evidence" type="text" value={associationEvidence} onChange={(event) => setAssociationEvidence(event.target.value)} placeholder="سبب المراجعة" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">ملاحظة داخلية (اختيارية)
              <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثال: إعادة ضبط بعد مراجعة" className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">مدة الصلاحية
              <select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]">
                {EXPIRY_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end pt-1"><Button type="submit" isLoading={createInvite.isPending} loadingText="بنصدر الدعوة..." icon={<KeyRound size={16} aria-hidden="true" />} fullOnMobile>إصدار دعوة خاصة</Button></div>
        </form>

        {createdInvite && (
          <div className="grid gap-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Link2 size={18} className="text-[var(--link)]" aria-hidden="true" /><span className="text-sm font-black text-[var(--text)]">دعوة {createdInvite.purpose === 'reset' ? 'إعادة ضبط' : 'إعداد كلمة المرور'}</span></div><span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">صالحة حتى {formatDate(createdInvite.expires_at)}</span></div>
            <div className="grid gap-2"><span className="text-xs font-bold text-[var(--text-2)]">الرابط</span><div dir="ltr" className="max-h-24 overflow-y-auto break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)] select-all">{createdInvite.url}</div><Button type="button" variant="primary" onClick={() => { void copyText(createdInvite.url, 'url'); }} icon={copiedType === 'url' ? <Check size={16} /> : <Copy size={16} />}>{copiedType === 'url' ? 'تم نسخ الرابط' : 'نسخ الرابط'}</Button></div>
            <div className="grid gap-2"><span className="text-xs font-bold text-[var(--text-2)]">الكود اليدوي</span><div dir="ltr" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)] select-all">{createdInvite.token}</div><Button type="button" variant="secondary" onClick={() => { void copyText(createdInvite.token, 'token'); }} icon={copiedType === 'token' ? <Check size={16} /> : <Copy size={16} />}>{copiedType === 'token' ? 'تم نسخ الكود' : 'نسخ الكود'}</Button></div>
          </div>
        )}

        <div className="grid gap-2.5"><h4 className="text-sm font-black text-[var(--text)]">الدعوات المعلقة ({activeList.length})</h4>{pendingInvites.isError ? <p role="alert">تعذر تحميل الدعوات. حاول مرة أخرى.</p> : pendingInvites.isLoading ? <p className="py-3 text-center text-xs text-[var(--text-muted)]">بنحمّل الدعوات...</p> : activeList.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">لا توجد دعوات معلقة حالياً.</div> : <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">{activeList.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="min-w-0"><p className="text-sm font-bold text-[var(--text)]">{item.email} — {item.purpose === 'reset' ? 'إعادة ضبط' : 'إعداد أولي'}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Clock size={13} aria-hidden="true" />تنتهي في: {formatDate(item.expires_at)}</p>{item.status !== 'pending' && <p className="text-xs font-bold text-amber-700">محاولة محجوزة أو تحتاج مراجعة؛ لا تُلغى ولا تُعاد تلقائياً.</p>}</div><button type="button" onClick={() => { void handleRevoke(item.id); }} disabled={revokeInvite.isPending || item.status !== 'pending'} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} aria-hidden="true" />إلغاء الدعوة</button></div>)}</div>}</div>
        <div className="flex justify-end border-t border-[var(--border)] pt-3"><Button type="button" variant="secondary" onClick={onClose}>إغلاق</Button></div>
      </div>
    </Modal>
  );
}
