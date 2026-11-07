import { CheckCircle2, Gift, PartyPopper, Wallet } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { parseDeadline } from '../../lib/dateUtils';
import { arDaysPhrase, arDurationPhrase, formatSigned } from '../../lib/arabic';

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
  'برافو! كل تسليم في معاده بيقرّب الفريق من هدفه.',
  'التزامك بيفرق مع الفريق — شكرًا على مجهودك.',
  'إنجاز جميل — كمّل بنفس المستوى.',
  'خطوة ممتازة! سجل إنجازاتك بيكبر مع كل مهمة.',
  'تسليم موفق! فخورين بمجهودك.',
];

/** "قبل الموعد بيومين" — الباء تلتصق بالكلمة وتنفصل عن الرقم */
const withBa = (phrase: string) => (/^\d/.test(phrase) ? `بـ${phrase}` : `ب${phrase}`);

function timingLine(deadline: string | null, submittedAt: string): { text: string; onTime: boolean } | null {
  const due = parseDeadline(deadline);
  if (!due) return null;
  const diffHours = (due.getTime() - new Date(submittedAt).getTime()) / 3_600_000;
  if (diffHours < 0) {
    return { text: 'التسليم وصل بعد الموعد، والأهم إنك أنجزت — حاول تسبق الموعد المرة الجاية.', onTime: false };
  }
  const early = diffHours >= 24 ? arDaysPhrase(Math.floor(diffHours / 24)) : arDurationPhrase(diffHours);
  return { text: `سلّمت قبل الموعد النهائي ${withBa(early)} — التزام يستاهل التقدير.`, onTime: true };
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
  const line = celebration ? ENCOURAGEMENTS[Math.abs(celebration.taskId) % ENCOURAGEMENTS.length] : '';
  const timing = celebration ? timingLine(celebration.deadline, celebration.submittedAt) : null;
  const total = typeof totalBonus === 'number' ? totalBonus : null;
  const bonus = celebration?.bonus ?? 0;

  return (
    <Modal
      isOpen={Boolean(celebration)}
      onClose={onClose}
      title={celebration?.isResubmission ? 'اتعاد التسليم' : 'المهمة اتسلّمت'}
      subtitle={celebration?.taskTitle}
      icon={<CheckCircle2 size={20} />}
      maxWidth="md"
      footer={<Button onClick={onClose} className="w-full">تمام، شكرًا</Button>}
    >
      {celebration && (
        <div className="grid gap-4 text-center" aria-live="polite">
          <div className="grid justify-items-center gap-3 pt-1">
            <span className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-[var(--primary)] text-white shadow-[var(--shadow-md)] motion-safe:animate-[celebrate-pop_480ms_cubic-bezier(0.2,0.9,0.3,1.3)_both]" aria-hidden="true">
              <PartyPopper size={30} />
            </span>
            <div className="grid gap-1.5">
              <p className="text-xl font-black text-[var(--text)]">برافو يا {celebration.firstName}!</p>
              <p className="text-sm leading-7 text-[var(--text-2)]">{line}</p>
              {timing && (
                <p className={`text-xs font-bold leading-6 ${timing.onTime ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>{timing.text}</p>
              )}
            </div>
          </div>

          <div className={`grid gap-2 text-start ${bonus > 0 ? 'sm:grid-cols-2' : ''}`}>
            {bonus > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-200"><Gift size={14} aria-hidden="true" />بونص المهمة</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-amber-900 dark:text-amber-100">{formatSigned(bonus)}</p>
                <p className="text-xs leading-5 text-amber-800/80 dark:text-amber-200/80">هيتضاف لرصيدك أول ما الإدارة تعتمدها.</p>
              </div>
            )}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]"><Wallet size={14} aria-hidden="true" />إجمالي البونص دلوقتي</p>
              {totalLoading ? (
                <span className="mt-2 block h-7 w-16 animate-pulse rounded-md bg-[var(--surface-2)]" aria-label="بنحمّل الرصيد" />
              ) : total === null || bonusStateError ? (
                <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">معرفناش نحمّل الرصيد دلوقتي</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text)]">{bonusInfinite ? '∞' : formatSigned(total)}</p>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    {bonusInfinite ? 'بونصك غير محدود؛ يظل بونص المهمة الرقمية محفوظاً في سجلك عند اعتمادها.' : bonus > 0 ? `هيبقى ${formatSigned(total + bonus)} بعد ما الإدارة تعتمد المهمة دي.` : 'من تقييمات الإدارة والمهام اللي اتعتمدت.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <p className="text-xs leading-6 text-[var(--text-muted)]">الإدارة هتراجع تسليمك قريب، وهيجيلك إشعار لو محتاج تعديل.</p>
        </div>
      )}
    </Modal>
  );
}
