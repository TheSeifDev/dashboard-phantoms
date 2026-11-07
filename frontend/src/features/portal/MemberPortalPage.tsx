import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Bell, CheckSquare, ClipboardCheck, Layers } from 'lucide-react';
import { getDeviceToken, useAuthStore } from '../../store/auth';
import { useMemberTasks, useUpdateTaskStatus } from '../tasks/api';
import { logoutMemberDevice, updateMemberReadiness } from '../members/api';
import type { Task } from '../../types/db';
import { PortalHeader } from './PortalHeader';
import { toast } from '../../store/toast';
import { handleSupabaseError } from '../../lib/errorHandler';
import { MemberHero } from './MemberHero';
import { MemberTasks } from './MemberTasks';
import { MemberEvaluations } from './MemberEvaluations';
import { SubmissionModal } from './SubmissionModal';
import MemberAnnouncements from './announcements/MemberAnnouncements';
import { SubmissionSuccessModal, type SubmissionCelebration } from './SubmissionSuccessModal';
import { useMemberBonus, useMemberInfiniteBonus } from './useMemberBonus';
import { useMemberEvaluations } from '../evaluations/api';
import { taskBonus } from '../tasks/taskMeta';
import { WhatsAppNotificationCenter } from './WhatsAppNotificationCenter';
import { usePWA } from '../../hooks/usePWA';
import type { NotificationTargetTab } from '../../lib/notifications';

type PortalTab = NotificationTargetTab;

export default function MemberPortalPage() {
  const member = useAuthStore((state) => state.currentMember);
  const logoutMember = useAuthStore((state) => state.logoutMember);
  const navigate = useNavigate();
  const tasksQuery = useMemberTasks(member?.id);
  const evaluationsQuery = useMemberEvaluations(member?.id);
  const updateTask = useUpdateTaskStatus();
  const [activeTab, setActiveTab] = useState<PortalTab>('ALL');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [submissionNote, setSubmissionNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingReadiness, setIsTogglingReadiness] = useState(false);
  const [celebration, setCelebration] = useState<SubmissionCelebration | null>(null);
  const bonusQuery = useMemberBonus(member?.id);
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
  const unreadEvaluationsCount = myEvaluations.filter((e) => !e.read_at).length;

  const logout = async () => {
    const deviceToken = getDeviceToken();
    try {
      if (deviceToken) await logoutMemberDevice(member.id, deviceToken);
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'حصلت مشكلة وإحنا بنسجّل خروج الجهاز.');
    } finally {
      logoutMember();
      navigate('/login');
    }
  };

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
      toast.success('بدأت المهمة — بالتوفيق!');
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نبدأ المهمة — مفيش حاجة اتغيرت.');
    }
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask) return;
    setIsSubmitting(true);
    try {
      await updateTask.mutateAsync({
        taskId: selectedTask.id,
        memberId: member.id,
        status: 'under_review',
        submissionUrl: submissionUrl.trim(),
        note: submissionNote.trim(),
        currentTracking: selectedTask.tracking ?? {},
      });
      const submitted = selectedTask;
      setSelectedTask(null);
      setSubmissionUrl('');
      setSubmissionNote('');
      void bonusQuery.refetch();
      setCelebration({
        taskId: submitted.id,
        taskTitle: submitted.title,
        firstName: member.full_name.trim().split(/\s+/)[0] || member.full_name,
        bonus: taskBonus(submitted),
        deadline: submitted.has_deadline ? submitted.deadline_date : null,
        submittedAt: new Date().toISOString(),
        isResubmission: submitted.tracking?.[String(member.id)]?.status === 'revision_requested',
      });
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نسلّم المهمة — جرّب تاني.');
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
      toast.success(canGo ? 'جاهزية النزول الميداني اتفعّلت.' : 'جاهزية النزول الميداني اتوقفت.');
    } catch (cause) {
      toast.error(handleSupabaseError(cause).message || 'معرفناش نحدّث حالة الجاهزية.');
    } finally {
      setIsTogglingReadiness(false);
    }
  };

  const openSubmission = (task: Task) => {
    setSelectedTask(task);
    setSubmissionNote(task.tracking?.[memberId]?.note ?? '');
    setSubmissionUrl(task.tracking?.[memberId]?.submission_url ?? '');
  };

  const tabs: Array<{ key: PortalTab; label: string; icon: typeof Layers; badge?: number }> = [
    { key: 'ALL', label: 'كل الأقسام', icon: Layers },
    { key: 'TASKS', label: 'المهام', icon: CheckSquare, badge: myTasks.length || undefined },
    {
      key: 'EVALUATIONS',
      label: 'التقييمات',
      icon: ClipboardCheck,
      badge: unreadEvaluationsCount || undefined,
    },
    { key: 'ANNOUNCEMENTS', label: 'الإعلانات', icon: Bell },
  ];

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)]" dir="rtl">
      <PortalHeader onLogout={logout} />
      <WhatsAppNotificationCenter
        memberId={member.id}
        tasks={myTasks}
        evaluations={myEvaluations}
        onSelectTab={setActiveTab}
        onTestNotification={() => {
          void sendTestNotification();
        }}
      />
      <main className="mx-auto grid w-full max-w-[var(--content-max)] gap-6 px-4 pb-8 pt-5 sm:px-6 sm:pt-7">
        <MemberHero
          member={member}
          onToggleField={toggleFieldReadiness}
          isUpdating={isTogglingReadiness}
          totalBonus={bonusQuery.data ?? null}
          bonusInfinite={bonusInfiniteQuery.data === true}
          bonusLoading={bonusQuery.isLoading}
          bonusStateLoading={bonusInfiniteQuery.isLoading}
          bonusStateError={bonusInfiniteQuery.isError}
        />

        {/* شريط التنقل السريع بين أقسام البوابة */}
        <nav
          aria-label="أقسام بوابة العضو"
          className="grid grid-cols-2 gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-sm)] sm:grid-cols-4"
        >
          {tabs.map(({ key, label, icon: Icon, badge }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition-colors ${
                  active
                    ? 'bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                {typeof badge === 'number' && badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--primary-soft)] text-[var(--link)]'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {(activeTab === 'ALL' || activeTab === 'TASKS') && (
          <MemberTasks
            tasks={myTasks}
            memberId={memberId}
            isLoading={tasksQuery.isLoading}
            isError={tasksQuery.isError}
            onRetry={() => {
              void tasksQuery.refetch();
            }}
            onStart={startTask}
            onSubmit={openSubmission}
          />
        )}

        {(activeTab === 'ALL' || activeTab === 'EVALUATIONS') && (
          <MemberEvaluations memberId={member.id} />
        )}

        {(activeTab === 'ALL' || activeTab === 'ANNOUNCEMENTS') && (
          <MemberAnnouncements memberId={member.id} />
        )}
      </main>
      <SubmissionModal
        task={selectedTask}
        url={submissionUrl}
        note={submissionNote}
        isSubmitting={isSubmitting}
        onUrlChange={setSubmissionUrl}
        onNoteChange={setSubmissionNote}
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
    </div>
  );
}
