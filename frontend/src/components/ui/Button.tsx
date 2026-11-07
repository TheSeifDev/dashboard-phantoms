import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  fullOnMobile?: boolean;
  isLoading?: boolean;
  loadingText?: string;
}

const variants: Record<Variant, string> = {
  primary: 'border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]',
  secondary: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]',
  ghost: 'border-transparent bg-transparent text-[var(--link)] hover:bg-[var(--primary-soft)]',
  danger: 'border-transparent bg-red-700 text-white hover:bg-red-800',
};

export function Button({ variant = 'primary', icon, fullOnMobile = false, isLoading = false, loadingText, className = '', children, disabled, ...props }: ButtonProps) {
  const isDisabled = disabled || isLoading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      aria-disabled={isDisabled || undefined}
      className={twMerge(
        'inline-flex min-h-[var(--touch)] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        fullOnMobile && 'w-full sm:w-auto',
        className
      )}
    >
      {isLoading ? <Loader2 size={17} aria-hidden="true" className="animate-spin" /> : icon}
      <span>{isLoading && loadingText ? loadingText : children}</span>
    </button>
  );
}
