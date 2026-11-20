import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Award, Check, Minus, Plus, Search, Users } from 'lucide-react';
import type { Member } from '../../types/db';
import {
  EVALUATION_GRADE_LABELS,
  useCreateEvaluations,
} from './api';
import type { EvaluationGrade } from './api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { sendPushNotification } from '../../lib/api/push';
import { useLocale } from '../../i18n/useLocale';

interface Props {
  isOpen: boolean;
  members: Member[];
  preselectedMemberId?: number | null;
  onClose: () => void;
}

const TITLE_PRESETS = [
  'تقييم الأداء الأسبوعي',
  'تقييم جودة تسليم المهام',
  'تقييم الالتزام والاجتماعات',
  'تقييم التعاون والمبادرة',
] as const;
const TITLE_PRESET_ENGLISH = [
  'Weekly performance review',
  'Task delivery quality review',
  'Commitment and meetings review',
  'Collaboration and initiative review',
] as const;

const GRADES_ORDER: EvaluationGrade[] = [
  'excellent',
  'very_good',
  'good',
  'needs_improvement',
  'warning',
];
const GRADE_LABELS_ENGLISH: Record<EvaluationGrade, string> = {
  excellent: 'Excellent',
  very_good: 'Very good',
  good: 'Good',
  needs_improvement: 'Needs improvement',
  warning: 'Notice',
};

const POSITIVE_POINTS = [1, 2, 3, 5, 10] as const;
const NEGATIVE_POINTS = [-1, -2, -3, -5] as const;
const focusStyle = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]';

export function EvaluationCreateModal({
  isOpen,
  members,
  preselectedMemberId,
  onClose,
}: Props) {
  const { t, number, dir } = useLocale();
  const createEvaluations = useCreateEvaluations();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [title, setTitle] = useState('تقييم الأداء الأسبوعي');
  const [grade, setGrade] = useState<EvaluationGrade>('very_good');
  const [points, setPoints] = useState<number>(0);
  const [feedback, setFeedback] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('إدارة PHANTOMS');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (preselectedMemberId) {
        setSelectedIds([preselectedMemberId]);
      } else if (members.length > 0) {
        setSelectedIds([members[0].id]);
      } else {
        setSelectedIds([]);
      }
      setMemberSearch('');
      setTitle('تقييم الأداء الأسبوعي');
      setGrade('very_good');
      setPoints(0);
      setFeedback('');
      setError('');
    }
  }, [isOpen, preselectedMemberId, members]);

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter(
      (member) =>
        member.full_name.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query),
    );
  }, [members, memberSearch]);

  const toggleMember = (id: number) => {
    setSelectedIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  };

  const selectAllFiltered = () => {
    const ids = filteredMembers.map((member) => member.id);
    setSelectedIds((previous) => [...new Set([...previous, ...ids])]);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (selectedIds.length === 0) {
      setError(t('اختر عضواً واحداً على الأقل لإرسال التقييم له.', 'Select at least one member to receive this evaluation.'));
      return;
    }

    if (!title.trim()) {
      setError(t('اكتب عنوان التقييم.', 'Enter an evaluation title.'));
      return;
    }

    if (!feedback.trim()) {
      setError(t('اكتب تفاصيل التقييم والرسالة التي ستظهر للعضو في بوابته.', 'Enter the evaluation details and message that will appear in the member portal.'));
      return;
    }

    const memberNamesMap: Record<number, string> = {};
    for (const member of members) memberNamesMap[member.id] = member.full_name;

    try {
      const count = await createEvaluations.mutateAsync({
        memberIds: selectedIds,
        memberNamesMap,
        title: title.trim(),
        grade,
        points,
        feedback: feedback.trim(),
        evaluatorName: evaluatorName.trim() || 'إدارة PHANTOMS',
      });
      for (let i = 0; i < selectedIds.length; i += 50) {
        const chunk = selectedIds.slice(i, i + 50);
        void sendPushNotification(
          `تقييم جديد: ${title.trim()}`,
          feedback.trim().slice(0, 120),
          chunk,
          '/portal',
        ).catch(() => {});
      }
      toast.success(
        count === 1
          ? t('تم إرسال التقييم للعضو بنجاح وهيظهر له فور دخوله.', 'Evaluation sent successfully and will appear when the member signs in.')
          : t(`تم إرسال التقييم لـ ${number(count)} أعضاء بنجاح.`, `Evaluation sent successfully to ${number(count)} members.`),
      );
      onClose();
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('إضافة تقييم جديد للأعضاء', 'Add a member evaluation')} maxWidth="lg">
      <form onSubmit={handleSubmit} className="grid gap-4 text-start" dir={dir} noValidate>
        {error && (
          <p className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)]" role="alert" aria-live="assertive">
            {error}
          </p>
        )}

        <fieldset className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <legend className="sr-only">{t('١. الأعضاء المستهدفون بالتقييم', '1. Members to evaluate')}</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="eval-members-heading" className="flex items-center gap-1.5 text-sm font-black text-[var(--text)]">
              <Users size={16} className="text-[var(--link)]" aria-hidden="true" />
              {t('الأعضاء المستهدفون بالتقييم', 'Members to evaluate')} <span aria-label={t(`${selectedIds.length} أعضاء محددون`, `${selectedIds.length} selected`)}>({number(selectedIds.length)})</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <button type="button" onClick={selectAllFiltered} className={`min-h-11 rounded-lg px-2 text-[var(--link)] hover:underline ${focusStyle}`}>
                {t('تحديد الظاهر', 'Select shown')}
              </button>
              <span className="text-[var(--text-muted)]" aria-hidden="true">|</span>
              <button type="button" onClick={clearSelection} className={`min-h-11 rounded-lg px-2 text-[var(--text-muted)] hover:text-[var(--text)] ${focusStyle}`}>
                {t('إلغاء التحديد', 'Clear selection')}
              </button>
            </div>
          </div>

          <div className="relative">
            <Search size={15} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search"
              aria-label={t('ابحث عن عضو بالاسم أو البريد الإلكتروني', 'Search members by name or email')}
              placeholder={t('ابحث عن عضو بالاسم أو البريد...', 'Search members by name or email…')}
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pe-3 ps-9 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            />
          </div>

          {filteredMembers.length > 0 ? (
            <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pe-1 sm:grid-cols-2" role="group" aria-labelledby="eval-members-heading">
              {filteredMembers.map((member) => {
                const checked = selectedIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    aria-pressed={checked}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm font-bold transition-colors ${focusStyle} ${checked
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--bg)]'
                    }`}
                  >
                    <span className="truncate">{member.full_name}</span>
                    {checked && <Check size={16} className="shrink-0 text-[var(--link)]" aria-label={t('محدد', 'Selected')} />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-sm text-[var(--text-muted)]" role="status">
              {members.length === 0
                ? t('لا يوجد أعضاء متاحون للاختيار حالياً.', 'No members are currently available to select.')
                : t('لم نعثر على أعضاء يطابقون البحث.', 'No members match this search.')}
            </p>
          )}
        </fieldset>

        <section className="grid gap-1.5" aria-labelledby="eval-title-label">
          <label id="eval-title-label" className="text-sm font-bold text-[var(--text)]" htmlFor="eval-title-input">
            {t('٢. عنوان التقييم', '2. Evaluation title')} <span aria-hidden="true">*</span>
          </label>
          <input
            id="eval-title-input"
            type="text"
            required
            aria-required="true"
            placeholder={t('مثال: تقييم الأداء الأسبوعي', 'Example: Weekly performance review')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5" aria-label={t('عناوين مقترحة', 'Suggested titles')}>
            {TITLE_PRESETS.map((preset, index) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTitle(preset)}
                aria-pressed={title === preset}
                className={`min-h-11 rounded-lg border px-3 py-1 text-xs font-bold transition-colors ${focusStyle} ${title === preset
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--link)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {t(preset, TITLE_PRESET_ENGLISH[index])}
              </button>
            ))}
          </div>
        </section>

        <fieldset className="grid min-w-0 gap-2" aria-labelledby="eval-grade-label">
          <legend id="eval-grade-label" className="text-sm font-bold text-[var(--text)]">{t('٣. التقدير العام', '3. Overall grade')} <span aria-hidden="true">*</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {GRADES_ORDER.map((gradeOption) => {
              const active = grade === gradeOption;
              return (
                <button
                  key={gradeOption}
                  type="button"
                  onClick={() => setGrade(gradeOption)}
                  aria-pressed={active}
                  className={`min-h-11 rounded-xl border px-2.5 text-sm font-black transition-colors ${focusStyle} ${active
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)]'
                  }`}
                >
                  {t(EVALUATION_GRADE_LABELS[gradeOption], GRADE_LABELS_ENGLISH[gradeOption])}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5" aria-labelledby="eval-points-label">
          <legend id="eval-points-label" className="text-sm font-bold text-[var(--text)]">{t('٤. نقاط البونص المصاحبة للتقييم', '4. Bonus points for this evaluation')}</legend>
          <p className="text-xs leading-5 text-[var(--text-muted)]">{t('تُضاف أو تُخصم تلقائياً من رصيد العضو وترتيب الفريق.', 'Points are automatically added to or deducted from the member’s balance and team ranking.')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setPoints(0)} aria-pressed={points === 0} className={`min-h-11 rounded-lg px-3 text-xs font-black transition-colors ${focusStyle} ${points === 0 ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'}`}>
              {t('٠ (بدون تغيير)', '0 (no change)')}
            </button>
            <span className="ms-1 flex min-h-11 items-center gap-0.5 text-xs font-bold text-[var(--success-text)]"><Plus size={12} aria-hidden="true" />{t('مكافأة:', 'Bonus:')}</span>
            {POSITIVE_POINTS.map((value) => (
              <button key={`pos-${value}`} type="button" onClick={() => setPoints(value)} aria-pressed={points === value} aria-label={t(`مكافأة ${value} نقطة`, `${value} bonus points`)} className={`min-h-11 min-w-11 rounded-lg px-2.5 text-xs font-black transition-colors ${focusStyle} ${points === value ? 'bg-[var(--success)] text-[var(--on-success)]' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'}`}>
                +{number(value)}
              </button>
            ))}
            <span className="ms-1 flex min-h-11 items-center gap-0.5 text-xs font-bold text-[var(--danger-text)]"><Minus size={12} aria-hidden="true" />{t('خصم:', 'Deduction:')}</span>
            {NEGATIVE_POINTS.map((value) => (
              <button key={`neg-${value}`} type="button" onClick={() => setPoints(value)} aria-pressed={points === value} aria-label={t(`خصم ${Math.abs(value)} نقاط`, `${Math.abs(value)} point deduction`)} className={`min-h-11 min-w-11 rounded-lg px-2.5 text-xs font-black transition-colors ${focusStyle} ${points === value ? 'bg-[var(--danger)] text-[var(--on-danger)]' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'}`}>
                {number(value)}
              </button>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs leading-5 font-semibold text-[var(--text-muted)]" role="status" aria-live="polite">
            <Award size={14} className="mt-0.5 shrink-0 text-[var(--link)]" aria-hidden="true" />
            {points === 0
              ? t('سيظهر التقييم كتوجيه دون تغيير نقاط البونص.', 'The evaluation will appear as feedback without changing bonus points.')
              : points > 0
                ? t(`سيحصل العضو على مكافأة ${number(points)} نقطة بونص عند حفظ التقييم.`, `The member will receive ${number(points)} bonus points when the evaluation is saved.`)
                : t(`سيتم خصم ${number(Math.abs(points))} نقطة مع توثيق السبب.`, `${number(Math.abs(points))} bonus points will be deducted with the reason recorded.`)}
          </p>
        </fieldset>

        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]" htmlFor="eval-feedback-input">
          {t('٥. رسالة وتفاصيل التقييم', '5. Evaluation message and details')} <span aria-hidden="true">*</span>
          <span className="text-xs font-normal leading-5 text-[var(--text-muted)]">{t('تظهر للعضو مباشرة عند دخوله البوابة.', 'Shown to the member when they sign in to the portal.')}</span>
          <textarea
            id="eval-feedback-input"
            required
            aria-required="true"
            rows={4}
            placeholder={t('اكتب نقاط القوة وأي ملاحظات أو توجيهات للفترة القادمة…', 'Describe strengths and any feedback or guidance for the next period…')}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-6 text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]" htmlFor="eval-evaluator-input">
          {t('٦. اسم المسؤول / المقيّم', '6. Evaluator name')}
          <input
            id="eval-evaluator-input"
            type="text"
            value={evaluatorName}
            onChange={(event) => setEvaluatorName(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
        </label>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>
            {t('إلغاء', 'Cancel')}
          </Button>
          <Button type="submit" isLoading={createEvaluations.isPending} loadingText={t('جارٍ حفظ وإرسال التقييم…', 'Saving and sending evaluation…')} fullOnMobile>
            {t('إرسال وحفظ التقييم', 'Save and send evaluation')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
