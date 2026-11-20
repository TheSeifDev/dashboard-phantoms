import { useState, type FormEvent } from 'react';
import { Plus, ExternalLink } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { toast } from '../../store/toast';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Field, SafeLink, StatusBadge, safeHref } from './common';
import { useWebMutation, useWebQuery } from './api';
import { RESOURCE_CATEGORIES, type WebMode, type WebResource } from './types';

const CATEGORY_COPY: Record<string, [string, string]> = {
  brand_logo: ['الشعارات', 'Brand logos'], brand_guidelines: ['دليل الهوية', 'Brand guidelines'], design_system: ['نظام التصميم', 'Design system'],
  ui_components: ['مكونات الواجهة', 'UI components'], documents_templates: ['الوثائق والقوالب', 'Documents & templates'], approved_fonts: ['الخطوط المعتمدة', 'Approved fonts'],
  illustrations_media: ['الرسومات والوسائط', 'Illustrations & media'], technical_standards: ['معايير تقنية', 'Technical standards'], development_resources: ['موارد التطوير', 'Development resources'], other: ['أخرى', 'Other'],
};
export function ResourcesPanel({ mode = 'admin' }: { mode?: WebMode }) {
  const { t, date } = useLocale();
  const query = useWebQuery<WebResource>(mode, 'web_resources', undefined, { project_id: null });
  const mutation = useWebMutation(mode);
  const [editing, setEditing] = useState<WebResource | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [preview, setPreview] = useState<WebResource | null>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const external = safeHref(String(form.get('external_url') ?? ''));
    if (!external) { toast.error(t('أدخل رابط HTTP أو HTTPS صالحًا.', 'Enter a valid HTTP or HTTPS link.')); return; }
    const approved = form.get('approved') === 'on';
    try {
      await mutation.mutateAsync({ table: 'web_resources', operation: editing === 'new' ? 'insert' : 'update', id: editing && editing !== 'new' ? editing.id : undefined, data: {
        ...(editing === 'new' ? { project_id: null, scope_id: '00000000-0000-0000-0000-000000000000' } : {}), title: String(form.get('title')), description: String(form.get('description')),
        category: String(form.get('category')), external_url: external, preview_url: safeHref(String(form.get('preview_url') ?? '')),
        version_label: String(form.get('version_label') ?? '') || null,
        tags: String(form.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean), is_approved: approved, access_status: approved ? 'approved' : 'pending',
      } });
      setEditing(null); toast.success(t('تم حفظ المورد المشترك.', 'Shared resource saved.'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('تعذر حفظ المورد.', 'Could not save resource.')); }
  };
  const visible = (query.data ?? []).filter((item) => (category === 'all' || item.category === category) && `${item.title} ${item.description} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  const value = editing !== 'new' ? editing : null;
  return <section className="wp-stack"><div className="wp-row"><div><h2>{t('مكتبة PHANTOMS المشتركة', 'PHANTOMS shared library')}</h2><p className="wp-muted">{t('مرجع واحد للأصول المعتمدة؛ تستخدم المشروعات المرجع نفسه دون نسخ الملفات.', 'One source for approved assets. Projects reference the same resource without duplicating files.')}</p></div>{mode === 'admin' && <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>{t('إضافة مورد', 'Add resource')}</Button>}</div>
    <div className="wp-toolbar"><Field label={t('البحث في الموارد', 'Search resources')}><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></Field><Field label={t('الفئة', 'Category')}><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">{t('كل الفئات', 'All categories')}</option>{RESOURCE_CATEGORIES.map((key) => <option key={key} value={key}>{t(...CATEGORY_COPY[key])}</option>)}</select></Field></div>
    {query.isPending && <p role="status">{t('جارٍ تحميل المكتبة…', 'Loading library…')}</p>}{query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}{query.data && visible.length === 0 && <EmptyState title={t('لا توجد موارد مطابقة', 'No matching resources')} description={t('أضف موردًا معتمدًا أو عدل المرشحات.', 'Add an approved resource or adjust filters.')} />}
    <div className="wp-grid">{visible.map((item) => <article key={item.id} className="wp-panel wp-stack"><div className="wp-row"><span className="wp-eyebrow">{t(...CATEGORY_COPY[item.category])}</span><StatusBadge status={item.access_status} /></div><h3>{item.title}</h3><p className="wp-muted">{item.description}</p><div className="wp-row"><span className="wp-muted">{item.version_label ?? '—'} · {date(item.updated_at)}</span><div className="wp-actions"><Button variant="secondary" onClick={() => setPreview(item)}>{t('عرض المرجع', 'View reference')}</Button>{mode === 'admin' && <Button variant="ghost" onClick={() => setEditing(item)}>{t('تعديل واعتماد', 'Edit & approve')}</Button>}</div></div></article>)}</div>
    <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title={t('المورد المشترك', 'Shared resource')} maxWidth="lg" footer={<Button form="wp-resource-form" type="submit" isLoading={mutation.isPending}>{t('حفظ المورد', 'Save resource')}</Button>}><form key={value?.id ?? 'new'} id="wp-resource-form" onSubmit={(event) => void save(event)} className="wp-stack"><Field label={t('العنوان', 'Title')}><input name="title" required minLength={2} maxLength={180} defaultValue={value?.title} /></Field><Field label={t('الوصف', 'Description')}><textarea name="description" defaultValue={value?.description} /></Field><Field label={t('الفئة', 'Category')}><select name="category" defaultValue={value?.category ?? 'development_resources'}>{RESOURCE_CATEGORIES.map((key) => <option key={key} value={key}>{t(...CATEGORY_COPY[key])}</option>)}</select></Field><Field label={t('رابط المورد', 'Resource URL')}><input name="external_url" type="url" required defaultValue={value?.external_url ?? ''} dir="ltr" /></Field><Field label={t('رابط معاينة (اختياري)', 'Preview URL (optional)')}><input name="preview_url" type="url" defaultValue={value?.preview_url ?? ''} dir="ltr" /></Field><div className="wp-grid"><Field label={t('الإصدار', 'Version')}><input name="version_label" defaultValue={value?.version_label ?? ''} /></Field><Field label={t('الوسوم (بفواصل)', 'Tags (comma separated)')}><input name="tags" defaultValue={value?.tags.join(', ')} /></Field></div><Field label={t('اعتماد المورد للمشروعات', 'Approve resource for projects')}><input type="checkbox" name="approved" defaultChecked={value?.is_approved} /></Field><p className="wp-muted">{t('الروابط متاحة الآن. رفع الملفات يتطلب مخزنًا خاصًا وسياسات وصول معتمدة؛ لا يتم الادعاء بتفعيل مخزن غير موجود.', 'Links are supported. File uploads require a configured private bucket and approved access policies; no unconfigured storage is represented as active.')}</p></form></Modal>
    <Modal isOpen={preview !== null} onClose={() => setPreview(null)} title={preview?.title ?? ''} maxWidth="lg">{preview && <div className="wp-stack"><p className="wp-detail-copy">{preview.description}</p>{safeHref(preview.preview_url) && /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(preview.preview_url ?? '') && <img src={safeHref(preview.preview_url) ?? ''} alt={preview.title} loading="lazy" style={{ maxHeight: 320, objectFit: 'contain' }} />}<SafeLink href={preview.external_url}><ExternalLink size={16} className="inline" /> {t('فتح المورد الأصلي', 'Open original resource')}</SafeLink>{preview.preview_url && <SafeLink href={preview.preview_url}>{t('فتح المعاينة', 'Open preview')}</SafeLink>}<p className="wp-muted">{preview.tags.join(' · ')} · {preview.version_label ?? '—'}</p></div>}</Modal>
  </section>;
}
