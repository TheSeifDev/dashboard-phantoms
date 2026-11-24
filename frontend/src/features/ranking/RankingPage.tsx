import { useMemo, useState } from 'react';
import { Trophy, Search, Plus, Users, Award, Coins, RotateCcw } from 'lucide-react';
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
import './ranking.css';
export default function RankingPage() {
  const { t, dir, number } = useLocale();
  const { members, notes, rankedAllMembers, topThree, isLoading, isError, refetch } = useRanking();
  const customFieldsQuery = useMemberCustomFields();
  const user = useAuthStore((state) => state.user);
  const adminAccess = useAdminAccess(user?.id ?? null);
  const canRecordRatings = adminAccess.data?.owner_authority === true || adminAccess.data?.permissions?.ranking === true;
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

  const summary = useMemo(() => {
    const totalPoints = rankedAllMembers.reduce((sum, m) => sum + (m.bonus_infinite === true ? 0 : m.totalBonus), 0);
    const withBonus = rankedAllMembers.filter((m) => m.bonus_infinite === true || m.totalBonus !== 0).length;
    const infinite = rankedAllMembers.filter((m) => m.bonus_infinite === true).length;
    const average = rankedAllMembers.length ? Math.round(totalPoints / rankedAllMembers.length) : 0;
    return { totalPoints, withBonus, infinite, average };
  }, [rankedAllMembers]);

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
    return (
      <div className="rank-page" dir={dir} aria-busy="true">
        <h1 className="rank-title">{t('ترتيب الفريق', 'Team ranking')}</h1>
        <CardSkeletons count={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rank-page" dir={dir}>
        <h1 className="rank-title">{t('ترتيب الفريق', 'Team ranking')}</h1>
        <ErrorState message={t('معرفناش نحمّل بيانات الترتيب والتقييم.', 'Could not load ranking and evaluation data.')} onRetry={() => { void refetch(); }} />
      </div>
    );
  }

  return (
    <div className="rank-page" dir={dir}>
      <header className="rank-topbar">
        <div className="rank-brand">
          <span className="rank-brand-orb" aria-hidden="true"><Trophy size={21} /></span>
          <div className="rank-brand-copy">
            <p className="rank-eyebrow">PHANTOMS</p>
            <h1 className="rank-title">{t('ترتيب الفريق', 'Team ranking')}</h1>
          </div>
        </div>

        <nav className="rank-tabs" aria-label={t('أقسام لوحة الترتيب', 'Ranking sections')}>
          <a className="rank-tab" href="#rank-podium"><Award size={14} aria-hidden="true" />{t('المتصدرون', 'Top')}</a>
          <a className="rank-tab" href="#rank-board"><Users size={14} aria-hidden="true" />{t('الترتيب الكامل', 'Leaderboard')}</a>
        </nav>

        <div className="rank-topbar-side">
          <span className="rank-points-chip">
            <Coins size={14} aria-hidden="true" />
            {number(summary.totalPoints)}
            <small>{t('نقطة', 'points')}</small>
          </span>
          <Button onClick={() => handleOpenAdjust()} icon={<Plus size={16} />} fullOnMobile>
            {canRecordRatings ? t('تقييم جديد', 'New award') : t('إدارة بونص ∞', 'Manage ∞ bonus')}
          </Button>
        </div>
      </header>

      <section id="rank-podium" className="rank-section grid gap-3" aria-labelledby="ranking-podium-heading">
        <div className="rank-head">
          <div className="rank-head-copy">
            <h2 id="ranking-podium-heading" className="rank-head-title">
              <Award size={17} aria-hidden="true" />
              {t('منصة المتصدرين', 'Top performers')}
            </h2>
            <p className="rank-head-note">{t('المراكز الثلاثة الأولى على مستوى الفريق بالكامل، قبل تطبيق فلاتر الجدول.', 'The team-wide top three, before the table filters are applied.')}</p>
          </div>
          <span className="rank-head-count">{t('إجمالي الأعضاء', 'Members')} <b>{number(members.length)}</b></span>
        </div>

        <RankingPodium
          topMembers={topThree}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
        />

        <p className="rank-summary">
          <Coins size={13} aria-hidden="true" />
          {t('إجمالي النقاط الممنوحة', 'Total points awarded')} <b>{number(summary.totalPoints)}</b>
          <span className="rank-dot" aria-hidden="true">·</span>
          <b>{number(summary.withBonus)}</b> {t('عضو لديه بونص', 'members with bonus')}
          <span className="rank-dot" aria-hidden="true">·</span>
          {t('المتوسط', 'Average')} <b>{number(summary.average)}</b> {t('نقطة للعضو', 'points / member')}
          {summary.infinite > 0 && (
            <>
              <span className="rank-dot" aria-hidden="true">·</span>
              <b>{number(summary.infinite)}</b> {t('بونص غير محدود', 'unlimited bonus')}
            </>
          )}
        </p>
      </section>

      <section className="rank-toolbar" aria-labelledby="ranking-filters-heading">
        <div className="rank-toolbar-row">
          <label className="rank-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{t('ابحث بالاسم أو البريد الإلكتروني', 'Search by name or email')}</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('ابحث بالاسم أو البريد الإلكتروني…', 'Search by name or email…')}
              aria-label={t('البحث في جدول الترتيب', 'Search ranking table')}
            />
          </label>
          <div className="rank-segment" role="group" aria-labelledby="ranking-filters-heading">
            <button type="button" aria-pressed={!onlyWithBonus} onClick={() => setOnlyWithBonus(false)}>
              {t('كل الأعضاء', 'All members')} <em>{number(rankedAllMembers.length)}</em>
            </button>
            <button type="button" aria-pressed={onlyWithBonus} onClick={() => setOnlyWithBonus(true)}>
              {t('لديهم بونص', 'With bonus')} <em>{number(summary.withBonus)}</em>
            </button>
          </div>
        </div>
        <div className="rank-toolbar-foot">
          <h3 id="ranking-filters-heading" className="rank-count">
            {t('يعرض', 'Showing')} <b>{number(filteredMembers.length)}</b> {t('من', 'of')} <b>{number(rankedAllMembers.length)}</b> {t('عضو', 'members')}
            <span className="sr-only"> — {t('الفلاتر لا تغيّر ترتيب الأعضاء أو نقاطهم.', 'Filters do not change member order or scores.')}</span>
          </h3>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="rank-reset">
              <RotateCcw size={13} aria-hidden="true" />
              {t('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
        </div>
      </section>

      <section id="rank-board" className="rank-section grid gap-3" aria-labelledby="ranking-table-heading">
        <div className="rank-head">
          <div className="rank-head-copy">
            <h2 id="ranking-table-heading" className="rank-head-title">
              <Users size={17} aria-hidden="true" />
              {t('الترتيب الكامل', 'Full leaderboard')}
            </h2>
            <p className="rank-head-note">{t('الأرقام المعروضة هي المراكز الأصلية؛ البحث لا يعيد ترتيب النتائج.', 'Displayed places are the original ranks; searching does not renumber results.')}</p>
          </div>
        </div>
        <RankingTable
          members={filteredMembers}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
          hasFilters={filtersActive}
          onClearFilters={clearFilters}
        />
      </section>

      <p className="rank-rules">
        {t('قواعد الترتيب: الأولوية للبونص غير المحدود، ثم أعلى رصيد نقاط. عند التعادل يُقدَّم ترتيب الإنجاز، ثم الأحدث انضماماً إذا لم تتوفر رتبة إنجاز.', 'Ranking rules: unlimited bonus first, then the highest point balance. Ties use completion rank, then the most recent join date when no completion rank exists.')}
      </p>

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
