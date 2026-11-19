import { RotateCcw, Search } from 'lucide-react';

import { useLocale } from '../../i18n/useLocale';
export interface MemberFiltersValue { search: string; work_conditions: string; device: string; alexandria: string; }

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
  const set = (key: keyof MemberFiltersValue, next: string) => onChange({ ...value, [key]: next });
  const isActive =
    value.search.trim() !== '' || value.work_conditions !== 'ALL' || value.device !== 'ALL' || value.alexandria !== 'ALL';
  const clear = () => onChange({ search: '', work_conditions: 'ALL', device: 'ALL', alexandria: 'ALL' });

  const selectClass = 'h-[var(--touch)] w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-0 text-sm font-bold text-[var(--text)] transition-colors hover:border-[var(--primary)] focus-visible:border-[var(--primary)] outline-none sm:w-auto sm:min-w-36';

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <span className="relative col-span-2 min-w-0 sm:min-w-48 sm:flex-1">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" />
          <input
            type="search"
            value={value.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder={t("ابحث بالاسم أو التليفون أو الإيميل...", "Search by name, phone, or email...")}
            className="h-[var(--touch)] w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] pe-3 ps-10 text-base font-semibold text-[var(--text)] placeholder:font-normal placeholder:text-[var(--text-muted)] transition-colors hover:border-[var(--primary)] focus-visible:border-[var(--primary)] focus-visible:bg-[var(--surface)] outline-none sm:text-sm"
            aria-label={t("البحث عن الأعضاء", "Search members")}
          />
        </span>
        <select value={value.work_conditions} onChange={(event) => set('work_conditions', event.target.value)} className={`${selectClass} col-span-2 sm:col-span-1`} aria-label={t("حالة العمل", "Work status")}>
          <option value="ALL">{t("كل حالات العمل", "All work statuses")}</option>
          {workConditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
        </select>
        <select value={value.device} onChange={(event) => set('device', event.target.value)} className={selectClass} aria-label={t("الجهاز", "Device")}>
          <option value="ALL">{t("كل الأجهزة", "All devices")}</option>
          <option value="لابتوب">{t("لابتوب", "Laptop")}</option>
          <option value="كمبيوتر">{t("كمبيوتر مكتبي (PC)", "Desktop PC")}</option>
          <option value="هاتف">{t("هاتف محمول", "Mobile phone")}</option>
          <option value="بدون">{t("بدون جهاز", "No device")}</option>
        </select>
        <select value={value.alexandria} onChange={(event) => set('alexandria', event.target.value)} className={selectClass} aria-label={t("النزول الميداني", "Field work")}>
          <option value="ALL">{t("الميدان: الكل", "Field work: all")}</option>
          <option value="YES">{t("جاهز للنزول", "Available for field work")}</option>
          <option value="NO">{t("مش متاح للنزول", "Unavailable for field work")}</option>
        </select>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] pt-3 md:border-t-0 md:border-s md:ps-4 md:pt-0">
        <p className="text-sm font-bold text-[var(--text-muted)]" role="status" aria-live="polite">
          {isActive ? <>{t("النتائج:", "Results:")} <span className="font-black tabular-nums text-[var(--link)]">{number(resultCount)}</span> {t("من", "of")} {number(totalCount)}</> : <>{t("الإجمالي:", "Total:")} <span className="font-black tabular-nums text-[var(--link)]">{number(totalCount)}</span></>}
        </p>
        {isActive && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-[var(--touch)] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-sm font-bold text-[var(--primary-ink)] hover:bg-[var(--primary-soft)] transition-colors"
          >
            <RotateCcw size={16} aria-hidden="true" />
            {t("امسح الفلاتر", "Clear filters")}
          </button>
        )}
      </div>
    </div>
  );
}
