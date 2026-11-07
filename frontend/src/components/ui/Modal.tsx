import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** أيقونة اختيارية بجوار العنوان */
  icon?: React.ReactNode;
  children: React.ReactNode;
  /**
   * شريط إجراءات ثابت أسفل النافذة (خارج منطقة التمرير) — يبقى ظاهراً دائماً
   * على الجوال والشاشات القصيرة. للنماذج: استخدم <Button type="submit" form={formId}>.
   */
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

const maxWidths = {
  sm: 'md:max-w-sm',
  md: 'md:max-w-md',
  lg: 'md:max-w-lg',
  xl: 'md:max-w-xl',
  '2xl': 'md:max-w-2xl',
  '3xl': 'md:max-w-3xl',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  maxWidth = 'md',
}) => {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  // نحتفظ بأحدث onClose دون إعادة تشغيل التأثير (يمنع سرقة التركيز عند كل render)
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!controls?.length) return;
      const first = controls.item(0);
      const last = controls.item(controls.length - 1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = 'hidden';
    // التركيز الأولي (مؤشر دقيق/ماوس): [data-autofocus] ← أول حقل إدخال ← زر الإغلاق.
    // على اللمس نركّز النافذة نفسها — فتح الكيبورد تلقائياً يغطي نصف الشاشة.
    const frame = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root) return;
      const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
      if (!finePointer) { root.focus({ preventScroll: true }); return; }
      const target = root.querySelector<HTMLElement>('[data-autofocus]')
        ?? root.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]):not(.sr-only), textarea:not([disabled]), select:not([disabled])')
        ?? root.querySelector<HTMLElement>('button');
      target?.focus({ preventScroll: true });
    });
    window.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center md:items-center md:p-4" role="presentation" dir="rtl">
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-[2px]"
        style={{ animation: 'app-scrim-in 160ms ease-out' }}
        onClick={onClose}
        aria-label="اقفل النافذة"
      />
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-lg)] outline-none md:max-h-[calc(100dvh-3rem)] md:rounded-[var(--radius-lg)] ${maxWidths[maxWidth]}`}
        style={{ animation: 'app-modal-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true">{icon}</span>}
            <div className="min-w-0">
              <h2 id={titleId} className="break-words text-base font-black leading-7 sm:text-lg">{title}</h2>
              {subtitle && <p id={subtitleId} className="mt-0.5 break-words text-sm leading-6 text-[var(--text-muted)]">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label="اقفل"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4 sm:pt-4">
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
};
