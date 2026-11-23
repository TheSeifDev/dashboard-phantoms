import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, MessageCircle, ShieldAlert, UserRound } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import type { Member } from '../../types/db';
import { useSetMemberPassword, type MemberPasswordResetResult } from './memberInviteApi';

interface Props {
  isOpen: boolean;
  member: Member | null;
  onClose: () => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
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
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      fallback.remove();
    }
  }
}

/**
 * An administrator sets a working password immediately (no invitation link),
 * tells the member they can sign in, and the member chooses a personal password
 * from inside the portal or the app afterwards.
 */
export function MemberPasswordResetModal({ isOpen, member, onClose }: Props) {
  const { t, dir } = useLocale();
  const reset = useSetMemberPassword();
  const [result, setResult] = useState<MemberPasswordResetResult | null>(null);
  const [copied, setCopied] = useState<'password' | 'message' | null>(null);
  const [error, setError] = useState('');
  const visibleRef = useRef(isOpen);
  const busyRef = useRef(false);
  const memberKey = member ? `${member.id}:${member.email}` : '';

  useEffect(() => {
    visibleRef.current = isOpen;
    if (!isOpen) {
      setResult(null);
      setCopied(null);
      setError('');
    }
    return () => { visibleRef.current = false; };
  }, [isOpen]);

  useEffect(() => {
    setResult(null);
    setCopied(null);
    setError('');
  }, [memberKey]);

  const submit = async () => {
    if (!member || busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      const applied = await reset.mutateAsync(member.id);
      if (!visibleRef.current) return;
      setResult(applied);
      toast.success(t('تم تعيين كلمة المرور المؤقتة. بلّغ العضو إنه يقدر يدخل الآن.', 'The temporary password is set. Tell the member they can sign in now.'));
    } catch (cause) {
      if (!visibleRef.current) return;
      setError(cause instanceof Error && cause.message
        ? cause.message
        : t('تعذر تعيين كلمة المرور. راجع صلاحياتك وحاول مرة أخرى.', 'Could not set the password. Check your permissions and try again.'));
    } finally {
      busyRef.current = false;
    }
  };

  const handleCopy = async (text: string, type: 'password' | 'message') => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      toast.error(t('تعذر النسخ تلقائياً؛ حدّد النص وانسخه يدوياً.', 'Could not copy automatically; select the text and copy it manually.'));
      return;
    }
    setCopied(type);
    toast.success(type === 'password' ? t('تم نسخ كلمة المرور.', 'Password copied.') : t('تم نسخ الرسالة.', 'Message copied.'));
    window.setTimeout(() => setCopied(null), 2500);
  };

  const messageFor = (value: MemberPasswordResetResult): string => {
    const name = (member?.full_name ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 100);
    const greeting = name ? t(`أهلًا يا ${name}،`, `Hello ${name},`) : t('أهلًا،', 'Hello,');
    return [
      greeting,
      t(
        `تم تعيين كلمة مرور مؤقتة لحسابك على منصة PHANTOMS: ${value.temporaryPassword}`,
        `A temporary password has been set for your PHANTOMS account: ${value.temporaryPassword}`,
      ),
      t(
        `ادخل من الموقع أو التطبيق بالبريد ${value.email} وكلمة المرور دي.`,
        `Sign in on the website or the app with ${value.email} and this password.`,
      ),
      t(
        'بعد الدخول افتح «الإعدادات» ← «أمان الحساب» وغيّر كلمة المرور: اكتب الحالية ثم الجديدة وأكّدها.',
        'After signing in, open Settings → Account security and change it: enter the current one, then the new password twice.',
      ),
    ].join('\n');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('إعادة تعيين كلمة المرور', 'Reset member password')} maxWidth="md">
      <div className="grid gap-4" dir={dir}>
        {member && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><UserRound size={20} /></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[var(--text)]">{member.full_name}</p>
              <p className="truncate text-xs text-[var(--text-2)]" dir="ltr">{member.email}</p>
            </div>
          </div>
        )}

        {!result && (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{t(
                'هيتم تعيين كلمة مرور مؤقتة 123456789 فوراً، وكلمة المرور القديمة هتتوقف. بلّغ العضو إنه يقدر يدخل بيها من الموقع أو التطبيق، وبعد الدخول هيغيّرها لكلمة مرور خاصة بيه ويأكدها.',
                'The temporary password 123456789 is applied immediately and the old password stops working. Tell the member they can sign in with it on the website or the app, then choose and confirm a personal password.',
              )}</p>
            </div>
            {error && <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
              <Button
                type="button"
                onClick={() => { void submit(); }}
                isLoading={reset.isPending}
                loadingText={t('بنعيّن كلمة المرور...', 'Setting the password...')}
                icon={<KeyRound size={16} aria-hidden="true" />}
              >
                {t('تعيين كلمة المرور 123456789', 'Set password 123456789')}
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className="grid gap-3 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)] p-4">
            <p className="text-sm font-black text-[var(--text)]">{t('تم تعيين كلمة المرور المؤقتة', 'Temporary password set')}</p>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
              <p className="text-[11px] font-bold text-[var(--text-muted)]">{t('كلمة المرور المؤقتة', 'Temporary password')}</p>
              <p dir="ltr" className="mt-1 font-mono text-2xl font-black tracking-widest text-[var(--text)] select-all">{result.temporaryPassword}</p>
              <p dir="ltr" className="mt-1 break-all text-xs text-[var(--text-2)]">{result.email}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" onClick={() => { void handleCopy(result.temporaryPassword, 'password'); }} icon={copied === 'password' ? <Check size={16} /> : <Copy size={16} />}>
                {copied === 'password' ? t('تم نسخ كلمة المرور', 'Password copied') : t('نسخ كلمة المرور', 'Copy password')}
              </Button>
              <Button type="button" onClick={() => { void handleCopy(messageFor(result), 'message'); }} icon={copied === 'message' ? <Check size={16} /> : <MessageCircle size={16} />}>
                {copied === 'message' ? t('تم نسخ الرسالة', 'Message copied') : t('نسخ رسالة للعضو', 'Copy message for the member')}
              </Button>
            </div>
            <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-password-message">
              {t('نص الرسالة (واتساب أو أي تطبيق)', 'Message text (WhatsApp or any app)')}
              <textarea id="member-password-message" dir="auto" rows={6} readOnly value={messageFor(result)} onFocus={(event) => event.currentTarget.select()} className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-normal leading-6 text-[var(--text)]" />
            </label>
            <p className="text-xs leading-5 text-[var(--text-2)]">{t('العضو هيتطلب منه يغيّر كلمة المرور دي من جوه الموقع أو التطبيق بعد أول دخول.', 'The member is asked to replace this password from inside the website or the app after the first sign-in.')}</p>
            <div className="flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>{t('تم', 'Done')}</Button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
