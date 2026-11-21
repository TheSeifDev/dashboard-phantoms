import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Search, Sparkles, Star, Users } from 'lucide-react';
import type { Member } from '../../types/db';
import { EVALUATION_GRADE_LABELS, useCreateEvaluations } from './api';
import type { EvaluationGrade } from './api';
import { EvalStars, EvalStarInput, MAX_STARS } from './StarRating';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { sendPushNotification } from '../../lib/api/push';
import { useLocale } from '../../i18n/useLocale';
import './evaluations.css';

interface StarsBalance {
  stars: number;
  count: number;
}

interface Props {
  isOpen: boolean;
  members: Member[];
  preselectedMemberId?: number | null;
  /** رصيد النجوم المتراكم لكل عضو، لعرض «قبل / بعد» أثناء منح النجوم. */
  starsByMember?: Record<number, StarsBalance>;
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
/** التقدير يقترح عدد النجوم المقابل له تلقائياً. */
const GRADE_STARS: Record<EvaluationGrade, number> = {
  excellent: 5,
  very_good: 4,
  good: 3,
  needs_improvement: 2,
  warning: 1,
};

const FORM_ID = 'eval-create-form';

export function EvaluationCreateModal({
  isOpen,
  members,
  preselectedMemberId,
  starsByMember = {},
  onClose,
}: Props) {
  const { t, number, dir } = useLocale();
  const createEvaluations = useCreateEvaluations();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [title, setTitle] = useState('تقييم الأداء الأسبوعي');
  const [grade, setGrade] = useState<EvaluationGrade>('very_good');
  const [stars, setStars] = useState<number>(GRADE_STARS.very_good);
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
      setStars(GRADE_STARS.very_good);
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

  const handleGrade = (nextGrade: EvaluationGrade) => {
    setGrade(nextGrade);
    // لا نطمس اختيار النجوم اليدوي: نحدّثه فقط لو كان لا يزال على قيمة التقدير السابق.
    setStars((current) => (current === GRADE_STARS[grade] || current === 0 ? GRADE_STARS[nextGrade] : current));
  };

  const singleMemberId = selectedIds.length === 1 ? selectedIds[0] : null;
  const singleBalance = singleMemberId ? starsByMember[singleMemberId]?.stars ?? 0 : 0;
  const selectedTotalStars = selectedIds.reduce(
    (sum, id) => sum + (starsByMember[id]?.stars ?? 0),
    0,
  );

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
        points: stars,
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('تقييم جديد للأعضاء', 'New member evaluation')}
      subtitle={t('اختر الأعضاء، حدّد التقدير، ثم امنح النجوم الذهبية من ١ إلى ٥.', 'Pick the members, set the grade, then award 1–5 golden stars.')}
      icon={<Sparkles size={18} aria-hidden="true" />}
      maxWidth="2xl"
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>
            {t('إلغاء', 'Cancel')}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            isLoading={createEvaluations.isPending}
            loadingText={t('جارٍ حفظ وإرسال التقييم…', 'Saving and sending evaluation…')}
            icon={<Star size={16} aria-hidden="true" />}
            fullOnMobile
          >
            {t('إرسال وحفظ التقييم', 'Save and send evaluation')}
          </Button>
        </>
      )}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="eval-form" dir={dir} noValidate>
        {error && (
          <p className="eval-form-alert" role="alert" aria-live="assertive">{error}</p>
        )}

        <fieldset className="eval-block">
          <legend className="sr-only">{t('الأعضاء المستهدفون بالتقييم', 'Members to evaluate')}</legend>
          <div className="eval-block-head">
            <h3 className="eval-block-title" id="eval-members-heading">
              <span className="eval-step" aria-hidden="true">١</span>
              <Users size={14} aria-hidden="true" />
              {t('الأعضاء المستهدفون', 'Members to evaluate')}
              <span className="eval-block-count" aria-label={t(`${selectedIds.length} أعضاء محددون`, `${selectedIds.length} selected`)}>
                {number(selectedIds.length)}
              </span>
            </h3>
            <div className="eval-block-actions">
              <button type="button" className="eval-link" onClick={selectAllFiltered}>
                {t('تحديد الظاهر', 'Select shown')}
              </button>
              <button type="button" className="eval-link eval-link--muted" onClick={clearSelection}>
                {t('إلغاء التحديد', 'Clear')}
              </button>
            </div>
          </div>

          <label className="eval-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">{t('ابحث عن عضو بالاسم أو البريد الإلكتروني', 'Search members by name or email')}</span>
            <input
              type="search"
              placeholder={t('ابحث عن عضو بالاسم أو البريد…', 'Search members by name or email…')}
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
          </label>

          {filteredMembers.length > 0 ? (
            <div className="eval-member-grid" role="group" aria-labelledby="eval-members-heading">
              {filteredMembers.map((member) => {
                const checked = selectedIds.includes(member.id);
                const balance = starsByMember[member.id]?.stars ?? 0;
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    aria-pressed={checked}
                    className="eval-member"
                  >
                    <span className="eval-member-initial" aria-hidden="true">
                      {member.full_name.trim().charAt(0) || 'ع'}
                    </span>
                    <span>{member.full_name}</span>
                    {balance > 0 && (
                      <span className="eval-star-pill eval-star-pill--muted" aria-label={t(`${balance} نجمة`, `${balance} stars`)}>
                        {number(balance)}
                      </span>
                    )}
                    {checked && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="eval-empty-note" role="status">
              {members.length === 0
                ? t('لا يوجد أعضاء متاحون للاختيار حالياً.', 'No members are currently available to select.')
                : t('لم نعثر على أعضاء يطابقون البحث.', 'No members match this search.')}
            </p>
          )}
        </fieldset>

        <section className="eval-block" aria-labelledby="eval-title-label">
          <div className="eval-block-head">
            <h3 className="eval-block-title" id="eval-title-label">
              <span className="eval-step" aria-hidden="true">٢</span>
              {t('عنوان التقييم', 'Evaluation title')}
            </h3>
          </div>
          <input
            id="eval-title-input"
            type="text"
            required
            aria-required="true"
            placeholder={t('مثال: تقييم الأداء الأسبوعي', 'Example: Weekly performance review')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="eval-input"
          />
          <div className="eval-chips" aria-label={t('عناوين مقترحة', 'Suggested titles')}>
            {TITLE_PRESETS.map((preset, index) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTitle(preset)}
                aria-pressed={title === preset}
                className="eval-chip"
              >
                {t(preset, TITLE_PRESET_ENGLISH[index])}
              </button>
            ))}
          </div>
        </section>

        <fieldset className="eval-block">
          <legend className="sr-only">{t('التقدير العام', 'Overall grade')}</legend>
          <div className="eval-block-head">
            <h3 className="eval-block-title" id="eval-grade-label">
              <span className="eval-step" aria-hidden="true">٣</span>
              {t('التقدير العام', 'Overall grade')}
            </h3>
            <span className="eval-hint">{t('اختيار التقدير يقترح النجوم تلقائياً', 'The grade suggests the stars')}</span>
          </div>
          <div className="eval-grades" role="group" aria-labelledby="eval-grade-label">
            {GRADES_ORDER.map((gradeOption) => {
              const active = grade === gradeOption;
              return (
                <button
                  key={gradeOption}
                  type="button"
                  onClick={() => handleGrade(gradeOption)}
                  aria-pressed={active}
                  className={`eval-grade-option eval-grade--${gradeOption}`}
                >
                  <b>{t(EVALUATION_GRADE_LABELS[gradeOption], GRADE_LABELS_ENGLISH[gradeOption])}</b>
                  <small>{t(`${GRADE_STARS[gradeOption]} نجوم`, `${GRADE_STARS[gradeOption]} stars`)}</small>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="eval-award">
          <legend className="sr-only">{t('النجوم الذهبية', 'Golden stars')}</legend>
          <div className="eval-award-head">
            <h3 className="eval-award-title" id="eval-award-label">
              <Star size={15} aria-hidden="true" />
              {t('النجوم الذهبية للتقييم', 'Golden stars for this review')}
            </h3>
            <span className="eval-award-total">
              <Star size={11} aria-hidden="true" />
              {t(`${number(stars)} من ${number(MAX_STARS)}`, `${number(stars)} of ${number(MAX_STARS)}`)}
            </span>
          </div>

          <EvalStarInput
            value={stars}
            onChange={setStars}
            label={t('اختر عدد النجوم الذهبية من ١ إلى ٥', 'Choose 1 to 5 golden stars')}
            describedBy="eval-award-readout"
          />

          <p className="eval-award-readout" id="eval-award-readout" role="status" aria-live="polite">
            <Star size={13} aria-hidden="true" />
            {stars === 0 ? (
              t('لن تُضاف نجوم، وسيظهر التقييم كملاحظة فقط.', 'No stars will be added; the review stays as feedback only.')
            ) : singleMemberId ? (
              t(
                `سيحصل العضو على ${number(stars)} نجمة، ورصيده يرتفع من ${number(singleBalance)} إلى ${number(singleBalance + stars)}.`,
                `The member gets ${number(stars)} star${stars > 1 ? 's' : ''}: balance goes from ${number(singleBalance)} to ${number(singleBalance + stars)}.`,
              )
            ) : (
              t(
                `كل عضو من ${number(selectedIds.length)} سيحصل على ${number(stars)} نجمة — ${number(stars * selectedIds.length)} نجمة تُضاف للفريق.`,
                `Each of ${number(selectedIds.length)} members gets ${number(stars)} star${stars > 1 ? 's' : ''} — ${number(stars * selectedIds.length)} stars added in total.`,
              )
            )}
            {selectedIds.length > 0 && (
              <span className="eval-award-balance">
                <small>{t('الرصيد الحالي للمحددين', 'Current balance of selected')}</small>
                <span><EvalStars value={Math.min(MAX_STARS, selectedTotalStars)} size="sm" /> {number(selectedTotalStars)}</span>
              </span>
            )}
          </p>
          <p className="eval-hint">
            {t('النجوم تتراكم: كل تقييم يضيف نجومه إلى رصيد العضو، ويقدر يجمع عدد كبير منها مع الوقت.', 'Stars accumulate: every review adds to the member balance, so they can collect many over time.')}
          </p>
        </fieldset>

        <label className="eval-field" htmlFor="eval-feedback-input">
          <span className="eval-label">
            {t('رسالة وتفاصيل التقييم', 'Evaluation message and details')} <span aria-hidden="true">*</span>
            <small>{t('تظهر للعضو مباشرة عند دخوله البوابة.', 'Shown to the member when they sign in to the portal.')}</small>
          </span>
          <textarea
            id="eval-feedback-input"
            required
            aria-required="true"
            rows={4}
            placeholder={t('اكتب نقاط القوة وأي ملاحظات أو توجيهات للفترة القادمة…', 'Describe strengths and any feedback or guidance for the next period…')}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            className="eval-textarea"
          />
        </label>

        <label className="eval-field" htmlFor="eval-evaluator-input">
          <span className="eval-label">{t('اسم المسؤول / المقيّم', 'Evaluator name')}</span>
          <input
            id="eval-evaluator-input"
            type="text"
            value={evaluatorName}
            onChange={(event) => setEvaluatorName(event.target.value)}
            className="eval-input"
          />
        </label>
      </form>
    </Modal>
  );
}
