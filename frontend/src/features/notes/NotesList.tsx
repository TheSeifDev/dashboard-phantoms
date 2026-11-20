import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Note } from '../../types/db';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Button } from '../../components/ui/Button';
import { NoteCard } from './NoteCard';
import { useLocale } from '../../i18n/useLocale';

interface NotesListProps {
  notes: Note[];
  totalCount: number;
  hasData: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  hasActiveFilters: boolean;
  emptyAction?: ReactNode;
  onRetry: () => void;
  onDelete: (id: number) => void;
}

export function NotesList({
  notes,
  totalCount,
  hasData,
  isLoading,
  isFetching,
  isError,
  hasActiveFilters,
  emptyAction,
  onRetry,
  onDelete,
}: NotesListProps) {
  const { t } = useLocale();

  if (isLoading && !hasData) {
    return (
      <div id="notes-results" role="status" aria-label={t('بنحمّل الملاحظات', 'Loading notes')}>
        <span className="sr-only">{t('بنحمّل الملاحظات...', 'Loading notes...')}</span>
        <CardSkeletons count={3} />
      </div>
    );
  }

  if (isError && !hasData) {
    return (
      <div id="notes-results" role="region" aria-label={t('نتيجة تحميل الملاحظات', 'Notes loading result')}>
        <ErrorState message={t('معرفناش نحمّل الملاحظات.', 'Could not load notes.')} onRetry={onRetry} />
      </div>
    );
  }

  const hasNoMatches = notes.length === 0 && hasActiveFilters && totalCount > 0;

  return (
    <section id="notes-results" className="grid gap-3" role="region" aria-label={t('قائمة الملاحظات', 'Notes list')}>
      {isError && hasData && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold">{t('تعذّر تحديث الملاحظات.', 'Could not refresh notes.')}</p>
            <p className="mt-0.5 text-xs leading-5">{t('المعروض هو آخر بيانات محمّلة. جرّب التحديث مرة تانية.', 'Showing the last loaded entries. You can try again.')}</p>
          </div>
          <Button type="button" variant="secondary" onClick={onRetry} icon={<RefreshCw size={16} />} fullOnMobile>
            {t('إعادة المحاولة', 'Retry')}
          </Button>
        </div>
      )}

      {isFetching && hasData && !isError && (
        <p role="status" className="text-xs text-[var(--text-muted)]">{t('بنحدّث القائمة...', 'Updating the list...')}</p>
      )}

      {notes.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {notes.map((note) => <NoteCard key={note.id} note={note} onDelete={onDelete} />)}
        </div>
      ) : hasNoMatches ? (
        <EmptyState
          title={t('مفيش نتائج مطابقة', 'No matching results')}
          description={t('مفيش ملاحظات بتطابق البحث والفلاتر الحالية. غيّر كلمة البحث أو امسح الفلاتر.', 'No notes match the current search and filters. Try another term or clear the filters.')}
          action={emptyAction}
        />
      ) : (
        <EmptyState
          title={t('لسه مفيش ملاحظات', 'No notes yet')}
          description={t('ضيف أول توجيه للفريق أو لعضو محدد عشان تتابع التحديثات.', 'Add the first note for the team or a specific member to keep a record of updates.')}
          action={emptyAction}
        />
      )}
    </section>
  );
}
