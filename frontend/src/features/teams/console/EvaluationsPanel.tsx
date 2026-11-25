import { useMemo, useState, type FormEvent } from 'react';
import { Award, Star, TrendingUp } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { MemberEvaluationGrade, TeamConsole } from '../../../types/db';
import { useCreateTeamEvaluation } from './api';
import { GRADE_COPY, PanelShell, StateChip } from './shared';
import { BarsChart } from './charts';

const GRADES: MemberEvaluationGrade[] = ['excellent', 'very_good', 'good', 'needs_improvement', 'warning'];
const MIN_POINTS = -10;
const MAX_POINTS = 20;

export function EvaluationsPanel({ teamId, data }: { teamId: string; data: TeamConsole }) {
  const { t, locale, number, date } = useLocale();
  const createEvaluation = useCreateTeamEvaluation(teamId);
  const [memberId, setMemberId] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [grade, setGrade] = useState<MemberEvaluationGrade>('very_good');
  const [points, setPoints] = useState(3);
  const [feedback, setFeedback] = useState('');
  const [filter, setFilter] = useState<'all' | 'positive' | 'negative'>('all');

  const members = data.members;
  const list = useMemo(() => data.evaluations.filter((item) => {
    if (filter === 'positive') return item.points > 0;
    if (filter === 'negative') return item.points < 0;
    return true;
  }), [data.evaluations, filter]);

  const totals = useMemo(() => {
    const awarded = data.evaluations.filter((item) => item.points > 0).reduce((sum, item) => sum + item.points, 0);
    const deducted = data.evaluations.filter((item) => item.points < 0).reduce((sum, item) => sum + item.points, 0);
    return { awarded, deducted, net: awarded + deducted };
  }, [data.evaluations]);

  const perMember = useMemo(() => data.members
    .slice()
    .sort((a, b) => b.team_bonus - a.team_bonus)
    .slice(0, 8)
    .map((member) => ({
      id: member.member_id,
      label: member.full_name,
      value: member.team_bonus,
      hint: `${number(member.evaluation_count)} ${t('تقييم', 'evals')}`,
      tone: member.team_bonus < 0 ? 'warning' as const : 'accent' as const,
    })), [data.members, number, t]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (memberId === '') {
      toast.error(t('اختار العضو اللي هتقيّمه.', 'Pick the member you want to evaluate.'));
      return;
    }
    if (title.trim().length < 3 || feedback.trim().length < 3) {
      toast.error(t('اكتب عنوان وملاحظة واضحة للتقييم.', 'Write a clear title and feedback for the evaluation.'));
      return;
    }
    try {
      await createEvaluation.mutateAsync({
        memberId,
        title: title.trim(),
        grade,
        points,
        feedback: feedback.trim(),
      });
      toast.success(t('اتسجل التقييم واتضاف للإجمالي الأساسي للعضو.', 'Evaluation saved and added to the member’s main total.'));
      setTitle('');
      setFeedback('');
      setPoints(3);
      setGrade('very_good');
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نسجل التقييم.', 'Could not save the evaluation.')).message);
    }
  };

  return (
    <>
      <div className="tmc-metrics">
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">+{number(totals.awarded)}</strong>
          <span>{t('نجوم ممنوحة', 'stars awarded')}</span>
          <small>{t('من تقييمات الفريق', 'from team evaluations')}</small>
        </article>
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">{number(totals.deducted)}</strong>
          <span>{t('نجوم مخصومة', 'stars deducted')}</span>
          <small>{t('من تقييمات الفريق', 'from team evaluations')}</small>
        </article>
        <article className="tmc-metric" data-tmc-anim>
          <strong dir="ltr">{totals.net >= 0 ? '+' : ''}{number(totals.net)}</strong>
          <span>{t('الصافي', 'net')}</span>
          <small>{t('بيتحسب في الـ total الأساسي', 'counted in the main total')}</small>
        </article>
      </div>

      <PanelShell
        id="tmc-eval-create"
        kicker={<><Award size={14} aria-hidden="true" />{t('تقييم جديد', 'New evaluation')}</>}
        title={t('قيّم عضو في الفريق', 'Evaluate a team member')}
        hint={t('النجوم بتتسجل في سجل البونص الأساسي فورًا، فأي بونص من الفريق يظهر في الـ total الرئيسي والعكس.', 'Stars are written to the main bonus ledger instantly, so team bonus shows in the main total and vice versa.')}
      >
        <form className="tmc-form" onSubmit={(event) => void submit(event)}>
          <label className="tmc-field">
            <span>{t('العضو', 'Member')}</span>
            <select value={memberId} onChange={(event) => setMemberId(event.target.value === '' ? '' : Number(event.target.value))} required>
              <option value="">{t('اختار عضو…', 'Pick a member…')}</option>
              {members.map((member) => (
                <option key={member.member_id} value={member.member_id}>{member.full_name}</option>
              ))}
            </select>
          </label>
          <label className="tmc-field">
            <span>{t('عنوان التقييم', 'Evaluation title')}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 200))} maxLength={200} required placeholder={t('مثال: تسليم Sprint 4', 'e.g. Sprint 4 delivery')} />
          </label>
          <label className="tmc-field">
            <span>{t('التقدير', 'Grade')}</span>
            <select value={grade} onChange={(event) => setGrade(event.target.value as MemberEvaluationGrade)}>
              {GRADES.map((value) => (
                <option key={value} value={value}>{GRADE_COPY[value][locale === 'ar' ? 'ar' : 'en']}</option>
              ))}
            </select>
          </label>
          <label className="tmc-field">
            <span>{t('النجوم', 'Stars')}</span>
            <input
              type="number"
              min={MIN_POINTS}
              max={MAX_POINTS}
              value={points}
              onChange={(event) => setPoints(Math.max(MIN_POINTS, Math.min(MAX_POINTS, Number(event.target.value) || 0)))}
            />
            <small className="tmc-counter" dir="ltr">{MIN_POINTS} … {MAX_POINTS}</small>
          </label>
          <label className="tmc-field tmc-field--wide">
            <span>{t('ملاحظة مكتوبة', 'Written feedback')}</span>
            <textarea value={feedback} onChange={(event) => setFeedback(event.target.value.slice(0, 3000))} rows={3} maxLength={3000} required placeholder={t('اكتب ملاحظة واضحة توضح سبب التقييم.', 'Write a clear note explaining the evaluation.')} />
          </label>
          <div className="tmc-form-actions">
            <Button type="submit" icon={<Star size={15} aria-hidden="true" />} isLoading={createEvaluation.isPending} disabled={members.length === 0}>
              {t('حفظ التقييم', 'Save evaluation')}
            </Button>
            {members.length === 0 ? <span className="tmc-note">{t('مفيش أعضاء نشطين في الفريق.', 'No active members in this team.')}</span> : null}
          </div>
        </form>
      </PanelShell>

      <div className="tmc-chart-grid">
        <PanelShell
          id="tmc-eval-bars"
          kicker={<><TrendingUp size={14} aria-hidden="true" />{t('التوزيع', 'Distribution')}</>}
          title={t('بونص الفريق لكل عضو', 'Team bonus per member')}
          hint={t('ده نصيب الفريق فقط؛ الإجمالي الأساسي ظاهر في تاب نظرة عامة.', 'This is the team share only; the main total lives in the Overview tab.')}
        >
          <BarsChart
            data={perMember}
            format={(value) => `${value >= 0 ? '+' : ''}${number(value)}`}
            emptyLabel={t('لسه مفيش بونص فريق.', 'No team bonus yet.')}
            ariaLabel={t('بونص الفريق لكل عضو', 'Team bonus per member')}
          />
        </PanelShell>

        <PanelShell
          id="tmc-eval-list"
          kicker={<><Star size={14} aria-hidden="true" />{t('السجل', 'Ledger')}</>}
          title={t('تقييمات الفريق', 'Team evaluations')}
          actions={(
            <div className="tmc-segmented tmc-segmented--sm" role="group" aria-label={t('تصفية التقييمات', 'Filter evaluations')}>
              <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>{t('الكل', 'All')}</button>
              <button type="button" className={filter === 'positive' ? 'is-active' : ''} onClick={() => setFilter('positive')}>{t('ممنوح', 'Awarded')}</button>
              <button type="button" className={filter === 'negative' ? 'is-active' : ''} onClick={() => setFilter('negative')}>{t('مخصوم', 'Deducted')}</button>
            </div>
          )}
        >
          {list.length === 0
            ? <p className="tmc-note">{t('مفيش تقييمات مطابقة للفلتر.', 'No evaluations match this filter.')}</p>
            : (
              <ul className="tmc-eval-list">
                {list.slice(0, 30).map((item) => {
                  const copy = GRADE_COPY[item.grade];
                  return (
                    <li key={item.id} className="tmc-eval" data-tmc-anim>
                      <div className="tmc-eval-head">
                        <strong>{item.member_name}</strong>
                        <StateChip tone={item.points >= 0 ? 'primary' : 'warning'}>{item.points >= 0 ? '+' : ''}{number(item.points)}</StateChip>
                      </div>
                      <div className="tmc-eval-stars" aria-label={`${copy[locale === 'ar' ? 'ar' : 'en']} · ${copy.stars}/5`}>
                        {Array.from({ length: 5 }, (_, index) => (
                          <Star key={index} size={13} aria-hidden="true" className={index < copy.stars ? 'is-on' : ''} />
                        ))}
                        <small>{copy[locale === 'ar' ? 'ar' : 'en']}</small>
                      </div>
                      <p className="tmc-eval-title">{item.title}</p>
                      <p className="tmc-eval-feedback">{item.feedback}</p>
                      <small className="tmc-eval-date">{date(item.created_at)}</small>
                    </li>
                  );
                })}
              </ul>
            )}
        </PanelShell>
      </div>
    </>
  );
}
