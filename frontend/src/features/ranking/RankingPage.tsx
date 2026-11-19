import { useMemo, useState } from 'react';
import { Trophy, Search, Filter, Plus, Users, Award } from 'lucide-react';
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
  const { t, dir } = useLocale();
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

  const handleOpenAdjust = (member?: Member) => {
    if (member) {
      setAdjustingMember(member);
    } else if (members.length > 0) {
      setAdjustingMember(members[0]);
    }
    setIsAdjustModalOpen(true);
  };

  if (isLoading) {
    return <div className="grid gap-5" dir={dir}><CardSkeletons count={3} /></div>;
  }

  if (isError) {
    return <div className="grid gap-5" dir={dir}><ErrorState message={t("معرفناش نحمّل بيانات الترتيب والتقييم.", "Could not load ranking and evaluation data.")} onRetry={() => { void refetch(); }} /></div>;
  }

  return (
    <div className="grid gap-6 text-start" dir={dir}>
      {/* Header */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 shadow-[var(--shadow-sm)]">
        <div className="flex items-start gap-3.5">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary-ink)]">
            <Trophy size={24} />
          </div>
          <div>
            <h2 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t("ترتيب الفريق", "Team ranking")}</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
              {t("البونص غير المحدود يتصدر، وبعده نقاط البونص المسجلة. دوس على أي عضو عشان تشوف ملفه الكامل.", "Unlimited bonuses rank first, followed by recorded bonus points. Select a member to view their profile.")}
            </p>
          </div>
        </div>
        <Button onClick={() => handleOpenAdjust()} icon={<Plus size={17} />} fullOnMobile className="min-h-11">
          {canRecordRatings ? t('سجّل تقييم جديد', 'Record evaluation') : t('إدارة بونص ∞', 'Manage unlimited bonus')}
        </Button>
      </section>

      {/* Top 3 Podium */}
      <section aria-label={t("منصة المتصدرين", "Top performers podium")}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-black text-sm text-[var(--text)] flex items-center gap-2">
            <Award size={18} className="text-amber-500" />
            المتصدرين
          </h3>
          <span className="text-xs text-[var(--text-muted)]">{t("من إجمالي", "of")} <b className="tabular-nums text-[var(--text)]">{members.length}</b> {t("عضو", "members")}</span>
        </div>
        <RankingPodium
          topMembers={topThree}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
        />
      </section>

      {/* Filters and Search */}
      <section className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)] sm:p-4" aria-label={t("فلترة جدول الترتيب", "Ranking filters")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("ابحث بالاسم أو البريد...", "Search by name or email...")}
              aria-label={t("البحث في جدول الترتيب", "Search ranking table")}
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] pe-3 ps-10 text-base placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-bold text-[var(--text)] has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-soft)]">
            <Filter size={16} className="shrink-0 text-[var(--link)]" aria-hidden="true" />
            <input
              type="checkbox"
              checked={onlyWithBonus}
              onChange={(e) => setOnlyWithBonus(e.target.checked)}
              className="size-[18px] shrink-0"
            />
            <span>{t("اللي عندهم بونص", "Members with bonuses")}</span>
          </label>
        </div>
      </section>

      {/* Ranking Table */}
      <section aria-label={t("جدول الترتيب الكامل", "Full ranking table")}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-black text-sm text-[var(--text)] flex items-center gap-2">
            <Users size={17} className="text-[var(--primary-ink)]" />
            الترتيب الكامل <span className="tabular-nums text-[var(--text-muted)]">({filteredMembers.length})</span>
          </h3>
        </div>
        <RankingTable
          members={filteredMembers}
          onSelectMember={(m) => setProfileMember(m)}
          onAdjustBonus={(m) => handleOpenAdjust(m)}
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
