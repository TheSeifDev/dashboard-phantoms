import { useState } from 'react';
import { Clock, Plus, Trophy, Users } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Modal } from '../../../components/ui/Modal';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useContestDetail, useIcpcContests, useJoinContest, useRecordContest, useSaveContest } from '../api';
import { Chip, InlineEmpty, Panel } from '../components/IcpcPanels';
import { PLATFORM_LABELS, type ContestKind, type ContestStatus, type IcpcContest, type IcpcMode } from '../types';

const KINDS: Array<{ value: ContestKind; ar: string; en: string }> = [
  { value: 'individual', ar: 'تدريب فردي', en: 'Individual practice' },
  { value: 'virtual', ar: 'مسابقة افتراضية', en: 'Virtual contest' },
  { value: 'internal', ar: 'داخلية PHANTOMS', en: 'Internal PHANTOMS' },
];

const STATUSES: Array<{ value: ContestStatus; ar: string; en: string }> = [
  { value: 'draft', ar: 'مسودة', en: 'Draft' },
  { value: 'scheduled', ar: 'مجدولة', en: 'Scheduled' },
  { value: 'running', ar: 'جارية', en: 'Running' },
  { value: 'finished', ar: 'منتهية', en: 'Finished' },
];

interface ContestDraft {
  id?: number;
  name: string;
  description: string;
  platform: string;
  kind: ContestKind;
  starts_at: string;
  duration_minutes: string;
  visibility: 'team' | 'admins';
  status: ContestStatus;
  penalty_minutes: string;
  points_per_problem: string;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

const EMPTY: ContestDraft = {
  name: '',
  description: '',
  platform: 'internal',
  kind: 'internal',
  starts_at: toLocalInput(new Date().toISOString()),
  duration_minutes: '300',
  visibility: 'team',
  status: 'scheduled',
  penalty_minutes: '20',
  points_per_problem: '1',
};

export function ContestsPage({ mode }: { mode: IcpcMode }) {
  const { t, number, date, locale } = useLocale();
  const contests = useIcpcContests(mode);
  const saveContest = useSaveContest(mode);
  const joinContest = useJoinContest(mode);
  const recordContest = useRecordContest(mode);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ContestDraft>(EMPTY);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [result, setResult] = useState({ solved: '0', penalty: '0', rank: '', delta: '' });
  const detail = useContestDetail(detailId, mode);

  const canManage = mode === 'admin';

  const openCreate = () => {
    setDraft(EMPTY);
    setEditorOpen(true);
  };

  const openEdit = (contest: IcpcContest) => {
    setDraft({
      id: contest.id,
      name: contest.name,
      description: contest.description ?? '',
      platform: contest.platform,
      kind: contest.kind,
      starts_at: toLocalInput(contest.starts_at),
      duration_minutes: String(contest.duration_minutes),
      visibility: contest.visibility,
      status: contest.status,
      penalty_minutes: String(contest.scoring.penalty_minutes ?? 20),
      points_per_problem: String(contest.scoring.points_per_problem ?? 1),
    });
    setEditorOpen(true);
  };

  const submit = async () => {
    try {
      await saveContest.mutateAsync({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        description: draft.description,
        platform: draft.platform,
        kind: draft.kind,
        starts_at: new Date(draft.starts_at).toISOString(),
        duration_minutes: Number(draft.duration_minutes),
        visibility: draft.visibility,
        status: draft.status,
        scoring: {
          penalty_minutes: Number(draft.penalty_minutes),
          points_per_problem: Number(draft.points_per_problem),
        },
      });
      toast.success(t('اتحفظت المسابقة.', 'Contest saved.'));
      setEditorOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحفظ المسابقة.', 'Could not save the contest.'));
    }
  };

  const join = async (id: number) => {
    try {
      await joinContest.mutateAsync(id);
      toast.success(t('اتسجلت مشاركتك.', 'You joined the contest.'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نسجّل مشاركتك.', 'Could not join.'));
    }
  };

  const submitResult = async () => {
    if (detailId === null) return;
    try {
      await recordContest.mutateAsync({
        contest_id: detailId,
        solved: Number(result.solved || 0),
        penalty: Number(result.penalty || 0),
        rank: result.rank ? Number(result.rank) : null,
        rating_delta: result.delta ? Number(result.delta) : null,
      });
      toast.success(t('اتسجلت النتيجة.', 'Result recorded.'));
      void detail.refetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نسجّل النتيجة.', 'Could not record the result.'));
    }
  };

  if (contests.isLoading) return <CardSkeletons count={3} />;
  if (contests.isError || !contests.data) {
    return <ErrorState message={(contests.error as Error | null)?.message ?? t('معرفناش نحمّل المسابقات.', 'Could not load contests.')} onRetry={() => void contests.refetch()} />;
  }

  return (
    <div className="grid gap-4">
      <Panel
        title={t('المسابقات', 'Contests')}
        icon={<Trophy size={15} aria-hidden="true" />}
        hint={t(`${number(contests.data.contests.length)} مسابقة`, `${number(contests.data.contests.length)} contests`)}
        action={canManage ? <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('مسابقة جديدة', 'New contest')}</Button> : undefined}
        flush
      >
        {contests.data.contests.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('مفيش مسابقات لسه', 'No contests yet')}
              description={t('اعمل مسابقة داخلية بخمس ساعات أو سجّل مسابقة افتراضية عشان نبدأ نحسب الأداء.', 'Create a five-hour internal contest or log a virtual one to start tracking performance.')}
              action={canManage ? <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>{t('أضف مسابقة', 'Add contest')}</Button> : undefined}
            />
          </div>
        ) : (
          <div className="icpc-list">
            {contests.data.contests.map((contest) => (
              <div key={contest.id} className="icpc-row" style={{ flexWrap: 'wrap' }}>
                <div className="icpc-row-main">
                  <span className="icpc-row-title">{contest.name}</span>
                  <span className="icpc-row-sub">
                    <Chip>{PLATFORM_LABELS[contest.platform] ?? contest.platform}</Chip>
                    <Chip>{KINDS.find((entry) => entry.value === contest.kind)?.[locale] ?? contest.kind}</Chip>
                    <Chip tone={contest.status === 'finished' ? 'neutral' : contest.status === 'running' ? 'success' : 'primary'}>
                      {STATUSES.find((entry) => entry.value === contest.status)?.[locale] ?? contest.status}
                    </Chip>
                    <span>{date(contest.starts_at)}</span>
                  </span>
                </div>
                <div className="icpc-row-meta">
                  <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden="true" />{number(Math.round(contest.duration_minutes / 60))}h</span>
                  <span className="inline-flex items-center gap-1"><Users size={12} aria-hidden="true" />{number(contest.participants)}</span>
                  <Button variant="secondary" onClick={() => { setDetailId(contest.id); setResult({ solved: '0', penalty: '0', rank: '', delta: '' }); }}>
                    {t('التفاصيل', 'Details')}
                  </Button>
                  {!contest.joined && <Button onClick={() => void join(contest.id)} isLoading={joinContest.isPending}>{t('شارك', 'Join')}</Button>}
                  {canManage && <Button variant="ghost" onClick={() => openEdit(contest)}>{t('تعديل', 'Edit')}</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={draft.id ? t('تعديل مسابقة', 'Edit contest') : t('مسابقة جديدة', 'New contest')}
        subtitle={t('الحساب قابل للضبط: نقاط لكل مسألة وعقوبة بالدقايق.', 'Configurable scoring: points per problem and penalty minutes.')}
        maxWidth="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={() => void submit()} isLoading={saveContest.isPending}>{t('حفظ', 'Save')}</Button>
          </>
        )}
      >
        <div className="icpc-form-grid">
          <label className="icpc-field icpc-span-2">
            <span>{t('اسم المسابقة', 'Name')}</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
          </label>
          <label className="icpc-field">
            <span>{t('النوع', 'Kind')}</span>
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ContestKind })}>
              {KINDS.map((entry) => <option key={entry.value} value={entry.value}>{entry[locale]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('المنصة', 'Platform')}</span>
            <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>
              {Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('وقت البداية', 'Start')}</span>
            <input type="datetime-local" value={draft.starts_at} onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('المدة (دقيقة)', 'Duration (minutes)')}</span>
            <input type="number" min={15} max={1440} value={draft.duration_minutes} onChange={(event) => setDraft({ ...draft, duration_minutes: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('الحالة', 'Status')}</span>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ContestStatus })}>
              {STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry[locale]}</option>)}
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('الظهور', 'Visibility')}</span>
            <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as 'team' | 'admins' })}>
              <option value="team">{t('للفريق', 'Team')}</option>
              <option value="admins">{t('للإدارة', 'Admins')}</option>
            </select>
          </label>
          <label className="icpc-field">
            <span>{t('عقوبة (دقيقة)', 'Penalty (min)')}</span>
            <input type="number" min={0} value={draft.penalty_minutes} onChange={(event) => setDraft({ ...draft, penalty_minutes: event.target.value })} />
          </label>
          <label className="icpc-field">
            <span>{t('نقاط لكل مسألة', 'Points per problem')}</span>
            <input type="number" min={1} value={draft.points_per_problem} onChange={(event) => setDraft({ ...draft, points_per_problem: event.target.value })} />
          </label>
          <label className="icpc-field icpc-span-2">
            <span>{t('وصف', 'Description')}</span>
            <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={detailId !== null}
        onClose={() => setDetailId(null)}
        title={detail.data?.contest?.name ?? t('تفاصيل المسابقة', 'Contest details')}
        subtitle={detail.data?.contest ? date(detail.data.contest.starts_at) : undefined}
        maxWidth="2xl"
      >
        {detail.isLoading ? (
          <CardSkeletons count={2} />
        ) : detail.data ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Chip tone="primary">{detail.data.contest.kind}</Chip>
              <Chip>{t(`${number(detail.data.contest.duration_minutes)} دقيقة`, `${number(detail.data.contest.duration_minutes)} min`)}</Chip>
              <Chip>{t(`عقوبة ${number(detail.data.contest.scoring.penalty_minutes ?? 20)} دقيقة`, `Penalty ${number(detail.data.contest.scoring.penalty_minutes ?? 20)}m`)}</Chip>
            </div>

            {detail.data.problems.length === 0 ? (
              <InlineEmpty>{t('مفيش مسائل مضافة للمسابقة.', 'No problems added to this contest.')}</InlineEmpty>
            ) : (
              <div className="icpc-scroll-x">
                <table className="icpc-table">
                  <thead>
                    <tr><th>{t('المسألة', 'Problem')}</th><th>{t('الصعوبة', 'Difficulty')}</th><th>{t('النقاط', 'Points')}</th><th /></tr>
                  </thead>
                  <tbody>
                    {detail.data.problems.map((problem) => (
                      <tr key={problem.id}>
                        <td>{problem.label} — {problem.title}</td>
                        <td>{problem.difficulty}</td>
                        <td>{number(problem.points)}</td>
                        <td>{problem.url && <a href={problem.url} target="_blank" rel="noreferrer noopener">{t('افتح', 'Open')}</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-extrabold">{t('لوحة النتائج', 'Scoreboard')}</h3>
              {detail.data.scoreboard.length === 0 ? (
                <InlineEmpty>{t('مفيش نتائج مسجّلة.', 'No results recorded.')}</InlineEmpty>
              ) : (
                <div className="icpc-scroll-x">
                  <table className="icpc-table">
                    <thead>
                      <tr><th>#</th><th>{t('العضو', 'Member')}</th><th>{t('محلولة', 'Solved')}</th><th>{t('عقوبة', 'Penalty')}</th><th>{t('النقاط', 'Score')}</th><th>Δ</th></tr>
                    </thead>
                    <tbody>
                      {detail.data.scoreboard.map((row, index) => (
                        <tr key={row.user_id}>
                          <td>{row.rank ?? index + 1}</td>
                          <td>{row.member}</td>
                          <td>{number(row.solved)}</td>
                          <td>{number(row.penalty)}</td>
                          <td>{number(row.score, { maximumFractionDigits: 1 })}</td>
                          <td>{row.rating_delta === null ? '—' : `${row.rating_delta >= 0 ? '+' : ''}${number(row.rating_delta)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="icpc-panel">
              <div className="icpc-panel-head"><h2>{t('تسجيل نتيجتك', 'Record your result')}</h2></div>
              <div className="icpc-panel-body grid gap-3 sm:grid-cols-4">
                <label className="icpc-field"><span>{t('محلولة', 'Solved')}</span><input type="number" min={0} value={result.solved} onChange={(event) => setResult({ ...result, solved: event.target.value })} /></label>
                <label className="icpc-field"><span>{t('عقوبة', 'Penalty')}</span><input type="number" min={0} value={result.penalty} onChange={(event) => setResult({ ...result, penalty: event.target.value })} /></label>
                <label className="icpc-field"><span>{t('الترتيب', 'Rank')}</span><input type="number" min={1} value={result.rank} onChange={(event) => setResult({ ...result, rank: event.target.value })} /></label>
                <label className="icpc-field"><span>{t('تغيير التقييم', 'Rating Δ')}</span><input type="number" value={result.delta} onChange={(event) => setResult({ ...result, delta: event.target.value })} /></label>
                <div className="sm:col-span-4">
                  <Button onClick={() => void submitResult()} isLoading={recordContest.isPending}>{t('سجّل', 'Record')}</Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <InlineEmpty>{t('مفيش بيانات.', 'No data.')}</InlineEmpty>
        )}
      </Modal>
    </div>
  );
}
