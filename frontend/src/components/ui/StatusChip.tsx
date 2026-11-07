import type { ReactNode } from 'react';

type ChipTone = 'success' | 'muted' | 'info' | 'warning' | 'danger';

const tones: Record<ChipTone, string> = {
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-400',
  muted: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]',
  info: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300',
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300',
};

/** شارة حالة لا تلتف أبداً. */
export function StatusChip({ tone = 'muted', children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}
