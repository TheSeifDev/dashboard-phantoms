import type { ReactNode } from 'react';

export function Panel({
  title,
  icon,
  hint,
  action,
  flush = false,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`icpc-panel ${className}`}>
      <header className="icpc-panel-head">
        <h2>
          {icon}
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {hint && <small>{hint}</small>}
          {action}
        </div>
      </header>
      <div className={flush ? 'icpc-panel-body--flush' : 'icpc-panel-body'}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="icpc-kpi">
      <span>
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Bar({
  label,
  value,
  total,
  suffix,
}: {
  label: string;
  value: number;
  total: number;
  suffix?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="icpc-bar">
      <div className="icpc-bar-label">
        <span>{label}</span>
        <small>
          {value}
          {suffix ? ` ${suffix}` : ''}
        </small>
      </div>
      <div className="icpc-bar-track" role="presentation">
        <div className="icpc-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  return <span className="icpc-chip" data-tone={tone}>{children}</span>;
}

export function InlineEmpty({ children }: { children: ReactNode }) {
  return <p className="icpc-empty-inline">{children}</p>;
}
