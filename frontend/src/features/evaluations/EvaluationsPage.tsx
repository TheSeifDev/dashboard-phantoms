import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Eye,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMembers } from '../members/api';
import {
  EVALUATION_GRADE_LABELS,
  STRIKE_LIMIT,
  useAdminEvaluations,
  useDeleteEvaluation,
  useExpelMember,
  useMemberStrikes,
} from './api';
import type { EvaluationGrade, MemberEvaluation } from './api';
import type { Member } from '../../types/db';
import { useAdminAccess } from '../admin/access/api';
import { useAuthStore } from '../../store/auth';
import { EvaluationCreateModal } from './EvaluationCreateModal';
import { EvalStars } from './StarRating';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import { MemberAvatar } from '../../components/ui/MemberAvatar';
import './evaluations.css';

type ReadStatusFilter = 'ALL' | 'READ' | 'UNREAD';

export function getGradeBadgeVariant(
  grade: EvaluationGrade,
): 'success' | 'info' | 'neutral' | 'warning' | 'danger' {
  switch (grade) {
    case 'excellent':
      return 'success';
    case 'very_good':
      return 'info';
    case 'good':
      return 'neutral';
    case 'needs_improvement':
      return 'warning';
    case 'warning':
      return 'danger';
  }
}

function getGradeLabel(grade: EvaluationGrade, t: (ar: string, en: string) => string) {
  const english: Record<EvaluationGrade, string> = {
    excellent: 'Excellent',
    very_good: 'Very good',
    good: 'Good',
    needs_improvement: 'Needs improvement',
    warning: 'Notice',
  };
  return t(EVALUATION_GRADE_LABELS[grade], english[grade]);
}

export default function EvaluationsPage() {
  const { t, number, date, dir } = useLocale();
  const evaluationsQuery = useAdminEvaluations();
  const membersQuery = useMembers();
  const deleteEval = useDeleteEvaluation();
  const strikesQuery = useMemberStrikes();
  const expelMember = useExpelMember();
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const access = useAdminAccess(ownerId);
  const isOwner = Boolean(ownerId) && access.data?.owner_authority === true;

  const [createOpen, setCreateOpen] = useState(false);
  const [preselectedMemberId, setPreselectedMemberId] = useState<number | null>(null);
  const [evalToDelete, setEvalToDelete] = useState<MemberEvaluation | null>(null);
  const [memberToExpel, setMemberToExpel] = useState<Member | null>(null);
  const [search, setSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<string>('ALL');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [readFilter, setReadFilter] = useState<ReadStatusFilter>('ALL');

  const members = membersQuery.data ?? [];
  const evaluations = evaluationsQuery.data ?? [];
  const strikes = strikesQuery.data ?? [];

  /** عدد التحذيرات لكل عضو — الحد ٣، والتالت معناه طرد. */
  const strikesByMember = useMemo(() => {
    const map: Record<number, number> = {};
    for (const strike of strikes) map[strike.member_id] = (map[strike.member_id] ?? 0) + 1;
    return map;
  }, [strikes]);

  /** الأعضاء اللي عليهم تحذيرات، مرتبين بالأقرب للحد. */
  const strikeWatch = useMemo(() => {
    return members
      .filter((member) => (strikesByMember[member.id] ?? 0) > 0)
      .map((member) => ({ member, strikes: strikesByMember[member.id] ?? 0 }))
      .sort((a, b) => b.strikes - a.strikes);
  }, [members, strikesByMember]);

  const memberNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const member of members) map[member.id] = member.full_name;
    return map;
  }, [members]);
  /** Member rows keyed by id so cards can show the linked GitHub picture. */
  const memberById = useMemo(() => {
    const map: Record<number, Member> = {};
    for (const member of members) map[member.id] = member;
    return map;
  }, [members]);

  /** رصيد النجوم المتراكم لكل عضو عبر كل التقييمات. */
  const starsByMember = useMemo(() => {
    const map: Record<number, { stars: number; count: number }> = {};
    for (const evaluation of evaluations) {
      const entry = map[evaluation.member_id] ?? { stars: 0, count: 0 };
      // الرصيد = مجموع كل الحركات (نجوم ممنوحة − نجوم مخصومة).
      entry.stars += evaluation.points;
      entry.count += 1;
      map[evaluation.member_id] = entry;
    }
    return map;
  }, [evaluations]);

  const stats = useMemo(() => {
    const total = evaluations.length;
    const readOrViewed = evaluations.filter((evaluation) => Boolean(evaluation.read_at || evaluation.viewed_at)).length;
    const starsAwarded = evaluations.reduce((sum, evaluation) => sum + Math.max(0, evaluation.points), 0);
    const deducted = evaluations.reduce((sum, evaluation) => sum + Math.min(0, evaluation.points), 0);
    const scored = evaluations.filter((evaluation) => evaluation.points > 0);
    const averageStars = scored.length
      ? scored.reduce((sum, evaluation) => sum + Math.min(5, evaluation.points), 0) / scored.length
      : 0;
    const topMember = Object.entries(starsByMember)
      .sort((a, b) => b[1].stars - a[1].stars)
      .find(([, entry]) => entry.stars > 0);
    return {
      total,
      readOrViewed,
      unread: total - readOrViewed,
      starsAwarded,
      deducted,
      averageStars,
      topMemberId: topMember ? Number(topMember[0]) : null,
      topMemberStars: topMember ? topMember[1].stars : 0,
      strikes: strikes.length,
      membersAtLimit: Object.values(strikesByMember).filter((count) => count >= STRIKE_LIMIT).length,
    };
  }, [evaluations, starsByMember, strikes, strikesByMember]);

  const readCounts = useMemo(() => {
    let read = 0;
    for (const evaluation of evaluations) {
      if (evaluation.read_at || evaluation.viewed_at) read += 1;
    }
    return { read, unread: evaluations.length - read };
  }, [evaluations]);

  const filteredEvaluations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return evaluations.filter((evaluation) => {
      const memberName = (memberNameMap[evaluation.member_id] ?? t(`عضو #${evaluation.member_id}`, `Member #${evaluation.member_id}`)).toLowerCase();
      const matchSearch =
        !query ||
        memberName.includes(query) ||
        evaluation.title.toLowerCase().includes(query) ||
        evaluation.feedback.toLowerCase().includes(query);
      const matchMember = memberFilter === 'ALL' || String(evaluation.member_id) === memberFilter;
      const matchGrade = gradeFilter === 'ALL' || evaluation.grade === gradeFilter;
      const isRead = Boolean(evaluation.read_at || evaluation.viewed_at);
      const matchRead =
        readFilter === 'ALL' ||
        (readFilter === 'READ' && isRead) ||
        (readFilter === 'UNREAD' && !isRead);
      return matchSearch && matchMember && matchGrade && matchRead;
    });
  }, [evaluations, memberNameMap, search, memberFilter, gradeFilter, readFilter, t]);

  const hasFilters = search.trim() !== '' || memberFilter !== 'ALL' || gradeFilter !== 'ALL' || readFilter !== 'ALL';

  const handleOpenCreate = (memberId?: number) => {
    setPreselectedMemberId(memberId ?? null);
    setCreateOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setMemberFilter('ALL');
    setGradeFilter('ALL');
    setReadFilter('ALL');
  };

  const handleConfirmDelete = async () => {
    if (!evalToDelete) return;
    try {
      await deleteEval.mutateAsync(evalToDelete);
      toast.success(t('تم حذف التقييم بنجاح.', 'Evaluation deleted successfully.'));
      setEvalToDelete(null);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return date(iso, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  const handleConfirmExpel = async () => {
    if (!memberToExpel) return;
    try {
      await expelMember.mutateAsync({
        memberId: memberToExpel.id,
        reason: t('الوصول للحد الأقصى من التحذيرات (٣ تحذيرات).', 'Reached the maximum number of strikes (3).'),
      });
      toast.success(
        t(
          `تم طرد ${memberToExpel.full_name} من الفريق بالكامل وإلغاء وصوله للبوابة.`,
          `${memberToExpel.full_name} was expelled from the team and their portal access was revoked.`,
        ),
      );
      setMemberToExpel(null);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message);
    }
  };

  if (evaluationsQuery.isLoading || membersQuery.isLoading) {
    return (
      <section className="eval-page" dir={dir} aria-busy="true" aria-label={t('تحميل سجل التقييمات', 'Loading evaluations')}>
        <h1 className="eval-title">{t('تقييمات الأعضاء', 'Member evaluations')}</h1>
        <p className="sr-only" role="status" aria-live="polite">{t('جارٍ تحميل سجل التقييمات وقائمة الأعضاء…', 'Loading evaluations and members…')}</p>
        <CardSkeletons count={4} />
      </section>
    );
  }

  if (evaluationsQuery.isError || membersQuery.isError) {
    const evaluationsFailed = evaluationsQuery.isError;
    return (
      <section className="eval-page" dir={dir}>
        <div className="eval-hero">
          <div className="eval-hero-main">
            <h1 className="eval-title">{t('تقييمات الأعضاء', 'Member evaluations')}</h1>
            <p className="eval-subtitle">{t('تعذّر تجهيز سجل التقييمات. أعد تحميل البيانات للمتابعة.', 'We could not prepare the evaluations view. Reload the data to continue.')}</p>
          </div>
        </div>
        <ErrorState
          message={evaluationsFailed
            ? t('معرفناش نحمّل سجل التقييمات.', 'Could not load the evaluation history.')
            : t('تعذر تحميل قائمة الأعضاء اللازمة لعرض وإضافة التقييمات.', 'Could not load the member list needed to view and create evaluations.')}
          onRetry={() => {
            if (evaluationsFailed) void evaluationsQuery.refetch();
            if (membersQuery.isError) void membersQuery.refetch();
          }}
        />
      </section>
    );
  }

  const averageDisplay = stats.averageStars ? number(stats.averageStars, { maximumFractionDigits: 1 }) : number(0);
  const topMemberName = stats.topMemberId ? memberNameMap[stats.topMemberId] ?? '' : '';

  return (
    <section className="eval-page" dir={dir}>
      <header className="eval-hero">
        <div className="eval-hero-main">
          <p className="eval-eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            {t('الأداء والتقدير', 'Performance & recognition')}
          </p>
          <h1 className="eval-title">{t('تقييمات الأعضاء', 'Member evaluations')}</h1>
          <p className="eval-subtitle">
            {t('امنح كل عضو تقييماً ونجوماً ذهبية من ١ إلى ٥، وتُجمع النجوم في رصيده مع كل تقييم جديد وتظهر له في بوابته.', 'Award each member an evaluation with 1–5 golden stars. Stars stack in their balance with every new review and appear in their portal.')}
          </p>
          <div className="eval-hero-meta">
            <span className="eval-meta-chip eval-meta-chip--star">
              <Star size={12} aria-hidden="true" />
              {t(`${number(stats.starsAwarded)} نجمة ممنوحة`, `${number(stats.starsAwarded)} stars awarded`)}
            </span>
            <span className="eval-meta-chip">
              <Users size={12} aria-hidden="true" />
              {t(`${number(members.length)} عضو في الفريق`, `${number(members.length)} team members`)}
            </span>
            <span className="eval-meta-chip">
              <Clock size={12} aria-hidden="true" />
              {t(`${number(stats.unread)} بانتظار الاطلاع`, `${number(stats.unread)} awaiting review`)}
            </span>
            {topMemberName && (
              <span className="eval-meta-chip">
                <Star size={12} aria-hidden="true" />
                {t(`الأعلى جمعاً: ${topMemberName}`, `Top collector: ${topMemberName}`)}
              </span>
            )}
          </div>
        </div>
        <div className="eval-hero-actions">
          <Button onClick={() => handleOpenCreate()} icon={<Plus size={17} aria-hidden="true" />} fullOnMobile>
            {t('تقييم جديد', 'New evaluation')}
          </Button>
        </div>
      </header>

      <div className="eval-stats" role="list" aria-label={t('ملخص التقييمات والنجوم', 'Evaluations and stars summary')}>
        <div className="eval-stat" role="listitem">
          <div className="eval-stat-top">
            <span className="eval-stat-label">{t('إجمالي التقييمات', 'Total evaluations')}</span>
            <span className="eval-stat-icon" aria-hidden="true"><Sparkles size={14} /></span>
          </div>
          <div className="eval-stat-figure">
            <span className="eval-stat-value">{number(stats.total)}</span>
            <span className="eval-stat-unit">{t('تقييم', 'reviews')}</span>
          </div>
          <span className="eval-stat-note">
            {t('نجوم متراكمة عبر الفريق', 'Stars stack across the team')}
          </span>
          <span className="eval-stat-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, stats.total ? (stats.readOrViewed / stats.total) * 100 : 0)}%` }} /></span>
        </div>

        <div className="eval-stat eval-stat--star" role="listitem">
          <div className="eval-stat-top">
            <span className="eval-stat-label">{t('النجوم الذهبية الممنوحة', 'Golden stars awarded')}</span>
            <span className="eval-stat-icon" aria-hidden="true"><Star size={14} /></span>
          </div>
          <div className="eval-stat-figure">
            <span className="eval-stat-value">{number(stats.starsAwarded)}</span>
            <span className="eval-stat-unit">{t('نجمة', 'stars')}</span>
          </div>
          <span className="eval-stat-note">
            {stats.deducted < 0
              ? t(`و${number(Math.abs(stats.deducted))} نقطة خصم`, `${number(Math.abs(stats.deducted))} deducted`)
              : t('كل نجمة = نقطة بونص', 'One star = one bonus point')}
          </span>
          <span className="eval-stat-meter" aria-hidden="true"><span style={{ width: stats.starsAwarded ? '100%' : '0%' }} /></span>
        </div>

        <div className="eval-stat eval-stat--violet" role="listitem">
          <div className="eval-stat-top">
            <span className="eval-stat-label">{t('متوسط النجوم للتقييم', 'Average stars per review')}</span>
            <span className="eval-stat-icon" aria-hidden="true"><Star size={14} /></span>
          </div>
          <div className="eval-stat-figure">
            <span className="eval-stat-value">{averageDisplay}</span>
            <span className="eval-stat-unit">{t('من ٥', 'of 5')}</span>
          </div>
          <span className="eval-stat-note">
            <EvalStars value={Math.round(stats.averageStars)} size="sm" />
          </span>
          <span className="eval-stat-meter" aria-hidden="true"><span style={{ width: `${(stats.averageStars / 5) * 100}%` }} /></span>
        </div>

        <div className="eval-stat eval-stat--amber" role="listitem">
          <div className="eval-stat-top">
            <span className="eval-stat-label">{t('بانتظار اطلاع العضو', 'Awaiting member review')}</span>
            <span className="eval-stat-icon" aria-hidden="true"><Clock size={14} /></span>
          </div>
          <div className="eval-stat-figure">
            <span className="eval-stat-value">{number(stats.unread)}</span>
            <span className="eval-stat-unit">{t('تقييم', 'reviews')}</span>
          </div>
          <span className="eval-stat-note">
            {t(`${number(stats.readOrViewed)} اطّلع عليها العضو`, `${number(stats.readOrViewed)} viewed by members`)}
          </span>
          <span className="eval-stat-meter" aria-hidden="true"><span style={{ width: `${stats.total ? (stats.unread / stats.total) * 100 : 0}%` }} /></span>
        </div>

        <div className="eval-stat eval-stat--strike" role="listitem">
          <div className="eval-stat-top">
            <span className="eval-stat-label">{t('التحذيرات المسجّلة', 'Recorded strikes')}</span>
            <span className="eval-stat-icon" aria-hidden="true"><AlertTriangle size={14} /></span>
          </div>
          <div className="eval-stat-figure">
            <span className="eval-stat-value">{number(stats.strikes)}</span>
            <span className="eval-stat-unit">{t('تحذير', 'strikes')}</span>
          </div>
          <span className="eval-stat-note">
            {stats.membersAtLimit > 0
              ? t(`${number(stats.membersAtLimit)} عضو وصل الحد — لازم طرد`, `${number(stats.membersAtLimit)} member(s) at the limit — expel`)
              : t(`الحد ${number(STRIKE_LIMIT)} تحذيرات لكل عضو`, `Limit ${number(STRIKE_LIMIT)} strikes per member`)}
          </span>
          <span className="eval-stat-meter" aria-hidden="true"><span style={{ width: `${strikeWatch.length ? Math.min(100, (stats.membersAtLimit / Math.max(1, strikeWatch.length)) * 100) : 0}%` }} /></span>
        </div>
      </div>

      {strikeWatch.length > 0 && (
        <section className="eval-strikes" aria-labelledby="eval-strikes-heading">
          <div className="eval-strikes-head">
            <h2 className="eval-strikes-title" id="eval-strikes-heading">
              <ShieldAlert size={16} aria-hidden="true" />
              {t('سجل التحذيرات', 'Strike watch')}
            </h2>
            <p className="eval-strikes-note">
              {t(
                `كل عضو عنده ${number(STRIKE_LIMIT)} تحذيرات بس. التحذير التالت معناه إن المالك يطرده من الفريق نهائياً.`,
                `Every member gets ${number(STRIKE_LIMIT)} strikes only. The third one means the owner expels them from the team.`,
              )}
            </p>
          </div>
          <ul className="eval-strikes-list">
            {strikeWatch.map(({ member, strikes: count }) => {
              const atLimit = count >= STRIKE_LIMIT;
              return (
                <li key={member.id} className={`eval-strikes-row ${atLimit ? 'eval-strikes-row--limit' : ''}`}>
                  <MemberAvatar member={member} name={member.full_name} className="eval-strikes-avatar" fallback="ع" />
                  <span className="eval-strikes-name">{member.full_name}</span>
                  <span
                    className="eval-strike-dots"
                    role="img"
                    aria-label={t(`${count} من ${STRIKE_LIMIT} تحذيرات`, `${count} of ${STRIKE_LIMIT} strikes`)}
                  >
                    {Array.from({ length: STRIKE_LIMIT }, (_, index) => (
                      <i
                        key={index}
                        className={`eval-strike-dot ${index < count ? 'eval-strike-dot--on' : ''}`}
                        aria-hidden="true"
                      />
                    ))}
                  </span>
                  <span className="eval-strikes-count">
                    {atLimit
                      ? t('وصل الحد الأقصى', 'At the limit')
                      : t(`فاضل ${number(STRIKE_LIMIT - count)}`, `${number(STRIKE_LIMIT - count)} left`)}
                  </span>
                  {isOwner ? (
                    <button
                      type="button"
                      className="eval-strikes-expel"
                      onClick={() => setMemberToExpel(member)}
                      disabled={expelMember.isPending}
                    >
                      <ShieldAlert size={13} aria-hidden="true" />
                      {t('طرد من الفريق', 'Expel from team')}
                    </button>
                  ) : (
                    <span className="eval-strikes-owner-only">
                      {t('الطرد للمالك فقط', 'Expulsion is owner-only')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="eval-toolbar" aria-label={t('البحث والتصفية', 'Search and filters')}>
        <div className="eval-toolbar-row">
          <label className="eval-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{t('ابحث باسم العضو أو عنوان التقييم أو تفاصيله', 'Search member, evaluation title, or feedback')}</span>
            <input
              type="search"
              placeholder={t('ابحث بالاسم أو عنوان التقييم…', 'Search by member or evaluation title…')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="eval-segment" role="group" aria-label={t('حالة الاطلاع', 'Read status')}>
            {([
              { key: 'ALL', label: t('الكل', 'All'), count: evaluations.length },
              { key: 'UNREAD', label: t('بانتظار', 'Pending'), count: readCounts.unread },
              { key: 'READ', label: t('اطّلع', 'Viewed'), count: readCounts.read },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={readFilter === option.key}
                onClick={() => setReadFilter(option.key)}
              >
                {option.label}
                <em>{number(option.count)}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="eval-toolbar-row">
          <div className="eval-selects">
            <select className="eval-select" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} aria-label={t('تصفية حسب العضو', 'Filter by member')}>
              <option value="ALL">{t('كل الأعضاء', 'All members')} ({number(members.length)})</option>
              {members.map((member) => <option key={member.id} value={String(member.id)}>{member.full_name}</option>)}
            </select>
            <select className="eval-select" value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)} aria-label={t('تصفية حسب التقدير', 'Filter by grade')}>
              <option value="ALL">{t('كل التقديرات', 'All grades')}</option>
              {(Object.keys(EVALUATION_GRADE_LABELS) as EvaluationGrade[]).map((grade) => <option key={grade} value={grade}>{getGradeLabel(grade, t)}</option>)}
            </select>
            {hasFilters && (
              <button type="button" className="eval-reset" onClick={clearFilters}>
                <RotateCcw size={13} aria-hidden="true" />
                {t('مسح المرشحات', 'Clear filters')}
              </button>
            )}
          </div>
          <p className="eval-hint" role="status" aria-live="polite">
            {t(`${number(filteredEvaluations.length)} من ${number(evaluations.length)} تقييم`, `${number(filteredEvaluations.length)} of ${number(evaluations.length)} reviews`)}
          </p>
        </div>
      </section>

      {evaluations.length === 0 ? (
        <EmptyState
          title={t('لا توجد تقييمات حتى الآن', 'No evaluations yet')}
          description={t('ابدأ بإرسال أول تقييم لأحد أعضاء الفريق مع نجومه الذهبية، وسيظهر له في بوابته.', 'Create the first evaluation for a team member with their golden stars; it will appear in their portal.')}
          action={<Button onClick={() => handleOpenCreate()} icon={<Plus size={16} aria-hidden="true" />} fullOnMobile>{t('تقييم جديد', 'New evaluation')}</Button>}
        />
      ) : filteredEvaluations.length === 0 ? (
        <EmptyState
          title={t('لا توجد نتائج مطابقة', 'No matching evaluations')}
          description={t('جرّب تعديل البحث أو المرشحات لعرض تقييمات أخرى.', 'Try changing the search or filters to see other evaluations.')}
          action={<Button type="button" variant="secondary" onClick={clearFilters} fullOnMobile>{t('مسح البحث والمرشحات', 'Clear search and filters')}</Button>}
        />
      ) : (
        <div className="eval-list" aria-label={t('نتائج التقييمات', 'Evaluation results')}>
          <p className="sr-only" role="status">{t(`عدد النتائج: ${filteredEvaluations.length}`, `${filteredEvaluations.length} results`)}</p>
          {filteredEvaluations.map((evaluation) => {
            const memberName = memberNameMap[evaluation.member_id] ?? t(`عضو #${evaluation.member_id}`, `Member #${evaluation.member_id}`);
            const viewed = Boolean(evaluation.read_at || evaluation.viewed_at);
            const balance = starsByMember[evaluation.member_id]?.stars ?? 0;
            const stars = Math.max(0, evaluation.points);
            return (
              <article key={`${evaluation.mode}-${evaluation.id}`} className={`eval-card ${viewed ? '' : 'eval-card--unread'}`}>
                <MemberAvatar member={memberById[evaluation.member_id]} name={memberName} className="eval-avatar" fallback="ع" />
                <div className="eval-body">
                  <div className="eval-head">
                    <div className="eval-identity">
                      <h2 className="eval-name">
                        {memberName}
                        {evaluation.kind === 'strike' ? (
                          <span className="eval-grade eval-grade--strike">
                            <AlertTriangle size={11} aria-hidden="true" />
                            {t('تحذير', 'Warning')}
                          </span>
                        ) : (
                          <span className={`eval-grade eval-grade--${evaluation.grade}`}>{getGradeLabel(evaluation.grade, t)}</span>
                        )}
                      </h2>
                      <p className="eval-meta">
                        <span>{evaluation.title}</span>
                        <span className="eval-dot" aria-hidden="true">·</span>
                        <span>{t('بواسطة', 'By')} {evaluation.evaluator_name}</span>
                        <span className="eval-dot" aria-hidden="true">·</span>
                        <time dateTime={evaluation.created_at}>{formatDate(evaluation.created_at)}</time>
                      </p>
                    </div>
                    <div className="eval-score">
                      {evaluation.kind === 'strike' ? (
                        <span className="eval-star-pill eval-star-pill--strike">
                          <AlertTriangle size={11} aria-hidden="true" />
                          {t('تحذير رسمي', 'Official warning')}
                        </span>
                      ) : stars > 0 ? (
                        <>
                          <EvalStars value={stars} />
                          <span className="eval-star-pill">
                            <Star size={11} aria-hidden="true" />
                            {t(`+${number(stars)} نجمة`, `+${number(stars)} stars`)}
                          </span>
                        </>
                      ) : evaluation.points < 0 ? (
                        <span className="eval-star-pill eval-star-pill--minus">
                          <Minus size={11} aria-hidden="true" />
                          {t(`${number(evaluation.points)} نقطة خصم`, `${number(evaluation.points)} points`)}
                        </span>
                      ) : (
                        <span className="eval-star-pill eval-star-pill--muted">{t('بدون نجوم', 'No stars')}</span>
                      )}
                      {balance > 0 && (
                        <span className="eval-star-pill eval-star-pill--muted" title={t('رصيد النجوم المتراكم لهذا العضو', 'Accumulated star balance for this member')}>
                          {t(`الرصيد ${number(balance)}`, `Balance ${number(balance)}`)}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="eval-feedback">{evaluation.feedback}</p>

                  <div className="eval-foot">
                    <span className={`eval-read ${evaluation.read_at ? 'eval-read--read' : evaluation.viewed_at ? 'eval-read--viewed' : ''}`} role="status" aria-label={t('حالة اطلاع العضو', 'Member read status')}>
                      {evaluation.read_at ? (
                        <>
                          <CheckCheck size={14} aria-hidden="true" />
                          {t('أكّد العضو القراءة', 'Member confirmed')} · {formatDate(evaluation.read_at)}
                        </>
                      ) : evaluation.viewed_at ? (
                        <>
                          <Eye size={14} aria-hidden="true" />
                          {t('شاهد التقييم في البوابة', 'Viewed in portal')} · {formatDate(evaluation.viewed_at)}
                        </>
                      ) : (
                        <>
                          <Clock size={14} aria-hidden="true" />
                          {t('لم يفتح العضو التقييم بعد', 'Not viewed yet')}
                        </>
                      )}
                    </span>
                    <div className="eval-actions">
                      <button
                        type="button"
                        className="eval-action"
                        onClick={() => handleOpenCreate(evaluation.member_id)}
                        aria-label={t(`إضافة تقييم جديد للعضو ${memberName}`, `Add another evaluation for ${memberName}`)}
                      >
                        <UserPlus size={14} aria-hidden="true" />
                        <span>{t('تقييم جديد', 'New review')}</span>
                      </button>
                      <button
                        type="button"
                        className="eval-action eval-action--danger"
                        onClick={() => setEvalToDelete(evaluation)}
                        aria-label={t(`حذف تقييم ${evaluation.title} للعضو ${memberName}`, `Delete “${evaluation.title}” for ${memberName}`)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{t('حذف', 'Delete')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <EvaluationCreateModal
        isOpen={createOpen}
        members={members}
        preselectedMemberId={preselectedMemberId}
        starsByMember={starsByMember}
        strikesByMember={strikesByMember}
        onClose={() => setCreateOpen(false)}
      />

      <ConfirmDialog
        isOpen={Boolean(evalToDelete)}
        onClose={() => setEvalToDelete(null)}
        onConfirm={() => { void handleConfirmDelete(); }}
        title={t('تأكيد حذف التقييم', 'Confirm evaluation deletion')}
        itemName={evalToDelete?.title}
        description={t('سيتم حذف هذا التقييم من بوابة العضو، وإذا كان مرتبطاً بنجوم أو نقاط بونص فسيتم إلغاؤها أيضاً.', 'This evaluation will be removed from the member portal. Any linked stars or bonus points will also be reversed.')}
        confirmLabel={t('حذف التقييم', 'Delete evaluation')}
        isPending={deleteEval.isPending}
        pendingLabel={t('جارٍ الحذف…', 'Deleting…')}
      />

      <ConfirmDialog
        isOpen={Boolean(memberToExpel)}
        onClose={() => setMemberToExpel(null)}
        onConfirm={() => { void handleConfirmExpel(); }}
        title={t('تأكيد طرد العضو من الفريق', 'Confirm member expulsion')}
        itemName={memberToExpel?.full_name}
        description={t(
          'هيتم إيقاف العضو، وإزالته من كل الفرق، وإلغاء ربط الدخول والجلسات — مش هيقدر يدخل بوابة الأعضاء تاني. الخطوة دي مش سهلة الرجوع.',
          'The member will be deactivated, removed from every team, and their sign-in binding and sessions revoked — they will not be able to enter the member portal again. This is not easily reversible.',
        )}
        confirmLabel={t('طرد نهائي', 'Expel permanently')}
        isPending={expelMember.isPending}
        pendingLabel={t('جارٍ الطرد…', 'Expelling…')}
      />
    </section>
  );
}
