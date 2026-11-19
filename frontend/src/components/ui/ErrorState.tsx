import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

import { useLocale } from '../../i18n/useLocale';
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-[var(--danger-border)] bg-[var(--danger-soft)] p-5 text-center text-[var(--danger-text)] dark:border-[var(--danger-border)] dark:bg-[var(--danger-soft)] dark:text-[var(--danger-text)]" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <p className="text-sm font-bold">{message}</p>
      {onRetry && <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={onRetry}>{t("إعادة المحاولة", "Retry")}</Button>}
    </div>
  );
}
