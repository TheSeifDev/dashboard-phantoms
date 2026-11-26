import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, UserRound } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import type { WebCandidate } from './types';

interface MemberPickerProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  candidates: WebCandidate[];
  placeholder: string;
  /** خيار «بدون» — بيستخدم للقائد الأساسي اللي بيتحدد لاحقًا. */
  clearLabel?: string;
  id?: string;
  invalid?: boolean;
}

/**
 * اختيار عضو واحد من دليل الأعضاء.
 * الـ native <select> كان بيعرض عدد محدود من الخيارات فبدا كأن فيه سقف،
 * فبقى هنا قائمة كاملة قابلة للبحث مع عدّاد واضح.
 */
export function MemberPicker({ name, value, onChange, candidates, placeholder, clearLabel, id, invalid }: MemberPickerProps) {
  const { t, number } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [drop, setDrop] = useState<'down' | 'up'>('down');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = candidates.find((person) => String(person.member_id) === value) ?? null;
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return candidates;
    return candidates.filter((person) => person.full_name.toLocaleLowerCase().includes(term));
  }, [candidates, search]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch('');
  };

  const toggle = () => {
    setOpen((current) => {
      if (current) return false;
      // نافذة المودال بتتمرّر، فلو المساحة تحت الحقل ضيقة بنفتح القائمة لفوق.
      const rect = rootRef.current?.getBoundingClientRect();
      const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
      setDrop(spaceBelow < 340 ? 'up' : 'down');
      return true;
    });
  };

  return (
    <div className="wp-picker" ref={rootRef} data-invalid={invalid ? 'true' : undefined}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        className="wp-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="wp-picker-value" data-empty={selected ? undefined : 'true'}>
          {selected ? (
            <>
              <span className="wp-picker-avatar" aria-hidden="true">
                {selected.full_name.trim().charAt(0)}
              </span>
              {selected.full_name}
            </>
          ) : (
            <>
              <UserRound size={15} aria-hidden="true" />
              {placeholder}
            </>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="wp-picker-chevron" data-open={open ? 'true' : undefined} />
      </button>

      {open && (
        <div className="wp-picker-panel" data-drop={drop}>
          <div className="wp-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('ابحث بالاسم', 'Search by name')}
              aria-label={t('ابحث في الأعضاء', 'Search members')}
            />
          </div>
          <p className="wp-picker-count">
            {t(
              `${number(filtered.length)} من ${number(candidates.length)} عضو متاح`,
              `${number(filtered.length)} of ${number(candidates.length)} members available`,
            )}
          </p>
          <ul className="wp-picker-list" role="listbox" aria-label={placeholder}>
            {clearLabel && !search.trim() && (
              <li role="none">
                <button type="button" role="option" aria-selected={value === ''} className="wp-picker-option" onClick={() => choose('')}>
                  <span className="wp-picker-option-name">{clearLabel}</span>
                  {value === '' && <Check size={15} aria-hidden="true" />}
                </button>
              </li>
            )}
            {filtered.map((person) => {
              const active = String(person.member_id) === value;
              return (
                <li key={person.member_id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="wp-picker-option"
                    data-active={active ? 'true' : undefined}
                    onClick={() => choose(String(person.member_id))}
                  >
                    <span className="wp-picker-avatar" aria-hidden="true">
                      {person.full_name.trim().charAt(0)}
                    </span>
                    <span className="wp-picker-option-name">{person.full_name}</span>
                    {active && <Check size={15} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li role="none" className="wp-picker-empty">
                {t('مفيش عضو بالاسم ده.', 'No member matches that name.')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
