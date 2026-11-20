import { CalendarDays, Megaphone, Minus, Plus, Trash2, UserRound } from 'lucide-react';
import type { Note } from '../../types/db';
import { parseNoteBonus } from './noteBonus';
import { useLocale } from '../../i18n/useLocale';

export function NoteCard({ note, onDelete }: { note: Note; onDelete: (id: number) => void }) {
  const { t, number, date } = useLocale();
  const isMemberNote = Boolean(note.target_member_id);
  const Icon = isMemberNote ? UserRound : Megaphone;
  const recipient = isMemberNote
    ? note.target_name || t('عضو غير متاح', 'Member unavailable')
    : t('ملاحظة عامة للفريق', 'Team note');
  const { bonus, body } = parseNoteBonus(note.text);
  const deleteLabel = isMemberNote
    ? t(`امسح ملاحظة العضو ${recipient}`, `Delete note for ${recipient}`)
    : t('امسح الملاحظة العامة للفريق', 'Delete team note');

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${isMemberNote ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'bg-[var(--surface-2)] text-[var(--text-2)]'}`}>
            <Icon size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate" dir="auto">{recipient}</span>
          </span>
          {bonus !== null && bonus !== 0 && (
            <span className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-black tabular-nums ${bonus > 0 ? 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:border-[var(--success-border)] dark:bg-[var(--success-soft)] dark:text-[var(--success-text)]' : 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]'}`}>
              {bonus > 0 ? <Plus size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
              <bdi>{number(Math.abs(bonus))}</bdi> {bonus > 0 ? t('بونص', 'bonus') : t('خصم', 'deduction')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(note.id)}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] dark:hover:bg-[var(--danger-soft)]"
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </header>

      <p dir="auto" className="min-h-12 flex-1 whitespace-pre-wrap break-words text-sm leading-7">
        {body || <span className="text-[var(--text-muted)]">{t('مفيش نص', 'No text')}</span>}
      </p>

      <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
        <span className="truncate font-bold text-[var(--text-2)]" dir="auto">{note.author || t('الإدارة', 'Admin')}</span>
        <time
          className="flex shrink-0 items-center gap-1.5"
          dateTime={note.created_at || undefined}
          title={note.created_at ? date(note.created_at, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : undefined}
        >
          <CalendarDays size={14} aria-hidden="true" />
          {note.created_at ? date(note.created_at, { dateStyle: 'medium' }) : note.date || '—'}
        </time>
      </footer>
    </article>
  );
}
