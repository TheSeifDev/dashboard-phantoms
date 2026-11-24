import { useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import { useSetMemberPassword, type MemberPasswordResetResult } from '../../members/memberInviteApi';
import type { AdminAccount } from '../../../types/db';

interface Props {
  isOpen: boolean;
  account: AdminAccount | null;
  onClose: () => void;
}

/**
 * تصفير كلمة مرور حساب مشرف — بيستخدم نفس مسار تعيين كلمة المرور المؤقتة
 * للعضو (binding موجود للمشرف)، وبيرجع كلمة مرور مؤقتة تتغيّر عند أول دخول.
 */
export function AdminPasswordResetModal({ isOpen, account, onClose }: Props) {
  const { t, dir } = useLocale();
  const reset = useSetMemberPassword();
  const [result, setResult] = useState<MemberPasswordResetResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setError('');
    }
  }, [isOpen]);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [account?.user_id]);

  const submit = async () => {
    if (!account?.member_id) return;
    setError('');
    try {
      const applied = await reset.mutateAsync(account.member_id);
      setResult(applied);
      toast.success(t('اتعينت كلمة مرور مؤقتة للمشرف.', 'A temporary password was set for the administrator.'));
    } catch (cause) {
      setError(toAppError(cause, t('معرفناش نعين كلمة المرور.', 'Could not set the password.')).message);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      toast.success(t('اتنسخت كلمة المرور.', 'Password copied.'));
    } catch {
      toast.error(t('معرفناش ننسخ. انسخها يدوي.', 'Could not copy. Please copy it manually.'));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('إعادة تعيين كلمة المرور', 'Reset password')}
      subtitle={account?.email ?? ''}
      icon={<KeyRound size={20} />}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t('إغلاق', 'Close')}</Button>
          {!result && (
            <Button
              type="button"
              icon={<KeyRound size={17} />}
              isLoading={reset.isPending}
              loadingText={t('بنعين…', 'Setting…')}
              disabled={!account?.member_id}
              onClick={() => void submit()}
            >
              {t('تعيين كلمة مرور مؤقتة', 'Set temporary password')}
            </Button>
          )}
        </>
      )}
    >
      <div className="grid gap-4" dir={dir}>
        {!account?.member_id && (
          <p className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-sm leading-6 text-[var(--warning-text)]">
            {t('الحساب ده مش مربوط بسجل عضو، فمفيش كلمة مرور نقدر نعيد تعيينها من هنا. اربطه بعضو الأول.', 'This account is not linked to a member record, so there is no password to reset here. Link it to a member first.')}
          </p>
        )}

        {!result && account?.member_id && (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-6">
            {t('هنتعيّن كلمة مرور مؤقتة، والمشرف هيتطلب منه يغيّرها أول ما يدخل.', 'A temporary password will be set, and the administrator must change it on next sign-in.')}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm leading-6 text-[var(--danger-text)]">
            {error}
          </p>
        )}

        {result && (
          <div className="grid gap-3">
            <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-soft)] p-4">
              <p className="text-xs font-bold text-[var(--success-text)]">{t('كلمة المرور المؤقتة', 'Temporary password')}</p>
              <p className="mt-1 break-all font-mono text-lg font-extrabold tracking-wide text-[var(--text)]" dir="ltr">{result.temporaryPassword}</p>
            </div>
            <Button type="button" variant="secondary" icon={<Copy size={16} />} onClick={() => void copy()}>
              {t('انسخ كلمة المرور', 'Copy password')}
            </Button>
            <p className="flex items-start gap-2 text-xs leading-6 text-[var(--text-muted)]">
              <ShieldAlert size={15} className="mt-1 shrink-0" aria-hidden="true" />
              {t('بلّغ المشرف بكلمة المرور في قناة خاصة، وهو ملزم بتغييرها بعد الدخول.', 'Share the password privately; the administrator must change it after signing in.')}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
