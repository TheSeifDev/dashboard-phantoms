import { useState } from 'react';
import { Check, Clock, Copy, KeyRound, Link2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  useCreateMemberInvite,
  usePendingMemberInvites,
  useRevokeMemberInvite,
} from './memberInviteApi';
import type { CreatedMemberInvite } from './memberInviteApi';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { hours: 24, label: 'يوم واحد (24 ساعة)' },
  { hours: 72, label: '3 أيام' },
  { hours: 168, label: '7 أيام (الافتراضي)' },
  { hours: 720, label: '30 يوماً' },
] as const;

export function MemberInviteModal({ isOpen, onClose }: Props) {
  const createInvite = useCreateMemberInvite();
  const pendingInvites = usePendingMemberInvites();
  const revokeInvite = useRevokeMemberInvite();

  const [note, setNote] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(168);
  const [createdInvite, setCreatedInvite] = useState<CreatedMemberInvite | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'msg' | null>(null);
  const [error, setError] = useState('');

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setCopiedType(null);

    try {
      const result = await createInvite.mutateAsync({
        note,
        expiresInHours,
      });
      setCreatedInvite(result);
      setNote('');
      toast.success('تم توليد رابط التسجيل المحمي بنجاح.');
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  const copyText = async (text: string, type: 'url' | 'msg') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      toast.success(type === 'url' ? 'تم نسخ الرابط.' : 'تم نسخ رسالة الدعوة الجاهزة.');
      window.setTimeout(() => setCopiedType(null), 2500);
    } catch {
      toast.error('معرفناش ننسخ تلقائياً — انسخ الرابط يدوياً من المربع.');
    }
  };

  const handleCopyInviteMessage = (invite: CreatedMemberInvite) => {
    const greeting = invite.note ? `أهلاً بك (${invite.note}) في فريق وصلة،` : 'أهلاً بك في فريق وصلة،';
    const message = [
      greeting,
      'ده رابط تسجيل محمي وخاص بيك عشان تسجّل بياناتك الكاملة في النظام بنفسك:',
      invite.url,
      'ملحوظة: الرابط ده صالح للاستخدام مرة واحدة فقط وبيقفل تلقائياً فور حفظ بياناتك.',
    ].join('\n\n');
    void copyText(message, 'msg');
  };

  const handleRevoke = async (id: number, mode: 'native' | 'fallback') => {
    try {
      await revokeInvite.mutateAsync({ id, mode });
      if (createdInvite?.id === id) {
        setCreatedInvite(null);
      }
      toast.success('تم إلغاء رابط الدعوة فوراً.');
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const activeList = pendingInvites.data ?? [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="رابط تسجيل عضو جديد (دعوة محمية)" maxWidth="lg">
      <div className="grid gap-4" dir="rtl">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]"
            aria-hidden="true"
          >
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0 text-xs leading-6 text-[var(--text-2)]">
            <p className="font-black text-[var(--text)]">كيف يعمل رابط التسجيل المحمي؟</p>
            <p>
              بدل إدخال بيانات العضو يدوياً، النظام يولّد رابطاً طويلاً وعشوائياً مشفراً تبعته للعضو الجديد.
              بمجرد أن يملأ العضو بياناته (بما فيها الحقول المخصصة مثل نوع الثانوية) ويضغط حفظ، يتم تسجيله في الفريق ويُقفل الرابط نهائياً بحيث لا يمكن استخدامه مرة ثانية.
            </p>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-bold text-red-900" role="alert">
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">
              ملاحظة أو اسم العضو المدعو (اختياري للتنظيم)
              <input
                type="text"
                placeholder="مثال: دعوة لـ أحمد محمد"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]">
              مدة صلاحية الرابط
              <select
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              isLoading={createInvite.isPending}
              loadingText="بنولّد الرابط المشفر..."
              icon={<KeyRound size={16} aria-hidden="true" />}
              fullOnMobile
            >
              توليد رابط تسجيل عشوائي محمي
            </Button>
          </div>
        </form>

        {createdInvite && (
          <div className="grid gap-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link2 size={18} className="text-[var(--link)]" aria-hidden="true" />
                <span className="text-sm font-black text-[var(--text)]">
                  الرابط الجاهز للإرسال {createdInvite.note ? `(${createdInvite.note})` : ''}
                </span>
              </div>
              <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">
                صالح لمرة واحدة حتى {formatDate(createdInvite.expires_at)}
              </span>
            </div>

            <div
              dir="ltr"
              className="max-h-24 overflow-y-auto break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)] select-all"
            >
              {createdInvite.url}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void copyText(createdInvite.url, 'url');
                }}
                icon={copiedType === 'url' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              >
                {copiedType === 'url' ? 'تم نسخ الرابط' : 'نسخ الرابط فقط'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleCopyInviteMessage(createdInvite)}
                icon={copiedType === 'msg' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              >
                {copiedType === 'msg' ? 'تم نسخ الرسالة' : 'نسخ رسالة دعوة جاهزة للواتساب'}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-[var(--text)]">
              روابط الدعوة النشطة بانتظار التسجيل ({activeList.length})
            </h4>
          </div>

          {pendingInvites.isLoading ? (
            <p className="py-3 text-center text-xs text-[var(--text-muted)]">بنحمّل الروابط النشطة...</p>
          ) : activeList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
              مفيش روابط دعوة معلقة حالياً. أي رابط تولّده هيظهر هنا لحد ما العضو يسجّل بيه أو تلغيه.
            </div>
          ) : (
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
              {activeList.map((item) => (
                <div
                  key={`${item.mode}-${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--text)]">
                      {item.note || 'دعوة عضو جديد (بدون ملاحظة)'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                      <Clock size={13} aria-hidden="true" />
                      <span>ينتهي في: {formatDate(item.expires_at)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRevoke(item.id, item.mode);
                    }}
                    disabled={revokeInvite.isPending}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--danger)] hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    إلغاء الرابط
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </Modal>
  );
}
