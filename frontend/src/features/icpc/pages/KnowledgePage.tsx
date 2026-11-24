import { useMemo, useState } from 'react';
import { BookOpen, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Modal } from '../../../components/ui/Modal';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useDeleteNote, useIcpcNotes, useSaveNote } from '../api';
import { Chip, InlineEmpty, Panel } from '../components/IcpcPanels';
import { NOTE_CATEGORIES, type IcpcMode, type IcpcNote } from '../types';

interface NoteDraft {
  id?: number;
  title: string;
  category: string;
  tags: string;
  content_md: string;
  links: string;
}

const EMPTY: NoteDraft = { title: '', category: 'algorithms', tags: '', content_md: '', links: '' };

export function KnowledgePage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const notes = useIcpcNotes(mode, query);
  const saveNote = useSaveNote(mode);
  const deleteNote = useDeleteNote(mode);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(EMPTY);

  const rows = useMemo(
    () => (notes.data?.notes ?? []).filter((note) => !category || note.category === category),
    [notes.data, category],
  );

  const openCreate = () => {
    setDraft(EMPTY);
    setOpen(true);
  };

  const openEdit = (note: IcpcNote) => {
    setDraft({
      id: note.id,
      title: note.title,
      category: note.category,
      tags: note.tags.join(', '),
      content_md: note.content_md,
      links: note.links.map((link) => link.url ?? '').filter(Boolean).join('\n'),
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      await saveNote.mutateAsync({
        ...(draft.id ? { id: draft.id } : {}),
        title: draft.title,
        category: draft.category,
        tags: draft.tags.split(',').map((entry) => entry.trim()).filter(Boolean),
        content_md: draft.content_md,
        links: draft.links.split('\n').map((entry) => entry.trim()).filter(Boolean).map((url) => ({ url })),
      });
      toast.success(t('اتحفظت الملاحظة.', 'Note saved.'));
      setOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحفظ الملاحظة.', 'Could not save the note.'));
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteNote.mutateAsync(id);
      toast.success(t('اتحذفت الملاحظة.', 'Note deleted.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف الملاحظة.', 'Could not delete the note.'));
    }
  };

  if (notes.isLoading) return <CardSkeletons count={3} />;
  if (notes.isError) {
    return <ErrorState message={(notes.error as Error | null)?.message ?? t('معرفناش نحمّل قاعدة المعرفة.', 'Could not load the knowledge base.')} onRetry={() => void notes.refetch()} />;
  }

  return (
    <div className="grid gap-4">
      <Panel
        title={t('قاعدة المعرفة', 'Knowledge base')}
        icon={<BookOpen size={15} aria-hidden="true" />}
        hint={t(`${number(rows.length)} ملاحظة`, `${number(rows.length)} notes`)}
        action={<Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('ملاحظة جديدة', 'New note')}</Button>}
        flush
      >
        <div className="icpc-toolbar">
          <label className="icpc-field" style={{ flex: '1 1 220px' }}>
            <span>{t('بحث', 'Search')}</span>
            <span className="relative">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('عنوان أو محتوى أو tag', 'Title, content, or tag')} style={{ paddingInlineStart: 34 }} />
            </span>
          </label>
          <label className="icpc-field">
            <span>{t('التصنيف', 'Category')}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('الكل', 'All')}</option>
              {Object.entries(NOTE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>{label[locale]}</option>
              ))}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('مفيش ملاحظات', 'No notes yet')}
              description={t('شارك قالب، إيديتوريال، أو درس من مسابقة عشان الفريق كله يستفيد.', 'Share a template, editorial, or contest lesson so the whole team benefits.')}
              action={<Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('أضف ملاحظة', 'Add note')}</Button>}
            />
          </div>
        ) : (
          <div className="icpc-list">
            {rows.map((note) => (
              <div key={note.id} className="icpc-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="icpc-row-main">
                  <span className="icpc-row-title">{note.title}</span>
                  <span className="icpc-row-sub">
                    <Chip tone="primary">{NOTE_CATEGORIES[note.category]?.[locale] ?? note.category}</Chip>
                    {note.status === 'pending' && <Chip tone="warning">{t('بانتظار المراجعة', 'Pending review')}</Chip>}
                    <span>{note.author}</span>
                    <span>{date(note.updated_at, { day: 'numeric', month: 'short' })}</span>
                    {note.tags.map((tag) => <Chip key={tag}>#{tag}</Chip>)}
                  </span>
                  {note.content_md && <p className="icpc-note-body m-0">{note.content_md}</p>}
                </div>
                <div className="icpc-row-meta">
                  {note.links.map((link) => (
                    link.url ? (
                      <a key={link.url} className="icpc-chip" href={link.url} target="_blank" rel="noreferrer noopener">
                        <Link2 size={12} aria-hidden="true" /> {t('مصدر', 'Source')}
                      </a>
                    ) : null
                  ))}
                  <Button variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => openEdit(note)} aria-label={t('تعديل', 'Edit')} />
                  <Button variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void remove(note.id)} aria-label={t('حذف', 'Delete')} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={draft.id ? t('تعديل ملاحظة', 'Edit note') : t('ملاحظة جديدة', 'New note')}
        subtitle={t('الأعضاء يقدروا يضيفوا، والكوتش والأدمن بيراجعوا.', 'Members can contribute; coaches and admins review.')}
        maxWidth="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={() => void submit()} isLoading={saveNote.isPending} disabled={!draft.title.trim()}>{t('حفظ', 'Save')}</Button>
          </>
        )}
      >
        <div className="icpc-form-grid">
          <label className="icpc-field icpc-span-2">
            <span>{t('العنوان', 'Title')}</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('التصنيف', 'Category')}</span>
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              {Object.entries(NOTE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>{label[locale]}</option>
              ))}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('Tags (بفاصلة)', 'Tags (comma)')}</span>
            <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="dp, greedy" />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('المحتوى (Markdown)', 'Content (Markdown)')}</span>
            <textarea value={draft.content_md} onChange={(event) => setDraft({ ...draft, content_md: event.target.value })} />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('روابط (سطر لكل رابط)', 'Links (one per line)')}</span>
            <textarea value={draft.links} onChange={(event) => setDraft({ ...draft, links: event.target.value })} />
          </label>
        </div>
      </Modal>

      {rows.length === 0 && notes.data && <InlineEmpty>{t('ابدأ بأول ملاحظة.', 'Start with the first note.')}</InlineEmpty>}
    </div>
  );
}
