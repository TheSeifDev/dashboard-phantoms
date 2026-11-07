import { useState } from 'react';
import type { FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const prompts = [
  'قولّي جاهزية نزول الإسكندرية والميدان',
  'مين الأعضاء المتاحين ومعاهم لابتوب؟',
  'إيه المهام المتأخرة دلوقتي؟',
  'اقترحلي توزيع مهمة جديدة لتطوير الموقع',
];

export function AiComposer({ isPending, onSend }: { isPending: boolean; onSend: (message: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSend(value);
    setValue('');
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2" aria-label="أسئلة مقترحة">
        <span className="flex min-h-11 items-center text-xs font-black text-[var(--text-muted)]">جرّب:</span>
        {prompts.map((prompt) => <button key={prompt} type="button" onClick={() => onSend(prompt)} disabled={isPending} className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--text-2)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--link)] disabled:opacity-50">{prompt}</button>)}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">اكتب سؤالك للمساعد</span><input value={value} onChange={(event) => setValue(event.target.value)} disabled={isPending} placeholder="اسأل عن الفريق أو اطلب مني أعمل مهمة..." className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-base" /></label>
        <Button type="submit" disabled={!value.trim() || isPending} icon={<Send size={18} />} className="min-w-14 px-3"><span className="hidden sm:inline">إرسال</span></Button>
      </form>
    </div>
  );
}
