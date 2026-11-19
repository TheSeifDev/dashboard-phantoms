import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Award, Plus, Minus, AlertCircle } from 'lucide-react';
import type { Member } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCreateMemberRating, useSetMemberInfiniteBonus } from './api';

import { useLocale } from '../../i18n/useLocale';
interface BonusAdjustmentModalProps {
  isOpen: boolean;
  member: Member | null;
  members: Member[];
  canRecordRatings: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BonusAdjustmentModal({ isOpen, member, members, canRecordRatings, onClose, onSuccess }: BonusAdjustmentModalProps) {
  const { t, dir, number } = useLocale();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [points, setPoints] = useState<number>(1);
  const [mode, setMode] = useState<'rating' | 'infinite'>('rating');
  const [reason, setReason] = useState<string>('');
  const [author, setAuthor] = useState<string>('إدارة PHANTOMS');
  const [error, setError] = useState<string>('');
  const createRating = useCreateMemberRating();
  const setInfiniteBonus = useSetMemberInfiniteBonus();

  // مزامنة العضو المختار مع كل فتح (القادم من الجدول/المنصة أو الافتراضي)
  useEffect(() => {
    if (isOpen) {
      setSelectedId(member?.id ?? members[0]?.id ?? null);
      setMode(member?.bonus_infinite || !canRecordRatings ? 'infinite' : 'rating');
      setPoints(1);
      setReason('');
      setError('');
    }
  }, [isOpen, member, members, canRecordRatings]);

  const selectedMember = members.find((m) => m.id === selectedId) ?? member ?? null;
  if (!selectedMember) return null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mode === 'rating' && !canRecordRatings) {
      setError(t('يلزم امتلاك صلاحية ترتيب الفريق لتسجيل التقييم.', 'Team ranking permission is required to record a rating.'));
      return;
    }
    if (mode === 'infinite') {
      if (reason.trim().length < 3) {
        setError(t('اكتب سبباً من 3 أحرف على الأقل عشان يتسجل في سجل التغييرات.', 'Enter a reason of at least 3 characters so it can be recorded in the change log.'));
        return;
      }
      try {
        setError('');
        await setInfiniteBonus.mutateAsync({
          memberId: selectedMember.id,
          enabled: selectedMember.bonus_infinite !== true,
          reason: reason.trim(),
        });
        setReason('');
        onSuccess?.();
        onClose();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('معرفناش نحدّث حالة البونص غير المحدود.', 'Could not update the unlimited bonus status.'));
      }
      return;
    }

    if (!reason.trim()) {
      setError(t('اكتب سبب التقييم عشان نوثّق الملاحظة في السجل.', 'Enter a rating reason so the note can be recorded in the log.'));
      return;
    }

    try {
      setError('');
      await createRating.mutateAsync({
        memberId: selectedMember.id,
        points,
        reason: reason.trim(),
        author: author.trim() || 'إدارة PHANTOMS',
      });
      setReason('');
      setPoints(1);
      onSuccess?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('معرفناش نسجل نقاط التقييم.', 'Could not record the rating points.'));
    }
  };

  const positiveOptions = [1, 2, 3, 4, 5];
  const negativeOptions = [-1, -2, -3, -4, -5];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("تقييم العضو والبونص", "Member evaluation and bonus")} maxWidth="md">
      <form onSubmit={handleSubmit} className="grid gap-4 text-start" dir={dir}>
        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]" role="alert">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}

        {/* Member selector + preview header */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          {t('العضو المطلوب تقييمه', 'Member to evaluate')}
          <select
            value={selectedMember.id}
            onChange={(event) => {
              setSelectedId(Number(event.target.value));
              setReason('');
              setError('');
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--primary)] text-white font-black text-base">
            {selectedMember.full_name.charAt(0)}
          </div>
          <div>
            <div className="font-black text-sm text-[var(--text)]">{selectedMember.full_name}</div>
            <div className="text-xs text-[var(--text-muted)]" dir="ltr">{selectedMember.email}</div>
          </div>
        </div>

        {canRecordRatings ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-2)] p-1">
            <button type="button" onClick={() => { setMode('rating'); setReason(''); setError(''); }} aria-pressed={mode === 'rating'} className={`min-h-11 rounded-lg px-3 text-sm font-black ${mode === 'rating' ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
              {t('تقييم رقمي', 'Numeric rating')}
            </button>
            <button type="button" onClick={() => { setMode('infinite'); setReason(''); setError(''); }} aria-pressed={mode === 'infinite'} className={`min-h-11 rounded-lg px-3 text-sm font-black ${mode === 'infinite' ? 'bg-[var(--surface)] text-[var(--primary-ink)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
              {t('بونص ∞', 'Infinite bonus ∞')}
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm leading-6 text-[var(--text-muted)]">
            {t('صلاحية ترتيب الفريق تتيح إدارة علامة ∞. تسجيل التقييم الرقمي يتطلب نفس الصلاحية.', 'Team ranking permission allows managing the ∞ marker. Recording a numeric rating requires the same permission.')}
          </p>
        )}

        {mode === 'rating' ? <>
        {/* Bonus selection */}
        <div>
          <label className="block text-sm font-bold text-[var(--text)] mb-2">
            {t('قيمة التقييم اللي هتتضاف أو تتخصم', 'Rating value to add or subtract')}
          </label>
          <div className="grid gap-2">
            {/* Zero (document only) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPoints(0)}
                className={`min-h-11 px-3 rounded-xl text-sm font-black transition-colors ${
                  points === 0
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)]'
                }`}
              >
                {t('0 — توثيق من غير نقاط', '0 — Log without points')}
              </button>
            </div>
            {/* Positive Options */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-[var(--success-text)] dark:text-[var(--success-text)] flex items-center gap-1 ms-1">
                <Plus size={13} /> {t('إضافة:', 'Add:')}
              </span>
              {positiveOptions.map((val) => (
                <button
                  type="button"
                  key={`pos-${val}`}
                  onClick={() => setPoints(val)}
                  className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${
                    points === val
                      ? 'bg-[var(--success)] text-[var(--on-success)] shadow-sm'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--success-border)]'
                  }`}
                >
                  +{number(val)}
                </button>
              ))}
            </div>

            {/* Negative Options */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-[var(--danger-text)] dark:text-[var(--danger-text)] flex items-center gap-1 ms-1">
                <Minus size={13} /> {t('خصم:', 'Subtract:')}
              </span>
              {negativeOptions.map((val) => (
                <button
                  type="button"
                  key={`neg-${val}`}
                  onClick={() => setPoints(val)}
                  className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${
                    points === val
                      ? 'bg-[var(--danger)] text-[var(--on-danger)] shadow-sm'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--danger-border)]'
                  }`}
                >
                  {number(val)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1">
            <Award size={14} className="text-[var(--primary-ink)]" />
            <span>
              {points === 0 ? (
                <>{t('توثيق ملاحظة من غير نقاط (الترتيب مش هيتأثر)', 'Log a note without points (ranking will not be affected)')}</>
              ) : (
                <>{t('القيمة اللي اخترتها:', 'Selected value:')} <b className={points > 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}>{points > 0 ? `+${number(points)}` : number(points)} {t('نقطة', 'points')}</b> {t('(هيتسجل الوسم', '(the recorded tag will be')} {points > 0 ? `[B:+${points}]` : `[B:${points}]`})</>
              )}
            </span>
          </div>
        </div>

        {/* Reason / Note text */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          {t("سبب التقييم والملاحظة المسجلة *", "Evaluation reason and note *")}
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          placeholder={t('مثال: التزام ممتاز بتسليم المهمة قبل الموعد، أو تفاعل كويس في الاجتماع...', 'Example: excellent commitment to submitting a task before the deadline, or good engagement in a meeting...')}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed"
          />
        </label>

        {/* Author */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          {t('اسم المسؤول / الكاتب', 'Administrator / author name')}
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
        </> : <>
          <div className={`grid gap-1 rounded-xl border p-3 text-sm ${selectedMember.bonus_infinite ? 'border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary-ink)]' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'}`}>
            <strong>{selectedMember.bonus_infinite ? t('البونص غير المحدود مفعّل ∞', 'Unlimited bonus is enabled ∞') : t('البونص غير المحدود غير مفعّل', 'Unlimited bonus is not enabled')}</strong>
            <span className="leading-6">{selectedMember.bonus_infinite ? t('إلغاء العلامة يرجّع عرض رصيد النقاط المسجلة كما هو، من غير حذف أو خصم.', 'Removing the marker restores the recorded points balance display as-is, without deleting or subtracting points.') : t('تفعيل العلامة يضع العضو فوق كل الأرصدة الرقمية. نقاطه الحالية تظل محفوظة.', 'Enabling the marker places the member above all numeric balances. Their current points remain saved.')}</span>
          </div>
          <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
            {selectedMember.bonus_infinite ? t('سبب الإلغاء *', 'Reason for disabling *') : t('سبب التفعيل *', 'Reason for enabling *')}
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('اكتب سبب التفعيل أو الإلغاء؛ هيتحفظ باسم حسابك ووقت الإجراء.', 'Enter a reason for enabling or disabling; it will be saved with your account name and the action time.')}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed"
            />
          </label>
        </>}

        {/* Form Actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile className="min-h-11">
            {t('إلغاء', 'Cancel')}
          </Button>
          <Button type="submit" variant={mode === 'infinite' && selectedMember.bonus_infinite ? 'danger' : 'primary'} isLoading={createRating.isPending || setInfiniteBonus.isPending} loadingText={t('بنسجل...', 'Saving...')} fullOnMobile className="min-h-11">
            {mode === 'infinite' ? (selectedMember.bonus_infinite ? t('إلغاء بونص ∞', 'Disable bonus ∞') : t('تفعيل بونص ∞', 'Enable bonus ∞')) : t('حفظ التقييم والملاحظة', 'Save rating and note')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
