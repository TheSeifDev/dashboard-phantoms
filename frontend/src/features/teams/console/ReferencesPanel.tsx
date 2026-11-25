import { useMemo, useState, type FormEvent } from 'react';
import { BookOpen, ExternalLink, Globe2, Plus, Trash2, UsersRound } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import { useAdminReferences, useDeleteReference, useSaveReference } from '../../references/api';
import {
  REFERENCE_CATEGORY_LABELS, REFERENCE_CATEGORY_ORDER, hostOf, isValidReferenceUrl, normalizeReferenceUrl,
  type ReferenceCategory, type ReferenceLink,
} from '../../references/types';
import { PanelShell, StateChip } from './shared';

export function ReferencesPanel({ teamSlug }: { teamSlug: string }) {
  const { t, locale, number, date } = useLocale();
  const references = useAdminReferences(true);
  const saveReference = useSaveReference();
  const deleteReference = useDeleteReference();
  const [scope, setScope] = useState<'team' | 'global'>('team');
  const [category, setCategory] = useState<ReferenceCategory>('docs');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ReferenceLink | null>(null);

  const links = useMemo(() => (references.data?.links ?? []).filter(
    (link) => link.team_slug === null || link.team_slug === teamSlug,
  ), [references.data, teamSlug]);
  const teamLinks = links.filter((link) => link.team_slug === teamSlug);
  const globalLinks = links.filter((link) => link.team_slug === null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim().length < 2) {
      toast.error(t('اكتب اسم واضح للمصدر.', 'Write a clear reference title.'));
      return;
    }
    if (!isValidReferenceUrl(url)) {
      toast.error(t('الرابط مش صحيح — لازم يبدأ بـ http أو https.', 'Invalid URL — it must start with http or https.'));
      return;
    }
    try {
      await saveReference.mutateAsync({
        title: title.trim(),
        url: normalizeReferenceUrl(url),
        description: description.trim(),
        category,
        team_slug: scope === 'team' ? teamSlug : null,
      });
      toast.success(scope === 'team' ? t('اتضاف المصدر للفريق.', 'Reference added to the team.') : t('اتضاف المصدر كمرجع Global.', 'Reference added as a global reference.'));
      setTitle('');
      setUrl('');
      setDescription('');
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ المصدر.', 'Could not save the reference.')).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteReference.mutateAsync(pendingDelete.id);
      toast.success(t('اتحذف المصدر.', 'Reference deleted.'));
      setPendingDelete(null);
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحذف المصدر.', 'Could not delete the reference.')).message);
    }
  };

  const renderList = (items: ReferenceLink[], kind: 'team' | 'global') => {
    if (items.length === 0) {
      return (
        <p className="tmc-note">
          {kind === 'team'
            ? t('مفيش مصادر خاصة بالفريق لحد الآن.', 'No team-specific references yet.')
            : t('مفيش مصادر Global متاحة.', 'No global references available.')}
        </p>
      );
    }
    return (
      <ul className="tmc-ref-list">
        {items.map((link) => (
          <li key={link.id} className="tmc-ref" data-tmc-anim>
            <div className="tmc-ref-head">
              <a href={link.url} target="_blank" rel="noreferrer noopener" className="tmc-ref-link">
                <span className="tmc-ref-title">{link.title}</span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
              <StateChip tone={kind === 'team' ? 'accent' : 'muted'}>
                {REFERENCE_CATEGORY_LABELS[link.category]?.[locale === 'ar' ? 'ar' : 'en'] ?? link.category}
              </StateChip>
            </div>
            <p className="tmc-ref-host" dir="ltr">{hostOf(link.url)}</p>
            {link.description ? <p className="tmc-ref-desc">{link.description}</p> : null}
            <div className="tmc-ref-foot">
              <small>{date(link.created_at)}</small>
              <button
                type="button"
                className="tmc-icon-btn is-danger"
                onClick={() => setPendingDelete(link)}
                aria-label={t(`حذف ${link.title}`, `Delete ${link.title}`)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <PanelShell
        id="tmc-ref-create"
        kicker={<><Plus size={14} aria-hidden="true" />{t('مصدر جديد', 'New reference')}</>}
        title={t('سجّل لينك مهم للفريق', 'Save an important link for the team')}
        hint={t('المصدر يقدر يكون خاص بالفريق أو Global يظهر لكل الفرق.', 'A reference can belong to this team or be global for every team.')}
      >
        <form className="tmc-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="tmc-field tmc-field--wide">
            <legend>{t('نطاق المصدر', 'Reference scope')}</legend>
            <div className="tmc-segmented" role="group">
              <button type="button" className={scope === 'team' ? 'is-active' : ''} aria-pressed={scope === 'team'} onClick={() => setScope('team')}>
                <UsersRound size={13} aria-hidden="true" />{t('خاص بالفريق', 'Team only')}
              </button>
              <button type="button" className={scope === 'global' ? 'is-active' : ''} aria-pressed={scope === 'global'} onClick={() => setScope('global')}>
                <Globe2 size={13} aria-hidden="true" />{t('Global', 'Global')}
              </button>
            </div>
          </fieldset>
          <label className="tmc-field">
            <span>{t('اسم المصدر', 'Reference title')}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} required maxLength={160} placeholder={t('مثال: React Router docs', 'e.g. React Router docs')} />
          </label>
          <label className="tmc-field">
            <span>{t('التصنيف', 'Category')}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as ReferenceCategory)}>
              {REFERENCE_CATEGORY_ORDER.map((value) => (
                <option key={value} value={value}>{REFERENCE_CATEGORY_LABELS[value][locale === 'ar' ? 'ar' : 'en']}</option>
              ))}
            </select>
          </label>
          <label className="tmc-field tmc-field--wide">
            <span>{t('الرابط', 'URL')}</span>
            <input value={url} onChange={(event) => setUrl(event.target.value.trim())} required dir="ltr" placeholder="https://…" />
          </label>
          <label className="tmc-field tmc-field--wide">
            <span>{t('وصف قصير', 'Short description')}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 400))} rows={2} maxLength={400} placeholder={t('ليه المصدر ده مهم للفريق؟ (اختياري)', 'Why is it useful for the team? (optional)')} />
          </label>
          <div className="tmc-form-actions">
            <Button type="submit" icon={<BookOpen size={15} aria-hidden="true" />} isLoading={saveReference.isPending}>
              {t('حفظ المصدر', 'Save reference')}
            </Button>
          </div>
        </form>
      </PanelShell>

      {references.isPending && <CardSkeletons count={1} />}
      {references.isError && <ErrorState message={t('تعذر تحميل المصادر.', 'Could not load references.')} onRetry={() => { void references.refetch(); }} />}
      {references.data && (
        <div className="tmc-chart-grid">
          <PanelShell
            id="tmc-ref-team"
            kicker={<><UsersRound size={14} aria-hidden="true" />{t('خاص بالفريق', 'Team references')}</>}
            title={t('مصادر الفريق', 'Team references')}
            actions={<StateChip tone="accent">{number(teamLinks.length)}</StateChip>}
          >
            {teamLinks.length === 0 && links.length === 0
              ? <EmptyState title={t('مفيش مصادر بعد', 'No references yet')} description={t('ضيف أول لينك من الفورم فوق.', 'Add the first link with the form above.')} />
              : renderList(teamLinks, 'team')}
          </PanelShell>
          <PanelShell
            id="tmc-ref-global"
            kicker={<><Globe2 size={14} aria-hidden="true" />{t('Global', 'Global')}</>}
            title={t('مصادر مشتركة', 'Shared references')}
            actions={<StateChip tone="muted">{number(globalLinks.length)}</StateChip>}
          >
            {renderList(globalLinks, 'global')}
          </PanelShell>
        </div>
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t('حذف المصدر؟', 'Delete this reference?')}
        description={t('اللينك هيتحذف من قائمة المصادر نهائيًا.', 'The link will be removed from references permanently.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={deleteReference.isPending}
        pendingLabel={t('بيتم الحذف...', 'Deleting…')}
      />
    </>
  );
}
