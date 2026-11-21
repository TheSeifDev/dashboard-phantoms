import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, ChartGantt, CircleDot, ClipboardCheck, CornerDownLeft, FileChartColumn, FolderGit2, FolderKanban,
  Languages, LayoutDashboard, Library, Lightbulb, ListChecks, ListTodo, Megaphone, MessageCircle, Moon, Network, Search,
  ShieldCheck, Sparkles, SquareKanban, StickyNote, Sun, Trophy, Users, type LucideProps,
} from 'lucide-react';
import { gsap, prefersReducedMotion } from '../motion/gsap';
import { useLocale } from '../../i18n/useLocale';

export interface PaletteEntry { path: string; ar: string; en: string }
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  pages: PaletteEntry[];
  isDark: boolean;
  onToggleTheme: () => void;
}
type Icon = ComponentType<LucideProps>;
interface Command { id: string; group: 'pages' | 'actions'; label: string; hint: string; icon: Icon; run: () => void }

const ICONS: Record<string, Icon> = {
  '/admin/dashboard': LayoutDashboard,
  '/admin/members': Users,
  '/admin/tasks': ListChecks,
  '/admin/evaluations': ClipboardCheck,
  '/admin/ranking': Trophy,
  '/admin/notes': StickyNote,
  '/admin/announcements': Megaphone,
  '/admin/ai-assistant': Sparkles,
  '/admin/whatsapp': MessageCircle,
  '/admin/admins': ShieldCheck,
  '/admin/teams': Network,
  '/admin/web-projects': FolderKanban,
  '/admin/web-projects/ideas': Lightbulb,
  '/admin/web-projects/projects': FolderGit2,
  '/admin/web-projects/timeline': ChartGantt,
  '/admin/web-projects/agile': SquareKanban,
  '/admin/web-projects/tasks': ListTodo,
  '/admin/web-projects/reports': FileChartColumn,
  '/admin/web-projects/resources': Library,
};

/** Spotlight-style launcher: every permitted page plus quick workspace actions, fully keyboard driven. */
export function CommandPalette({ open, onClose, pages, isDark, onToggleTheme }: CommandPaletteProps) {
  const { t, locale, setLocale, dir } = useLocale();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(open);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => [
    ...pages.map((page) => ({ id: page.path, group: 'pages' as const, label: t(page.ar, page.en), hint: page.path.replace('/admin', '') || '/', icon: ICONS[page.path] ?? CircleDot, run: () => navigate(page.path) })),
    { id: 'theme', group: 'actions', label: isDark ? t('شغّل الوضع الفاتح', 'Use light theme') : t('شغّل الوضع الداكن', 'Use dark theme'), hint: t('المظهر', 'Appearance'), icon: isDark ? Sun : Moon, run: onToggleTheme },
    { id: 'language', group: 'actions', label: locale === 'ar' ? 'Switch to English' : 'التبديل للعربية', hint: t('اللغة', 'Language'), icon: Languages, run: () => setLocale(locale === 'ar' ? 'en' : 'ar') },
  ], [pages, t, isDark, locale, navigate, onToggleTheme, setLocale]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => {
      const page = pages.find((item) => item.path === command.id);
      return `${command.label} ${command.hint} ${page ? `${page.ar} ${page.en}` : ''}`.toLowerCase().includes(needle);
    });
  }, [commands, pages, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (open) setMounted(true); }, [open]);

  // Enter / exit choreography. Exit keeps the node mounted until GSAP finishes.
  useLayoutEffect(() => {
    if (!mounted) return;
    const scrim = scrimRef.current;
    const panel = panelRef.current;
    if (!scrim || !panel) return;
    const reduced = prefersReducedMotion();
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      inputRef.current?.focus();
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (!reduced) {
        const timeline = gsap.timeline();
        timeline.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' })
          .fromTo(panel, { opacity: 0, y: -18, scale: 0.96, rotateX: 8 }, { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.45, ease: 'back.out(1.5)' }, 0)
          .fromTo(panel.querySelectorAll('.cmdk-item'), { opacity: 0, x: dir === 'rtl' ? 10 : -10 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.018, ease: 'power2.out', clearProps: 'opacity,transform' }, 0.1);
      }
      return () => { document.body.style.overflow = previous; };
    }
    const finish = () => { setMounted(false); returnFocus.current?.focus?.(); };
    if (reduced) { finish(); return; }
    const timeline = gsap.timeline({ onComplete: finish });
    timeline.to(panel, { opacity: 0, y: -10, scale: 0.97, duration: 0.18, ease: 'power2.in' }).to(scrim, { opacity: 0, duration: 0.18 }, 0);
    return () => { timeline.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!mounted || typeof document === 'undefined') return null;

  const execute = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'Tab') { event.preventDefault(); inputRef.current?.focus(); return; }
    if (!results.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (value + 1) % results.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value - 1 + results.length) % results.length); }
    if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    if (event.key === 'End') { event.preventDefault(); setActive(results.length - 1); }
    if (event.key === 'Enter') { event.preventDefault(); execute(results[active]); }
  };
  const groups: Array<{ key: Command['group']; title: string }> = [
    { key: 'pages', title: t('الصفحات', 'Pages') },
    { key: 'actions', title: t('إجراءات سريعة', 'Quick actions') },
  ];
  let index = -1;

  return createPortal(
    <div className="cmdk-root" dir={dir} onKeyDown={onKeyDown}>
      <div ref={scrimRef} className="cmdk-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="cmdk-panel" role="dialog" aria-modal="true" aria-label={t('لوحة الأوامر', 'Command palette')}>
        <div className="cmdk-search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[active] ? `cmdk-${results[active].id.replace(/[^a-z0-9]/gi, '-')}` : undefined}
            aria-label={t('ابحث عن صفحة', 'Search pages')}
            placeholder={t('اكتب اسم صفحة أو أمر...', 'Type a page or a command…')}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul ref={listRef} id="cmdk-list" className="cmdk-list" role="listbox" aria-label={t('النتائج', 'Results')}>
          {results.length === 0 && <li className="cmdk-empty" role="presentation">{t('مفيش نتيجة مطابقة', 'No matching results')}</li>}
          {groups.map((group) => {
            const items = results.filter((command) => command.group === group.key);
            if (!items.length) return null;
            return (
              <li key={group.key} role="presentation" className="cmdk-group">
                <p className="cmdk-group-title" aria-hidden="true">{group.title}</p>
                <ul role="group" aria-label={group.title}>
                  {items.map((command) => {
                    index += 1;
                    const current = index;
                    const IconComponent = command.icon;
                    return (
                      <li
                        key={command.id}
                        id={`cmdk-${command.id.replace(/[^a-z0-9]/gi, '-')}`}
                        role="option"
                        aria-selected={current === active}
                        data-index={current}
                        className="cmdk-item"
                        onMouseMove={() => setActive(current)}
                        onClick={() => execute(command)}
                      >
                        <span className="cmdk-item-icon"><IconComponent size={17} aria-hidden="true" /></span>
                        <span className="cmdk-item-label">{command.label}</span>
                        <span className="cmdk-item-hint" dir="ltr">{command.hint}</span>
                        {command.group === 'pages' ? <ArrowUpRight className="cmdk-item-go" size={15} aria-hidden="true" /> : <CornerDownLeft className="cmdk-item-go" size={15} aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        <footer className="cmdk-footer" aria-hidden="true">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd>{t('تنقّل', 'Navigate')}</span>
          <span><kbd className="kbd">↵</kbd>{t('افتح', 'Open')}</span>
          <span className="cmdk-footer-brand">PHANTOMS · {t('مساحة العمل', 'Workspace')}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
