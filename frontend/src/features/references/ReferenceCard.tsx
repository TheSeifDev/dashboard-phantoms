import { ArrowUpRight, BookOpen, Boxes, ExternalLink, GitBranch, GraduationCap, Link2, Package, Palette, Pencil, Trash2, Wrench, Users } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { REFERENCE_CATEGORY_LABELS, hostOf, type ReferenceCategory, type ReferenceLink } from './types';

const CATEGORY_ICONS: Record<ReferenceCategory, typeof Link2> = {
  framework: Boxes,
  library: Package,
  docs: BookOpen,
  tool: Wrench,
  design: Palette,
  course: GraduationCap,
  repo: GitBranch,
  other: Link2,
};

interface Props {
  link: ReferenceLink;
  onEdit?: (link: ReferenceLink) => void;
  onDelete?: (link: ReferenceLink) => void;
}

export function ReferenceCard({ link, onEdit, onDelete }: Props) {
  const { t } = useLocale();
  const Icon = CATEGORY_ICONS[link.category] ?? Link2;
  return (
    <article className="ref-card">
      <div className="ref-card-head">
        <span className="ref-card-mark" aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
        <div className="ref-card-title">
          <h3>{link.title}</h3>
          <span className="ref-host">{hostOf(link.url)}</span>
        </div>
      </div>
      {link.description && <p>{link.description}</p>}
      <div className="ref-chips">
        <span className="ref-chip">{t(REFERENCE_CATEGORY_LABELS[link.category].ar, REFERENCE_CATEGORY_LABELS[link.category].en)}</span>
        {link.team_slug === null ? (
          <span className="ref-chip ref-chip--global"><Users size={11} aria-hidden="true" />{t('Global · كل الفريق', 'Global')}</span>
        ) : (
          <span className="ref-chip ref-chip--team">{link.team_name ?? link.team_slug}</span>
        )}
      </div>
      <div className="ref-card-foot">
        <a className="ref-open" href={link.url} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={13} aria-hidden="true" />
          {t('فتح الرابط', 'Open link')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        {(onEdit || onDelete) && (
          <div className="ref-actions">
            {onEdit && (
              <button type="button" className="ref-icon-btn" onClick={() => onEdit(link)} aria-label={t(`تعديل ${link.title}`, `Edit ${link.title}`)}>
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
            {onDelete && (
              <button type="button" className="ref-icon-btn ref-icon-btn--danger" onClick={() => onDelete(link)} aria-label={t(`حذف ${link.title}`, `Delete ${link.title}`)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}