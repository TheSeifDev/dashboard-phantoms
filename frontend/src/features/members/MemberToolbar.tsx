import { RotateCcw, Search } from 'lucide-react';

import { useLocale } from '../../i18n/useLocale';

export type MemberActivityFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type MemberInformationFilter = 'ALL' | 'COMPLETE' | 'MISSING';
export interface MemberFiltersValue {
  search: string;
  work_conditions: string;
  device: string;
  alexandria: string;
  activity: MemberActivityFilter;
  information: MemberInformationFilter;
}

export function MemberToolbar({
  workConditions,
  value,
  onChange,
  resultCount,
  totalCount,
}: {
  workConditions: string[];
  value: MemberFiltersValue;
  onChange: (value: MemberFiltersValue) => void;
  resultCount: number;
  totalCount: number;
}) {
  const { t, number } = useLocale();
  const set = <Key extends keyof MemberFiltersValue>(key: Key, next: MemberFiltersValue[Key]) => onChange({ ...value, [key]: next });
  const isActive =
    value.search.trim() !== '' || value.work_conditions !== 'ALL' || value.device !== 'ALL' || value.alexandria !== 'ALL' || value.activity !== 'ALL' || value.information !== 'ALL';
  const activeFilterCount = [
    value.search.trim() !== '',
    value.work_conditions !== 'ALL',
    value.device !== 'ALL',
    value.alexandria !== 'ALL',
    value.activity !== 'ALL',
    value.information !== 'ALL',
  ].filter(Boolean).length;
  const clear = () => onChange({ search: '', work_conditions: 'ALL', device: 'ALL', alexandria: 'ALL', activity: 'ALL', information: 'ALL' });

  const selectClass = 'h-[var(--touch)] w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-0 text-sm font-bold text-[var(--text)] transition-colors hover:border-[var(--primary)] focus-visible:border-[var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 sm:w-auto sm:min-w-36';

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-sm font-black text-[var(--text)]">{t('ابحث وصَفِّ دليل الأعضاء', 'Find and filter members')}</h2>
          <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
            {t('ابحث بالاسم أو بيانات التواصل أو الرقم الأكاديمي أو المجموعة أو التخصص، ثم استخدم الفلاتر لتضييق النتائج.', 'Search by name, contact details, academic number, group, or specialization, then use filters to narrow results.')}
          </p>
        </div>
        {isActive && (
          <span className="inline-flex min-h-7 items-center rounded-full bg-[var(--primary-soft)] px-2.5 text-xs font-bold text-[var(--link)]" aria-label={t(`${number(activeFilterCount)} فلاتر نشطة`, `${number(activeFilterCount)} active filters`)}>
            {number(activeFilterCount)} {t('فلاتر نشطة', 'active filters')}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <span className="relative col-span-2 min-w-0 sm:min-w-48 sm:flex-1">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" />
            <input
              type="search"
              value={value.search}
              onChange={(event) => set('search', event.target.value)}
              placeholder={t('الاسم، الهاتف، الرقم الأكاديمي، المجموعة أو التخصص...', 'Name, phone, academic number, group, or specialization...')}
              className="h-[var(--touch)] w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] pe-3 ps-10 text-base font-semibold text-[var(--text)] placeholder:font-normal placeholder:text-[var(--text-muted)] transition-colors hover:border-[var(--primary)] focus-visible:border-[var(--primary)] focus-visible:bg-[var(--surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2 sm:text-sm"
              aria-label={t('البحث عن الأعضاء', 'Search members')}
              aria-describedby="members-search-help"
            />
          </span>
          <span id="members-search-help" className="sr-only">
            {t('يشمل البحث الاسم والبريد والهاتف والإقامة والنبذة والرقم الأكاديمي والمجموعة والتخصص والحقول المخصصة.', 'Search includes name, email, phone, residence, bio, academic number, group, specialization, and custom fields.')}
          </span>
          <select value={value.work_conditions} onChange={(event) => set('work_conditions', event.target.value)} className={`${selectClass} col-span-2 sm:col-span-1`} aria-label={t('ظروف العمل', 'Work conditions')}>
            <option value="ALL">{t('كل ظروف العمل', 'All work conditions')}</option>
            {workConditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          </select>
          <select value={value.device} onChange={(event) => set('device', event.target.value)} className={selectClass} aria-label={t('الجهاز', 'Device')}>
            <option value="ALL">{t('كل الأجهزة', 'All devices')}</option>
            <option value="لابتوب">{t('لابتوب', 'Laptop')}</option>
            <option value="كمبيوتر">{t('كمبيوتر مكتبي (PC)', 'Desktop PC')}</option>
            <option value="هاتف">{t('هاتف محمول', 'Mobile phone')}</option>
            <option value="بدون">{t('بدون جهاز', 'No device')}</option>
          </select>
          <select value={value.alexandria} onChange={(event) => set('alexandria', event.target.value)} className={selectClass} aria-label={t('النزول الميداني', 'Field work')}>
            <option value="ALL">{t('الميدان: الكل', 'Field work: all')}</option>
            <option value="YES">{t('جاهز للنزول', 'Available for field work')}</option>
            <option value="NO">{t('مش متاح للنزول', 'Unavailable for field work')}</option>
          </select>
          <select value={value.activity} onChange={(event) => set('activity', event.target.value as MemberActivityFilter)} className={`${selectClass} col-span-2 sm:col-span-1`} aria-label={t('حالة نشاط العضو', 'Member activity status')}>
            <option value="ALL">{t('كل حالات النشاط', 'All activity statuses')}</option>
            <option value="ACTIVE">{t('نشط', 'Active')}</option>
            <option value="INACTIVE">{t('غير نشط', 'Inactive')}</option>
          </select>
          <select value={value.information} onChange={(event) => set('information', event.target.value as MemberInformationFilter)} className={`${selectClass} col-span-2 sm:col-span-1`} aria-label={t('اكتمال البيانات المطلوبة', 'Required information completion')}>
            <option value="ALL">{t('كل حالات البيانات', 'All information statuses')}</option>
            <option value="MISSING">{t('يلزم استكمال البيانات', 'Needs information')}</option>
            <option value="COMPLETE">{t('البيانات مكتملة', 'Information complete')}</option>
          </select>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] pt-3 md:border-t-0 md:border-s md:ps-4 md:pt-0">
          <p className="text-sm font-bold text-[var(--text-muted)]" role="status" aria-live="polite" aria-atomic="true">
            {isActive ? <>{t('النتائج:', 'Results:')} <span className="font-black tabular-nums text-[var(--link)]">{number(resultCount)}</span> {t('من', 'of')} {number(totalCount)}</> : <>{t('الإجمالي:', 'Total:')} <span className="font-black tabular-nums text-[var(--link)]">{number(totalCount)}</span></>}
          </p>
          {isActive && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-[var(--touch)] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-sm font-bold text-[var(--primary-ink)] transition-colors hover:bg-[var(--primary-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
            >
              <RotateCcw size={16} aria-hidden="true" />
              {t('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
