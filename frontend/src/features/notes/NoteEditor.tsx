import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { Member, NoteInsert } from '../../types/db';
import { useCreateNote } from './api';

export function NoteEditor({ isOpen, members, onClose }: { isOpen: boolean; members: Member[]; onClose: () => void }) {
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('إدارة وصلة');
  const [targetType, setTargetType] = useState<'all' | 'member'>('all');
  const [targetMemberId, setTargetMemberId] = useState<number | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [formError, setFormError] = useState('');
  const createNote = useCreateNote();

  const reset = () => {
    setText('');
    setAuthor('إدارة وصلة');
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
      setFormError('اكتب محتوى الملاحظة.');
      return;
    }
    if (points !== 0 && targetMemberId == null) {
      setFormError('البونص بيتسجّل لعضو محدد — اختار العضو المستهدف أو خلّي القيمة صفر.');
      return;
    }
    const targetMember = members.find((member) => member.id === targetMemberId);
    // نفس صيغة النظام القديم: صفر = نص صافٍ، وغيره وسم [B:±N] يُحتسب في الترتيب
    const tag = points === 0 ? '' : points > 0 ? `[B:+${points}]` : `[B:${points}]`;
    const payload: NoteInsert = {
      text: tag ? `${text.trim()} ${tag}` : text.trim(),
      author: author.trim() || 'الإدارة',
      author_role: 'Admin',
      date: new Date().toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }),
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
    <Modal isOpen={isOpen} onClose={onClose} title="اكتب ملاحظة وتوجيه جديد" maxWidth="md">
      <form onSubmit={submit} className="grid gap-4">
        {formError && <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100" role="alert"><AlertCircle size={18} />{formError}</p>}
        <label className="grid gap-2 text-sm font-bold">اكتب الملاحظة والتوجيه *
          <textarea rows={4} required value={text} onChange={(event) => setText(event.target.value)} placeholder="اكتب التوجيه أو الملاحظة هنا بالتفصيل..." className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 leading-6" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">اسم الكاتب
            <input value={author} onChange={(event) => setAuthor(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
          </label>
          <label className="grid gap-2 text-sm font-bold">وجّه الملاحظة لـ
            <select value={targetType} onChange={(event) => setTargetType(event.target.value as typeof targetType)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3">
              <option value="all">كل الفريق</option><option value="member">عضو محدد</option>
            </select>
          </label>
        </div>
        {targetType === 'member' && <label className="grid gap-2 text-sm font-bold">العضو اللي هيتوجّه له<select required value={targetMemberId ?? ''} onChange={(event) => setTargetMemberId(Number(event.target.value))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3"><option value="">اختار عضو</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold">نقط البونص (اختياري — بتتحسب في الترتيب لما توجّهها لعضو)</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => pickPoints(0)} className={`min-h-11 px-3 rounded-xl text-sm font-black transition-colors ${points === 0 ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]'}`}>0 — بدون</button>
            {[1, 2, 3, 4, 5].map((val) => (
              <button type="button" key={`pos-${val}`} onClick={() => pickPoints(val)} className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${points === val ? 'bg-emerald-600 text-white' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-emerald-400'}`}>+{val}</button>
            ))}
            {[-1, -2, -3, -4, -5].map((val) => (
              <button type="button" key={`neg-${val}`} onClick={() => pickPoints(val)} className={`min-h-11 min-w-11 px-3 rounded-xl text-sm font-black transition-colors ${points === val ? 'bg-red-600 text-white' : 'border border-[var(--border)] bg-[var(--bg)] hover:border-red-400'}`}>{val}</button>
            ))}
          </div>
          <p className="text-xs font-semibold text-[var(--text-muted)]">{points === 0 ? 'ملاحظة للتوثيق من غير نقط.' : `الوسم ${points > 0 ? `[B:+${points}]` : `[B:${points}]`} هيتسجّل ويتحسب في ترتيب العضو.`}</p>
        </fieldset>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={onClose} fullOnMobile>إلغاء</Button><Button type="submit" isLoading={createNote.isPending} loadingText="بنحفظ..." fullOnMobile>حفظ الملاحظة</Button></div>
      </form>
    </Modal>
  );
}
