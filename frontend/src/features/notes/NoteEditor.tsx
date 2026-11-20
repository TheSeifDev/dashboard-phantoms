import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { Member, NoteInsert } from '../../types/db';
import { useCreateNote } from './api';
import { useLocale } from '../../i18n/useLocale';

interface NoteEditorProps {
  isOpen: boolean;
  members: Member[];
  membersLoading?: boolean;
  membersError?: boolean;
  onRetryMembers?: () => void;
  onClose: () => void;
}

export function NoteEditor({ isOpen, members, membersLoading = false, membersError = false, onRetryMembers, onClose }: NoteEditorProps) {
  const { t, date } = useLocale();
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(() => t('إدارة PHANTOMS', 'PHANTOMS Administration'));
  const [targetType, setTargetType] = useState<'all' | 'member'>('all');
  const [targetMemberId, setTargetMemberId] = useState<number | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [formError, setFormError] = useState('');
  const createNote = useCreateNote();

  const reset = () => {
    setText('');
    setAuthor(t('إدارة PHANTOMS', 'PHANTOMS Administration'));
    setTargetType('all');
    setTargetMemberId(null);
    setPoints(0);
    setFormError('');
  };

  const pickPoints = (value: number) => {
    setPoints(value);
    if (value !== 0) setTargetType('member');
    setFormError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim()) {
      setFormError(t('اكتب محتوى الملاحظة.', 'Enter the note content.'));
      return;
    }
    if (points !== 0 && targetMemberId == null) {
      setFormError(t('البونص بيتسجّل لعضو محدد — اختار العضو المستهدف أو خلّي القيمة صفر.', 'Points are recorded for a specific member. Select the member or set the value to zero.'));
      return;
    }
    const targetMember = members.find((member) => member.id === targetMemberId);
    // نفس صيغة النظام القديم: صفر = نص صافٍ، وغيره وسم [B:±N] يُحتسب في الترتيب
    const tag = points === 0 ? '' : points > 0 ? `[B:+${points}]` : `[B:${points}]`;
    const payload: NoteInsert = {
      text: tag ? `${text.trim()} ${tag}` : text.trim(),
      author: author.trim() || t('الإدارة', 'Admin'),
      author_role: 'Admin',
      date: date(new Date(), { dateStyle: 'medium' }),
      target_member_id: targetType === 'member' ? targetMemberId : null,
      target_name: targetType === 'member' ? targetMember?.full_name ?? null : null,
    };
    try {
      await createNote.mutateAsync(payload);
      reset();
      onClose();
    } catch {
      setFormError(t('معرفناش نحفظ الملاحظة. جرّب تاني؛ النص اللي كتبته لسه موجود.', 'Could not save the note. Please retry; your text is still here.'));
    }
  };

  const memberSelectDisabled = members.length === 0 && (membersLoading || membersError);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('اكتب ملاحظة وتوجيه جديد', 'Write a new note or instruction')} subtitle={t('الملاحظة العامة تظهر للفريق، والملاحظة الموجّهة ترتبط بعضو محدد.', 'Team notes are shared with everyone; member notes are linked to one person.')} maxWidth="md">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {formError && <p className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]" role="alert" aria-live="assertive"><AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{formError}</p>}

        <label className="grid gap-2 text-sm font-bold">
          {t('اكتب الملاحظة أو التوجيه *', 'Note or instruction *')}
          <textarea
            rows={5}
            required
            dir="auto"
            value={text}
            onChange={(event) => { setText(event.target.value); setFormError(''); }}
            placeholder={t('اكتب التوجيه أو الملاحظة هنا بالتفصيل...', 'Write the note or instruction in detail...')}
            aria-describedby="note-content-help"
            className="min-h-32 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-base leading-6 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
          />
          <span id="note-content-help" className="text-xs font-normal leading-5 text-[var(--text-muted)]">{t('اكتب النص كما تريد أن يظهر في السجل.', 'Enter the text as you want it to appear in the record.')}</span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">
            {t('اسم الكاتب', 'Author name')}
            <input dir="auto" value={author} onChange={(event) => setAuthor(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm" />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            {t('وجّه الملاحظة إلى', 'Address this note to')}
            <select
              value={targetType}
              onChange={(event) => { setTargetType(event.target.value as typeof targetType); setFormError(''); }}
              className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            >
              <option value="all">{t('كل الفريق', 'Entire team')}</option>
              <option value="member">{t('عضو محدد', 'Specific member')}</option>
            </select>
          </label>
        </div>

        {targetType === 'member' && (
          <div className="grid gap-2">
            <label className="grid gap-2 text-sm font-bold" htmlFor="note-target-member">{t('العضو المستهدف', 'Target member')}
              <select
                id="note-target-member"
                required
                disabled={memberSelectDisabled}
                value={targetMemberId ?? ''}
                onChange={(event) => { setTargetMemberId(event.target.value === '' ? null : Number(event.target.value)); setFormError(''); }}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              >
                <option value="">{membersLoading ? t('بنحمّل الأعضاء...', 'Loading members...') : t('اختار عضوًا', 'Select a member')}</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}
              </select>
            </label>
            {membersLoading && members.length === 0 ? (
              <p role="status" className="text-xs text-[var(--text-muted)]">{t('قائمة الأعضاء لسه بتتحمّل.', 'The member list is still loading.')}</p>
            ) : membersError && members.length === 0 ? (
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)] sm:flex-row sm:items-center sm:justify-between">
                <p role="alert">{t('معرفناش نحمّل الأعضاء؛ جرّب تاني أو اختار كل الفريق.', 'Could not load members. Retry or choose the entire team.')}</p>
                {onRetryMembers && <Button type="button" variant="secondary" onClick={onRetryMembers} icon={<RefreshCw size={16} />} fullOnMobile>{t('إعادة المحاولة', 'Retry')}</Button>}
              </div>
            ) : membersError ? (
              <p role="status" className="text-xs text-[var(--text-muted)]">{t('تعذّر تحديث القائمة؛ الأسماء المحمّلة ما زالت متاحة.', 'Could not refresh the list; the loaded names are still available.')}</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">{t('مفيش أعضاء متاحين للاستهداف حاليًا.', 'There are no members available to target right now.')}</p>
            ) : null}
          </div>
        )}

        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold">{t('نقط البونص أو الخصم (اختياري)', 'Bonus or deduction points (optional)')}</legend>
          <p className="text-xs leading-5 text-[var(--text-muted)]">{t('النقط من 1 إلى 5. اختيار قيمة غير صفرية يوجّه الملاحظة تلقائيًا لعضو وتدخل في ترتيبه.', 'Choose between 1 and 5 points. Any non-zero value automatically targets a member and affects their ranking.')}</p>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('اختيار نقاط البونص أو الخصم', 'Choose bonus or deduction points')}>
            <button type="button" onClick={() => pickPoints(0)} aria-pressed={points === 0} className={`min-h-11 rounded-xl px-3 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${points === 0 ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]'}`}>{t('0 — بدون', '0 — None')}</button>
            {[1, 2, 3, 4, 5].map((value) => (
              <button type="button" key={`pos-${value}`} onClick={() => pickPoints(value)} aria-pressed={points === value} aria-label={t(`إضافة ${value} ${value === 1 ? 'نقطة بونص' : 'نقط بونص'}`, `Add ${value} bonus ${value === 1 ? 'point' : 'points'}`)} className={`min-h-11 min-w-11 rounded-xl px-3 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--success-border)] ${points === value ? 'bg-[var(--success)] text-[var(--on-success)]' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--success-border)]'}`}>+{value}</button>
            ))}
            {[-1, -2, -3, -4, -5].map((value) => (
              <button type="button" key={`neg-${value}`} onClick={() => pickPoints(value)} aria-pressed={points === value} aria-label={t(`خصم ${Math.abs(value)} ${Math.abs(value) === 1 ? 'نقطة' : 'نقط'}`, `Deduct ${Math.abs(value)} ${Math.abs(value) === 1 ? 'point' : 'points'}`)} className={`min-h-11 min-w-11 rounded-xl px-3 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger-border)] ${points === value ? 'bg-[var(--danger)] text-[var(--on-danger)]' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--danger-border)]'}`}>{value}</button>
            ))}
          </div>
          <p className="text-xs font-semibold text-[var(--text-muted)]" aria-live="polite">
            {points === 0
              ? t('ملاحظة للتوثيق من غير نقط.', 'A note for the record, with no points.')
              : t(`الوسم ${points > 0 ? `[B:+${points}]` : `[B:${points}]`} هيتسجّل ويتحسب في ترتيب العضو.`, `The ${points > 0 ? `[B:+${points}]` : `[B:${points}]`} tag will be saved and counted in the member ranking.`)}
          </p>
        </fieldset>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
          <Button type="submit" isLoading={createNote.isPending} loadingText={t('بنحفظ...', 'Saving...')} fullOnMobile>{t('حفظ الملاحظة', 'Save note')}</Button>
        </div>
      </form>
    </Modal>
  );
}
