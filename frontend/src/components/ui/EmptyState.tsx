import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ui-empty grid min-h-48 place-items-center rounded-[var(--radius-lg)] border border-dashed p-6 text-center">
      <div className="grid justify-items-center gap-2">
        <span className="ui-empty-orb"><Inbox size={24} aria-hidden="true" /></span>
        <h3 className="font-bold">{title}</h3>
        <p className="max-w-md text-sm leading-6 text-[var(--text-muted)]">{description}</p>
        {action}
      </div>
    </div>
  );
}
