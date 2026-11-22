import { useMemo, useState } from 'react';
import { BookMarked, Globe2, Layers3, Search, Users } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { useMemberReferences } from './api';
import { ReferenceCard } from './ReferenceCard';
import { filterReferences } from './types';
import './references.css';

export default function MemberReferencesPage() {
  const { t, number, dir } = useLocale();
  const member = useAuthStore((state) => state.currentMember);
  const references = useMemberReferences(Boolean(member));
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);

  const links = references.data?.links ?? [];
  const teams = references.data?.teams ?? [];
  const visible = useMemo(() => filterReferences(links, query, scope), [links, query, scope]);
  const globalCount = links.filter((link) => link.team_slug === null).length;

  const tabs: Array<{ value: string | null; label: string; count: number; icon: typeof Layers3 }> = [
    { value: null, label: t('الكل', 'All'), count: links.length, icon: Layers3 },
    { value: 'global', label: t('Global', 'Global'), count: globalCount, icon: Globe2 },
    ...teams.map((team) => ({ value: team.slug, label: team.name, count: links.filter((link) => link.team_slug === team.slug).length, icon: Users })),
  ];

  return (
    <div className="ref-page" dir={dir}>
      <PageHeader
        icon={<BookMarked size={22} aria-hidden="true" />}
        title={t('المصادر', 'References')}
        description={t('كل اللينكات المهمة اللي الفريق محتاجها — frameworks، libraries، docs وأدوات. المراجع العامة لكل حد، والخاصة بتيمك ظاهرة لك انت بس.', 'Every link the team needs — frameworks, libraries, docs, and tools. Global references for everyone, yours team’s references visible to you.')}
      />

      {references.isPending && <CardSkeletons count={3} />}
      {references.isError && <ErrorState message={t('معرفناش نحمّل المصادر.', 'Could not load the references.')} onRetry={() => { void references.refetch(); }} />}

      {references.data && (
        <section className="ref-panel" aria-label={t('المصادر المتاحة لك', 'References available to you')}>
          <div className="ref-toolbar">
            <div className="ref-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('ابحث بالاسم أو الرابط…', 'Search by title or link…')}
                aria-label={t('بحث المصادر', 'Search references')}
              />
            </div>
            <div className="ref-tabs" role="group" aria-label={t('تصفية المصادر', 'Filter references')}>
              {tabs.map(({ value, label, count, icon: Icon }) => (
                <button key={value ?? 'all'} type="button" className="ref-tab" aria-pressed={scope === value} onClick={() => setScope(value)}>
                  <Icon size={12} aria-hidden="true" style={{ display: 'inline', marginInlineEnd: 5, verticalAlign: '-1px' }} />
                  {label} · {number(count)}
                </button>
              ))}
            </div>
          </div>

          {links.length === 0 && (
            <div className="ref-grid">
              <EmptyState
                title={t('لسه مفيش مصادر ليك', 'No references for you yet')}
                description={t('أول ما الإدارة تضيف مرجع Global أو مرجع لتيمك، هيظهر هنا تلقائي.', 'As soon as an admin adds a global reference or one for your team, it appears here.')}
              />
            </div>
          )}

          {links.length > 0 && visible.length === 0 && (
            <div className="ref-empty">
              <Search size={26} strokeWidth={1.5} aria-hidden="true" />
              <p>{t('مفيش مصادر مطابقة للبحث أو التصفية دي.', 'No references match this search or filter.')}</p>
              <button type="button" className="ref-tab" onClick={() => { setQuery(''); setScope(null); }}>{t('مسح التصفية', 'Clear filters')}</button>
            </div>
          )}

          {visible.length > 0 && (
            <div className="ref-grid">
              {visible.map((link) => <ReferenceCard key={link.id} link={link} />)}
            </div>
          )}
        </section>
      )}

      <section className="ref-note">
        <Users size={15} aria-hidden="true" />
        <p>{t('المراجع الخاصة بتيم بتيجي من عضويتك النشطة في التيم. لو اتحركت لتيم تاني، القائمة بتتحدّث تلقائي.', 'Team references follow your active team memberships. If your team changes, the list updates automatically.')}</p>
      </section>
    </div>
  );
}