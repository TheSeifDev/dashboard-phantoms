import type { ReactNode } from 'react';

type ChipTone = 'success' | 'muted' | 'info' | 'warning' | 'danger';

const tones: Record<ChipTone, string> = {
  success: 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success)]',
  muted: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]',
  info: 'border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info-text)] dark:text-[var(--info)]',
  warning: 'border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-text)] dark:text-[var(--warning)]',
  danger: 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)] dark:text-[var(--danger)]',
};

/** شارة حالة لا تلتف أبداً. */
export function StatusChip({ tone = 'muted', children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}
