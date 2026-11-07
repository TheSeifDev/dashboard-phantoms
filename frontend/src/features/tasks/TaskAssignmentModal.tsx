import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CheckSquare, Gift, Search, UserCheck, Users, X } from 'lucide-react';
import type { Member, TaskInsert, TaskTrackingEntry } from '../../types/db';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { addDaysISO, combineLocalDateTime, daysRemaining, formatDeadline, hoursRemaining } from '../../lib/dateUtils';
import { AR, arCount, arDaysPhrase, arDurationPhrase, formatSigned, normalizeArabic } from '../../lib/arabic';
import { useCreateTask } from './api';

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESC_MAX = 2000;
const BONUS_MAX = 50;
const QUICK_BONUS = [0, 5, 10, 15, 20];

type AssignMode = 'all' | 'specific';
type FieldErrors = Partial<Record<'title' | 'deadline' | 'bonus' | 'assignees', string>>;

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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '؟') + (parts[1]?.[0] ?? '');
}

/** القيمة المخزنة: تاريخ فقط (= نهاية اليوم) أو تاريخ + ساعة بإزاحة المنطقة */
function deadlineValue(date: string, time: string): string {
  return time ? combineLocalDateTime(date, time) : date;
}

function deadlineHint(date: string, time: string): string {
  const value = deadlineValue(date, time);
  const days = daysRemaining(value);
  const hours = hoursRemaining(value);
  const when = time && hours !== null && hours > 0 && hours < 24
    ? `خلال ${arDurationPhrase(hours)}`
    : days === 0 ? 'النهارده' : days === 1 ? 'بكرة' : days !== null && days > 1 ? `بعد ${arDaysPhrase(days)}` : '';
  const label = formatDeadline(value, { weekday: true, year: 'always' });
  return `${time ? `موعدها يوم ${label}` : `موعدها آخر يوم ${label}`}${when ? ` — ${when}` : ''}.`;
}

/** "10" → 10 ؛ فارغ → 0 ؛ غير صالح → NaN */
function parseBonus(input: string): number {
  const clean = input.trim();
  if (!clean) return 0;
  return /^\d+$/.test(clean) ? Number(clean) : Number.NaN;
}

export function TaskAssignmentModal({
  isOpen,
  members,
  membersLoading = false,
  onClose,
}: {
  isOpen: boolean;
  members: Member[];
  membersLoading?: boolean;
  onClose: () => void;
}) {
  const create = useCreateTask();
  const formId = useId();
  const ids = {
    title: `${formId}-title`,
    titleError: `${formId}-title-error`,
    description: `${formId}-description`,
    deadline: `${formId}-deadline`,
    deadlineHint: `${formId}-deadline-hint`,
    deadlineError: `${formId}-deadline-error`,
    time: `${formId}-time`,
    bonus: `${formId}-bonus`,
    bonusHint: `${formId}-bonus-hint`,
    bonusError: `${formId}-bonus-error`,
    search: `${formId}-search`,
    assigneesError: `${formId}-assignees-error`,
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [bonusInput, setBonusInput] = useState('0');
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

  const today = addDaysISO(0);
  const filtered = useMemo(() => {
    const needle = normalizeArabic(query);
    if (!needle) return members;
    return members.filter((member) => normalizeArabic(`${member.full_name} ${member.residence ?? ''}`).includes(needle));
  }, [members, query]);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    const cleanTitle = title.trim();
    if (!cleanTitle) errors.title = 'اكتب عنوان واضح للمهمة.';
    else if (cleanTitle.length < TITLE_MIN) errors.title = `العنوان قصير قوي — ${TITLE_MIN} حروف على الأقل.`;
    if (deadline && deadline < today) errors.deadline = 'مينفعش تختار تاريخ فات — اختار النهارده أو تاريخ بعد كده.';
    else if (deadline && deadlineTime && (hoursRemaining(deadlineValue(deadline, deadlineTime)) ?? 1) <= 0) errors.deadline = 'الساعة دي عدّت — اختار وقت بعد كده النهارده أو يوم تاني.';
    const bonusValue = parseBonus(bonusInput);
    if (Number.isNaN(bonusValue) || bonusValue < 0 || bonusValue > BONUS_MAX) errors.bonus = `البونص لازم يكون رقم صحيح من 0 لـ ${BONUS_MAX}.`;
    if (!membersLoading && members.length === 0) errors.assignees = 'مفيش أعضاء في الفريق لسه — ضيف أعضاء من صفحة الأعضاء الأول.';
    else if (mode === 'specific' && selectedValid.length === 0) errors.assignees = 'اختار عضو واحد على الأقل، أو ادّي المهمة لكل الفريق.';
    return errors;
  };
  const errors = attempted ? validate() : {};

  const assigneeCount = mode === 'all' ? members.length : selectedValid.length;
  const summary = membersLoading
    ? 'بنحمّل قائمة الأعضاء...'
    : mode === 'all'
      ? `هتتسند لكل الفريق (${arCount(members.length, AR.member)}).`
      : selectedValid.length
        ? `هتتسند لـ ${arCount(selectedValid.length, AR.memberGen)}.`
        : 'لسه ما اخترتش أي عضو.';

  const toggleMember = (id: string) =>
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const filteredIds = filtered.map((member) => String(member.id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedValid.includes(id));
  const toggleAllFiltered = () =>
    setSelected((current) => allFilteredSelected
      ? current.filter((id) => !filteredIds.includes(id))
      : Array.from(new Set([...current, ...filteredIds])));

  const resetForm = () => {
    setTitle(''); setDescription(''); setDeadline(''); setDeadlineTime(''); setBonusInput('0'); setMode('all'); setSelected([]); setQuery('');
    setAttempted(false); setServerError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    setAttempted(true);
    setServerError('');
    const found = validate();
    const firstInvalid = found.title ? ids.title : found.deadline ? ids.deadline : found.bonus ? ids.bonus : found.assignees ? (mode === 'specific' && members.length ? ids.search : null) : null;
    if (Object.keys(found).length) {
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }

    const cleanTitle = title.trim();
    const bonus = parseBonus(bonusInput);
    const assignees = mode === 'all' ? members.map((member) => String(member.id)) : selectedValid;
    const now = new Date().toISOString();
    const tracking: Record<string, TaskTrackingEntry> = Object.fromEntries(
      assignees.map((id) => [id, { status: 'pending', updated_at: now, note: '', submission_url: '' }]),
    );
    const payload: TaskInsert = {
      title: cleanTitle,
      description: description.trim() || null,
      has_deadline: Boolean(deadline),
      deadline_date: deadline ? deadlineValue(deadline, deadlineTime) : null,
      assigned_to: mode === 'all' ? 'ALL' : assignees,
      tracking,
      bonus_points: bonus,
    };
    try {
      const result = await create.mutateAsync(payload);
      const bonusText = bonus > 0 && !result.bonusSkipped ? ` ببونص ${formatSigned(bonus)}` : '';
      toast.success(`اتعملت «${cleanTitle}»${bonusText} واتسندت لـ ${mode === 'all' ? 'كل الفريق' : arCount(assignees.length, AR.memberGen)}.`);
      if (bonus > 0 && result.bonusSkipped) toast.warning('اتعملت المهمة من غير بونص: قاعدة البيانات محتاجة تحديث 0012 الأول.');
      resetForm();
      onClose();
    } catch (cause) {
      setServerError(handleSupabaseError(cause).message || 'معرفناش نعمل المهمة، ومفيش حاجة اتحفظت. جرّب تاني.');
    }
  };

  const modeOptions: Array<{ value: AssignMode; title: string; hint: string; Icon: typeof Users }> = [
    { value: 'all', title: 'كل الفريق', hint: membersLoading ? 'بنحمّل...' : arCount(members.length, AR.member), Icon: Users },
    { value: 'specific', title: 'أعضاء محددين', hint: selectedValid.length ? `اتحدد ${arCount(selectedValid.length, AR.memberGen)}` : 'اختار بالاسم', Icon: UserCheck },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="تكليف مهمة جديدة"
      subtitle="حدّد المهمة وموعدها واختار مين هينفذها."
      icon={<CheckSquare size={20} />}
      maxWidth="xl"
      footer={
        <div className="grid gap-2.5 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <p className={`text-xs font-bold leading-5 ${!membersLoading && assigneeCount === 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">{summary}</p>
          <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
            <Button type="submit" form={formId} isLoading={create.isPending} loadingText="بنعمل..." disabled={membersLoading}>اعمل المهمة</Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
        {serverError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold leading-6 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        )}

        {/* العنوان */}
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={ids.title} className="text-sm font-bold">
              عنوان المهمة <span className="text-[var(--danger)]" aria-hidden="true">*</span>
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
            placeholder="مثال: تجهيز تصاميم حملة نوفمبر"
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
              التفاصيل <span className="text-xs font-medium text-[var(--text-muted)]">(اختياري)</span>
            </label>
            {description.length > 0 && <span className="text-xs tabular-nums text-[var(--text-muted)]">{description.length}/{DESC_MAX}</span>}
          </div>
          <textarea
            id={ids.description}
            rows={3}
            value={description}
            maxLength={DESC_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="اكتب المطلوب بالضبط، والروابط المرجعية، ومعايير القبول..."
            className={`min-h-24 resize-y py-2.5 leading-7 ${fieldClass(false)}`}
          />
        </div>

        {/* الموعد النهائي */}
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={ids.deadline} className="text-sm font-bold">
              الموعد النهائي <span className="text-xs font-medium text-[var(--text-muted)]">(اختياري)</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="اختار الموعد النهائي بسرعة">
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
                  {option.label}
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
              <label htmlFor={ids.time} className="sr-only">وقت التسليم (اختياري)</label>
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
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="اختار وقت التسليم بسرعة">
              {[{ label: 'آخر النهار', value: '' }, { label: '12 الضهر', value: '12:00' }, { label: '6 المسا', value: '18:00' }, { label: '9 بالليل', value: '21:00' }].map((option) => {
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
            : <p id={ids.deadlineHint} className="text-xs leading-5 text-[var(--text-muted)]">{deadline ? deadlineHint(deadline, deadlineTime) : 'من غير موعد نهائي — المهمة مش هتظهر متأخرة.'}</p>}
        </div>

        {/* البونص */}
        <div className="grid gap-2">
          <label htmlFor={ids.bonus} className="flex items-center gap-1.5 text-sm font-bold">
            <Gift size={16} className="text-amber-600 dark:text-amber-300" aria-hidden="true" />
            بونص المهمة <span className="text-xs font-medium text-[var(--text-muted)]">(اختياري)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="اختيار سريع للبونص">
              {QUICK_BONUS.map((value) => {
                const active = parseBonus(bonusInput) === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBonusInput(String(value))}
                    className={`min-h-10 min-w-12 rounded-full border px-3 text-xs font-black tabular-nums transition-colors ${active ? 'border-amber-500 bg-amber-500 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-300'}`}
                  >
                    {value === 0 ? 'بدون' : formatSigned(value)}
                  </button>
                );
              })}
            </div>
            <input
              id={ids.bonus}
              type="number"
              inputMode="numeric"
              min={0}
              max={BONUS_MAX}
              step={1}
              value={bonusInput}
              onChange={(event) => setBonusInput(event.target.value)}
              aria-invalid={Boolean(errors.bonus) || undefined}
              aria-describedby={errors.bonus ? ids.bonusError : ids.bonusHint}
              aria-label={`قيمة بونص مخصصة من 0 لـ ${BONUS_MAX}`}
              className={`min-h-10 !w-24 shrink-0 text-center tabular-nums ${fieldClass(Boolean(errors.bonus))}`}
            />
          </div>
          {errors.bonus
            ? <FieldError id={ids.bonusError}>{errors.bonus}</FieldError>
            : <p id={ids.bonusHint} className="text-xs leading-5 text-[var(--text-muted)]">
                {parseBonus(bonusInput) > 0
                  ? `كل عضو هياخد ${formatSigned(parseBonus(bonusInput))} بونص تلقائيًا لما تسليمه يتعتمد، وهيظهر في الترتيب.`
                  : 'من غير بونص — العضو هياخد نقاط الاعتماد العادية بس.'}
              </p>}
        </div>

        {/* الإسناد */}
        <fieldset className="grid gap-3" aria-describedby={errors.assignees ? ids.assigneesError : undefined}>
          <legend className="mb-2 text-sm font-bold">
            المهمة دي لمين؟ <span className="text-[var(--danger)]" aria-hidden="true">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {modeOptions.map(({ value, title: optionTitle, hint, Icon }) => (
              <label
                key={value}
                className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--primary)] has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-soft)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--link)]"
              >
                <input
                  type="radio"
                  name={`${formId}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="sr-only"
                />
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--link)]" aria-hidden="true"><Icon size={19} /></span>
                <span className="grid min-w-0 leading-5">
                  <span className="text-sm font-black">{optionTitle}</span>
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
                  placeholder="دوّر بالاسم أو المحافظة..."
                  aria-label="دور على عضو"
                  className={`min-h-11 ps-10 pe-10 ${fieldClass(false)} bg-[var(--surface)]`}
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute inset-y-0 end-1 my-auto grid size-9 min-h-0 min-w-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label="امسح البحث">
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-bold text-[var(--text-muted)]" aria-live="polite">
                  {selectedValid.length ? `المحدد: ${selectedValid.length} من ${members.length}` : `${arCount(members.length, AR.member)} في الفريق`}
                </span>
                <div className="flex gap-1">
                  {filteredIds.length > 0 && (
                    <button type="button" onClick={toggleAllFiltered} className="min-h-9 rounded-lg px-2.5 text-xs font-bold text-[var(--link)] hover:bg-[var(--primary-soft)]">
                      {allFilteredSelected ? 'شيل تحديد الظاهر' : query ? 'حدد نتائج البحث' : 'حدد الكل'}
                    </button>
                  )}
                  {selectedValid.length > 0 && !allFilteredSelected && (
                    <button type="button" onClick={() => setSelected([])} className="min-h-9 rounded-lg px-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--surface-2)]">
                      امسح الاختيار
                    </button>
                  )}
                </div>
              </div>
              <ul className="grid max-h-64 gap-1 overflow-y-auto overscroll-contain pe-1" aria-label="أعضاء الفريق">
                {filtered.length === 0 && (
                  <li className="rounded-lg p-4 text-center text-sm text-[var(--text-muted)]">مفيش عضو مطابق لـ «{query}».</li>
                )}
                {filtered.map((member) => {
                  const id = String(member.id);
                  const checked = selectedValid.includes(id);
                  return (
                    <li key={id}>
                      <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-1.5 transition-colors ${checked ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-transparent hover:bg-[var(--surface-2)]'}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(id)} className="size-[18px] shrink-0 cursor-pointer" />
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-black text-[var(--link)]" aria-hidden="true">{initialsOf(member.full_name)}</span>
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
          {errors.assignees && <FieldError id={ids.assigneesError}>{errors.assignees}</FieldError>}
        </fieldset>
      </form>
    </Modal>
  );
}
