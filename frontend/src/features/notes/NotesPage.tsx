import { useMemo, useState } from 'react';
import { Plus, Search, StickyNote, X } from 'lucide-react';
import { useNotes, useDeleteNote } from './api';
import { useMembers } from '../members/api';
import { NotesList } from './NotesList';
import { NoteEditor } from './NoteEditor';
import { toast } from '../../store/toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';
import { normalizeArabic } from '../../lib/arabic';
import type { Note } from '../../types/db';

type TargetFilter = 'ALL' | 'GENERAL' | 'MEMBER';

function getDeleteErrorCode(cause: unknown): string | undefined {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String((cause as { code?: unknown }).code ?? '');
  }
  return undefined;
}

export default function NotesPage() {
  const { t, number, dir } = useLocale();
  const notesQuery = useNotes();
  const membersQuery = useMembers();
  const deleteNote = useDeleteNote();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('ALL');
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const hasActiveFilters = targetFilter !== 'ALL' || searchTerm.trim().length > 0;

  const counts = useMemo(() => ({
    ALL: notes.length,
    GENERAL: notes.filter((note) => !note.target_member_id).length,
    MEMBER: notes.filter((note) => Boolean(note.target_member_id)).length,
  }), [notes]);

  const filteredNotes = useMemo(() => {
    const needle = normalizeArabic(searchTerm);
    return notes.filter((note) => {
      const matchTarget = targetFilter === 'ALL'
        || (targetFilter === 'GENERAL' && !note.target_member_id)
        || (targetFilter === 'MEMBER' && Boolean(note.target_member_id));
      if (!matchTarget) return false;
      if (!needle) return true;
      return normalizeArabic(`${note.text} ${note.target_name ?? ''} ${note.author ?? ''}`).includes(needle);
    });
  }, [notes, searchTerm, targetFilter]);

  const pendingDeleteNote: Note | undefined = pendingDeleteId == null
    ? undefined
    : notes.find((note) => note.id === pendingDeleteId);

  const clearFilters = () => {
    setSearchTerm('');
    setTargetFilter('ALL');
  };

  const confirmDeleteNote = async () => {
    if (pendingDeleteId == null) return;
    try {
      await deleteNote.mutateAsync(pendingDeleteId);
      toast.success(t('اتمسحت الملاحظة.', 'Note deleted.'));
      setPendingDeleteId(null);
    } catch (cause) {
      const code = getDeleteErrorCode(cause);
      if (code === '42501') {
        toast.error(t('معندكش صلاحية تمسح الملاحظة دي.', 'You do not have permission to delete this note.'));
      } else if (code === 'PGRST301') {
        toast.error(t('الجلسة انتهت. سجّل دخولك تاني وحاول.', 'Your session expired. Sign in again and retry.'));
      } else {
        toast.error(t('معرفناش نمسح الملاحظة. جرّب تاني.', 'Could not delete the note. Please try again.'));
      }
    }
  };

  const tabs: Array<{ value: TargetFilter; label: string }> = [
    { value: 'ALL', label: t('الكل', 'All') },
    { value: 'GENERAL', label: t('عامة', 'General') },
    { value: 'MEMBER', label: t('لأعضاء', 'Members') },
  ];

  const listSummary = notesQuery.isLoading && notesQuery.data === undefined
    ? t('بنحمّل الملاحظات...', 'Loading notes...')
    : notesQuery.isError && notesQuery.data === undefined
      ? t('تعذّر تحميل سجل الملاحظات.', 'The notes list could not be loaded.')
      : t(
        `${number(filteredNotes.length)} من ${number(notes.length)} ملاحظة`,
        `${number(filteredNotes.length)} of ${number(notes.length)} notes`,
      );

  return (
    <div className="grid grid-cols-1 gap-4" dir={dir}>
      <section aria-labelledby="notes-page-title" className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
        <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 id="notes-page-title" className="flex items-center gap-2 text-[var(--fs-xl)] font-black"><StickyNote size={23} className="shrink-0 text-[var(--link)]" aria-hidden="true" />{t('سجل الملاحظات والتوجيهات', 'Notes and guidance')}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t('تابع توجيهات الفريق والملاحظات المرتبطة بالأعضاء ونقط البونص أو الخصم.', 'Review team guidance, member-specific notes, and bonus or deduction points.')}</p>
          </div>
          <Button onClick={() => setIsEditorOpen(true)} icon={<Plus size={18} />} fullOnMobile>{t('اكتب ملاحظة', 'Write a note')}</Button>
        </div>

        <div className="grid gap-3 border-t border-[var(--border)] pt-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
            <div className="relative min-w-0">
              <Search size={18} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
              <input
                type="search"
                dir="auto"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t('ابحث في النص أو اسم العضو أو الكاتب...', 'Search note text, member, or author...')}
                aria-label={t('البحث في الملاحظات وأسماء الأعضاء والكتّاب', 'Search notes, members, and authors')}
                aria-controls="notes-results"
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-10 ps-10 text-base placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
              />
              {searchTerm && (
                <button type="button" onClick={() => setSearchTerm('')} className="absolute inset-y-0 end-1 my-auto grid size-10 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" aria-label={t('مسح عبارة البحث', 'Clear search')} title={t('مسح عبارة البحث', 'Clear search')}>
                  <X size={16} aria-hidden="true" />
                </button>
              )}
              <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">{t('يشمل البحث نص الملاحظة واسم العضو أو الكاتب.', 'Search includes note text, member name, and author.')}</p>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-2)] p-1 md:flex" role="group" aria-label={t('تصفية حسب جهة الملاحظة', 'Filter by note audience')}>
              {tabs.map((tab) => {
                const active = targetFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    aria-pressed={active}
                    aria-controls="notes-results"
                    onClick={() => setTargetFilter(tab.value)}
                    className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 sm:px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${active ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                  >
                    {tab.label}
                    <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'bg-[var(--surface)]'}`}>{number(counts[tab.value])}</span>
                  </button>
                );
              })}
            </div>

            {hasActiveFilters ? (
              <Button type="button" variant="secondary" onClick={clearFilters} icon={<X size={16} />} fullOnMobile>
                {t('مسح الفلاتر', 'Clear filters')}
              </Button>
            ) : <span className="hidden md:block" aria-hidden="true" />}
          </div>
          <p className="text-xs font-semibold text-[var(--text-muted)]" role="status" aria-live="polite">{listSummary}</p>
        </div>
      </section>

      <NotesList
        notes={filteredNotes}
        totalCount={notes.length}
        hasData={notesQuery.data !== undefined}
        isLoading={notesQuery.isLoading}
        isFetching={notesQuery.isFetching}
        isError={notesQuery.isError}
        hasActiveFilters={hasActiveFilters}
        emptyAction={hasActiveFilters && notes.length > 0
          ? <Button type="button" variant="secondary" onClick={clearFilters}>{t('مسح الفلاتر والبحث', 'Clear filters and search')}</Button>
          : <Button type="button" onClick={() => setIsEditorOpen(true)} icon={<Plus size={17} />} fullOnMobile>{t('اكتب أول ملاحظة', 'Write the first note')}</Button>}
        onRetry={() => { void notesQuery.refetch(); }}
        onDelete={setPendingDeleteId}
      />

      <NoteEditor
        isOpen={isEditorOpen}
        members={membersQuery.data ?? []}
        membersLoading={membersQuery.isLoading}
        membersError={membersQuery.isError}
        onRetryMembers={() => { void membersQuery.refetch(); }}
        onClose={() => setIsEditorOpen(false)}
      />
      <Modal
        isOpen={pendingDeleteId != null}
        onClose={() => setPendingDeleteId(null)}
        title={t('تمسح الملاحظة؟', 'Delete this note?')}
        subtitle={t('هتتمسح نهائي، وأي بونص أو خصم مسجّل فيها هيتشال من رصيد العضو.', 'This note will be permanently deleted, and any recorded bonus or deduction will be removed from the member’s balance.')}
        maxWidth="sm"
        footer={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>{t('إلغاء', 'Cancel')}</Button>
            <Button variant="danger" onClick={() => void confirmDeleteNote()} isLoading={deleteNote.isPending} loadingText={t('بنمسح...', 'Deleting...')}>{t('مسح نهائي', 'Delete permanently')}</Button>
          </div>
        }
      >
        {pendingDeleteNote && (
          <dl className="mb-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">{t('موجّهة إلى', 'Addressed to')}</dt><dd className="mt-0.5 truncate font-bold" dir="auto">{pendingDeleteNote.target_member_id ? pendingDeleteNote.target_name || t('عضو غير متاح', 'Member unavailable') : t('الفريق بالكامل', 'The whole team')}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">{t('الكاتب', 'Author')}</dt><dd className="mt-0.5 truncate font-bold" dir="auto">{pendingDeleteNote.author || t('الإدارة', 'Admin')}</dd></div>
          </dl>
        )}
        <p className="text-sm leading-7 text-[var(--text-2)]">{t('مينفعش ترجع في الإجراء ده.', 'This action cannot be undone.')}</p>
      </Modal>
    </div>
  );
}
