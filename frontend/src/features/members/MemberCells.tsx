import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, Eye, Laptop, Minus, Monitor, MoreVertical, Pencil, Smartphone, Tablet, Trash2,
} from 'lucide-react';
import type { Member } from '../../types/db';
import { StatusChip } from '../../components/ui/StatusChip';
import { detectDevices, type DeviceKind } from './memberDisplay';

const deviceMeta: Record<Exclude<DeviceKind, 'none'>, { label: string; Icon: typeof Laptop }> = {
  laptop: { label: 'لابتوب', Icon: Laptop },
  desktop: { label: 'كمبيوتر مكتبي', Icon: Monitor },
  phone: { label: 'هاتف محمول', Icon: Smartphone },
  tablet: { label: 'تابلت', Icon: Tablet },
};

export function DeviceChips({ device, full }: { device: string | null | undefined; full?: string }) {
  const kinds = detectDevices(device);
  if (kinds[0] === 'none') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]" title={full ?? device ?? ''}>
        <Minus size={16} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-bold">بدون جهاز</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2 overflow-hidden" title={full ?? device ?? ''} role="img" aria-label={`الأجهزة: ${device}`}>
      {kinds.filter((k) => k !== 'none').map((kind) => {
        const { label, Icon } = deviceMeta[kind as Exclude<DeviceKind, 'none'>];
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
  return ready ? (
    <StatusChip tone="success">
      <CheckCircle2 size={14} aria-hidden="true" />
      جاهز للنزول
    </StatusChip>
  ) : (
    <StatusChip tone="muted">مش متاح</StatusChip>
  );
}

export function WorkStatusChip({ status }: { status: string | null | undefined }) {
  const active = status === 'active';
  return <StatusChip tone={active ? 'success' : 'muted'}>{active ? 'نشط' : 'غير نشط'}</StatusChip>;
}

import { createPortal } from 'react-dom';

/** قائمة كباب (⋮): عرض / تعديل / حذف — أزرار ≥44px. */
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (portalRef.current && !portalRef.current.contains(event.target as Node) && !btnRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleScroll = () => setOpen(false);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
      setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const itemClass =
    'flex min-h-[44px] w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-2)]';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={`خيارات ${member.full_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="member-kebab grid size-11 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div 
          ref={portalRef}
          role="menu" 
          aria-label={`خيارات ${member.full_name}`} 
          className="fixed z-[var(--z-toast)] w-44 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-lg)]" 
          style={{ animation: 'app-kebab-in 140ms ease', top: pos.top, left: pos.left + pos.width - 176 /* 176 is w-44 in px */ }}
        >
          <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onView(member); }} className={itemClass}>
            <Eye size={16} aria-hidden="true" /> عرض التفاصيل
          </button>
          <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(member); }} className={itemClass}>
            <Pencil size={16} aria-hidden="true" /> تعديل
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(member); }}
            className={`${itemClass} text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-950/30`}
          >
            <Trash2 size={16} aria-hidden="true" /> مسح
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
