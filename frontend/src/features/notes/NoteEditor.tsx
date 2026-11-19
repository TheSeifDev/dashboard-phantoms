import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { Member, NoteInsert } from '../../types/db';
import { useCreateNote } from './api';

import { useLocale } from '../../i18n/useLocale';
export function NoteEditor({ isOpen, members, onClose }: { isOpen: boolean; members: Member[]; onClose: () => void }) {
  const { t, date } = useLocale();
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('إدارة PHANTOMS');
  const [targetType, setTargetType] = useState<'all' | 'member'>('all');
  const [targetMemberId, setTargetMemberId] = useState<number | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [formError, setFormError] = useState('');
  const createNote = useCreateNote();

  const reset = () => {
    setText('');
    setAuthor('إدارة PHANTOMS');
    setTargetType('all');
    setTargetMemberId(null);
    setPoints(0);
    setFormError('');
  };

  const pickPoints = (value: number) => {
    setPoints(value);
    // البونص يُحتسب لعضو محدد فقط — اختياره ينقل الاستهداف تلقائياً لعضو
    if (value !== 0) setTargetType('member');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim()) {
      setFormError(t('اكتب محتوى الملاحظة.', 'Enter the note content.'));
      return;
    }
    if (points !== 0 && targetMemberId == null) {
      setFormError(t('البونص بيتسجّل لعضو محدد — اختار العضو المستهدف أو خلّي القيمة صفر.', 'Bonuses are recorded for a specific member. Select a member or set the value to zero.'));
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
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'معرفناش نحفظ الملاحظة.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("اكتب ملاحظة وتوجيه جديد", "Write a new note or instruction")} maxWidth="md">
      <form onSubmit={submit} className="grid gap-4">
        {formError && <p className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]" role="alert"><AlertCircle size={18} />{formError}</p>}
        <label className="grid gap-2 text-sm font-bold">{t("اكتب الملاحظة والتوجيه *", "Note or instruction *")}
          <textarea rows={4} required value={text} onChange={(event) => setText(event.target.value)} placeholder={t("اكتب التوجيه أو الملاحظة هنا بالتفصيل...", "Write the note or instruction in detail...")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 leading-6" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">{t("اسم الكاتب", "Author name")}
            <input value={author} onChange={(event) => setAuthor(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
          </label>
          <label className="grid gap-2 text-sm font-bold">{t("وجّه الملاحظة لـ", "Address this note to")}
            <select value={targetType} onChange={(event) => setTargetType(event.target.value as typeof targetType)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3">
              <option value="all">{t("كل الفريق", "Entire team")}</option><option value="member">{t("عضو محدد", "Specific member")}</option>
            </select>
          </label>
        </div>
        {targetType === 'member' && <label className="grid gap-2 text-sm font-bold">{t("العضو اللي هيتوجّه له", "Member to address")}<select required value={targetMemberId ?? ''} onChange={(event) => setTargetMemberId(Number(event.target.value))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3"><option value="">{t("اختار عضو", "Select a member")}</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold">{t("نقط البونص (اختياري — بتتحسب في الترتيب لما توجّهها لعضو)", "Bonus points (optional — counted in ranking when addressed to a member)")}</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => pickPoints(0)} className={`min-h-11 px-3 rounded-xl text-sm font-black transition-colors ${points === 0 ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]'}`}>{t("0 — بدون", "0 — None")}</button>
            {[1, 2, 3, 4, 5].map((val) => (
              <button type="button" key={`pos-${val}`} onClick={() => pickPoints(val)} className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${points === val ? 'bg-[var(--success)] text-[var(--on-success)]' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--success-border)]'}`}>+{val}</button>
            ))}
            {[-1, -2, -3, -4, -5].map((val) => (
              <button type="button" key={`neg-${val}`} onClick={() => pickPoints(val)} className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${points === val ? 'bg-[var(--danger)] text-[var(--on-danger)]' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--danger-border)]'}`}>{val}</button>
            ))}
          </div>
          <p className="text-xs font-semibold text-[var(--text-muted)]">{points === 0 ? t('ملاحظة للتوثيق من غير نقط.', 'A note for the record, with no points.') : t(`الوسم ${points > 0 ? `[B:+${points}]` : `[B:${points}]`} هيتسجّل ويتحسب في ترتيب العضو.`, `The ${points > 0 ? `[B:+${points}]` : `[B:${points}]`} tag will be saved and counted in the member ranking.`)}</p>
        </fieldset>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={onClose} fullOnMobile>{t("إلغاء", "Cancel")}</Button><Button type="submit" isLoading={createNote.isPending} loadingText={t("بنحفظ...", "Saving...")} fullOnMobile>{t("حفظ الملاحظة", "Save note")}</Button></div>
      </form>
    </Modal>
  );
}
