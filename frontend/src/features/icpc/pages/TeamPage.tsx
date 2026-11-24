import { useMemo, useState } from 'react';
import { Link2, Plus, Users } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Segmented } from '../../dashboard/Segmented';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useAddRating, useIcpcTeam, useLinkPlatform } from '../api';
import { Chip, InlineEmpty, Panel } from '../components/IcpcPanels';
import { PLATFORM_LABELS, type IcpcMode } from '../types';

const RANGES = [
  { value: '30', ar: '30 يوم', en: '30 days' },
  { value: '90', ar: '90 يوم', en: '90 days' },
  { value: '180', ar: '6 شهور', en: '6 months' },
] as const;

export function TeamPage({ mode }: { mode: IcpcMode }) {
  const { t, number, locale } = useLocale();
  const [days, setDays] = useState(90);
  const [platform, setPlatform] = useState('codeforces');
  const [handle, setHandle] = useState('');
  const [rating, setRating] = useState('');
  const [contestName, setContestName] = useState('');
  const [contestRating, setContestRating] = useState('');
  const [delta, setDelta] = useState('');
  const team = useIcpcTeam(mode, days);
  const linkPlatform = useLinkPlatform(mode);
  const addRating = useAddRating(mode);

  const matrix = useMemo(() => {
    const members = team.data?.members ?? [];
    const topics = (team.data?.topics ?? []).slice(0, 10);
    const max = Math.max(1, ...members.flatMap((member) => topics.map((topic) => member.topics[topic] ?? 0)));
    return { members, topics, max };
  }, [team.data]);

  if (team.isLoading) return <CardSkeletons count={3} />;
  if (team.isError || !team.data) {
    return <ErrorState message={(team.error as Error | null)?.message ?? t('معرفناش نحمّل أداء الفريق.', 'Could not load team performance.')} onRetry={() => void team.refetch()} />;
  }

  const submitPlatform = async () => {
    try {
      await linkPlatform.mutateAsync({ platform, handle, current_rating: rating ? Number(rating) : null });
      toast.success(t('اتربط حساب المنصة.', 'Platform account linked.'));
      setHandle('');
      setRating('');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نربط الحساب.', 'Could not link the account.'));
    }
  };

  const submitRating = async () => {
    try {
      await addRating.mutateAsync({
        platform,
        contest_name: contestName,
        rating: Number(contestRating),
        delta: delta ? Number(delta) : 0,
      });
      toast.success(t('اتسجل التقييم.', 'Rating logged.'));
      setContestName('');
      setContestRating('');
      setDelta('');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نسجّل التقييم.', 'Could not log the rating.'));
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={String(days)}
          options={RANGES.map((range) => ({ value: range.value, label: t(range.ar, range.en) }))}
          onChange={(value) => setDays(Number(value))}
          label={t('المدى', 'Range')}
        />
        <Chip tone="primary">{t(`${number(matrix.members.length)} عضو`, `${number(matrix.members.length)} members`)}</Chip>
      </div>

      <Panel title={t('مصفوفة المهارات', 'Skill matrix')} icon={<Users size={15} aria-hidden="true" />} hint={t('عدد المسائل المحلولة لكل موضوع', 'solved per topic')} flush>
        {matrix.members.length === 0 ? (
          <InlineEmpty>{t('مفيش أعضاء مرتبطين بحسابات.', 'No linked members.')}</InlineEmpty>
        ) : (
          <div className="icpc-scroll-x">
            <table className="icpc-table">
              <thead>
                <tr>
                  <th>{t('العضو', 'Member')}</th>
                  <th>{t('محلولة', 'Solved')}</th>
                  <th>{t('مسابقات', 'Contests')}</th>
                  <th>{t('التقييم', 'Rating')}</th>
                  {matrix.topics.map((topic) => <th key={topic}>{topic}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.members.map((member) => (
                  <tr key={member.user_id}>
                    <td>
                      <div className="grid">
                        <strong>{member.member}</strong>
                        <small className="text-[10px] text-[var(--text-muted)]">{member.team ?? '—'} · {member.role}</small>
                      </div>
                    </td>
                    <td>{number(member.solved)}</td>
                    <td>{number(member.contests)}</td>
                    <td>{member.rating === null ? '—' : number(member.rating)}</td>
                    {matrix.topics.map((topic) => {
                      const value = member.topics[topic] ?? 0;
                      const intensity = value === 0 ? 0 : Math.min(4, Math.ceil((value / matrix.max) * 4));
                      return (
                        <td key={topic} style={{ background: intensity === 0 ? 'transparent' : `color-mix(in oklab, var(--primary) ${intensity * 18}%, transparent)` }}>
                          {value === 0 ? '—' : number(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="icpc-grid icpc-grid--split">
        <Panel title={t('ربط حساب منصة', 'Link a platform account')} icon={<Link2 size={15} aria-hidden="true" />}>
          <div className="icpc-form-grid">
            <label className="icpc-field">
              <span>{t('المنصة', 'Platform')}</span>
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                {['codeforces', 'codechef', 'atcoder', 'cses', 'other'].map((value) => (
                  <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label className="icpc-field">
              <span>{t('اسم المستخدم', 'Handle')}</span>
              <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="tourist" />
            </label>
            <label className="icpc-field">
              <span>{t('التقييم الحالي (اختياري)', 'Current rating (optional)')}</span>
              <input type="number" min={0} value={rating} onChange={(event) => setRating(event.target.value)} />
            </label>
            <div className="flex items-end">
              <Button onClick={() => void submitPlatform()} isLoading={linkPlatform.isPending} disabled={!handle.trim()}>{t('اربط', 'Link')}</Button>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-6 text-[var(--text-muted)]">
            {t('الربط يدوي حاليًا — مفيش أي أرقام تقييم بتتولّد من غير ما تسجّلها.', 'Linking is manual for now — no rating numbers are ever invented.')}
          </p>
        </Panel>

        <Panel title={t('تسجيل تقييم مسابقة', 'Log a contest rating')} icon={<Plus size={15} aria-hidden="true" />}>
          <div className="icpc-form-grid">
            <label className="icpc-field">
              <span>{t('اسم المسابقة', 'Contest name')}</span>
              <input value={contestName} onChange={(event) => setContestName(event.target.value)} placeholder="Codeforces Round 1000" />
            </label>
            <label className="icpc-field">
              <span>{t('التقييم بعد المسابقة', 'Rating after')}</span>
              <input type="number" min={0} value={contestRating} onChange={(event) => setContestRating(event.target.value)} />
            </label>
            <label className="icpc-field">
              <span>{t('التغيير', 'Delta')}</span>
              <input type="number" value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="+42" />
            </label>
            <div className="flex items-end">
              <Button onClick={() => void submitRating()} isLoading={addRating.isPending} disabled={!contestName.trim() || !contestRating}>
                {t('سجّل', 'Log')}
              </Button>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-6 text-[var(--text-muted)]">
            {locale === 'ar'
              ? 'لازم تربط حساب المنصة الأول قبل تسجيل التقييم.'
              : 'Link the platform account before logging a rating.'}
          </p>
        </Panel>
      </div>
    </div>
  );
}
