import type { ReactNode } from 'react';

/** رأس صفحة موحد: أيقونة + عنوان + وصف + إجراءات. */
export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] sm:p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-[var(--text)] sm:text-2xl">{title}</h2>
          {description && <p className="mt-1 max-w-xl text-sm leading-7 text-[var(--text-muted)]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">{actions}</div>}
    </header>
  );
}
