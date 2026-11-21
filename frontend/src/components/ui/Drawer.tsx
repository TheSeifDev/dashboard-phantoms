import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';

/**
 * درج جانبي من جهة inline-end — للجوال والتفاصيل.
 * UI فقط: حبس تركيز + Escape + قفل تمرير الخلفية.
 */
export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  label,
  className = '',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const { t, dir } = useLocale();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls.item(0);
      const last = controls.item(controls.length - 1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]" role="presentation" dir={dir}>
      <button type="button" className="ui-scrim absolute inset-0" style={{ animation: 'app-scrim-in 220ms ease-out' }} onClick={onClose} aria-label={t("اقفل القائمة الجانبية", "Close side panel")} />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        className={`ui-drawer absolute inset-y-0 end-0 flex w-full max-w-md min-w-0 flex-col overflow-hidden border-s text-[var(--text)] ${className}`}
        style={{ animation: 'app-drawer-in 380ms cubic-bezier(0.2, 0.9, 0.25, 1.1)', ['--drawer-from' as string]: dir === 'rtl' ? '-36px' : '36px' }}
      >
        <header className="ui-drawer-header flex min-h-16 shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
          <h2 className="min-w-0 flex-1 break-words text-base font-black leading-snug text-[var(--text)]" title={title}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-close grid size-11 shrink-0 place-items-center border text-[var(--text-muted)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]"
            aria-label={t("اقفل", "Close")}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</div>
      </section>
    </div>
  );
}
