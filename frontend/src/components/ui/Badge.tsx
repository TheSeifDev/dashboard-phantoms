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
    primary: 'bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/60',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60',
    warning: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
    danger: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60',
    info: 'bg-cyan-50 text-cyan-700 border-cyan-200/80 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800/60',
    neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  }[variant];

  const dotStyles = {
    primary: 'bg-purple-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-cyan-500',
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
