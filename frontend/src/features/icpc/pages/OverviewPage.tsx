import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Flame,
  ListChecks,
  Radio,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Segmented } from '../../dashboard/Segmented';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useIcpcOverview, useSetProgress } from '../api';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { RatingChart } from '../components/RatingChart';
import { Bar, Chip, InlineEmpty, Kpi, Panel } from '../components/IcpcPanels';
import { DIFFICULTY_LABELS, PLATFORM_LABELS, type IcpcMode } from '../types';

const RANGES = [
  { value: '30', ar: '30 يوم', en: '30 days' },
  { value: '90', ar: '90 يوم', en: '90 days' },
  { value: '180', ar: '6 شهور', en: '6 months' },
  { value: '365', ar: 'سنة', en: '1 year' },
] as const;

export function OverviewPage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const [days, setDays] = useState(180);
  const [scope, setScope] = useState<string | null>(null);
  const overview = useIcpcOverview(mode, days, scope);
  const setProgress = useSetProgress(mode);

  const data = overview.data;
  const masteryTop = useMemo(() => (data?.mastery ?? []).slice(0, 10), [data]);

  if (overview.isLoading) return <CardSkeletons count={4} />;
  if (overview.isError || !data) {
    return <ErrorState message={(overview.error as Error | null)?.message ?? t('معرفناش نحمّل البيانات.', 'Could not load data.')} onRetry={() => void overview.refetch()} />;
  }

  const markSolved = async (assignmentId: number) => {
    try {
      await setProgress.mutateAsync({ assignmentId, status: 'solved' });
      toast.success(t('اتسجلت كمحلولة.', 'Marked as solved.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحدّث الحالة.', 'Could not update status.'));
    }
  };

  const maxTopic = Math.max(1, ...(data.topics_top ?? []).map((entry) => entry.count));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={String(days)}
          options={RANGES.map((range) => ({ value: range.value, label: t(range.ar, range.en) }))}
          onChange={(value) => setDays(Number(value))}
          label={t('المدى الزمني', 'Date range')}
        />
        {data.can_manage && (
          <Segmented
            value={scope ?? 'team'}
            options={[
              { value: 'team', label: t('الفريق', 'Team') },
              { value: 'me', label: t('أنا', 'Me') },
            ]}
            onChange={(value) => setScope(value === 'team' ? null : 'me')}
            label={t('نطاق البيانات', 'Data scope')}
          />
        )}
      </div>

      <div className="icpc-kpis">
        <Kpi label={t('أعضاء نشطين', 'Active members')} value={number(data.kpis.active_members)} icon={<Users size={14} aria-hidden="true" />} />
        <Kpi label={t('مسائل محلولة', 'Problems solved')} value={number(data.kpis.problems_solved)} icon={<CheckCircle2 size={14} aria-hidden="true" />} />
        <Kpi label={t('مسابقات', 'Contests')} value={number(data.kpis.contests)} icon={<Trophy size={14} aria-hidden="true" />} />
        <Kpi label={t('ساعات تدريب', 'Training hours')} value={number(data.kpis.training_hours)} icon={<Activity size={14} aria-hidden="true" />} />
        <Kpi label={t('ستريك حالي', 'Current streak')} value={t(`${number(data.kpis.streak)} يوم`, `${number(data.kpis.streak)}d`)} icon={<Flame size={14} aria-hidden="true" />} />
        <Kpi
          label={t('هدف الأسبوع', 'Weekly goal')}
          value={`${number(data.kpis.weekly_solved)}/${number(data.kpis.weekly_goal)}`}
          hint={t('مسائل محلولة آخر 7 أيام', 'solved in the last 7 days')}
          icon={<Target size={14} aria-hidden="true" />}
        />
      </div>

      <div className="icpc-grid icpc-grid--split">
        <Panel
          title={t('تمرين اليوم', 'Daily workout')}
          icon={<ListChecks size={15} aria-hidden="true" />}
          hint={date(data.workout.day)}
          flush
        >
          {data.workout.items.length === 0 ? (
            <InlineEmpty>{t('مفيش مسائل مستحقة النهاردة — اختار مسائل من بنك المسائل.', 'Nothing due today — pick problems from the bank.')}</InlineEmpty>
          ) : (
            <div className="icpc-list">
              {data.workout.items.slice(0, 8).map((item) => (
                <div key={item.assignment_id} className="icpc-row">
                  <div className="icpc-row-main">
                    <span className="icpc-row-title">{item.title}</span>
                    <span className="icpc-row-sub">
                      <Chip>{DIFFICULTY_LABELS[item.difficulty][locale]}</Chip>
                      {item.topics.slice(0, 2).map((topic) => <Chip key={topic}>{topic}</Chip>)}
                    </span>
                  </div>
                  <div className="icpc-row-meta">
                    {item.url && (
                      <a className="icpc-chip" href={item.url} target="_blank" rel="noreferrer noopener">
                        <ExternalLink size={12} aria-hidden="true" /> {t('المسألة', 'Open')}
                      </a>
                    )}
                    <Button variant="secondary" onClick={() => void markSolved(item.assignment_id)}>
                      {t('خلصتها', 'Done')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t('نشاط التدريب', 'Training activity')} icon={<Activity size={15} aria-hidden="true" />} hint={t('آخر 6 شهور', 'last 6 months')}>
          <ActivityHeatmap days={data.heatmap} weeks={26} />
        </Panel>
      </div>

      <div className="icpc-grid icpc-grid--split">
        <Panel title={t('تطور التقييم', 'Rating progression')} icon={<ArrowUpRight size={15} aria-hidden="true" />}>
          <RatingChart series={data.rating} />
          {data.rating.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.rating.map((series) => {
                const delta = series.current - series.first;
                return (
                  <Chip key={series.platform} tone={delta >= 0 ? 'success' : 'danger'}>
                    {PLATFORM_LABELS[series.platform] ?? series.platform}: {number(series.current)} ({delta >= 0 ? '+' : ''}{number(delta)})
                  </Chip>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={t('أكثر المواضيع تدريبًا', 'Top topics')} icon={<Target size={15} aria-hidden="true" />} flush>
          {data.topics_top.length === 0 ? (
            <InlineEmpty>{t('لسه مفيش مسائل محلولة بتصنيف مواضيع.', 'No solved problems with topics yet.')}</InlineEmpty>
          ) : (
            <div className="icpc-panel-body">
              {data.topics_top.map((entry) => (
                <Bar key={entry.topic} label={entry.topic} value={entry.count} total={maxTopic} suffix={t('مسألة', 'solved')} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="icpc-grid icpc-grid--split">
        <Panel title={t('آخر المسابقات', 'Recent contests')} icon={<Trophy size={15} aria-hidden="true" />} flush action={<Link className="icpc-chip" to={mode === 'admin' ? '/admin/icpc/contests' : '/portal/icpc/contests'}>{t('الكل', 'All')}</Link>}>
          {data.recent_contests.length === 0 ? (
            <InlineEmpty>{t('مفيش مسابقات مسجّلة.', 'No contests recorded.')}</InlineEmpty>
          ) : (
            <div className="icpc-list">
              {data.recent_contests.map((contest) => (
                <div key={contest.id} className="icpc-row">
                  <div className="icpc-row-main">
                    <span className="icpc-row-title">{contest.name}</span>
                    <span className="icpc-row-sub">
                      <Chip>{PLATFORM_LABELS[contest.platform] ?? contest.platform}</Chip>
                      {date(contest.starts_at)}
                    </span>
                  </div>
                  <div className="icpc-row-meta">
                    <span>{t(`${number(contest.solved)} محلولة`, `${number(contest.solved)} solved`)}</span>
                    {contest.rank && <Chip tone="primary">#{number(contest.rank)}</Chip>}
                    {contest.delta !== null && (
                      <Chip tone={contest.delta >= 0 ? 'success' : 'danger'}>
                        {contest.delta >= 0 ? '+' : ''}{number(contest.delta)}
                      </Chip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t('آخر المسائل المقبولة', 'Recent AC')} icon={<CheckCircle2 size={15} aria-hidden="true" />} flush>
          {data.recent_ac.length === 0 ? (
            <InlineEmpty>{t('مفيش مسائل مقبولة لسه.', 'No accepted problems yet.')}</InlineEmpty>
          ) : (
            <div className="icpc-list">
              {data.recent_ac.map((entry, index) => (
                <div key={`${entry.problem}-${index}`} className="icpc-row">
                  <div className="icpc-row-main">
                    <span className="icpc-row-title">{entry.problem}</span>
                    <span className="icpc-row-sub">
                      <Chip>{PLATFORM_LABELS[entry.platform] ?? entry.platform}</Chip>
                      <Chip tone={entry.difficulty === 'easy' ? 'success' : entry.difficulty === 'medium' ? 'warning' : 'danger'}>
                        {DIFFICULTY_LABELS[entry.difficulty].en}
                      </Chip>
                      <span>{entry.member}</span>
                    </span>
                  </div>
                  <div className="icpc-row-meta">
                    {entry.solved_at && <span>{date(entry.solved_at, { month: 'short', day: 'numeric' })}</span>}
                    {entry.url && (
                      <a className="icpc-chip" href={entry.url} target="_blank" rel="noreferrer noopener" aria-label={t('افتح المسألة', 'Open problem')}>
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('إتقان المواضيع', 'Topic mastery')} icon={<Radio size={15} aria-hidden="true" />} hint={t('نسبة المسائل المحلولة من إجمالي مسائل الموضوع', 'solved share of the topic bank')}>
        {masteryTop.length === 0 ? (
          <InlineEmpty>{t('ضيف مسائل بمواضيع عشان نحسب الإتقان.', 'Add problems with topics to compute mastery.')}</InlineEmpty>
        ) : (
          <div className="icpc-mastery">
            {masteryTop.map((row) => (
              <div key={row.topic} className="icpc-mastery-card">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-[13px]">{row.topic}</strong>
                  <Chip tone={row.percent >= 70 ? 'success' : row.percent >= 40 ? 'warning' : 'neutral'}>{number(row.percent)}%</Chip>
                </div>
                <div className="icpc-bar-track">
                  <div className="icpc-bar-fill" style={{ width: `${Math.min(100, row.percent)}%` }} />
                </div>
                <small className="text-[11px] text-[var(--text-muted)]">
                  {t(`${number(row.solved)} من ${number(row.total)} مسألة`, `${number(row.solved)} of ${number(row.total)} problems`)}
                </small>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
