import { useId, useState } from 'react';
import { ArrowUpDown, Check, CircleMinus, Filter, RotateCcw, Search, SlidersHorizontal, Sparkles, UserCheck, X } from 'lucide-react';

import { useLocale } from '../../i18n/useLocale';

export type MemberActivityFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type MemberInformationFilter = 'ALL' | 'COMPLETE' | 'MISSING';
export type MemberSort = 'name' | 'newest' | 'oldest' | 'incomplete';

export interface MemberFiltersValue {
  search: string;
  work_conditions: string;
  device: string;
  alexandria: string;
  activity: MemberActivityFilter;
  information: MemberInformationFilter;
  sort: MemberSort;
}

export const EMPTY_MEMBER_FILTERS: MemberFiltersValue = {
  search: '',
  work_conditions: 'ALL',
  device: 'ALL',
  alexandria: 'ALL',
  activity: 'ALL',
  information: 'ALL',
  sort: 'name',
};

export function countActiveFilters(value: MemberFiltersValue): number {
  return [
    value.search.trim() !== '',
    value.work_conditions !== 'ALL',
    value.device !== 'ALL',
    value.alexandria !== 'ALL',
    value.activity !== 'ALL',
    value.information !== 'ALL',
  ].filter(Boolean).length;
}

export function MemberToolbar({
  workConditions,
  value,
  onChange,
  resultCount,
  totalCount,
  deviceOptions,
}: {
  workConditions: string[];
  value: MemberFiltersValue;
  onChange: (value: MemberFiltersValue) => void;
  resultCount: number;
  totalCount: number;
  deviceOptions?: Array<{ value: string; label: string }>;
}) {
  const { t, number } = useLocale();
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const set = <Key extends keyof MemberFiltersValue>(key: Key, next: MemberFiltersValue[Key]) => onChange({ ...value, [key]: next });
  const activeCount = countActiveFilters(value);
  const isActive = activeCount > 0;
  const clear = () => onChange({ ...EMPTY_MEMBER_FILTERS, sort: value.sort });

  const devices = deviceOptions ?? [
    { value: 'لابتوب', label: t('لابتوب', 'Laptop') },
    { value: 'كمبيوتر', label: t('كمبيوتر مكتبي', 'Desktop PC') },
    { value: 'هاتف', label: t('هاتف محمول', 'Mobile phone') },
    { value: 'بدون', label: t('بدون جهاز', 'No device') },
  ];

  const chips = [
    {
      key: 'active',
      label: t('نشطون', 'Active'),
      icon: <UserCheck aria-hidden="true" />,
      pressed: value.activity === 'ACTIVE',
      toggle: () => set('activity', value.activity === 'ACTIVE' ? 'ALL' : 'ACTIVE'),
    },
    {
      key: 'inactive',
      label: t('غير نشطين', 'Inactive'),
      icon: <CircleMinus aria-hidden="true" />,
      pressed: value.activity === 'INACTIVE',
      toggle: () => set('activity', value.activity === 'INACTIVE' ? 'ALL' : 'INACTIVE'),
    },
    {
      key: 'incomplete',
      label: t('يحتاج بيانات', 'Needs information'),
      icon: <Sparkles aria-hidden="true" />,
      pressed: value.information === 'MISSING',
      toggle: () => set('information', value.information === 'MISSING' ? 'ALL' : 'MISSING'),
    },
    {
      key: 'ready',
      label: t('جاهز للميدان', 'Field ready'),
      icon: <Check aria-hidden="true" />,
      pressed: value.alexandria === 'YES',
      toggle: () => set('alexandria', value.alexandria === 'YES' ? 'ALL' : 'YES'),
    },
  ];

  const tags: Array<{ key: string; label: string; clear: () => void }> = [];
  if (value.search.trim()) tags.push({ key: 'search', label: `${t('بحث', 'Search')}: ${value.search.trim()}`, clear: () => set('search', '') });
  if (value.activity !== 'ALL') tags.push({ key: 'activity', label: value.activity === 'ACTIVE' ? t('نشط', 'Active') : t('غير نشط', 'Inactive'), clear: () => set('activity', 'ALL') });
  if (value.information !== 'ALL') tags.push({ key: 'information', label: value.information === 'MISSING' ? t('يحتاج بيانات', 'Needs information') : t('البيانات مكتملة', 'Information complete'), clear: () => set('information', 'ALL') });
  if (value.alexandria !== 'ALL') tags.push({ key: 'alexandria', label: value.alexandria === 'YES' ? t('جاهز للميدان', 'Field ready') : t('مش متاح للميدان', 'Not field ready'), clear: () => set('alexandria', 'ALL') });
  if (value.device !== 'ALL') tags.push({ key: 'device', label: devices.find((option) => option.value === value.device)?.label ?? value.device, clear: () => set('device', 'ALL') });
  if (value.work_conditions !== 'ALL') tags.push({ key: 'work_conditions', label: value.work_conditions, clear: () => set('work_conditions', 'ALL') });

  return (
    <div className="member-dir-toolbar glass-card">
      <div className="member-dir-toolbar-top">
        <label className="member-dir-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{t('البحث في دليل الأعضاء', 'Search the member directory')}</span>
          <input
            type="search"
            value={value.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder={t('ابحث بالاسم، الهاتف، الرقم الأكاديمي، المجموعة أو التخصص…', 'Search name, phone, academic number, group or specialization…')}
            aria-describedby={`${panelId}-help`}
          />
          {value.search && (
            <button type="button" className="member-dir-search-clear" onClick={() => set('search', '')} aria-label={t('امسح البحث', 'Clear search')}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>
        <button
          type="button"
          className="member-dir-button"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          {t('كل الفلاتر', 'All filters')}
          {activeCount > 0 && <span className="member-dir-button-count">{number(activeCount)}</span>}
        </button>
        <label className="member-dir-button" title={t('ترتيب النتائج', 'Sort results')}>
          <ArrowUpDown size={16} aria-hidden="true" />
          <span className="sr-only">{t('ترتيب النتائج', 'Sort results')}</span>
          <select
            value={value.sort}
            onChange={(event) => set('sort', event.target.value as MemberSort)}
            style={{ border: 0, background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none' }}
          >
            <option value="name">{t('الاسم (أ–ي)', 'Name (A–Z)')}</option>
            <option value="newest">{t('الأحدث إضافة', 'Newest first')}</option>
            <option value="oldest">{t('الأقدم إضافة', 'Oldest first')}</option>
            <option value="incomplete">{t('ناقص البيانات أولًا', 'Missing info first')}</option>
          </select>
        </label>
      </div>

      <p id={`${panelId}-help`} className="sr-only">
        {t(
          'البحث يشمل الاسم والبريد والهاتف والإقامة والنبذة والرقم الأكاديمي والمجموعة والتخصص والحقول المخصصة.',
          'Search covers name, email, phone, residence, bio, academic number, group, specialization and custom fields.',
        )}
      </p>

      <div className="member-dir-chips-row">
        {chips.map((chip) => (
          <button key={chip.key} type="button" className="member-dir-chip" aria-pressed={chip.pressed} onClick={chip.toggle}>
            {chip.icon}
            {chip.label}
          </button>
        ))}
        <span className="member-dir-sep" aria-hidden="true" />
        <span className="member-dir-results">
          <p role="status" aria-live="polite" aria-atomic="true">
            {isActive ? (
              <>
                {t('النتائج', 'Results')} <strong>{number(resultCount)}</strong> {t('من', 'of')} {number(totalCount)}
              </>
            ) : (
              <>
                {t('الإجمالي', 'Total')} <strong>{number(totalCount)}</strong>
              </>
            )}
          </p>
        </span>
      </div>

      {panelOpen && (
        <div className="member-dir-panel" id={panelId}>
          <label className="member-dir-field">
            <span>{t('ظروف العمل', 'Work conditions')}</span>
            <select value={value.work_conditions} onChange={(event) => set('work_conditions', event.target.value)}>
              <option value="ALL">{t('كل الظروف', 'All conditions')}</option>
              {workConditions.map((condition) => (
                <option key={condition} value={condition}>{condition}</option>
              ))}
            </select>
          </label>
          <label className="member-dir-field">
            <span>{t('الجهاز', 'Device')}</span>
            <select value={value.device} onChange={(event) => set('device', event.target.value)}>
              <option value="ALL">{t('كل الأجهزة', 'All devices')}</option>
              {devices.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="member-dir-field">
            <span>{t('النزول الميداني', 'Field work')}</span>
            <select value={value.alexandria} onChange={(event) => set('alexandria', event.target.value)}>
              <option value="ALL">{t('الكل', 'All')}</option>
              <option value="YES">{t('جاهز للنزول', 'Available for field work')}</option>
              <option value="NO">{t('مش متاح', 'Unavailable')}</option>
            </select>
          </label>
          <label className="member-dir-field">
            <span>{t('حالة النشاط', 'Activity')}</span>
            <select value={value.activity} onChange={(event) => set('activity', event.target.value as MemberActivityFilter)}>
              <option value="ALL">{t('الكل', 'All')}</option>
              <option value="ACTIVE">{t('نشط', 'Active')}</option>
              <option value="INACTIVE">{t('غير نشط', 'Inactive')}</option>
            </select>
          </label>
          <label className="member-dir-field">
            <span>{t('اكتمال البيانات', 'Information')}</span>
            <select value={value.information} onChange={(event) => set('information', event.target.value as MemberInformationFilter)}>
              <option value="ALL">{t('الكل', 'All')}</option>
              <option value="MISSING">{t('يحتاج استكمال', 'Needs information')}</option>
              <option value="COMPLETE">{t('مكتملة', 'Complete')}</option>
            </select>
          </label>
        </div>
      )}

      {isActive && (
        <div className="member-dir-active">
          <span className="member-dir-active-label"><Filter size={13} aria-hidden="true" /> {t('فلاتر مطبقة', 'Applied filters')}</span>
          {tags.map((tag) => (
            <span key={tag.key} className="member-dir-tag">
              {tag.label}
              <button type="button" onClick={tag.clear} aria-label={`${t('شيل الفلتر', 'Remove filter')}: ${tag.label}`}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="member-dir-reset" onClick={clear}>
            <RotateCcw size={13} aria-hidden="true" />
            {t('مسح الكل', 'Clear all')}
          </button>
        </div>
      )}
    </div>
  );
}
