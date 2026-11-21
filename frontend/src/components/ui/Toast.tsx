import {
  AlertCircle,
  CheckCircle2,
  Cog,
  Download,
  Info,
  LoaderCircle,
  RefreshCw,
  Save,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useLocale } from '../../i18n/useLocale';
import { useToastStore, type ToastKind } from '../../store/toast';
import './Toast.css';

type ToastIcon = typeof CheckCircle2;

const icons: Record<ToastKind, ToastIcon> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: TriangleAlert,
  loading: LoaderCircle,
};

const taskIcons: Record<string, ToastIcon> = {
  download: Download,
  save: Save,
  upload: Upload,
  sync: RefreshCw,
  export: Download,
  import: Upload,
  process: Cog,
  task: LoaderCircle,
};

const taskLabels: Record<string, [string, string]> = {
  download: ['تنزيل', 'Download'],
  save: ['حفظ', 'Save'],
  upload: ['رفع', 'Upload'],
  sync: ['مزامنة', 'Sync'],
  export: ['تصدير', 'Export'],
  import: ['استيراد', 'Import'],
  process: ['معالجة', 'Processing'],
  task: ['مهمة جارية', 'Task in progress'],
};

const kindLabels: Record<ToastKind, [string, string]> = {
  success: ['تم بنجاح', 'Success'],
  error: ['حدث خطأ', 'Error'],
  info: ['معلومة', 'Information'],
  warning: ['تنبيه', 'Warning'],
  loading: ['جارٍ التنفيذ', 'In progress'],
};

function getToastIcon(kind: ToastKind, task?: string): ToastIcon {
  return kind === 'loading' && task ? taskIcons[task.toLowerCase()] ?? LoaderCircle : icons[kind];
}

export function ToastViewport() {
  const { t, dir, number } = useLocale();
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      className="toast-viewport"
      aria-live="polite"
      aria-atomic="false"
      dir={dir}
    >
      {toasts.map((toast) => {
        const Icon = getToastIcon(toast.kind, toast.task);
        const taskLabel = toast.task ? taskLabels[toast.task.toLowerCase()] : undefined;
        const kindLabel = kindLabels[toast.kind];
        const progress = typeof toast.progress === 'number' ? toast.progress : null;
        const progressText = progress === null ? t('جارٍ التنفيذ', 'In progress') : `${number(progress)}%`;
        const progressStyle = progress === null ? undefined : { '--toast-progress': `${progress}%` } as CSSProperties;

        return (
          <article
            key={toast.id}
            className={`toast-card toast-card--${toast.kind}`}
            data-kind={toast.kind}
            data-task={toast.task ?? undefined}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            aria-busy={toast.kind === 'loading' ? 'true' : undefined}
          >
            <div className="toast-icon" aria-hidden="true">
              <Icon size={18} strokeWidth={2.2} />
            </div>
            <div className="toast-copy">
              <div className="toast-meta">
                {taskLabel ? <span className="toast-task">{t(taskLabel[0], taskLabel[1])}</span> : null}
                {!taskLabel && !toast.title ? <span className="toast-task">{t(kindLabel[0], kindLabel[1])}</span> : null}
              </div>
              {toast.title ? <p className="toast-title">{toast.title}</p> : null}
              <p className="toast-message">{toast.message}</p>
              {toast.detail ? <p className="toast-detail">{toast.detail}</p> : null}
              {toast.kind === 'loading' ? (
                <div className="toast-progress-wrap">
                  <div
                    className={`toast-progress ${progress === null ? 'toast-progress--indeterminate' : ''}`}
                    role="progressbar"
                    aria-label={t('تقدم المهمة', 'Task progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    aria-valuetext={progressText}
                    style={progressStyle}
                  />
                </div>
              ) : null}
            </div>
            {toast.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  try {
                    toast.action?.onClick();
                  } finally {
                    dismiss(toast.id);
                  }
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label={t('إغلاق التنبيه', 'Dismiss notification')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}
