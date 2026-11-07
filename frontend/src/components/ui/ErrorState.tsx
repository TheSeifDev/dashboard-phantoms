import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-red-200 bg-red-50 p-5 text-center text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <p className="text-sm font-bold">{message}</p>
      {onRetry && <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={onRetry}>إعادة المحاولة</Button>}
    </div>
  );
}
