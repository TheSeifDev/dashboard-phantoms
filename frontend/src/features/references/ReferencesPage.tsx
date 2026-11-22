import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Globe2, Layers3, Link2, Plus, Search, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';
import { useAdminReferences, useDeleteReference } from './api';
import { ReferenceCard } from './ReferenceCard';
import { ReferenceEditorModal } from './ReferenceEditorModal';
import { filterReferences, type ReferenceLink } from './types';
import './references.css';

export default function ReferencesPage() {
  const { t, number, dir } = useLocale();
  const references = useAdminReferences();
  const deleteReference = useDeleteReference();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ReferenceLink | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReferenceLink | null>(null);

  const links = references.data?.links ?? [];
  const teams = references.data?.teams ?? [];

  useEffect(() => {
    if (scope && scope !== 'global' && teams.length > 0 && !teams.some((team) => team.slug === scope)) setScope(null);
  }, [scope, teams]);

  const visible = useMemo(() => filterReferences(links, query, scope), [links, query, scope]);

  const metrics = useMemo(() => {
    const global = links.filter((link) => link.team_slug === null).length;
    return { global, teamScoped: links.length - global, teams: teams.length };
  }, [links, teams]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (link: ReferenceLink) => {
    setEditing(link);
    setEditorOpen(true);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await deleteReference.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذف المصدر.', 'Reference deleted.'));
      setPendingDelete(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف المصدر.', 'Could not delete the reference.'));
    }
  };

  const tabs: Array<{ value: string | null; label: string; count: number; icon: typeof Link2 }> = [
    { value: null, label: t('الكل', 'All'), count: links.length, icon: Layers3 },
    { value: 'global', label: t('Global', 'Global'), count: metrics.global, icon: Globe2 },
    ...teams.map((team) => ({ value: team.slug, label: team.name, count: links.filter((link) => link.team_slug === team.slug).length, icon: Users })),
  ];

  return (
    <div className="ref-page" dir={dir}>
      <PageHeader
        icon={<BookMarked size={22} aria-hidden="true" />}
        title={t('المصادر', 'References')}
        description={t('كل لينك مهم في مكان واحد: frameworks، libraries، docs، أدوات. مرجع Global لكل الفريق، أو خاص بتيم واحد بس — بدل ما نتوه إحنا سجلناه فين.', 'Every important link in one place: frameworks, libraries, docs, tools. Global for everyone, or scoped to a single team.')}
        actions={<Button icon={<Plus size={17} aria-hidden="true" />} onClick={openCreate}>{t('مصدر جديد', 'New reference')}</Button>}
      />

      <section className="ref-metrics" aria-label={t('ملخص المصادر', 'References summary')}>
        <div className="ref-metric">
          <span>{t('إجمالي المصادر', 'Total references')}<Link2 size={15} aria-hidden="true" /></span>
          <strong>{number(links.length)}</strong>
          <small>{t('لينكات محفوظة', 'Saved links')}</small>
        </div>
        <div className="ref-metric">
          <span>{t('Global', 'Global')}<Globe2 size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.global)}</strong>
          <small>{t('متاحة لكل الأعضاء', 'Visible to every member')}</small>
        </div>
        <div className="ref-metric">
          <span>{t('مراجع التيمات', 'Team references')}<Users size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.teamScoped)}</strong>
          <small>{t('مربوطة بتيم معيّن', 'Scoped to one team')}</small>
        </div>
        <div className="ref-metric">
          <span>{t('التيمات', 'Teams')}<Layers3 size={15} aria-hidden="true" /></span>
          <strong>{number(metrics.teams)}</strong>
          <small>{t('AI · Software · Hardware وأي تيم جديد', 'AI · Software · Hardware and any new team')}</small>
        </div>
      </section>

      <section className="ref-panel" aria-label={t('كل المصادر', 'All references')}>
        <div className="ref-toolbar">
          <div className="ref-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('ابحث بالاسم أو الرابط أو الوصف…', 'Search by title, link, or description…')}
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

        {references.isPending && <div className="ref-grid"><CardSkeletons count={3} /></div>}
        {references.isError && <ErrorState message={t('معرفناش نحمّل المصادر.', 'Could not load the references.')} onRetry={() => { void references.refetch(); }} />}
        {references.data && links.length === 0 && (
          <div className="ref-empty">
            <BookMarked size={28} strokeWidth={1.5} aria-hidden="true" />
            <p>{t('لسه مفيش مصادر محفوظة. ابدأ بأهم Framework أو مكتبة الفريق بيستخدمها.', 'No references saved yet. Start with the framework or library the team uses most.')}</p>
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('مصدر جديد', 'New reference')}</Button>
          </div>
        )}
        {references.data && links.length > 0 && visible.length === 0 && (
          <div className="ref-empty">
            <Search size={26} strokeWidth={1.5} aria-hidden="true" />
            <p>{t('مفيش مصادر مطابقة للبحث أو التصفية دي.', 'No references match this search or filter.')}</p>
            <Button variant="secondary" onClick={() => { setQuery(''); setScope(null); }}>{t('مسح التصفية', 'Clear filters')}</Button>
          </div>
        )}
        {visible.length > 0 && (
          <div className="ref-grid">
            {visible.map((link) => (
              <ReferenceCard key={link.id} link={link} onEdit={openEdit} onDelete={setPendingDelete} />
            ))}
          </div>
        )}
      </section>

      <section className="ref-note">
        <Globe2 size={15} aria-hidden="true" />
        <p>{t('المرجع الـGlobal بيظهر لكل أعضاء البوابة. المرجع الخاص بتيم بيظهر لأعضاء التيم ده بس (العضوية النشطة وقت القراءة) — وأي تيم جديد يظهر هنا تلقائيًا.', 'Global references appear to every portal member. A team reference appears only to that team’s active members — new teams show up here automatically.')}</p>
      </section>

      <ReferenceEditorModal isOpen={editorOpen} onClose={() => setEditorOpen(false)} teams={teams} link={editing} />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
        title={t('حذف المصدر؟', 'Delete this reference?')}
        description={t('هيتحذف اللينك من المنصة نهائيًا. تقدر ترجعه في أي وقت بإضافة جديدة.', 'The link is removed from the platform. You can add it again at any time.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={deleteReference.isPending}
        pendingLabel={t('بيتحذف…', 'Deleting…')}
      />
    </div>
  );
}