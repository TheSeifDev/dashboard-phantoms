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
    <header className="glass-card ui-page-header flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="ui-page-header-orb" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="ui-page-header-title m-0 text-xl font-bold text-[var(--text)] sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-xl text-sm leading-7 text-[var(--text-muted)]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">{actions}</div>}
    </header>
  );
}
