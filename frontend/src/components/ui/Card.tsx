import type { HTMLAttributes } from 'react';
/** Frosted glass card with the shared pointer spotlight (driven by MotionLayer). */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`glass-card min-w-0 p-4 sm:p-5 ${className}`} />;
}
