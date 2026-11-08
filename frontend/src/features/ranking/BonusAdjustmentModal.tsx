import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Award, Plus, Minus, AlertCircle } from 'lucide-react';
import type { Member } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCreateMemberRating, useSetMemberInfiniteBonus } from './api';

interface BonusAdjustmentModalProps {
  isOpen: boolean;
  member: Member | null;
  members: Member[];
  canRecordRatings: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BonusAdjustmentModal({ isOpen, member, members, canRecordRatings, onClose, onSuccess }: BonusAdjustmentModalProps) {
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
      setError('يلزم امتلاك صلاحية ترتيب الفريق لتسجيل التقييم.');
      return;
    }
    if (mode === 'infinite') {
      if (reason.trim().length < 3) {
        setError('اكتب سبباً من 3 أحرف على الأقل عشان يتسجل في سجل التغييرات.');
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
        setError(cause instanceof Error ? cause.message : 'معرفناش نحدّث حالة البونص غير المحدود.');
      }
      return;
    }

    if (!reason.trim()) {
      setError('اكتب سبب التقييم عشان نوثّق الملاحظة في السجل.');
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
      setError(cause instanceof Error ? cause.message : 'معرفناش نسجل نقاط التقييم.');
    }
  };

  const positiveOptions = [1, 2, 3, 4, 5];
  const negativeOptions = [-1, -2, -3, -4, -5];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تقييم العضو والبونص" maxWidth="md">
      <form onSubmit={handleSubmit} className="grid gap-4 text-start" dir="rtl">
        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100" role="alert">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}

        {/* Member selector + preview header */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          العضو المطلوب تقييمه
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
              تقييم رقمي
            </button>
            <button type="button" onClick={() => { setMode('infinite'); setReason(''); setError(''); }} aria-pressed={mode === 'infinite'} className={`min-h-11 rounded-lg px-3 text-sm font-black ${mode === 'infinite' ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
              بونص ∞
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm leading-6 text-[var(--text-muted)]">
            صلاحية ترتيب الفريق تتيح إدارة علامة ∞. تسجيل التقييم الرقمي يتطلب نفس الصلاحية.
          </p>
        )}

        {mode === 'rating' ? <>
        {/* Bonus selection */}
        <div>
          <label className="block text-sm font-bold text-[var(--text)] mb-2">
            قيمة التقييم اللي هتتضاف أو تتخصم
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
                0 — توثيق من غير نقاط
              </button>
            </div>
            {/* Positive Options */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 ms-1">
                <Plus size={13} /> إضافة:
              </span>
              {positiveOptions.map((val) => (
                <button
                  type="button"
                  key={`pos-${val}`}
                  onClick={() => setPoints(val)}
                  className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${
                    points === val
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-emerald-400'
                  }`}
                >
                  +{val}
                </button>
              ))}
            </div>

            {/* Negative Options */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1 ms-1">
                <Minus size={13} /> خصم:
              </span>
              {negativeOptions.map((val) => (
                <button
                  type="button"
                  key={`neg-${val}`}
                  onClick={() => setPoints(val)}
                  className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${
                    points === val
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-red-400'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1">
            <Award size={14} className="text-[var(--primary)]" />
            <span>
              {points === 0 ? (
                <>توثيق ملاحظة من غير نقاط (الترتيب مش هيتأثر)</>
              ) : (
                <>القيمة اللي اخترتها: <b className={points > 0 ? 'text-emerald-600' : 'text-red-600'}>{points > 0 ? `+${points}` : points} نقطة</b> (هيتسجل الوسم {points > 0 ? `[B:+${points}]` : `[B:${points}]`})</>
              )}
            </span>
          </div>
        </div>

        {/* Reason / Note text */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          سبب التقييم والملاحظة المسجلة *
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: التزام ممتاز بتسليم المهمة قبل الموعد، أو تفاعل كويس في الاجتماع..."
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed"
          />
        </label>

        {/* Author */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          اسم المسؤول / الكاتب
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
        </> : <>
          <div className={`grid gap-1 rounded-xl border p-3 text-sm ${selectedMember.bonus_infinite ? 'border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'}`}>
            <strong>{selectedMember.bonus_infinite ? 'البونص غير المحدود مفعّل ∞' : 'البونص غير المحدود غير مفعّل'}</strong>
            <span className="leading-6">{selectedMember.bonus_infinite ? 'إلغاء العلامة يرجّع عرض رصيد النقاط المسجلة كما هو، من غير حذف أو خصم.' : 'تفعيل العلامة يضع العضو فوق كل الأرصدة الرقمية. نقاطه الحالية تظل محفوظة.'}</span>
          </div>
          <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
            سبب {selectedMember.bonus_infinite ? 'الإلغاء' : 'التفعيل'} *
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="اكتب سبب التفعيل أو الإلغاء؛ هيتحفظ باسم حسابك ووقت الإجراء."
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed"
            />
          </label>
        </>}

        {/* Form Actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile className="min-h-11">
            إلغاء
          </Button>
          <Button type="submit" variant={mode === 'infinite' && selectedMember.bonus_infinite ? 'danger' : 'primary'} isLoading={createRating.isPending || setInfiniteBonus.isPending} loadingText="بنسجل..." fullOnMobile className="min-h-11">
            {mode === 'infinite' ? (selectedMember.bonus_infinite ? 'إلغاء بونص ∞' : 'تفعيل بونص ∞') : 'حفظ التقييم والملاحظة'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
