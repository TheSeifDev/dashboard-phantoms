import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      <div className="grid justify-items-center gap-2">
        <span className="grid size-12 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]"><Inbox size={22} aria-hidden="true" /></span>
        <h3 className="font-extrabold">{title}</h3>
        <p className="max-w-md text-sm leading-6 text-[var(--text-muted)]">{description}</p>
        {action}
      </div>
    </div>
  );
}
