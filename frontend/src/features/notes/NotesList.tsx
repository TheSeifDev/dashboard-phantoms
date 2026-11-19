import type { ReactNode } from 'react';
import type { Note } from '../../types/db';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { NoteCard } from './NoteCard';

import { useLocale } from '../../i18n/useLocale';
export function NotesList({ notes, isLoading, isError, isFiltered = false, emptyAction, onRetry, onDelete }: { notes: Note[]; isLoading: boolean; isError: boolean; isFiltered?: boolean; emptyAction?: ReactNode; onRetry: () => void; onDelete: (id: number) => void }) {
  const { t } = useLocale();
  if (isLoading) return <CardSkeletons count={3} />;
  if (isError) return <ErrorState message={t("معرفناش نحمّل الملاحظات.", "Could not load notes.")} onRetry={onRetry} />;
  if (!notes.length) {
    return isFiltered
      ? <EmptyState title={t("مفيش نتائج مطابقة", "No matching results")} description={t("جرّب كلمة بحث تانية أو غيّر الفلترة.", "Try another search term or change the filters.")} />
      : <EmptyState title={t("لسه مفيش ملاحظات", "No notes yet")} description={t("ضيف أول توجيه للفريق أو لعضو محدد عشان تتابع التحديثات.", "Add guidance for the team or a specific member to track updates.")} action={emptyAction} />;
  }
  return <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">{notes.map((note) => <NoteCard key={note.id} note={note} onDelete={onDelete} />)}</div>;
}
