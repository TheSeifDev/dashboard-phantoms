import { useMemo, useState } from 'react';
import { Plus, Search, StickyNote, X } from 'lucide-react';
import { useNotes, useDeleteNote } from './api';
import { useMembers } from '../members/api';
import { NotesList } from './NotesList';
import { NoteEditor } from './NoteEditor';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { AR, arCount, normalizeArabic } from '../../lib/arabic';

type TargetFilter = 'ALL' | 'GENERAL' | 'MEMBER';

export default function NotesPage() {
  const notesQuery = useNotes();
  const membersQuery = useMembers();
  const deleteNote = useDeleteNote();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('ALL');
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);

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

  const confirmDeleteNote = async () => {
    if (pendingDeleteId == null) return;
    try {
      await deleteNote.mutateAsync(pendingDeleteId);
      toast.success('اتمسحت الملاحظة.');
      setPendingDeleteId(null);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نمسح الملاحظة.');
    }
  };

  const tabs: Array<{ value: TargetFilter; label: string }> = [
    { value: 'ALL', label: 'الكل' },
    { value: 'GENERAL', label: 'عامة' },
    { value: 'MEMBER', label: 'لأعضاء' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4" dir="rtl">
      <section className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
        <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[var(--fs-xl)] font-black"><StickyNote size={23} className="shrink-0 text-[var(--link)]" aria-hidden="true" />سجل الملاحظات والتوجيهات</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{notesQuery.isLoading ? 'بنحمّل...' : `${arCount(notes.length, AR.note)} — توجيهات عامة ونقط بونص وخصم للأعضاء.`}</p>
          </div>
          <Button onClick={() => setIsEditorOpen(true)} icon={<Plus size={18} />} fullOnMobile>اكتب ملاحظة</Button>
        </div>
        <div className="grid gap-3 border-t border-[var(--border)] pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="دوّر في الملاحظات أو باسم العضو..."
              aria-label="البحث في الملاحظات"
              className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-10 ps-10 text-base placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} className="absolute inset-y-0 end-1 my-auto grid size-9 min-h-0 min-w-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label="مسح البحث"><X size={16} aria-hidden="true" /></button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-2)] p-1 md:flex" role="tablist" aria-label="فلترة الملاحظات">
            {tabs.map((tab) => {
              const active = targetFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTargetFilter(tab.value)}
                  className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 sm:px-3 text-sm font-bold transition-colors ${active ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                  {tab.label}
                  <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-[var(--primary-soft)] text-[var(--link)]' : 'bg-[var(--surface)]'}`}>{counts[tab.value]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <NotesList
        notes={filteredNotes}
        isLoading={notesQuery.isLoading}
        isError={notesQuery.isError}
        isFiltered={notes.length > 0}
        emptyAction={<Button onClick={() => setIsEditorOpen(true)} icon={<Plus size={17} />}>اكتب أول ملاحظة</Button>}
        onRetry={() => { void notesQuery.refetch(); }}
        onDelete={setPendingDeleteId}
      />
      <NoteEditor isOpen={isEditorOpen} members={membersQuery.data ?? []} onClose={() => setIsEditorOpen(false)} />
      <Modal
        isOpen={pendingDeleteId != null}
        onClose={() => setPendingDeleteId(null)}
        title="تمسح الملاحظة؟"
        subtitle="هتتمسح نهائي، ولو فيها نقط بونص أو خصم رصيد العضو هيتغيّر."
        maxWidth="sm"
        footer={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>إلغاء</Button>
            <Button variant="danger" onClick={() => void confirmDeleteNote()} isLoading={deleteNote.isPending} loadingText="بنمسح...">مسح نهائي</Button>
          </div>
        }
      >
        <p className="text-sm leading-7 text-[var(--text-2)]">مينفعش ترجع في الإجراء ده.</p>
      </Modal>
    </div>
  );
}
