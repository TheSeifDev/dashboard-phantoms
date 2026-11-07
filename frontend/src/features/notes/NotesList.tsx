import type { ReactNode } from 'react';
import type { Note } from '../../types/db';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { NoteCard } from './NoteCard';

export function NotesList({ notes, isLoading, isError, isFiltered = false, emptyAction, onRetry, onDelete }: { notes: Note[]; isLoading: boolean; isError: boolean; isFiltered?: boolean; emptyAction?: ReactNode; onRetry: () => void; onDelete: (id: number) => void }) {
  if (isLoading) return <CardSkeletons count={3} />;
  if (isError) return <ErrorState message="معرفناش نحمّل الملاحظات." onRetry={onRetry} />;
  if (!notes.length) {
    return isFiltered
      ? <EmptyState title="مفيش نتائج مطابقة" description="جرّب كلمة بحث تانية أو غيّر الفلترة." />
      : <EmptyState title="لسه مفيش ملاحظات" description="ضيف أول توجيه للفريق أو لعضو محدد عشان تتابع التحديثات." action={emptyAction} />;
  }
  return <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">{notes.map((note) => <NoteCard key={note.id} note={note} onDelete={onDelete} />)}</div>;
}
