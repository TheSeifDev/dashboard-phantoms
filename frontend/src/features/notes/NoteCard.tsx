import { CalendarDays, Megaphone, Minus, Plus, Trash2, UserRound } from 'lucide-react';
import type { Note } from '../../types/db';
import { formatDate, formatRelativeTime } from '../../lib/dateUtils';
import { parseNoteBonus } from './noteBonus';

export function NoteCard({ note, onDelete }: { note: Note; onDelete: (id: number) => void }) {
  const Icon = note.target_name ? UserRound : Megaphone;
  const { bonus, body } = parseNoteBonus(note.text);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${note.target_name ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>
            <Icon size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{note.target_name ? note.target_name : 'ملاحظة عامة للفريق'}</span>
          </span>
          {bonus !== null && bonus !== 0 && (
            <span className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-black tabular-nums ${bonus > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'}`}>
              {bonus > 0 ? <Plus size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
              {Math.abs(bonus)} {bonus > 0 ? 'بونص' : 'خصم'}
            </span>
          )}
        </div>
        <button type="button" onClick={() => onDelete(note.id)} className="grid size-10 min-h-0 min-w-0 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" aria-label="امسح الملاحظة" title="امسح الملاحظة">
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </header>
      <p className="flex-1 whitespace-pre-line break-words text-sm leading-7">{body || <span className="text-[var(--text-muted)]">مفيش نص</span>}</p>
      <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
        <span className="truncate font-bold text-[var(--text-2)]">{note.author || 'الإدارة'}</span>
        <time className="flex shrink-0 items-center gap-1.5" dateTime={note.created_at} title={formatDate(note.created_at, 'EEEE d MMMM yyyy، h:mm a')}>
          <CalendarDays size={14} aria-hidden="true" />
          {note.created_at ? formatRelativeTime(note.created_at) : (note.date || '—')}
        </time>
      </footer>
    </article>
  );
}
