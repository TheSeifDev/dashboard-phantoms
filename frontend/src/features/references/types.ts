/** عقود RPC المصادر — مشتركة بين لوحة الإدارة وبوابة العضو. */
export type ReferenceCategory = 'framework' | 'library' | 'docs' | 'tool' | 'design' | 'course' | 'repo' | 'other';

export interface ReferenceLink {
  id: number;
  title: string;
  url: string;
  description: string | null;
  category: ReferenceCategory;
  /** null = مرجع Global لكل الفريق */
  team_slug: string | null;
  team_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferenceTeam {
  slug: string;
  name: string;
}

export interface ReferencePayload {
  links: ReferenceLink[];
  teams: ReferenceTeam[];
  total: number;
}

export interface ReferenceDraft {
  id?: number;
  title: string;
  url: string;
  description: string;
  category: ReferenceCategory;
  team_slug: string | null;
}

export const REFERENCE_CATEGORY_ORDER: ReferenceCategory[] = ['framework', 'library', 'docs', 'tool', 'design', 'course', 'repo', 'other'];

export const REFERENCE_CATEGORY_LABELS: Record<ReferenceCategory, { ar: string; en: string }> = {
  framework: { ar: 'Framework', en: 'Framework' },
  library: { ar: 'Library', en: 'Library' },
  docs: { ar: 'Documentation', en: 'Documentation' },
  tool: { ar: 'أداة', en: 'Tool' },
  design: { ar: 'تصميم', en: 'Design' },
  course: { ar: 'كورس', en: 'Course' },
  repo: { ar: 'Repository', en: 'Repository' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** اسم النطاق للعرض (بدون www وبدون المسار). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

/** يضيف https:// لو المستخدم كتب الدومين بدون بروتوكول. */
export function normalizeReferenceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** هل الرابط صالح للنشر (http/https بدون مسافات)؟ */
export function isValidReferenceUrl(value: string): boolean {
  const normalized = normalizeReferenceUrl(value);
  if (!/^https?:\/\/[^\s]+$/i.test(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.includes('.') && !parsed.hostname.startsWith('.');
  } catch {
    return false;
  }
}

/** تصفية المصادر بالبحث + النطاق المختار (null = الكل، 'global' = العام). */
export function filterReferences(links: ReferenceLink[], query: string, scope: string | null): ReferenceLink[] {
  const needle = query.trim().toLocaleLowerCase();
  return links.filter((link) => {
    if (scope === 'global' && link.team_slug !== null) return false;
    if (scope && scope !== 'global' && link.team_slug !== scope) return false;
    if (!needle) return true;
    const haystack = `${link.title} ${link.url} ${link.description ?? ''} ${link.team_name ?? ''} ${REFERENCE_CATEGORY_LABELS[link.category].en}`;
    return haystack.toLocaleLowerCase().includes(needle);
  });
}
