import React from 'react';
import type { TaskStatus } from '../../types/db';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'primary',
  size = 'md',
}) => {
  const variantStyles = {
    primary: 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]/20',
    success: 'bg-[var(--success-soft)] text-[var(--success)] border-[var(--success-border)]',
    warning: 'bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning-border)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger-border)]',
    info: 'bg-[var(--info-soft)] text-[var(--info)] border-[var(--info-border)]',
    neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  }[variant];

  const dotStyles = {
    primary: 'bg-[var(--primary)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--warning)]',
    danger: 'bg-[var(--danger)]',
    info: 'bg-[var(--info)]',
    neutral: 'bg-[var(--text-muted)]',
  }[variant];

  const sizeStyles = {
    sm: 'text-[10px] px-2 py-0.5 font-bold',
    md: 'text-xs px-2.5 py-1 font-bold',
  }[size];

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border ${variantStyles} ${sizeStyles}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyles}`} />
      <span>{children}</span>
    </span>
  );
};

export const TaskStatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <Badge variant="neutral">لسه مبدأش</Badge>;
    case 'in_progress':
      return <Badge variant="info">تحت التنفيذ</Badge>;
    case 'under_review':
      return <Badge variant="warning">تحت المراجعة</Badge>;
    case 'approved':
      return <Badge variant="success">اتعتمدت</Badge>;
    case 'revision_requested':
      return <Badge variant="danger">محتاجة تعديل</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
};
