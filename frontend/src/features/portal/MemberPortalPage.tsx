import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useMemberTasks, useSubmitTaskDelivery, useUpdateTaskStatus } from '../tasks/api';
import { updateMemberReadiness } from '../members/api';
import type { Task, TaskDifficulty, TaskSubmissionLink } from '../../types/db';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { MemberHero } from './MemberHero';
import '../dashboard/dashboard.css';
import { MemberHomeCards } from './MemberHomeCards';
import { MemberMetricsGrid } from './MemberMetricsGrid';
import { MemberTeamInsights } from './MemberTeamInsights';
import { MemberDaySummary } from './MemberDaySummary';
import { useMemberTeamActivity } from './useMemberTeamActivity';
import { getCairoDate } from '../dashboard/taskContributions';
import { MemberTasks } from './MemberTasks';
import { MemberEvaluations } from './MemberEvaluations';
import { SubmissionModal } from './SubmissionModal';
import MemberAnnouncements from './announcements/MemberAnnouncements';
import { SubmissionSuccessModal, type SubmissionCelebration } from './SubmissionSuccessModal';
import { useMemberBonus, useMemberInfiniteBonus } from './useMemberBonus';
import { useMemberEvaluations } from '../evaluations/api';
import { taskBonus } from '../tasks/taskMeta';
import { WhatsAppNotificationCenter } from './WhatsAppNotificationCenter';
import { ProfileReminderBanner } from '../members/ProfileReminderBanner';
import { MemberPasswordBanner } from '../members/MemberPasswordBanner';
import { usePWA } from '../../hooks/usePWA';
import type { NotificationTargetTab } from '../../lib/notifications';
import { useLocale } from '../../i18n/useLocale';

type PortalTab = NotificationTargetTab;

export default function MemberPortalPage() {
  const { t } = useLocale();
  const member = useAuthStore((state) => state.currentMember);
  const tasksQuery = useMemberTasks(member?.id);
  const evaluationsQuery = useMemberEvaluations(member?.id);
  const updateTask = useUpdateTaskStatus();
  const submitDelivery = useSubmitTaskDelivery();
  const [params, setParams] = useSearchParams();
  const requestedTab = (params.get('tab') ?? 'ALL').toUpperCase() as PortalTab;
  const activeTab: PortalTab = (['ALL', 'TASKS', 'EVALUATIONS', 'ANNOUNCEMENTS'] as PortalTab[]).includes(requestedTab) ? requestedTab : 'ALL';
  const setActiveTab = (next: PortalTab) => {
    setParams(next === 'ALL' ? {} : { tab: next }, { replace: false });
  };
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [submissionDescription, setSubmissionDescription] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [usefulnessStars, setUsefulnessStars] = useState(5);
  const [submissionDifficulty, setSubmissionDifficulty] = useState<TaskDifficulty>('medium');
  const [submissionLinks, setSubmissionLinks] = useState<TaskSubmissionLink[]>([{ label: '', url: '' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingReadiness, setIsTogglingReadiness] = useState(false);
  const [celebration, setCelebration] = useState<SubmissionCelebration | null>(null);
  const bonusQuery = useMemberBonus(member?.id);
  // نفس استعلام قسم مساهمات الفريق (مفتاح واحد في الكاش) عشان كارت «أعضاء الفريق»
  // وهيكس الهيرو وخريطة المساهمات — كلهم بيقروا من نفس الأرقام.
  const teamActivity = useMemberTeamActivity(Number(getCairoDate().slice(0, 4)), Boolean(member?.id));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const bonusInfiniteQuery = useMemberInfiniteBonus(member?.id);
  const { sendTestNotification } = usePWA({
    memberId: member?.id,
    memberEmail: member?.email,
  });

  // مزامنة دورية سريعة للمهام والتقييمات لاكتشاف الإشعارات الجديدة لحظياً في الـ APK والـ PWA
  useEffect(() => {
    if (!member?.id) return;
    const intervalId = window.setInterval(() => {
      void tasksQuery.refetch();
      void evaluationsQuery.refetch();
    }, 15_000);
    return () => window.clearInterval(intervalId);
  }, [member?.id, tasksQuery, evaluationsQuery]);

  if (!member) return <Navigate to="/login" replace />;
  const memberId = String(member.id);

  const myTasks = tasksQuery.data ?? [];
  const myEvaluations = evaluationsQuery.data ?? [];

  const startTask = async (task: Task) => {
    try {
      const current = task.tracking?.[String(member.id)];
      await updateTask.mutateAsync({
        taskId: task.id,
        memberId: member.id,
        status: 'in_progress',
        note: current?.note ?? '',
        submissionUrl: current?.submission_url ?? '',
        currentTracking: task.tracking ?? {},
      });
      toast.success(t('بدأت المهمة — بالتوفيق!', 'Task started — good luck!'));
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نبدأ المهمة — مفيش حاجة اتغيرت.', 'We could not start the task; nothing was changed.'));
    }
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask) return;
    setIsSubmitting(true);
    try {
      const updatedTask = await submitDelivery.mutateAsync({
        taskId: selectedTask.id, memberId: member.id,
        description: submissionDescription, notes: submissionNotes,
        usefulnessStars, difficulty: submissionDifficulty,
        links: submissionLinks.filter((link) => link.label.trim() || link.url.trim()),
      });
      const submitted = selectedTask;
      const submittedEntry = updatedTask.tracking?.[memberId];
      setSelectedTask(null);
      setSubmissionDescription(''); setSubmissionNotes(''); setUsefulnessStars(5);
      setSubmissionDifficulty('medium'); setSubmissionLinks([{ label: '', url: '' }]);
      void bonusQuery.refetch();
      setCelebration({
        taskId: submitted.id,
        taskTitle: submitted.title,
        firstName: member.full_name.trim().split(/\s+/)[0] || member.full_name,
        bonus: taskBonus(submitted),
        deadline: submitted.has_deadline ? submitted.deadline_date : null,
        submittedAt: submittedEntry?.submitted_at ?? new Date().toISOString(),
        isResubmission: submitted.tracking?.[String(member.id)]?.status === 'revision_requested',
      });
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نسلّم المهمة — جرّب تاني.', 'We could not submit the task. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleFieldReadiness = async () => {
    const canGo = !member.can_go_alexandria;
    setIsTogglingReadiness(true);
    try {
      await updateMemberReadiness(member.id, canGo);
      useAuthStore.getState().setMember({ ...member, can_go_alexandria: canGo });
      toast.success(canGo ? t('جاهزية النزول الميداني اتفعّلت.', 'Field availability enabled.') : t('جاهزية النزول الميداني اتوقفت.', 'Field availability disabled.'));
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || t('معرفناش نحدّث حالة الجاهزية.', 'We could not update your field availability.'));
    } finally {
      setIsTogglingReadiness(false);
    }
  };

  const openSubmission = (task: Task) => {
    setSelectedTask(task);
    const entry = task.tracking?.[memberId];
    setSubmissionDescription(entry?.submission_description ?? '');
    setSubmissionNotes(entry?.submission_notes ?? entry?.note ?? '');
    setUsefulnessStars(entry?.usefulness_stars ?? 5);
    setSubmissionDifficulty(entry?.difficulty ?? 'medium');
    setSubmissionLinks(entry?.submission_links?.length ? entry.submission_links : [{ label: '', url: '' }]);
  };

  return (
    <>
      <WhatsAppNotificationCenter
        memberId={member.id}
        tasks={myTasks}
        evaluations={myEvaluations}
        onSelectTab={setActiveTab}
        onTestNotification={() => {
          void sendTestNotification();
        }}
      />
      <div className="dashboard-root">
        <ProfileReminderBanner />
        <MemberPasswordBanner />
        {activeTab === 'ALL' && (
          <>
            <MemberHero
              member={member}
              tasks={myTasks}
              evaluations={myEvaluations}
              onToggleField={toggleFieldReadiness}
              isUpdating={isTogglingReadiness}
              totalBonus={bonusQuery.data ?? null}
              bonusInfinite={bonusInfiniteQuery.data === true}
              bonusLoading={bonusQuery.isLoading}
              bonusError={bonusQuery.isError}
              bonusStateLoading={bonusInfiniteQuery.isLoading}
              bonusStateError={bonusInfiniteQuery.isError}
              todayActivity={teamActivity.today}
              onOpenToday={setOpenDay}
            />
            <MemberMetricsGrid
              tasks={myTasks}
              memberId={member.id}
              evaluations={myEvaluations}
              teamSize={teamActivity.query.data?.rosterSize ?? null}
              bonus={bonusQuery.data ?? null}
              onOpenEvaluations={() => setActiveTab('EVALUATIONS')}
            />
            <MemberHomeCards
              member={member}
              tasks={myTasks}
              evaluations={myEvaluations}
              bonus={bonusQuery.data ?? null}
              onOpenTab={setActiveTab}
            />
            <MemberTeamInsights onOpenDay={setOpenDay} />
          </>
        )}

        {activeTab === 'TASKS' && (
          <MemberTasks
            tasks={myTasks}
            memberId={memberId}
            isLoading={tasksQuery.isLoading}
            isError={tasksQuery.isError}
        isUpdating={updateTask.isPending || submitDelivery.isPending}
            onRetry={() => {
              void tasksQuery.refetch();
            }}
            onStart={startTask}
            onSubmit={openSubmission}
          />
        )}

        {activeTab === 'EVALUATIONS' && <MemberEvaluations memberId={member.id} />}

        {activeTab === 'ANNOUNCEMENTS' && <MemberAnnouncements memberId={member.id} />}
      </div>
      {openDay ? (
        <MemberDaySummary
          date={openDay}
          approvals={teamActivity.activity?.byDate.get(openDay)?.approvals ?? 0}
          shares={teamActivity.activity?.byDate.get(openDay)?.githubBy ?? []}
          people={teamActivity.people}
          onClose={() => setOpenDay(null)}
        />
      ) : null}
      <SubmissionModal
        task={selectedTask}
        description={submissionDescription}
        notes={submissionNotes}
        stars={usefulnessStars}
        difficulty={submissionDifficulty}
        links={submissionLinks}
        isSubmitting={isSubmitting}
        onDescriptionChange={setSubmissionDescription}
        onNotesChange={setSubmissionNotes}
        onStarsChange={setUsefulnessStars}
        onDifficultyChange={setSubmissionDifficulty}
        onLinksChange={setSubmissionLinks}
        onClose={() => setSelectedTask(null)}
        onSubmit={submitTask}
      />
      <SubmissionSuccessModal
        celebration={celebration}
        totalBonus={bonusQuery.data}
        bonusInfinite={bonusInfiniteQuery.data === true}
        bonusStateError={bonusInfiniteQuery.isError}
        totalLoading={
          bonusQuery.isLoading ||
          bonusQuery.isFetching ||
          bonusInfiniteQuery.isLoading ||
          bonusInfiniteQuery.isFetching
        }
        onClose={() => setCelebration(null)}
      />
    </>
  );
}
