import { useState } from 'react';
import type { FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';

import { useLocale } from '../../i18n/useLocale';
const prompts = [
  { ar: 'قولّي جاهزية نزول الإسكندرية والميدان', en: 'Tell me who is ready for Alexandria and field work' },
  { ar: 'مين الأعضاء المتاحين ومعاهم لابتوب؟', en: 'Which available members have a laptop?' },
  { ar: 'إيه المهام المتأخرة دلوقتي؟', en: 'Which tasks are overdue right now?' },
  { ar: 'اقترحلي توزيع مهمة جديدة لتطوير الموقع', en: 'Suggest an assignment for a new website development task' },
];

export function AiComposer({ isPending, onSend }: { isPending: boolean; onSend: (message: string) => void }) {
  const { locale, t } = useLocale();
  const [value, setValue] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSend(value);
    setValue('');
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2" aria-label={t("أسئلة مقترحة", "Suggested prompts")}>
        <span className="flex min-h-11 items-center text-xs font-black text-[var(--text-muted)]">{t("جرّب:", "Try:")}</span>
        {prompts.map((prompt) => {
          const text = locale === 'ar' ? prompt.ar : prompt.en;
          return <button key={prompt.ar} type="button" onClick={() => onSend(text)} disabled={isPending} className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--text-2)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--link)] disabled:opacity-50">{text}</button>;
        })}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">{t("اكتب سؤالك للمساعد", "Write your question for the assistant")}</span><input value={value} onChange={(event) => setValue(event.target.value)} disabled={isPending} placeholder={t("اسأل عن الفريق أو اطلب مني أعمل مهمة...", "Ask about the team or request a task...")} className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-base" /></label>
        <Button type="submit" disabled={!value.trim() || isPending} icon={<Send size={18} />} className="min-w-14 px-3"><span className="hidden sm:inline">{t("إرسال", "Send")}</span></Button>
      </form>
    </div>
  );
}
