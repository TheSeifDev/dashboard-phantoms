import { CheckCircle2, Gift, PartyPopper, Wallet } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { parseDeadline } from '../../lib/dateUtils';
import { arDaysPhrase, arDurationPhrase, formatSigned } from '../../lib/arabic';
import { useLocale } from '../../i18n/useLocale';

export interface SubmissionCelebration {
  taskId: number;
  taskTitle: string;
  firstName: string;
  bonus: number;
  deadline: string | null;
  submittedAt: string;
  isResubmission: boolean;
}

const ENCOURAGEMENTS = [
  { ar: 'برافو! كل تسليم في معاده بيقرّب الفريق من هدفه.', en: 'Great work! Every on-time submission moves the team closer to its goal.' },
  { ar: 'التزامك بيفرق مع الفريق — شكرًا على مجهودك.', en: 'Your commitment makes a difference to the team — thank you for your effort.' },
  { ar: 'إنجاز جميل — كمّل بنفس المستوى.', en: 'A great achievement — keep up the same standard.' },
  { ar: 'خطوة ممتازة! سجل إنجازاتك بيكبر مع كل مهمة.', en: 'Excellent progress! Your record grows with every task.' },
  { ar: 'تسليم موفق! فخورين بمجهودك.', en: 'Submission received! We are proud of your work.' },
];

/** "قبل الموعد بيومين" — الباء تلتصق بالكلمة وتنفصل عن الرقم */
const withBa = (phrase: string) => (/^\d/.test(phrase) ? `بـ${phrase}` : `ب${phrase}`);

type Translate = (arabic: string, english: string) => string;
type FormatNumber = (value: number) => string;

function timingLine(deadline: string | null, submittedAt: string, locale: 'ar' | 'en', t: Translate, number: FormatNumber): { text: string; onTime: boolean } | null {
  const due = parseDeadline(deadline);
  if (!due) return null;
  const diffHours = (due.getTime() - new Date(submittedAt).getTime()) / 3_600_000;
  if (diffHours < 0) {
    return { text: t('التسليم وصل بعد الموعد، والأهم إنك أنجزت — حاول تسبق الموعد المرة الجاية.', 'This was submitted after the deadline, but completing it matters — try to get ahead next time.'), onTime: false };
  }
  const amount = diffHours >= 24 ? Math.floor(diffHours / 24) : Math.max(1, Math.floor(diffHours));
  const early = locale === 'ar'
    ? withBa(diffHours >= 24 ? arDaysPhrase(amount) : arDurationPhrase(diffHours))
    : `${number(amount)} ${diffHours >= 24 ? (amount === 1 ? 'day' : 'days') : (amount === 1 ? 'hour' : 'hours')}`;
  const text = locale === 'ar'
    ? `سلّمت قبل الموعد النهائي ${early} — التزام يستاهل التقدير.`
    : `Submitted ${early} before the deadline — great commitment.`;
  return { text, onTime: true };
}

export function SubmissionSuccessModal({
  celebration,
  totalBonus,
  bonusInfinite,
  bonusStateError,
  totalLoading,
  onClose,
}: {
  celebration: SubmissionCelebration | null;
  totalBonus: number | null | undefined;
  bonusInfinite: boolean;
  bonusStateError: boolean;
  totalLoading: boolean;
  onClose: () => void;
}) {
  const { t, locale, dir, number } = useLocale();
  const encouragement = celebration ? ENCOURAGEMENTS[Math.abs(celebration.taskId) % ENCOURAGEMENTS.length] : null;
  const line = encouragement ? t(encouragement.ar, encouragement.en) : '';
  const timing = celebration ? timingLine(celebration.deadline, celebration.submittedAt, locale, t, number) : null;
  const total = typeof totalBonus === 'number' ? totalBonus : null;
  const bonus = celebration?.bonus ?? 0;

  return (
    <Modal
      isOpen={Boolean(celebration)}
      onClose={onClose}
      title={celebration?.isResubmission ? t('اتعاد التسليم', 'Task resubmitted') : t('المهمة اتسلّمت', 'Task submitted')}
      subtitle={celebration?.taskTitle}
      icon={<CheckCircle2 size={20} />}
      maxWidth="md"
      footer={<Button onClick={onClose} className="w-full">{t('تمام، شكرًا', 'Done, thanks')}</Button>}
    >
      {celebration && (
        <div dir={dir} className="grid gap-4 text-center" aria-live="polite">
          <div className="grid justify-items-center gap-3 pt-1">
            <span className="grid size-16 place-items-center rounded-full bg-[var(--primary)] text-white shadow-[var(--shadow-md)] motion-safe:animate-[celebrate-pop_480ms_cubic-bezier(0.2,0.9,0.3,1.3)_both]" aria-hidden="true">
              <PartyPopper size={30} />
            </span>
            <div className="grid gap-1.5">
              <p className="text-xl font-black text-[var(--text)]">{t(`برافو يا ${celebration.firstName}!`, `Well done, ${celebration.firstName}!`)}</p>
              <p className="text-sm leading-7 text-[var(--text-2)]">{line}</p>
              {timing && (
                <p className={`text-xs font-bold leading-6 ${timing.onTime ? 'text-[var(--success-text)] dark:text-[var(--success-text)]' : 'text-amber-800 dark:text-amber-300'}`}>{timing.text}</p>
              )}
            </div>
          </div>

          <div className={`grid gap-2 text-start ${bonus > 0 ? 'sm:grid-cols-2' : ''}`}>
            {bonus > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-200"><Gift size={14} aria-hidden="true" />{t('بونص المهمة', 'Task bonus')}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-amber-900 dark:text-amber-100">{formatSigned(bonus)}</p>
                <p className="text-xs leading-5 text-amber-800/80 dark:text-amber-200/80">{t('هيتضاف لرصيدك أول ما الإدارة تعتمدها.', 'It will be added to your balance when the administration approves the task.')}</p>
              </div>
            )}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]"><Wallet size={14} aria-hidden="true" />{t('إجمالي البونص دلوقتي', 'Current bonus balance')}</p>
              {totalLoading ? (
                <span className="mt-2 block h-7 w-16 animate-pulse rounded-md bg-[var(--surface-2)]" aria-label={t('بنحمّل الرصيد', 'Loading balance')} />
              ) : total === null || bonusStateError ? (
                <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">{t('معرفناش نحمّل الرصيد دلوقتي', 'We could not load your balance right now')}</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text)]">{bonusInfinite ? '∞' : formatSigned(total)}</p>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    {bonusInfinite ? t('بونصك غير محدود؛ يظل بونص المهمة الرقمية محفوظاً في سجلك عند اعتمادها.', 'Your bonus is unlimited; this task bonus will still be recorded when approved.') : bonus > 0 ? t(`هيبقى ${formatSigned(total + bonus)} بعد ما الإدارة تعتمد المهمة دي.`, `Your balance will be ${formatSigned(total + bonus)} after the administration approves this task.`) : t('من تقييمات الإدارة والمهام اللي اتعتمدت.', 'Earned through approved tasks and administration evaluations.')}
                  </p>
                </>
              )}
            </div>
          </div>

          <p className="text-xs leading-6 text-[var(--text-muted)]">{t('الإدارة هتراجع تسليمك قريب، وهيجيلك إشعار لو محتاج تعديل.', 'The administration will review your submission soon and notify you if revisions are needed.')}</p>
        </div>
      )}
    </Modal>
  );
}
