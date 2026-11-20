import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2, Eye, Laptop, Minus, Monitor, MoreVertical, Pencil, Smartphone, Tablet, Trash2,
} from 'lucide-react';
import type { Member } from '../../types/db';
import { StatusChip } from '../../components/ui/StatusChip';
import { detectDevices, type DeviceKind } from './memberDisplay';
import { useLocale } from '../../i18n/useLocale';

const deviceMeta: Record<Exclude<DeviceKind, 'none'>, { Icon: typeof Laptop }> = {
  laptop: { Icon: Laptop },
  desktop: { Icon: Monitor },
  phone: { Icon: Smartphone },
  tablet: { Icon: Tablet },
};

function deviceLabel(kind: Exclude<DeviceKind, 'none'>, t: (arabic: string, english: string) => string) {
  if (kind === 'laptop') return t('لابتوب', 'Laptop');
  if (kind === 'desktop') return t('كمبيوتر مكتبي', 'Desktop computer');
  if (kind === 'phone') return t('هاتف محمول', 'Mobile phone');
  return t('جهاز لوحي', 'Tablet');
}

export function DeviceChips({ device, full }: { device: string | null | undefined; full?: string }) {
  const { t } = useLocale();
  const kinds = detectDevices(device);
  if (kinds[0] === 'none') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]" title={full ?? device ?? t('بدون جهاز', 'No device')}>
        <Minus size={16} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-bold">{t('بدون جهاز', 'No device')}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2 overflow-hidden" title={full ?? device ?? ''} role="img" aria-label={t(`الأجهزة: ${device}`, `Devices: ${device}`)}>
      {kinds.filter((kind): kind is Exclude<DeviceKind, 'none'> => kind !== 'none').map((kind) => {
        const { Icon } = deviceMeta[kind];
        const label = deviceLabel(kind, t);
        return (
          <span key={kind} title={label} className="inline-flex shrink-0 items-center gap-1 text-[var(--text-2)]">
            <Icon size={17} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
            <span className="whitespace-nowrap text-xs font-bold">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ReadinessChip({ ready }: { ready: boolean }) {
  const { t } = useLocale();
  return ready ? (
    <StatusChip tone="success">
      <CheckCircle2 size={14} aria-hidden="true" />
      {t('جاهز للنزول', 'Available for field work')}
    </StatusChip>
  ) : (
    <StatusChip tone="muted">{t('مش متاح', 'Unavailable')}</StatusChip>
  );
}

export function WorkStatusChip({ status }: { status: string | null | undefined }) {
  const { t } = useLocale();
  const active = status === 'active';
  return <StatusChip tone={active ? 'success' : 'muted'}>{active ? t('نشط', 'Active') : t('غير نشط', 'Inactive')}</StatusChip>;
}

/** Member actions menu: keyboard-operable, localized, and kept within the viewport. */
export function MemberRowMenu({
  member,
  onView,
  onEdit,
  onDelete,
}: {
  member: Member;
  onView: (member: Member) => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const menuId = `member-actions-${member.id}`;

  useEffect(() => {
    if (!open) return;
    portalRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const handlePointer = (event: PointerEvent) => {
      if (portalRef.current && !portalRef.current.contains(event.target as Node) && !btnRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleScroll = () => setOpen(false);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (!portalRef.current?.contains(event.target as Node)) return;
      const items = Array.from(portalRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[nextIndex]?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuWidth = 176;
      const menuHeight = 154;
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
      const preferredTop = rect.bottom + 6;
      const top = preferredTop + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 6)
        : preferredTop;
      setPos({ top, left });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const itemClass = 'flex min-h-[44px] w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 text-start text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-[-2px]';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={t(`خيارات ${member.full_name}`, `Options for ${member.full_name}`)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="member-kebab grid size-11 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={portalRef}
          id={menuId}
          role="menu"
          aria-label={t(`خيارات ${member.full_name}`, `Options for ${member.full_name}`)}
          className="fixed z-[var(--z-toast)] w-44 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-lg)]"
          style={{ animation: 'app-kebab-in 140ms ease', top: pos.top, left: pos.left }}
        >
          <button type="button" role="menuitem" tabIndex={-1} onClick={(event) => { event.stopPropagation(); setOpen(false); onView(member); }} className={itemClass}>
            <Eye size={16} aria-hidden="true" /> {t('عرض التفاصيل', 'View details')}
          </button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={(event) => { event.stopPropagation(); setOpen(false); onEdit(member); }} className={itemClass}>
            <Pencil size={16} aria-hidden="true" /> {t('تعديل', 'Edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={(event) => { event.stopPropagation(); setOpen(false); onDelete(member); }}
            className={`${itemClass} text-[var(--danger)] hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--danger-soft)]`}
          >
            <Trash2 size={16} aria-hidden="true" /> {t('حذف', 'Delete')}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
