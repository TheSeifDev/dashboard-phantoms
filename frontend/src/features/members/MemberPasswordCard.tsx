import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, LockKeyhole, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';
import { MEMBER_PASSWORD_ACCESS_KEY, useMemberPasswordAccess } from '../auth/member-password-access';
import { changeMemberPassword, MemberPasswordChangeError } from '../auth/member-password-change-api';
import { memberPasswordRequirements, validateMemberPassword } from '../auth/member-password';

const FIELD_CLASS = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]';

/**
 * Self-service password change for a signed-in member. Works on the website and
 * inside the app, and is the required step after an administrator hands over a
 * temporary password.
 */
export function MemberPasswordCard() {
  const { t, dir } = useLocale();
  const cache = useQueryClient();
  const access = useMemberPasswordAccess();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const latch = useRef(false);
  const mustChange = access.data?.must_change_password === true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (latch.current) return;
    setError('');
    setSuccess(false);
    if (!currentPassword) {
      setError(t('اكتب كلمة المرور الحالية.', 'Enter your current password.'));
      return;
    }
    const validation = validateMemberPassword(newPassword, confirmPassword);
    if (!validation.ok) {
      setError(validation.code === 'PASSWORD_MISMATCH'
        ? t('كلمتا المرور الجديدتان غير متطابقتين.', 'The two new passwords do not match.')
        : t('كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل، وألا تتجاوز 72 بايتاً، وتحتوي على حرف إنجليزي ورقم.', 'The new password needs at least 12 characters, at most 72 bytes, one English letter and one digit.'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('كلمة المرور الجديدة لازم تكون مختلفة عن الحالية.', 'The new password must be different from the current one.'));
      return;
    }
    latch.current = true;
    setSaving(true);
    try {
      await changeMemberPassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
      await cache.invalidateQueries({ queryKey: MEMBER_PASSWORD_ACCESS_KEY });
    } catch (cause) {
      const code = cause instanceof MemberPasswordChangeError ? cause.code : 'SERVER_UNAVAILABLE';
      if (code === 'INVALID_CREDENTIALS') {
        setError(t('كلمة المرور الحالية غير صحيحة.', 'Your current password is incorrect.'));
      } else if (code === 'RATE_LIMITED') {
        setError(t('محاولات كثيرة. استنى دقيقة وجرّب تاني.', 'Too many attempts. Wait a minute and try again.'));
      } else if (cause instanceof MemberPasswordChangeError) {
        setError(cause.message);
      } else {
        setError(t('تعذر تغيير كلمة المرور. حاول مرة أخرى.', 'Could not change the password. Please try again.'));
      }
    } finally {
      latch.current = false;
      setSaving(false);
    }
  };

  return (
    <section id="password" aria-labelledby="member-password-title" dir={dir} className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true"><LockKeyhole size={18} /></span>
        <div className="min-w-0">
          <h2 id="member-password-title" className="text-sm font-black text-[var(--text)]">{t('أمان الحساب وكلمة المرور', 'Account security and password')}</h2>
          <p className="mt-0.5 text-xs leading-5 text-[var(--text-2)]">
            {t('غيّر كلمة المرور من هنا في أي وقت. لو الإدارة عيّنت لك كلمة مرور مؤقتة، لازم تغيّرها لكلمة خاصة بك.', 'Change your password here at any time. If an administrator set a temporary password, replace it with a personal one.')}
          </p>
        </div>
      </div>

      {mustChange && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="status">
          <TriangleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('أنت داخل بكلمة مرور مؤقتة. اكتبها في «كلمة المرور الحالية» واختار كلمة مرور جديدة وأكّدها.', 'You are signed in with a temporary password. Enter it as the current password, then choose and confirm a new one.')}</span>
        </div>
      )}

      <form onSubmit={(event) => { void submit(event); }} className="grid gap-3" noValidate aria-busy={saving || undefined}>
        <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-password-current">
          {t('كلمة المرور الحالية', 'Current password')}
          <input id="member-password-current" type="password" dir="ltr" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(''); setSuccess(false); }} className={FIELD_CLASS} disabled={saving} />
        </label>
        <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-password-new">
          {t('كلمة المرور الجديدة', 'New password')}
          <input id="member-password-new" type="password" dir="ltr" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(''); setSuccess(false); }} className={FIELD_CLASS} disabled={saving} aria-describedby="member-password-rules" />
        </label>
        <label className="grid gap-1.5 text-xs font-bold text-[var(--text-2)]" htmlFor="member-password-confirm">
          {t('تأكيد كلمة المرور الجديدة', 'Confirm new password')}
          <input id="member-password-confirm" type="password" dir="ltr" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); setSuccess(false); }} className={FIELD_CLASS} disabled={saving} />
        </label>
        <ul id="member-password-rules" className="m-0 grid gap-1 ps-5 text-[11px] font-normal leading-5 text-[var(--text-muted)]">
          {memberPasswordRequirements().map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
        {error && <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] p-2.5 text-xs font-bold text-[var(--danger-text)]" role="alert">{error}</p>}
        {success && (
          <p className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] p-2.5 text-xs font-bold text-[var(--text)]" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t('تم تغيير كلمة المرور. استخدم كلمة المرور الجديدة في المرة القادمة على الموقع أو التطبيق.', 'Password changed. Use the new password next time on the website or the app.')}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" isLoading={saving} loadingText={t('بنغيّر كلمة المرور...', 'Changing password...')} icon={<KeyRound size={16} aria-hidden="true" />}>
            {t('تغيير كلمة المرور', 'Change password')}
          </Button>
        </div>
      </form>
    </section>
  );
}
