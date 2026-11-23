import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Crown, Search, Sparkles, Trophy, Users } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { useAuthStore } from '../../store/auth';
import { useMemberLeaderboard, type LeaderboardRow } from './useMemberLeaderboard';
import './member-ranking.css';

function motionAllowed() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return '?';
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toUpperCase();
}

function bonusLabel(row: { bonus: number; bonus_infinite: boolean }, number: (value: number) => string) {
  return row.bonus_infinite ? '∞' : number(row.bonus);
}

export default function MemberRankingPage() {
  const { t, number, dir } = useLocale();
  const member = useAuthStore((state) => state.currentMember);
  const leaderboard = useMemberLeaderboard(member?.id ?? null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = leaderboard.data?.rows ?? [];
  const me = leaderboard.data?.me ?? null;
  const podium = rows.slice(0, 3);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.full_name.toLowerCase().includes(needle) || row.teams.some((team) => team.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !motionAllowed() || rows.length === 0) return;
    const cards = root.querySelectorAll<HTMLElement>('[data-mr-card]');
    const bars = root.querySelectorAll<HTMLElement>('[data-mr-bar]');
    const steps = root.querySelectorAll<HTMLElement>('[data-mr-step]');
    const list = root.querySelectorAll<HTMLElement>('[data-mr-row]');
    const timeline = gsap.timeline();
    if (cards.length > 0) {
      timeline.fromTo(
        cards,
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'transform,opacity' },
      );
    }
    if (bars.length > 0) {
      timeline.fromTo(
        bars,
        { scaleY: 0.05 },
        { scaleY: 1, duration: 0.62, stagger: 0.08, ease: 'power3.out', transformOrigin: 'bottom center', clearProps: 'transform' },
        '-=0.2',
      );
    }
    if (steps.length > 0) {
      timeline.fromTo(
        steps,
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.07, ease: 'power2.out', clearProps: 'transform,opacity' },
        '-=0.45',
      );
    }
    if (list.length > 0) {
      timeline.fromTo(
        list,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.32, stagger: 0.018, ease: 'power1.out', clearProps: 'transform,opacity' },
        '-=0.3',
      );
    }
    return () => {
      timeline.kill();
    };
  }, [rows.length, leaderboard.data?.generated_at]);

  return (
    <div className="mr-page" dir={dir} ref={rootRef}>
      <PageHeader
        icon={<Trophy size={22} aria-hidden="true" />}
        title={t('ترتيب الفريق', 'Team ranking')}
        description={t(
          'نفس ترتيب لوحة الإدارة بالظبط — البونص محسوب من ملاحظات الأداء، والأولوية لحد عنده بونص غير محدود، وبعدها الأعلى نقاط، ولو التعادل بيتم بالـ completion rank.',
          'Exactly the same ranking the admin dashboard uses — bonus comes from performance notes, unlimited bonus first, then the highest points, with completion rank as the tie-breaker.',
        )}
      />

      {leaderboard.isPending && <CardSkeletons count={3} />}

      {leaderboard.isError && (
        <ErrorState
          message={t('معرفناش نحمّل ترتيب الفريق.', 'Could not load the team ranking.')}
          onRetry={() => {
            void leaderboard.refetch();
          }}
        />
      )}

      {leaderboard.data && rows.length === 0 && (
        <EmptyState
          title={t('مفيش أعضاء نشطين لسه', 'No active members yet')}
          description={t('أول ما يبدأ الفريق يتسجل، الترتيب هيظهر هنا.', 'As soon as the roster fills in, the ranking shows up here.')}
        />
      )}

      {leaderboard.data && rows.length > 0 && (
        <>
          <section className="mr-stats" aria-label={t('ملخص ترتيبك', 'Your ranking summary')}>
            <article className="mr-stat" data-mr-card>
              <span className="mr-stat-icon" aria-hidden="true"><Trophy size={16} /></span>
              <p className="mr-stat-label">{t('ترتيبك', 'Your rank')}</p>
              <p className="mr-stat-value">
                {me ? `#${number(me.rank)}` : '—'}
                <span className="mr-stat-sub">/ {number(leaderboard.data.roster_size)}</span>
              </p>
            </article>
            <article className="mr-stat" data-mr-card>
              <span className="mr-stat-icon" aria-hidden="true"><Sparkles size={16} /></span>
              <p className="mr-stat-label">{t('نقاطك', 'Your points')}</p>
              <p className="mr-stat-value">
                {me ? bonusLabel(me, number) : '—'}
                <span className="mr-stat-sub">{me?.bonus_infinite ? t('غير محدود', 'unlimited') : t('بونص', 'bonus')}</span>
              </p>
            </article>
            <article className="mr-stat" data-mr-card>
              <span className="mr-stat-icon" aria-hidden="true"><Users size={16} /></span>
              <p className="mr-stat-label">{t('أعضاء الترتيب', 'Members ranked')}</p>
              <p className="mr-stat-value">{number(leaderboard.data.roster_size)}</p>
            </article>
            <article className="mr-stat" data-mr-card>
              <span className="mr-stat-icon" aria-hidden="true"><Crown size={16} /></span>
              <p className="mr-stat-label">{t('تيمك', 'Your team')}</p>
              <p className="mr-stat-value mr-stat-value--team">{me && me.teams.length > 0 ? me.teams.join(' · ') : '—'}</p>
            </article>
          </section>

          <section className="mr-podium-card" aria-label={t('أول ثلاثة', 'Top three')}>
            <div className="mr-podium">
              {[1, 0, 2].map((index) => {
                const row = podium[index];
                if (!row) return null;
                return (
                  <div key={row.member_id} className={`mr-step mr-step--${row.rank}`} data-mr-step>
                    <div className="mr-step-body">
                      <span className="mr-step-avatar" aria-hidden="true">{initials(row.full_name)}</span>
                      <p className="mr-step-name" dir="auto">{row.full_name}</p>
                      <p className="mr-step-bonus">{bonusLabel(row, number)}</p>
                      {row.teams.length > 0 && <p className="mr-step-teams">{row.teams.join(' · ')}</p>}
                    </div>
                    <div className="mr-step-bar" data-mr-bar>
                      <span className="mr-step-rank">{number(row.rank)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mr-table-card" aria-label={t('كل الأعضاء', 'All members')}>
            <div className="mr-table-head">
              <div>
                <h2 className="mr-table-title">{t('كل الأعضاء', 'All members')}</h2>
                <p className="mr-table-note">{t('الترتيب بيتحدّث تلقائي مع أي ملاحظة أداء جديدة.', 'The ranking refreshes automatically with every new performance note.')}</p>
              </div>
              <div className="mr-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('ابحث بالاسم أو التيم…', 'Search by name or team…')}
                  aria-label={t('بحث في الترتيب', 'Search the ranking')}
                />
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title={t('مفيش نتائج للبحث ده', 'No matches for that search')}
                description={t('جرّب اسم تاني أو امسح كلمة البحث.', 'Try another name or clear the search.')}
              />
            ) : (
              <ol className="mr-list">
                {visible.map((row: LeaderboardRow) => (
                  <li key={row.member_id} className="mr-row" data-mr-row data-me={row.is_me ? 'true' : undefined}>
                    <span className={`mr-rank mr-rank--${row.rank <= 3 ? row.rank : 'rest'}`}>{number(row.rank)}</span>
                    <span className="mr-avatar" aria-hidden="true">{initials(row.full_name)}</span>
                    <span className="mr-identity">
                      <span className="mr-name">
                        <span className="mr-name-text" dir="auto" title={row.full_name}>{row.full_name}</span>
                        {row.is_me && <span className="mr-you">{t('أنت', 'You')}</span>}
                      </span>
                      {row.teams.length > 0 && (
                        <span className="mr-teams">
                          {row.teams.map((team) => (
                            <span key={team} className="mr-team">{team}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className={`mr-points${row.bonus_infinite ? ' mr-points--infinite' : ''}`}>
                      {bonusLabel(row, number)}
                      <span className="mr-points-unit">{row.bonus_infinite ? t('غير محدود', 'unlimited') : t('نقطة', 'pts')}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
