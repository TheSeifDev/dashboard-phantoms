import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Check, Minus, Search, Sparkles, Star, Users } from 'lucide-react';
import type { Member } from '../../types/db';
import { STRIKE_LIMIT, useCreateEvaluations, useIssueStrike } from './api';
import type { EvaluationKind } from './api';
import { EvalMinusInput, EvalStars, EvalStarInput, MAX_STARS } from './StarRating';
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
  /** رصيد النجوم المتراكم لكل عضو، لعرض «قبل / بعد» أثناء منح النجوم أو خصمها. */
  starsByMember?: Record<number, StarsBalance>;
  /** عدد التحذيرات المسجّلة لكل عضو (الحد ٣). */
  strikesByMember?: Record<number, number>;
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

const MODES: EvaluationKind[] = ['stars', 'minus', 'strike'];

const FORM_ID = 'eval-create-form';

export function EvaluationCreateModal({
  isOpen,
  members,
  preselectedMemberId,
  starsByMember = {},
  strikesByMember = {},
  onClose,
}: Props) {
  const { t, number, dir } = useLocale();
  const createEvaluations = useCreateEvaluations();
  const issueStrike = useIssueStrike();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [title, setTitle] = useState('تقييم الأداء الأسبوعي');
  const [mode, setMode] = useState<EvaluationKind>('stars');
  const [stars, setStars] = useState<number>(4);
  const [minus, setMinus] = useState<number>(1);
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
      setMode('stars');
      setStars(4);
      setMinus(1);
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

  const singleMemberId = selectedIds.length === 1 ? selectedIds[0] : null;
  const singleBalance = singleMemberId ? starsByMember[singleMemberId]?.stars ?? 0 : 0;
  const selectedTotalStars = selectedIds.reduce(
    (sum, id) => sum + (starsByMember[id]?.stars ?? 0),
    0,
  );
  const atLimitIds = selectedIds.filter((id) => (strikesByMember[id] ?? 0) >= STRIKE_LIMIT);

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

    const cleanEvaluator = evaluatorName.trim() || 'إدارة PHANTOMS';
    const memberNamesMap: Record<number, string> = {};
    for (const member of members) memberNamesMap[member.id] = member.full_name;

    if (mode === 'strike') {
      if (atLimitIds.length > 0) {
        setError(t(
          'فيه عضو محدد وصل للحد الأقصى (٣ تحذيرات). لازم يتطرد من الفريق بدل ما تتحذره تاني.',
          'A selected member already reached the 3-strike limit. They must be expelled instead of warned again.',
        ));
        return;
      }
      let issued = 0;
      let expulsionRequired: string | null = null;
      try {
        for (const memberId of selectedIds) {
          try {
            const result = await issueStrike.mutateAsync({
              memberId,
              title: title.trim(),
              feedback: feedback.trim(),
              author: cleanEvaluator,
            });
            issued += 1;
            if (result.expulsion_required && !expulsionRequired) {
              expulsionRequired = memberNamesMap[memberId] ?? `#${memberId}`;
            }
          } catch (cause) {
            const raw = String((cause as { message?: string })?.message ?? cause);
            if (raw.includes('STRIKE_LIMIT_REACHED')) {
              throw new Error(t(
                `العضو ${memberNamesMap[memberId] ?? ''} عنده ٣ تحذيرات بالفعل — لازم يتطرد من الفريق.`,
                `${memberNamesMap[memberId] ?? 'This member'} already has 3 strikes and must be expelled.`,
              ));
            }
            throw cause;
          }
        }
        for (let i = 0; i < selectedIds.length; i += 50) {
          const chunk = selectedIds.slice(i, i + 50);
          void sendPushNotification(
            `تحذير رسمي: ${title.trim()}`,
            feedback.trim().slice(0, 120),
            chunk,
            '/portal',
          ).catch(() => {});
        }
        toast.success(
          issued === 1
            ? t('تم تسجيل التحذير وإبلاغ العضو.', 'Warning recorded and the member notified.')
            : t(`تم تسجيل ${number(issued)} تحذيرات.`, `${number(issued)} warnings recorded.`),
        );
        if (expulsionRequired) {
          toast.warning(
            t(
              `${expulsionRequired} وصل ٣ تحذيرات — دور المالك دلوقتي يطرده من الفريق من صفحة التقييمات.`,
              `${expulsionRequired} reached 3 strikes — the owner must expel them from the evaluations page.`,
            ),
          );
        }
        onClose();
      } catch (cause) {
        const message = cause instanceof Error && cause.message.includes('تحذيرات')
          ? cause.message
          : handleSupabaseError(cause).message;
        setError(message);
      }
      return;
    }

    const points = mode === 'minus' ? -Math.abs(minus) : Math.abs(stars);

    try {
      const count = await createEvaluations.mutateAsync({
        memberIds: selectedIds,
        memberNamesMap,
        title: title.trim(),
        kind: mode,
        points,
        feedback: feedback.trim(),
        evaluatorName: cleanEvaluator,
      });
      for (let i = 0; i < selectedIds.length; i += 50) {
        const chunk = selectedIds.slice(i, i + 50);
        void sendPushNotification(
          `${mode === 'minus' ? 'خصم نجوم' : 'تقييم جديد'}: ${title.trim()}`,
          feedback.trim().slice(0, 120),
          chunk,
          '/portal',
        ).catch(() => {});
      }
      toast.success(
        count === 1
          ? mode === 'minus'
            ? t('تم خصم النجوم من العضو وإبلاغه.', 'Stars deducted from the member and they were notified.')
            : t('تم إرسال التقييم للعضو بنجاح وهيظهر له فور دخوله.', 'Evaluation sent successfully and will appear when the member signs in.')
          : mode === 'minus'
            ? t(`تم خصم النجوم من ${number(count)} أعضاء.`, `Stars deducted from ${number(count)} members.`)
            : t(`تم إرسال التقييم لـ ${number(count)} أعضاء بنجاح.`, `Evaluation sent successfully to ${number(count)} members.`),
      );
      onClose();
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  const pending = createEvaluations.isPending || issueStrike.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('تقييم جديد للأعضاء', 'New member evaluation')}
      subtitle={t('اختر الأعضاء، ثم امنح نجوم، اخصم نجوم، أو سجّل تحذير.', 'Pick the members, then award stars, deduct stars, or record a warning.')}
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
            variant={mode === 'strike' ? 'danger' : 'primary'}
            isLoading={pending}
            loadingText={mode === 'strike'
              ? t('جارٍ تسجيل التحذير…', 'Recording the warning…')
              : t('جارٍ حفظ وإرسال التقييم…', 'Saving and sending evaluation…')}
            icon={mode === 'strike'
              ? <AlertTriangle size={16} aria-hidden="true" />
              : mode === 'minus'
                ? <Minus size={16} aria-hidden="true" />
                : <Star size={16} aria-hidden="true" />}
            fullOnMobile
          >
            {mode === 'strike'
              ? t('تسجيل التحذير', 'Record warning')
              : mode === 'minus'
                ? t('خصم النجوم', 'Deduct stars')
                : t('إرسال وحفظ التقييم', 'Save and send evaluation')}
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
                const strikes = strikesByMember[member.id] ?? 0;
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
                    {strikes > 0 && (
                      <span
                        className={`eval-strike-pill ${strikes >= STRIKE_LIMIT ? 'eval-strike-pill--full' : ''}`}
                        aria-label={t(`${strikes} من ${STRIKE_LIMIT} تحذيرات`, `${strikes} of ${STRIKE_LIMIT} strikes`)}
                      >
                        <AlertTriangle size={11} aria-hidden="true" />
                        {number(strikes)}/{number(STRIKE_LIMIT)}
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
          <legend className="sr-only">{t('نوع التقييم', 'Evaluation type')}</legend>
          <div className="eval-block-head">
            <h3 className="eval-block-title" id="eval-mode-label">
              <span className="eval-step" aria-hidden="true">٣</span>
              {t('نوع التقييم', 'Evaluation type')}
            </h3>
          </div>
          <div className="eval-modes" role="group" aria-labelledby="eval-mode-label">
            {MODES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => { setMode(option); setError(''); }}
                aria-pressed={mode === option}
                className={`eval-mode eval-mode--${option}`}
              >
                <span className="eval-mode-icon" aria-hidden="true">
                  {option === 'stars' ? <Star size={14} /> : null}
                  {option === 'minus' ? <Minus size={14} /> : null}
                  {option === 'strike' ? <AlertTriangle size={14} /> : null}
                </span>
                <b>
                  {option === 'stars'
                    ? t('نجوم', 'Stars')
                    : option === 'minus'
                      ? t('خصم نجوم', 'Deduct')
                      : t('تحذير', 'Strike')}
                </b>
              </button>
            ))}
          </div>
          <p className="eval-mode-caption">
            {mode === 'stars'
              ? t('كل تقييم بيضيف نجومه لرصيد العضو والنجوم بتتراكم.', 'Every review adds its stars to the member balance, and stars accumulate.')
              : mode === 'minus'
                ? t('بتشيل نجوم من الرصيد — حركة مستقلة بتتسجل في سجل التقييمات.', 'Removes stars from the balance — a standalone entry in the review history.')
                : t(`تحذير رسمي بدون نجوم — ${STRIKE_LIMIT} تحذيرات والثالث معناه طرد.`, `A formal warning with no stars — ${STRIKE_LIMIT} strikes and the third means expulsion.`)}
          </p>
        </fieldset>

        {mode === 'strike' ? (
          <fieldset className="eval-award eval-award--strike">
            <legend className="sr-only">{t('تحذير رسمي', 'Official warning')}</legend>
            <div className="eval-award-head">
              <h3 className="eval-award-title" id="eval-strike-label">
                <AlertTriangle size={15} aria-hidden="true" />
                {t('تحذير رسمي', 'Official warning')}
              </h3>
              <span className="eval-award-total eval-award-total--strike">
                {t(`الحد ${number(STRIKE_LIMIT)} تحذيرات`, `Limit ${number(STRIKE_LIMIT)} strikes`)}
              </span>
            </div>
            <p className="eval-award-readout" id="eval-strike-readout" role="status" aria-live="polite">
              <AlertTriangle size={13} aria-hidden="true" />
              {selectedIds.length === 0
                ? t('اختر الأعضاء اللي هياخدوا التحذير.', 'Select the members who will receive the warning.')
                : t(
                  `هيتسجل تحذير لـ ${number(selectedIds.length)} عضو. التحذير مش بياخد نجوم، لكن التالت معناه إنك تطرده من الفريق بنفسك.`,
                  `A warning will be recorded for ${number(selectedIds.length)} member(s). Warnings carry no stars, but the third one means you expel them yourself.`,
                )}
            </p>
            <ul className="eval-strike-list">
              {selectedIds.map((id) => {
                const strikes = strikesByMember[id] ?? 0;
                const name = members.find((member) => member.id === id)?.full_name ?? `#${id}`;
                return (
                  <li key={id} className="eval-strike-row">
                    <span className="eval-strike-name">{name}</span>
                    <span className="eval-strike-dots" aria-hidden="true">
                      {Array.from({ length: STRIKE_LIMIT }, (_, index) => (
                        <i
                          key={index}
                          className={`eval-strike-dot ${index < strikes ? 'eval-strike-dot--on' : ''} ${index === strikes ? 'eval-strike-dot--next' : ''}`}
                        />
                      ))}
                    </span>
                    <span className="eval-strike-count">
                      {strikes >= STRIKE_LIMIT
                        ? t('وصل الحد — لازم طرد', 'At the limit — expel')
                        : t(`${number(strikes)} من ${number(STRIKE_LIMIT)} — فاضل ${number(STRIKE_LIMIT - strikes)}`, `${number(strikes)} of ${number(STRIKE_LIMIT)} — ${number(STRIKE_LIMIT - strikes)} left`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : mode === 'minus' ? (
            <fieldset className="eval-award eval-award--minus">
              <legend className="sr-only">{t('خصم النجوم', 'Deduct stars')}</legend>
              <div className="eval-award-head">
                <h3 className="eval-award-title eval-award-title--minus" id="eval-minus-label">
                  <Minus size={15} aria-hidden="true" />
                  {t('خصم نجوم من الرصيد', 'Deduct stars from the balance')}
                </h3>
                <span className="eval-award-total eval-award-total--minus">
                  <Minus size={11} aria-hidden="true" />
                  {t(`${number(minus)} من ${number(MAX_STARS)}`, `${number(minus)} of ${number(MAX_STARS)}`)}
                </span>
              </div>

              <EvalMinusInput
                value={minus}
                onChange={setMinus}
                label={t('اختر عدد النجوم التي تُخصم من العضو', 'Choose how many stars to deduct')}
                describedBy="eval-minus-readout"
              />

              <p className="eval-award-readout eval-award-readout--minus" id="eval-minus-readout" role="status" aria-live="polite">
                <Minus size={13} aria-hidden="true" />
                {singleMemberId ? (
                  t(
                    `هيتخصم ${number(minus)} نجمة من رصيد العضو، ورصيده ينزل من ${number(singleBalance)} إلى ${number(Math.max(0, singleBalance - minus))}.`,
                    `${number(minus)} star${minus > 1 ? 's' : ''} will be deducted: balance goes from ${number(singleBalance)} to ${number(Math.max(0, singleBalance - minus))}.`,
                  )
                ) : (
                  t(
                    `هيتخصم ${number(minus)} نجمة من كل عضو محدد — ${number(minus * selectedIds.length)} نجمة إجمالاً.`,
                    `${number(minus)} star${minus > 1 ? 's' : ''} deducted from each selected member — ${number(minus * selectedIds.length)} in total.`,
                  )
                )}
              </p>
              <p className="eval-hint">
                {t('الخصم حركة مستقلة: بيتسجل في سجل التقييمات ومش بيتمسح لو حذفت تقييماً قديماً.', 'Deductions are standalone entries: they appear in the history and stay even if an older review is deleted.')}
              </p>
            </fieldset>
        ) : (
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
                    <span><EvalStars value={Math.min(MAX_STARS, Math.max(0, selectedTotalStars))} size="sm" /> {number(Math.max(0, selectedTotalStars))}</span>
                  </span>
                )}
              </p>
              <p className="eval-hint">
                {t('النجوم تتراكم: كل تقييم يضيف نجومه إلى رصيد العضو، ويقدر يجمع عدد كبير منها مع الوقت.', 'Stars accumulate: every review adds to the member balance, so they can collect many over time.')}
              </p>
            </fieldset>
        )}

        <label className="eval-field" htmlFor="eval-feedback-input">
          <span className="eval-label">
            {mode === 'strike'
              ? t('سبب التحذير', 'Reason for the warning')
              : t('رسالة وتفاصيل التقييم', 'Evaluation message and details')} <span aria-hidden="true">*</span>
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
