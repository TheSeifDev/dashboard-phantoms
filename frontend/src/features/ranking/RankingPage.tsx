import { useMemo, useState } from 'react';
import { Trophy, Search, Filter, Plus, Users, Award, RotateCcw } from 'lucide-react';
import type { Member } from '../../types/db';
import { useRanking } from './useRanking';
import { RankingPodium } from './RankingPodium';
import { RankingTable } from './RankingTable';
import { BonusAdjustmentModal } from './BonusAdjustmentModal';
import { MemberProfileModal } from '../members/MemberProfileModal';
import { useMemberCustomFields } from '../members/customFieldsApi';
import { Button } from '../../components/ui/Button';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useAuthStore } from '../../store/auth';
import { useAdminAccess } from '../admin/access/api';

import { useLocale } from '../../i18n/useLocale';
export default function RankingPage() {
  const { t, dir, number } = useLocale();
  const { members, notes, rankedAllMembers, topThree, isLoading, isError, refetch } = useRanking();
  const customFieldsQuery = useMemberCustomFields();
  const user = useAuthStore((state) => state.user);
  const adminAccess = useAdminAccess(user?.id ?? null);
  const canRecordRatings = adminAccess.data?.is_owner === true || adminAccess.data?.permissions?.ranking === true;

  const [search, setSearch] = useState('');
  const [onlyWithBonus, setOnlyWithBonus] = useState(false);
  const [adjustingMember, setAdjustingMember] = useState<Member | null>(null);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<Member | null>(null);

  const filteredMembers = useMemo(() => {
    return rankedAllMembers.filter((m) => {
      const q = search.trim().toLowerCase();
      const matchSearch = !q || m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
      const matchBonus = !onlyWithBonus || m.bonus_infinite === true || m.totalBonus !== 0;
      return matchSearch && matchBonus;
    });
  }, [rankedAllMembers, search, onlyWithBonus]);

  const filtersActive = Boolean(search.trim()) || onlyWithBonus;
  const clearFilters = () => {
    setSearch('');
    setOnlyWithBonus(false);
  };

  const handleOpenAdjust = (member?: Member) => {
    if (member) {
      setAdjustingMember(member);
    } else if (members.length > 0) {
      setAdjustingMember(members[0]);
    }
    setIsAdjustModalOpen(true);
  };

  if (isLoading) {
    return <div className="grid gap-5" dir={dir} aria-busy="true"><h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t('ترتيب الفريق', 'Team ranking')}</h1><CardSkeletons count={3} /></div>;
  }

  if (isError) {
    return <div className="grid gap-5" dir={dir}><h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t('ترتيب الفريق', 'Team ranking')}</h1><ErrorState message={t('معرفناش نحمّل بيانات الترتيب والتقييم.', 'Could not load ranking and evaluation data.')} onRetry={() => { void refetch(); }} /></div>;
  }

  return (
    <div className="grid gap-6 text-start" dir={dir}>
      <header className="flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary-ink)] sm:size-14">
            <Trophy size={25} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--primary-ink)]">PHANTOMS</p>
            <h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t('ترتيب الفريق', 'Team ranking')}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
              {t('الأولوية للبونص غير المحدود، ثم أعلى رصيد نقاط. عند التعادل يُقدَّم ترتيب الإنجاز، ثم الأحدث انضمامًا إذا لم يتوفر.', 'Unlimited bonus ranks first, followed by the highest points balance. Ties use completion rank, then most recent join date when no completion rank is available.')}
            </p>
          </div>
        </div>
        <Button onClick={() => handleOpenAdjust()} icon={<Plus size={17} />} fullOnMobile className="min-h-11 shrink-0">
          {canRecordRatings ? t('سجّل تقييم جديد', 'Record evaluation') : t('إدارة بونص ∞', 'Manage unlimited bonus')}
        </Button>
      </header>

      <section aria-labelledby="ranking-podium-heading" className="grid gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="ranking-podium-heading" className="flex items-center gap-2 text-base font-black text-[var(--text)]">
              <Award size={19} className="text-amber-500" aria-hidden="true" />
              {t('منصة المتصدرين', 'Top performers')}
            </h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('تعرض المراكز الأولى على مستوى الفريق بالكامل، قبل تطبيق فلاتر الجدول.', 'Shows the team-wide leaders before the table filters are applied.')}</p>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {t('إجمالي الأعضاء:', 'Team members:')} <b className="tabular-nums text-[var(--text)]">{number(members.length)}</b>
          </span>
        </div>
        <RankingPodium
          topMembers={topThree}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
        />
      </section>

      <section className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5" aria-labelledby="ranking-filters-heading">
        <div>
          <h3 id="ranking-filters-heading" className="text-sm font-black text-[var(--text)]">{t('ابحث وفلتر الترتيب', 'Search and filter rankings')}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('تؤثر الفلاتر على القائمة أدناه فقط؛ لا تغيّر ترتيب الأعضاء أو نقاطهم.', 'Filters only narrow the list below; they do not change member order or scores.')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block">
            <span className="sr-only">{t('ابحث بالاسم أو البريد الإلكتروني', 'Search by name or email')}</span>
            <Search size={17} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('ابحث بالاسم أو البريد الإلكتروني...', 'Search by name or email...')}
              aria-label={t('البحث في جدول الترتيب', 'Search ranking table')}
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-3 ps-10 text-base placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] transition-colors has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-soft)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--link)]">
            <Filter size={16} className="shrink-0 text-[var(--link)]" aria-hidden="true" />
            <input
              type="checkbox"
              checked={onlyWithBonus}
              onChange={(e) => setOnlyWithBonus(e.target.checked)}
              className="size-[18px] shrink-0 accent-[var(--primary)]"
            />
            <span>{t('أعضاء لديهم بونص فقط', 'Members with bonuses only')}</span>
          </label>
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold text-[var(--text-muted)]" aria-live="polite" aria-atomic="true">
            {t('يعرض', 'Showing')} <b className="tabular-nums text-[var(--text)]">{number(filteredMembers.length)}</b> {t('من', 'of')} <b className="tabular-nums text-[var(--text)]">{number(rankedAllMembers.length)}</b> {t('عضو', 'members')}
          </p>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg px-2 text-sm font-bold text-[var(--primary-ink)] hover:bg-[var(--primary-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--link)]">
              <RotateCcw size={15} aria-hidden="true" />
              {t('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="ranking-table-heading" className="grid gap-3">
        <div>
          <h3 id="ranking-table-heading" className="flex items-center gap-2 text-base font-black text-[var(--text)]">
            <Users size={18} className="text-[var(--primary-ink)]" aria-hidden="true" />
            {t('الترتيب الكامل', 'Full ranking')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t('الأرقام المعروضة هي المراكز الأصلية؛ البحث لا يعيد ترتيب النتائج.', 'Displayed positions are the original ranks; searching does not renumber results.')}</p>
        </div>
        <RankingTable
          members={filteredMembers}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
          hasFilters={filtersActive}
          onClearFilters={clearFilters}
        />
      </section>

      <BonusAdjustmentModal
        isOpen={isAdjustModalOpen}
        member={adjustingMember}
        members={members}
        canRecordRatings={canRecordRatings}
        onClose={() => {
          setIsAdjustModalOpen(false);
          setAdjustingMember(null);
        }}
        onSuccess={() => void refetch()}
      />

      <MemberProfileModal
        isOpen={Boolean(profileMember)}
        member={profileMember}
        customFields={customFieldsQuery.data ?? []}
        notes={notes}
        onClose={() => setProfileMember(null)}
        onAdjustBonus={(m) => {
          setProfileMember(null);
          handleOpenAdjust(m);
        }}
      />
    </div>
  );
}
