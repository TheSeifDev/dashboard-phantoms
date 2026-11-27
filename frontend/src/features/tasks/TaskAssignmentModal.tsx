import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CheckSquare, Layers, Search, ShieldCheck, Star, UserCheck, Users, X } from 'lucide-react';
import type { Member, TaskInsert, TaskTrackingEntry } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { addDaysISO, combineLocalDateTime, daysRemaining, formatDeadline, hoursRemaining } from '../../lib/dateUtils';
import { AR, arCount, arDaysPhrase, arDurationPhrase, formatSigned, normalizeArabic } from '../../lib/arabic';
import { useCreateTask, useTaskAudienceGroups } from './api';
import { POINTS_PER_STAR, STAR_MAX, audienceCount, resolveAudienceIds, starsLabel, starsToBonusPoints, type TaskAssignMode } from './taskAudience';

import { useLocale } from '../../i18n/useLocale';
const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESC_MAX = 2000;
export { POINTS_PER_STAR, STAR_MAX };

type AssignMode = TaskAssignMode;
type FieldErrors = Partial<Record<'title' | 'deadline' | 'assignees', string>>;

const QUICK_DEADLINES: Array<{ label: string; days: number | null }> = [
  { label: 'بدون موعد', days: null },
  { label: 'النهارده', days: 0 },
  { label: 'بكرة', days: 1 },
  { label: 'بعد 3 أيام', days: 3 },
  { label: 'بعد أسبوع', days: 7 },
];

const fieldClass = (invalid: boolean) =>
  `w-full rounded-xl border bg-[var(--bg)] px-3 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] transition-[border-color,box-shadow] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] ${invalid ? 'border-[var(--danger)] focus:border-[var(--danger)]' : 'border-[var(--border)] focus:border-[var(--primary)]'}`;

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs font-bold leading-5 text-[var(--danger)]">
      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

function initialsOf(name: string, locale: 'ar' | 'en'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? (locale === 'ar' ? '؟' : '?')) + (parts[1]?.[0] ?? '');
}

/** القيمة المخزنة: تاريخ فقط (= نهاية اليوم) أو تاريخ + ساعة بإزاحة المنطقة */
function deadlineValue(date: string, time: string): string {
  return time ? combineLocalDateTime(date, time) : date;
}

function deadlineHint(dateValue: string, time: string, locale: 'ar' | 'en', t: (arabic: string, english: string) => string, formatDate: (value: string) => string, number: (value: number) => string): string {
  const value = deadlineValue(dateValue, time);
  const days = daysRemaining(value);
  const hours = hoursRemaining(value);
  const when = time && hours !== null && hours > 0 && hours < 24
    ? locale === 'ar' ? `خلال ${arDurationPhrase(hours)}` : `in ${number(Math.max(1, Math.ceil(hours)))} ${Math.ceil(hours) < 2 ? 'hour' : 'hours'}`
    : days === 0 ? t('النهارده', 'today') : days === 1 ? t('بكرة', 'tomorrow') : days !== null && days > 1 ? t(`بعد ${arDaysPhrase(days)}`, `in ${number(days)} days`) : '';
  const label = formatDate(value);
  return locale === 'ar'
    ? `${time ? `موعدها يوم ${label}` : `موعدها آخر يوم ${label}`}${when ? ` — ${when}` : ''}.`
    : `${time ? `Due on ${label}` : `Due by the end of ${label}`}${when ? ` — ${when}` : ''}.`;
}

export function TaskAssignmentModal({
  isOpen,
  members,
  membersLoading = false,
  teamId = null,
  onClose,
}: {
  isOpen: boolean;
  members: Member[];
  membersLoading?: boolean;
  /** Head/Monitor seats create tasks for their own team only. */
  teamId?: string | null;
  onClose: () => void;
}) {
  const { t, number, date, locale } = useLocale();
  const create = useCreateTask();
  const groups = useTaskAudienceGroups(isOpen);
  const formId = useId();
  const ids = {
    title: `${formId}-title`,
    titleError: `${formId}-title-error`,
    description: `${formId}-description`,
    deadline: `${formId}-deadline`,
    deadlineHint: `${formId}-deadline-hint`,
    deadlineError: `${formId}-deadline-error`,
    time: `${formId}-time`,
    bonusHint: `${formId}-bonus-hint`,
    stars: `${formId}-stars`,
    search: `${formId}-search`,
    assigneesError: `${formId}-assignees-error`,
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [stars, setStars] = useState(0);
  const [mode, setMode] = useState<AssignMode>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState('');

  // فتح جديد = رسائل نظيفة (المسودة نفسها تبقى حتى لا يضيع ما كُتب بإغلاق عرضي)
  useEffect(() => {
    if (isOpen) { setAttempted(false); setServerError(''); }
  }, [isOpen]);

  // أعضاء حُذفوا من الفريق لا يبقون مختارين
  const memberIds = useMemo(() => new Set(members.map((member) => String(member.id))), [members]);
  const selectedValid = useMemo(() => selected.filter((id) => memberIds.has(id)), [selected, memberIds]);

  // مجموعات الإسناد الجماعي (قادة مشاريع الويب / رؤساء ومراقبي التيمات) بعد مطابقتها بأعضاء الفريق الحاليين
  const groupMembers = useMemo(() => {
    const byId = new Map(members.map((member) => [member.id, member]));
    const resolve = (ids: number[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((member): member is Member => Boolean(member));
    return { leads: resolve(groups.data?.leads), heads: resolve(groups.data?.heads) };
  }, [members, groups.data]);
  const groupAudience = mode === 'leads' ? groupMembers.leads : mode === 'heads' ? groupMembers.heads : [];
  const groupsUnavailable = groups.isError;

  const today = addDaysISO(0);
  const filtered = useMemo(() => {
    const needle = normalizeArabic(query);
    if (!needle) return members;
    return members.filter((member) => normalizeArabic(`${member.full_name} ${member.residence ?? ''}`).includes(needle));
  }, [members, query]);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    const cleanTitle = title.trim();
    if (!cleanTitle) errors.title = t('اكتب عنوان واضح للمهمة.', 'Enter a clear task title.');
    else if (cleanTitle.length < TITLE_MIN) errors.title = t(`العنوان قصير قوي — ${TITLE_MIN} حروف على الأقل.`, `The title is too short — at least ${TITLE_MIN} characters are required.`);
    if (deadline && deadline < today) errors.deadline = t('مينفعش تختار تاريخ فات — اختار النهارده أو تاريخ بعد كده.', 'Choose today or a future date. Past dates are not allowed.');
    else if (deadline && deadlineTime && (hoursRemaining(deadlineValue(deadline, deadlineTime)) ?? 1) <= 0) errors.deadline = t('الساعة دي عدّت — اختار وقت بعد كده النهارده أو يوم تاني.', 'That time has passed — choose a later time today or another day.');
    if (!membersLoading && members.length === 0) errors.assignees = t('مفيش أعضاء في الفريق لسه — ضيف أعضاء من صفحة الأعضاء الأول.', 'There are no team members yet — add members from the Members page first.');
    else if (mode === 'specific' && selectedValid.length === 0) errors.assignees = t('اختار عضو واحد على الأقل، أو ادّي المهمة لكل الفريق.', 'Select at least one member or assign the task to the whole team.');
    else if ((mode === 'leads' || mode === 'heads') && groupsUnavailable) errors.assignees = t('معرفناش نحمّل المجموعة دي — اقفل النافذة وجرّب تاني.', 'Could not load this audience group — close and try again.');
    else if ((mode === 'leads' || mode === 'heads') && groupAudience.length === 0) errors.assignees = mode === 'leads'
      ? t('مفيش قادة مشاريع ويب معيّنين حاليًا — عيّن قائد من صفحة مشاريع الويب.', 'No web-project leaders are assigned yet — assign a lead from Web Projects.')
      : t('مفيش رؤساء أو مراقبين معيّنين على التيمات حاليًا.', 'No team heads or monitors are assigned yet.');
    return errors;
  };
  const errors = attempted ? validate() : {};

  const audience = resolveAudienceIds(mode, { memberIds: members.map((member) => member.id), leadIds: groupMembers.leads.map((member) => member.id), headIds: groupMembers.heads.map((member) => member.id) }, selectedValid);
  const assigneeCount = audienceCount(mode, { memberIds: members.map((member) => member.id), leadIds: groupMembers.leads.map((member) => member.id), headIds: groupMembers.heads.map((member) => member.id) }, selectedValid);
  const summary = membersLoading
    ? t('بنحمّل قائمة الأعضاء...', 'Loading member list...')
    : mode === 'all'
      ? t(`هتتسند لكل الفريق (${arCount(members.length, AR.member)}).`, `Assigned to the entire team (${number(members.length)} ${members.length === 1 ? 'member' : 'members'}).`)
        : mode === 'specific'
        ? selectedValid.length
          ? locale === 'ar' ? `هتتسند لـ ${arCount(selectedValid.length, AR.memberGen)}.` : `Assigned to ${number(selectedValid.length)} ${selectedValid.length === 1 ? 'member' : 'members'}.`
          : t('لسه ما اخترتش أي عضو.', 'No members selected yet.')
        : groupAudience.length
          ? locale === 'ar'
            ? `هتتسند لـ ${arCount(groupAudience.length, AR.memberGen)} من ${mode === 'leads' ? 'قادة مشاريع الويب' : 'رؤساء ومراقبي التيمات'}.`
            : `Assigned to ${number(groupAudience.length)} ${mode === 'leads' ? 'web-project leaders' : 'team heads & monitors'}.`
          : groups.isLoading ? t('بنحمّل المجموعة...', 'Loading the group...') : t('المجموعة دي فاضية حاليًا.', 'This group is currently empty.');

  const toggleMember = (id: string) =>
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const filteredIds = filtered.map((member) => String(member.id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedValid.includes(id));
  const toggleAllFiltered = () =>
    setSelected((current) => allFilteredSelected
      ? current.filter((id) => !filteredIds.includes(id))
      : Array.from(new Set([...current, ...filteredIds])));

  const resetForm = () => {
    setTitle(''); setDescription(''); setDeadline(''); setDeadlineTime(''); setStars(0); setMode('all'); setSelected([]); setQuery('');
    setAttempted(false); setServerError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    setAttempted(true);
    setServerError('');
    const found = validate();
    const firstInvalid = found.title ? ids.title : found.deadline ? ids.deadline : found.assignees ? (mode === 'specific' && members.length ? ids.search : null) : null;
    if (Object.keys(found).length) {
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }

    const cleanTitle = title.trim();
    const bonus = starsToBonusPoints(stars);
    const now = new Date().toISOString();
    const tracking: Record<string, TaskTrackingEntry> = Object.fromEntries(
      (audience === 'ALL' ? members.map((member) => String(member.id)) : audience).map((id) => [id, { status: 'pending', updated_at: now, note: '', submission_url: '' }]),
    );
    const payload: TaskInsert = {
      team_id: teamId ?? null,
      title: cleanTitle,
      description: description.trim() || null,
      has_deadline: Boolean(deadline),
      deadline_date: deadline ? deadlineValue(deadline, deadlineTime) : null,
      assigned_to: audience,
      tracking,
      bonus_points: bonus,
    };
    try {
      const result = await create.mutateAsync(payload);
      const formattedBonus = locale === 'ar' ? formatSigned(bonus) : new Intl.NumberFormat('en-GB', { signDisplay: 'always', maximumFractionDigits: 0 }).format(bonus);
      const bonusText = bonus > 0 && !result.bonusSkipped ? t(` ببونص ${formattedBonus}`, ` with ${formattedBonus} bonus`) : '';
      const assignedLabel = mode === 'all'
        ? t('كل الفريق', 'the entire team')
        : mode === 'leads'
          ? t('قادة مشاريع الويب', 'web-project leaders')
          : mode === 'heads'
            ? t('رؤساء ومراقبي التيمات', 'team heads & monitors')
            : locale === 'ar' ? arCount(assigneeCount, AR.memberGen) : `${number(assigneeCount)} ${assigneeCount === 1 ? 'member' : 'members'}`;
      toast.success(t(`اتعملت «${cleanTitle}»${bonusText} واتسندت لـ ${assignedLabel}.`, `“${cleanTitle}” was created${bonusText} and assigned to ${assignedLabel}.`));
      if (bonus > 0 && result.bonusSkipped) toast.warning(t('اتعملت المهمة من غير بونص: قاعدة البيانات محتاجة تحديث 0012 الأول.', 'Task created without a bonus: the database needs migration 0012.'));
      resetForm();
      onClose();
    } catch (cause) {
      setServerError(handleSupabaseError(cause).message || t('معرفناش نعمل المهمة، ومفيش حاجة اتحفظت. جرّب تاني.', 'Could not create the task; nothing was saved. Try again.'));
    }
  };

  const modeOptions: Array<{ value: AssignMode; title: string; hint: string; Icon: typeof Users }> = [
    { value: 'all', title: t('كل الفريق', 'Entire team'), hint: membersLoading ? t('بنحمّل...', 'Loading...') : locale === 'ar' ? arCount(members.length, AR.member) : `${number(members.length)} ${members.length === 1 ? 'member' : 'members'}`, Icon: Users },
    { value: 'specific', title: t('أعضاء محددين', 'Specific members'), hint: selectedValid.length ? locale === 'ar' ? `اتحدد ${arCount(selectedValid.length, AR.memberGen)}` : `${number(selectedValid.length)} selected` : t('اختار بالاسم', 'Choose by name'), Icon: UserCheck },
    { value: 'leads', title: t('قادة مشاريع الويب', 'Web-project leaders'), hint: groups.isLoading ? t('بنحمّل...', 'Loading...') : locale === 'ar' ? arCount(groupMembers.leads.length, AR.member) : `${number(groupMembers.leads.length)} ${groupMembers.leads.length === 1 ? 'leader' : 'leaders'}`, Icon: Layers },
    { value: 'heads', title: t('رؤساء ومراقبو التيمات', 'Team heads & monitors'), hint: groups.isLoading ? t('بنحمّل...', 'Loading...') : locale === 'ar' ? arCount(groupMembers.heads.length, AR.member) : `${number(groupMembers.heads.length)} ${groupMembers.heads.length === 1 ? 'member' : 'members'}`, Icon: ShieldCheck },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("تكليف مهمة جديدة", "Assign a new task")}
      subtitle={t("حدّد المهمة وموعدها واختار مين هينفذها.", "Set the task and deadline, then choose who will complete it.")}
      icon={<CheckSquare size={20} />}
      maxWidth="xl"
      footer={
        <div className="grid gap-2.5 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <p className={`text-xs font-bold leading-5 ${!membersLoading && assigneeCount === 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">{summary}</p>
          <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>{t("إلغاء", "Cancel")}</Button>
            <Button type="submit" form={formId} isLoading={create.isPending} loadingText={t("بنعمل...", "Creating...")} disabled={membersLoading}>{t("اعمل المهمة", "Create task")}</Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
        {serverError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold leading-6 text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        )}

        {/* العنوان */}
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={ids.title} className="text-sm font-bold">
              {t("عنوان المهمة", "Task title")} <span className="text-[var(--danger)]" aria-hidden="true">*</span>
            </label>
            <span className={`text-xs tabular-nums ${title.length >= TITLE_MAX - 10 ? 'font-bold text-amber-700 dark:text-amber-300' : 'text-[var(--text-muted)]'}`}>{title.length}/{TITLE_MAX}</span>
          </div>
          <input
            id={ids.title}
            data-autofocus
            value={title}
            maxLength={TITLE_MAX}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("مثال: تجهيز تصاميم حملة نوفمبر", "Example: Prepare November campaign designs")}
            aria-required="true"
            aria-invalid={Boolean(errors.title) || undefined}
            aria-describedby={errors.title ? ids.titleError : undefined}
            className={`min-h-12 ${fieldClass(Boolean(errors.title))}`}
          />
          {errors.title && <FieldError id={ids.titleError}>{errors.title}</FieldError>}
        </div>

        {/* التفاصيل */}
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={ids.description} className="text-sm font-bold">
              {t("التفاصيل", "Details")} <span className="text-xs font-medium text-[var(--text-muted)]">({t("اختياري", "optional")})</span>
            </label>
            {description.length > 0 && <span className="text-xs tabular-nums text-[var(--text-muted)]">{description.length}/{DESC_MAX}</span>}
          </div>
          <textarea
            id={ids.description}
            rows={3}
            value={description}
            maxLength={DESC_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("اكتب المطلوب بالضبط، والروابط المرجعية، ومعايير القبول...", "Describe requirements, references, and acceptance criteria...")}
            className={`min-h-24 resize-y py-2.5 leading-7 ${fieldClass(false)}`}
          />
        </div>

        {/* الموعد النهائي */}
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={ids.deadline} className="text-sm font-bold">
              {t('الموعد النهائي', 'Deadline')} <span className="text-xs font-medium text-[var(--text-muted)]">({t('اختياري', 'optional')})</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("اختار الموعد النهائي بسرعة", "Choose a quick deadline")}>
            {QUICK_DEADLINES.map((option) => {
              const value = option.days === null ? '' : addDaysISO(option.days);
              const active = deadline === value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setDeadline(value); if (!value) setDeadlineTime(''); }}
                  className={`min-h-10 rounded-full border px-3.5 text-xs font-bold transition-colors ${active ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--primary)] hover:text-[var(--link)]'}`}
                >
                  {option.days === null ? t('بدون موعد', 'No deadline') : option.days === 0 ? t('النهارده', 'Today') : option.days === 1 ? t('بكرة', 'Tomorrow') : option.days === 3 ? t('بعد 3 أيام', 'In 3 days') : t('بعد أسبوع', 'In one week')}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2 sm:max-w-md">
            <input
              id={ids.deadline}
              type="date"
              min={today}
              value={deadline}
              onChange={(event) => { setDeadline(event.target.value); if (!event.target.value) setDeadlineTime(''); }}
              aria-invalid={Boolean(errors.deadline) || undefined}
              aria-describedby={errors.deadline ? ids.deadlineError : ids.deadlineHint}
              className={`min-h-11 ${fieldClass(Boolean(errors.deadline))}`}
            />
            <div className="relative">
              <label htmlFor={ids.time} className="sr-only">{t('وقت التسليم (اختياري)', 'Deadline time (optional)')}</label>
              <input
                id={ids.time}
                type="time"
                step={300}
                value={deadlineTime}
                disabled={!deadline}
                onChange={(event) => setDeadlineTime(event.target.value)}
                aria-describedby={ids.deadlineHint}
                className={`min-h-11 disabled:cursor-not-allowed disabled:opacity-50 ${fieldClass(Boolean(errors.deadline) && Boolean(deadlineTime))}`}
              />
            </div>
          </div>
          {deadline && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('اختار وقت التسليم بسرعة', 'Choose a quick deadline time')}>
              {[{ label: t('آخر النهار', 'End of day'), value: '' }, { label: t('12 الضهر', '12 noon'), value: '12:00' }, { label: t('6 المسا', '6 pm'), value: '18:00' }, { label: t('9 بالليل', '9 pm'), value: '21:00' }].map((option) => {
                const active = deadlineTime === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDeadlineTime(option.value)}
                    className={`min-h-9 rounded-full border px-3 text-xs font-bold transition-colors ${active ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--link)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--primary)] hover:text-[var(--link)]'}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
          {errors.deadline
            ? <FieldError id={ids.deadlineError}>{errors.deadline}</FieldError>
            : <p id={ids.deadlineHint} className="text-xs leading-5 text-[var(--text-muted)]">{deadline ? deadlineHint(deadline, deadlineTime, locale, t, (value) => locale === 'ar' ? formatDeadline(value, { weekday: true, year: 'always' }) : date(value, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), number) : t('من غير موعد نهائي — المهمة مش هتظهر متأخرة.', 'Without a deadline, the task will not be marked overdue.')}</p>}
        </div>

        {/* البونص بالنجوم */}
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold">{t('بونص المهمة', 'Task bonus')} <span className="text-xs font-medium text-[var(--text-muted)]">({t('اختياري', 'optional')})</span></span>
            <span className="text-xs font-bold tabular-nums text-[var(--text-muted)]" aria-live="polite">
              {starsLabel(stars, locale)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('بونص المهمة بالنجوم', 'Task bonus in stars')} id={ids.stars}>
            {Array.from({ length: STAR_MAX }, (_, index) => index + 1).map((value) => {
              const active = stars >= value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={stars === value}
                  aria-label={t(`${number(value)} نجوم`, `${number(value)} stars`)}
                  onClick={() => setStars(stars === value ? 0 : value)}
                  className={`grid size-11 place-items-center rounded-xl border transition-colors ${active ? 'border-amber-500 bg-amber-500/12 text-amber-600 dark:border-amber-400 dark:text-amber-300' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-amber-500 hover:text-amber-600'}`}
                >
                  <Star size={20} aria-hidden="true" fill={active ? 'currentColor' : 'none'} />
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={stars === 0}
              onClick={() => setStars(0)}
              className={`min-h-11 rounded-xl border px-3 text-xs font-bold transition-colors ${stars === 0 ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--link)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--primary)] hover:text-[var(--link)]'}`}
            >
              {t('بدون', 'None')}
            </button>
          </div>
          <p id={ids.bonusHint} className="text-xs leading-5 text-[var(--text-muted)]">
            {stars > 0
              ? t(`كل عضو هياخد ${formatSigned(starsToBonusPoints(stars))} نقطة بونص تلقائيًا لما تسليمه يتعتمد (${number(stars)} نجمة × ${number(POINTS_PER_STAR)}).`, `Each member earns ${new Intl.NumberFormat('en-GB', { signDisplay: 'always' }).format(starsToBonusPoints(stars))} bonus points when their submission is approved (${number(stars)} × ${number(POINTS_PER_STAR)}).`)
              : t('من غير بونص — العضو هياخد نقاط الاعتماد العادية بس.', 'No bonus — members will only receive the standard approval points.')}
          </p>
        </div>

        {/* الإسناد */}
        <fieldset className="grid gap-3" aria-describedby={errors.assignees ? ids.assigneesError : undefined}>
          <legend className="mb-2 text-sm font-bold">
            {t('المهمة دي لمين؟', 'Who is this task for?')} <span className="text-[var(--danger)]" aria-hidden="true">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {modeOptions.map(({ value, title: optionTitle, hint, Icon }) => (
              <label
                key={value}
                className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--accent)] has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--link)]"
              >
                <input
                  type="radio"
                  name={`${formId}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="sr-only"
                />
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]" aria-hidden="true"><Icon size={19} /></span>
                <span className="grid min-w-0 gap-0.5 leading-5">
                  <span className="text-[13px] font-black">{optionTitle}</span>
                  <span className="truncate text-xs text-[var(--text-muted)]">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {membersLoading ? (
            <div className="grid gap-2 rounded-xl border border-[var(--border)] p-3" aria-busy="true">
              {[0, 1, 2].map((row) => <div key={row} className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />)}
            </div>
          ) : mode === 'specific' && members.length > 0 && (
            <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 sm:p-3">
              <div className="relative">
                <Search size={17} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  id={ids.search}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('دوّر بالاسم أو المحافظة...', 'Search by name or residence...')}
                  aria-label={t('دور على عضو', 'Search members')}
                  className={`min-h-11 ps-10 pe-10 ${fieldClass(false)} bg-[var(--surface)]`}
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute inset-y-0 end-1 my-auto grid size-9 min-h-0 min-w-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label={t('امسح البحث', 'Clear search')}>
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-bold text-[var(--text-muted)]" aria-live="polite">
                  {selectedValid.length ? t(`المحدد: ${selectedValid.length} من ${members.length}`, `${number(selectedValid.length)} of ${number(members.length)} selected`) : locale === 'ar' ? `${arCount(members.length, AR.member)} في الفريق` : `${number(members.length)} members on the team`}
                </span>
                <div className="flex gap-1">
                  {filteredIds.length > 0 && (
                    <button type="button" onClick={toggleAllFiltered} className="min-h-9 rounded-lg px-2.5 text-xs font-bold text-[var(--link)] hover:bg-[var(--primary-soft)]">
                      {allFilteredSelected ? t('شيل تحديد الظاهر', 'Clear visible selection') : query ? t('حدد نتائج البحث', 'Select search results') : t('حدد الكل', 'Select all')}
                    </button>
                  )}
                  {selectedValid.length > 0 && !allFilteredSelected && (
                    <button type="button" onClick={() => setSelected([])} className="min-h-9 rounded-lg px-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--surface-2)]">
                      {t('امسح الاختيار', 'Clear selection')}
                    </button>
                  )}
                </div>
              </div>
              <ul className="grid max-h-64 gap-1 overflow-y-auto overscroll-contain pe-1" aria-label={t('أعضاء الفريق', 'Team members')}>
                {filtered.length === 0 && (
                  <li className="rounded-lg p-4 text-center text-sm text-[var(--text-muted)]">{t(`مفيش عضو مطابق لـ «${query}».`, `No members match “${query}”.`)}</li>
                )}
                {filtered.map((member) => {
                  const id = String(member.id);
                  const checked = selectedValid.includes(id);
                  return (
                    <li key={id}>
                      <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-1.5 transition-colors ${checked ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-transparent hover:bg-[var(--surface-2)]'}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(id)} className="size-[18px] shrink-0 cursor-pointer" />
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-black text-[var(--link)]" aria-hidden="true">{initialsOf(member.full_name, locale)}</span>
                        <span className="grid min-w-0 flex-1 leading-5">
                          <span className="truncate text-sm font-bold" title={member.full_name}>{member.full_name}</span>
                          {member.residence && <span className="truncate text-xs text-[var(--text-muted)]">{member.residence}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {(mode === 'leads' || mode === 'heads') && (
            groups.isLoading ? (
              <div className="grid gap-2 rounded-xl border border-[var(--border)] p-3" aria-busy="true">
                {[0, 1].map((row) => <div key={row} className="h-9 animate-pulse rounded-lg bg-[var(--surface-2)]" />)}
              </div>
            ) : groupAudience.length > 0 ? (
              <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                <p className="text-xs font-bold text-[var(--text-muted)]">
                  {mode === 'leads' ? t('المهمة هتتسند لكل قادة مشاريع الويب دول:', 'This task goes to these web-project leaders:') : t('المهمة هتتسند لكل رؤساء ومراقبي التيمات دول:', 'This task goes to these team heads & monitors:')}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {groupAudience.map((member) => (
                    <li key={member.id} className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold">
                      <span className="grid size-5 place-items-center rounded-full bg-[var(--primary-soft)] text-[10px] font-black text-[var(--link)]" aria-hidden="true">{initialsOf(member.full_name, locale)}</span>
                      <span className="max-w-40 truncate" title={member.full_name}>{member.full_name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
          {errors.assignees && <FieldError id={ids.assigneesError}>{errors.assignees}</FieldError>}
        </fieldset>
      </form>
    </Modal>
  );
}
