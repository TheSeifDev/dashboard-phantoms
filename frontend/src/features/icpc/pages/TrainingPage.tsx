import { GraduationCap, Link2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { useLocale } from '../../../i18n/useLocale';
import { toast } from '../../../store/toast';
import { useIcpcTraining, useSetTopicStatus } from '../api';
import { Chip, Panel } from '../components/IcpcPanels';
import { STAGE_TITLES, type IcpcMode, type TrainingTopic } from '../types';

const NEXT_STATUS: Record<TrainingTopic['status'], TrainingTopic['status']> = {
  todo: 'learning',
  learning: 'done',
  done: 'todo',
};

export function TrainingPage({ mode }: { mode: IcpcMode }) {
  const { t, number, locale } = useLocale();
  const training = useIcpcTraining(mode);
  const setStatus = useSetTopicStatus(mode);

  if (training.isLoading) return <CardSkeletons count={3} />;
  if (training.isError || !training.data) {
    return <ErrorState message={(training.error as Error | null)?.message ?? t('معرفناش نحمّل الخريطة.', 'Could not load the roadmap.')} onRetry={() => void training.refetch()} />;
  }

  const update = async (topic: TrainingTopic) => {
    try {
      await setStatus.mutateAsync({ topicId: topic.id, status: NEXT_STATUS[topic.status] });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحدّث الموضوع.', 'Could not update topic.'));
    }
  };

  return (
    <div className="icpc-stages">
      {training.data.stages.map((stage) => (
        <section key={stage.stage} className="icpc-panel">
          <header className="icpc-stage-head">
            <div className="flex items-center gap-3">
              <span className="icpc-stage-num">{number(stage.stage).padStart(2, '0')}</span>
              <div>
                <h2 className="m-0 text-sm font-extrabold">{STAGE_TITLES[stage.stage]?.[locale] ?? `Stage ${stage.stage}`}</h2>
                <small className="text-[11px] text-[var(--text-muted)]">
                  {t(`${number(stage.done)} من ${number(stage.total)} موضوع مكتمل`, `${number(stage.done)} of ${number(stage.total)} topics done`)}
                </small>
              </div>
            </div>
            <Chip tone={stage.done === stage.total && stage.total > 0 ? 'success' : 'neutral'}>
              {stage.total > 0 ? `${number(Math.round((stage.done / stage.total) * 100))}%` : '—'}
            </Chip>
          </header>
          <div className="icpc-topics">
            {stage.topics.map((topic) => (
              <article key={topic.id} className="icpc-topic">
                <div className="icpc-topic-top">
                  <span className="icpc-topic-name">{locale === 'ar' ? topic.title_ar : topic.title_en}</span>
                  <Chip tone={topic.status === 'done' ? 'success' : topic.status === 'learning' ? 'warning' : 'neutral'}>
                    {topic.status === 'done' ? t('مكتمل', 'Done') : topic.status === 'learning' ? t('شغال عليه', 'Learning') : t('لسه', 'Todo')}
                  </Chip>
                </div>
                {topic.description && <p className="icpc-topic-desc m-0">{topic.description}</p>}
                <div className="icpc-topic-actions">
                  <Chip>{topic.difficulty === 'easy' ? t('سهل', 'Easy') : topic.difficulty === 'medium' ? t('متوسط', 'Medium') : t('صعب', 'Hard')}</Chip>
                  <Chip>{t(`${number(topic.problems)} مسألة`, `${number(topic.problems)} problems`)}</Chip>
                  {topic.resources.slice(0, 2).map((resource) => (
                    resource.url ? (
                      <a key={resource.url} className="icpc-chip" href={resource.url} target="_blank" rel="noreferrer noopener">
                        <Link2 size={11} aria-hidden="true" /> {resource.label ?? t('مصدر', 'Resource')}
                      </a>
                    ) : null
                  ))}
                </div>
                <div>
                  <Button variant="secondary" onClick={() => void update(topic)} isLoading={setStatus.isPending}>
                    {topic.status === 'done' ? t('إرجاع لسه', 'Reset') : topic.status === 'learning' ? t('خلصته', 'Mark done') : t('ابدأ', 'Start')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {training.data.stages.length === 0 && (
        <Panel title={t('خريطة التدريب', 'Training roadmap')} icon={<GraduationCap size={15} aria-hidden="true" />}>
          <p className="icpc-empty-inline">{t('مفيش مراحل متاحة.', 'No stages available.')}</p>
        </Panel>
      )}
    </div>
  );
}
