import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useToastStore, type ToastKind } from '../../store/toast';

const icons: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: TriangleAlert,
};

const styles: Record<ToastKind, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100',
  info: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100',
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-toast)] mx-auto flex w-full max-w-md flex-col gap-2 px-4 md:end-6 md:start-auto md:mx-0 md:px-0"
      dir="rtl"
    >
      {toasts.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex min-h-11 items-center gap-3 rounded-[var(--radius)] border p-3 shadow-[var(--shadow-lg)] ${styles[t.kind]}`}
          >
            <Icon size={19} aria-hidden="true" className="shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-bold leading-6">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action?.onClick(); dismiss(t.id); }}
                className="grid min-h-[44px] shrink-0 place-items-center rounded-lg px-3 text-sm font-black underline underline-offset-4 hover:bg-black/5 dark:hover:bg-white/10"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="اقفل التنبيه"
              className="-m-2 grid size-11 shrink-0 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
